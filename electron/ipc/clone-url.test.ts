import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeCloneUrl, repoFolderNameFromUrl, suggestedFolderName } from './clone-url.js';

/**
 * `normalizeCloneUrl` is the only thing standing between a pasted string and
 * `git clone`. Two separate jobs are being done and both are load-bearing:
 * accepting the handful of forms a person actually pastes, and refusing the
 * transports that turn a clone into arbitrary code execution.
 */
describe('normalizeCloneUrl', () => {
  describe('accepts the forms people paste', () => {
    it('takes an https URL unchanged', () => {
      expect(normalizeCloneUrl('https://github.com/solidjs/solid.git')).toBe(
        'https://github.com/solidjs/solid.git',
      );
    });

    it('takes an https URL without the .git suffix', () => {
      // What the green "Code" button copies, and what the address bar shows.
      expect(normalizeCloneUrl('https://github.com/solidjs/solid')).toBe(
        'https://github.com/solidjs/solid',
      );
    });

    it('takes the scp-like SSH form', () => {
      expect(normalizeCloneUrl('git@github.com:solidjs/solid.git')).toBe(
        'git@github.com:solidjs/solid.git',
      );
    });

    it('takes an explicit ssh:// URL', () => {
      expect(normalizeCloneUrl('ssh://git@github.com/solidjs/solid.git')).toBe(
        'ssh://git@github.com/solidjs/solid.git',
      );
    });

    it('expands the owner/repo shorthand to a GitHub https URL', () => {
      expect(normalizeCloneUrl('solidjs/solid')).toBe('https://github.com/solidjs/solid.git');
    });

    it('trims surrounding whitespace, which a paste routinely carries', () => {
      expect(normalizeCloneUrl('  https://github.com/solidjs/solid.git \n')).toBe(
        'https://github.com/solidjs/solid.git',
      );
    });

    it('accepts a self-hosted https host, not only github.com', () => {
      expect(normalizeCloneUrl('https://git.example.org/team/thing.git')).toBe(
        'https://git.example.org/team/thing.git',
      );
    });
  });

  describe('refuses what must never reach git', () => {
    it('rejects the empty string', () => {
      expect(normalizeCloneUrl('')).toBeNull();
      expect(normalizeCloneUrl('   ')).toBeNull();
    });

    it('rejects the ext:: transport, which runs an arbitrary command', () => {
      // `git clone 'ext::sh -c whoami'` executes `sh`. This is the single most
      // important line in this file: a URL field that reaches git unfiltered is
      // a remote code execution primitive wearing a text input.
      expect(normalizeCloneUrl('ext::sh -c whoami')).toBeNull();
      expect(normalizeCloneUrl('EXT::sh -c whoami')).toBeNull();
    });

    it('rejects a leading dash, which git would read as an option', () => {
      // `--upload-pack=<cmd>` is the other command-execution route. The spawn
      // also passes `--` before the URL, so this is belt and braces.
      expect(normalizeCloneUrl('--upload-pack=touch /tmp/pwned')).toBeNull();
      expect(normalizeCloneUrl('-u evil')).toBeNull();
    });

    it('rejects file:// and bare local paths — this is the *remote* clone path', () => {
      // "Choose a local folder" already handles a repository on this machine.
      // A local path here would also bypass the offline-mode gate.
      expect(normalizeCloneUrl('file:///etc')).toBeNull();
      expect(normalizeCloneUrl('/Users/someone/code/thing')).toBeNull();
      expect(normalizeCloneUrl('../thing')).toBeNull();
    });

    it('rejects the unauthenticated git:// transport', () => {
      // No encryption and no server authentication: whoever is between you and
      // the host chooses what source code you receive.
      expect(normalizeCloneUrl('git://github.com/solidjs/solid.git')).toBeNull();
    });

    it('rejects plaintext http, which would put credentials on the wire', () => {
      expect(normalizeCloneUrl('http://github.com/solidjs/solid.git')).toBeNull();
    });

    it('rejects a scheme with no host', () => {
      // A prefix test would accept these. The renderer copy used to, and the
      // Clone button lit up on an address the main process then refused.
      expect(normalizeCloneUrl('https://')).toBeNull();
      expect(normalizeCloneUrl('ssh://')).toBeNull();
    });

    it('rejects a shorthand that is not exactly owner/repo', () => {
      expect(normalizeCloneUrl('solid')).toBeNull();
      expect(normalizeCloneUrl('a/b/c')).toBeNull();
      expect(normalizeCloneUrl('../../etc/passwd')).toBeNull();
    });

    it('rejects embedded newlines rather than cloning the first line', () => {
      expect(normalizeCloneUrl('https://github.com/a/b\nrm -rf /')).toBeNull();
    });
  });
});

describe('repoFolderNameFromUrl', () => {
  it('uses the last path segment', () => {
    expect(repoFolderNameFromUrl('https://github.com/solidjs/solid.git')).toBe('solid');
    expect(repoFolderNameFromUrl('https://github.com/solidjs/solid')).toBe('solid');
  });

  it('handles the scp-like form, where the separator is a colon', () => {
    expect(repoFolderNameFromUrl('git@github.com:solidjs/solid.git')).toBe('solid');
  });

  it('ignores a trailing slash', () => {
    expect(repoFolderNameFromUrl('https://github.com/solidjs/solid/')).toBe('solid');
  });

  it('keeps dots that are part of the name, dropping only the .git suffix', () => {
    expect(repoFolderNameFromUrl('https://github.com/o/next.js.git')).toBe('next.js');
  });

  it('returns null when there is no segment to name a folder after', () => {
    expect(repoFolderNameFromUrl('https://github.com/')).toBeNull();
    expect(repoFolderNameFromUrl('https://github.com')).toBeNull();
  });

  it('never yields a name that could escape the chosen parent directory', () => {
    // The contract is not "reject these inputs" — it is "whatever comes back
    // is a single, inert path segment", because the result is joined onto a
    // directory the user picked.
    const hostile = [
      'https://github.com/o/..',
      'git@github.com:o/..',
      'git@github.com:o/../../etc',
      'https://github.com/o/.',
      'https://github.com/a/b%2F..%2Fc',
    ];
    for (const url of hostile) {
      const name = repoFolderNameFromUrl(url);
      if (name === null) continue;
      expect(name, url).not.toBe('.');
      expect(name, url).not.toBe('..');
      expect(name, url).not.toContain('/');
      expect(name, url).not.toContain('\\');
    }
  });
});

describe('suggestedFolderName', () => {
  it('is the same answer with "" for null, so it can bind to an input value', () => {
    expect(suggestedFolderName('https://github.com/solidjs/solid.git')).toBe('solid');
    expect(suggestedFolderName('')).toBe('');
    expect(suggestedFolderName('https://github.com/')).toBe('');
  });

  it('tolerates half-typed input, since the dialog calls it on every keystroke', () => {
    expect(suggestedFolderName('htt')).toBe('htt');
    expect(suggestedFolderName('solidjs/solid')).toBe('solid');
  });
});

/**
 * The value model is written twice — once here, once in `src/lib/clone-url.ts`
 * — because `no-renderer-importing-main` forbids the renderer reaching into
 * `electron/` and `electron/tsconfig.json`'s `rootDir` forbids the reverse.
 * Same constraint, same remedy, and same shape as `parity with the renderer
 * copy` in `window-blur.test.ts`.
 *
 * The first draft of this feature widened the dependency-cruiser allowlist to
 * share one module instead. That was reverted: the existing allowlist entries
 * are inert by construction (a JSON re-export, a regex), whereas this module's
 * own first draft reached for `path.basename` — a Node import — in a file that
 * sits beside one which spawns subprocesses. A widened gate is inherited by
 * every future edit; this test is not.
 *
 * Drift here is not cosmetic. The renderer copy decides whether the Clone
 * button is enabled. If it grows more permissive than this file, the button
 * lights up on addresses that are then refused, and the user is told to fix
 * something the UI told them was fine.
 */
describe('parity with the renderer copy', () => {
  const root = resolve(__dirname, '..', '..');
  const rendererSource = readFileSync(join(root, 'src', 'lib', 'clone-url.ts'), 'utf8');
  const mainSource = readFileSync(join(root, 'electron', 'ipc', 'clone-url.ts'), 'utf8');

  /** The body of a top-level `export function`, as written. */
  function bodyIn(source: string, name: string): string {
    const match = new RegExp(
      `export function ${name}\\([^)]*\\)[^{]*\\{\\n([\\s\\S]*?)\\n\\}`,
    ).exec(source);
    if (!match) throw new Error(`${name} changed shape and can no longer be compared as text`);
    return match[1];
  }

  /** A top-level `const NAME = ...;` declaration, as written. */
  function constIn(source: string, name: string): string {
    const match = new RegExp(`const ${name} = (.*);`).exec(source);
    if (!match) throw new Error(`${name} is no longer a literal in both copies`);
    return match[1];
  }

  it('agrees on which transports are allowed', () => {
    expect(constIn(rendererSource, 'ALLOWED_SCHEMES')).toBe(constIn(mainSource, 'ALLOWED_SCHEMES'));
    // Pinned against the values under test, so the two copies cannot agree on
    // a set this suite is not the one asserting behaviour for.
    expect(constIn(mainSource, 'ALLOWED_SCHEMES')).toBe("new Set(['https:', 'ssh:'])");
  });

  it('agrees on how a shorthand and an scp-like address are recognised', () => {
    expect(constIn(rendererSource, 'SHORTHAND')).toBe(constIn(mainSource, 'SHORTHAND'));
    expect(constIn(rendererSource, 'SCP_LIKE')).toBe(constIn(mainSource, 'SCP_LIKE'));
  });

  it('agrees on the URL normalization, character for character', () => {
    expect(bodyIn(rendererSource, 'normalizeCloneUrl')).toBe(
      bodyIn(mainSource, 'normalizeCloneUrl'),
    );
  });

  it('agrees on the folder naming, character for character', () => {
    expect(bodyIn(rendererSource, 'repoFolderNameFromUrl')).toBe(
      bodyIn(mainSource, 'repoFolderNameFromUrl'),
    );
    expect(bodyIn(rendererSource, 'suggestedFolderName')).toBe(
      bodyIn(mainSource, 'suggestedFolderName'),
    );
  });

  it('keeps the renderer copy free of imports, which is what makes it copyable', () => {
    // An import in the renderer copy means it has grown a dependency the main
    // copy does not share, and the body comparison above would stop meaning
    // what it claims to mean.
    expect(rendererSource).not.toMatch(/^\s*import\s/m);
    expect(mainSource).not.toMatch(/^\s*import\s/m);
  });
});
