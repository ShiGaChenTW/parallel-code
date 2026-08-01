import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_TERMINAL_LABELS,
  TERMINAL_TARGETS,
  availableTerminalTargets,
  isExternalTerminalApp,
  isTerminalTarget,
  terminalLaunchSpec,
} from './terminal-launch.js';

/**
 * The launcher is a pure function so the per-app, per-platform argv can be
 * pinned without spawning anything. Every case below is a claim about a real
 * command line; getting one wrong means a button that silently does nothing on
 * someone else's machine, which is the failure mode this file exists to stop.
 */
describe('availableTerminalTargets', () => {
  it('offers all three on macOS', () => {
    expect(availableTerminalTargets('darwin')).toEqual(['builtin', 'ghostty', 'alacritty']);
  });

  it('offers all three on Linux', () => {
    // Both emulators ship for Linux, and the caller resolves their binary
    // through the same PATH import the editor setting uses — so hiding them
    // here would deny Linux users the whole feature to avoid a failure macOS
    // users are already allowed to hit and be told about.
    expect(availableTerminalTargets('linux')).toEqual(['builtin', 'ghostty', 'alacritty']);
  });

  it('offers only the built-in panel on a platform this app does not ship for', () => {
    expect(availableTerminalTargets('win32')).toEqual(['builtin']);
  });

  it('never offers a target outside the fixed list', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const target of availableTerminalTargets(platform)) {
        expect(TERMINAL_TARGETS).toContain(target);
      }
    }
  });

  it('always offers the built-in panel, on every platform', () => {
    // The load-bearing property of the whole design: whatever else is missing,
    // there is one target that cannot fail to be available.
    for (const platform of ['darwin', 'linux', 'win32', 'freebsd']) {
      expect(availableTerminalTargets(platform)).toContain('builtin');
    }
  });
});

describe('isTerminalTarget', () => {
  it('accepts the three shipped ids', () => {
    expect(isTerminalTarget('builtin')).toBe(true);
    expect(isTerminalTarget('ghostty')).toBe(true);
    expect(isTerminalTarget('alacritty')).toBe(true);
  });

  it('rejects anything else, so persisted state cannot widen the list', () => {
    expect(isTerminalTarget('iterm2')).toBe(false);
    // The id this setting used before the built-in panel became a target. A
    // state file written by a pre-release build must fall back, not be honoured
    // under a meaning it never had.
    expect(isTerminalTarget('system')).toBe(false);
    expect(isTerminalTarget('')).toBe(false);
    expect(isTerminalTarget(null)).toBe(false);
    expect(isTerminalTarget(42)).toBe(false);
  });
});

describe('isExternalTerminalApp', () => {
  it('separates the built-in panel from the launched apps', () => {
    expect(isExternalTerminalApp('builtin')).toBe(false);
    expect(isExternalTerminalApp('ghostty')).toBe(true);
    expect(isExternalTerminalApp('alacritty')).toBe(true);
  });

  it('labels every external app', () => {
    for (const target of TERMINAL_TARGETS) {
      if (!isExternalTerminalApp(target)) continue;
      expect(EXTERNAL_TERMINAL_LABELS[target]).toBeTruthy();
    }
  });
});

describe('terminalLaunchSpec on macOS', () => {
  const cwd = '/Users/me/code/project';

  it('opens a new Ghostty window at the directory', () => {
    // -n forces a new instance rather than raising the existing window, which
    // would land the user in whatever directory that window already had.
    expect(terminalLaunchSpec('ghostty', 'darwin', cwd)).toEqual({
      command: 'open',
      args: ['-na', 'Ghostty', '--args', `--working-directory=${cwd}`],
      cwd,
      exitsAfterLaunch: true,
    });
  });

  it('opens a new Alacritty window at the directory', () => {
    expect(terminalLaunchSpec('alacritty', 'darwin', cwd)).toEqual({
      command: 'open',
      args: ['-na', 'Alacritty', '--args', '--working-directory', cwd],
      cwd,
      exitsAfterLaunch: true,
    });
  });

  it('marks the launcher as one that exits, so a missing app is noticed', () => {
    // `open` always resolves from /usr/bin, so the spawn succeeds even when the
    // app bundle does not exist. Its exit status is the only signal there is.
    expect(terminalLaunchSpec('ghostty', 'darwin', cwd)?.exitsAfterLaunch).toBe(true);
  });
});

describe('terminalLaunchSpec on Linux', () => {
  const cwd = '/home/me/code/project';

  it('runs the Ghostty binary with the equals form of the flag', () => {
    expect(terminalLaunchSpec('ghostty', 'linux', cwd)).toEqual({
      command: 'ghostty',
      args: [`--working-directory=${cwd}`],
      cwd,
      exitsAfterLaunch: false,
    });
  });

  it('runs the Alacritty binary with the spaced form of the flag', () => {
    expect(terminalLaunchSpec('alacritty', 'linux', cwd)).toEqual({
      command: 'alacritty',
      args: ['--working-directory', cwd],
      cwd,
      exitsAfterLaunch: false,
    });
  });

  it('never asks the caller to wait for an emulator that owns a window', () => {
    // The process lives as long as the window. Waiting on its exit would hang
    // the IPC call until the user quit the terminal they just opened.
    expect(terminalLaunchSpec('alacritty', 'linux', cwd)?.exitsAfterLaunch).toBe(false);
  });

  it('passes a bare command name, leaving PATH resolution to the caller', () => {
    // Deliberately not an absolute path: main resolves it against the imported
    // login-shell PATH, which is the only place that knows where a user's
    // Homebrew or ~/.local/bin install lives.
    const spec = terminalLaunchSpec('ghostty', 'linux', cwd);
    expect(spec?.command).toBe('ghostty');
    expect(spec?.command).not.toContain('/');
  });
});

describe('terminalLaunchSpec refusals', () => {
  const cwd = '/Users/me/code/project';

  it('refuses a platform that offers no external terminal rather than guessing', () => {
    // Falling back to the built-in panel here would be worse than failing: the
    // user asked for Ghostty, and quietly opening something else is the kind of
    // bug nobody reports because it looks like it worked.
    expect(terminalLaunchSpec('ghostty', 'win32', cwd)).toBeNull();
    expect(terminalLaunchSpec('alacritty', 'win32', cwd)).toBeNull();
  });

  it('returns null for an empty working directory', () => {
    expect(terminalLaunchSpec('ghostty', 'darwin', '')).toBeNull();
    expect(terminalLaunchSpec('ghostty', 'linux', '   ')).toBeNull();
  });
});

describe('terminalLaunchSpec argument safety', () => {
  it('passes the path as one argv entry, never interpolated into a string', () => {
    // A worktree path can contain spaces, quotes and semicolons. Every spec is
    // consumed by spawn() without a shell, so the path must arrive as its own
    // element and must not be escaped or quoted here.
    const nasty = "/Users/me/a b/c'd;rm -rf x";
    const spec = terminalLaunchSpec('alacritty', 'darwin', nasty);
    expect(spec?.args).toContain(nasty);
    expect(spec?.args.some((arg) => arg.includes('\\') || arg.includes('"'))).toBe(false);
  });

  it("keeps a nasty path whole inside Ghostty's equals form", () => {
    const nasty = "/Users/me/a b/c'd;rm -rf x";
    const spec = terminalLaunchSpec('ghostty', 'darwin', nasty);
    expect(spec?.args).toContain(`--working-directory=${nasty}`);
    expect(spec?.cwd).toBe(nasty);
  });
});

/**
 * The value model is written twice — once here in `electron/terminal-launch.ts`,
 * once in `src/lib/native-terminal.ts` — because `no-renderer-importing-main`
 * forbids the renderer reaching into `electron/` and `electron/tsconfig.json`'s
 * `rootDir` forbids the reverse. That is the same bind `window-blur` and
 * `window-opacity` hit, and this is the same answer: duplicate, then pin the
 * copies together by reading the other one as text, since the two cannot be
 * imported into one program.
 *
 * Widening the dependency-cruiser exception instead was the alternative and was
 * rejected. Its two existing entries — `ipc/channels.ts` and
 * `mcp/prompt-detect.ts` — are platform-neutral pure data, whereas this file
 * also holds a per-platform argv table, which is precisely the class of thing
 * that rule keeps out of the renderer. The renderer does not need it: it sends
 * an id over IPC. Only the value model is shared, so only the value model is
 * duplicated.
 *
 * Drift is not cosmetic. A target the Settings picker offers that this file
 * refuses to launch is a button that silently does nothing.
 */
describe('parity with the renderer copy', () => {
  const root = resolve(__dirname, '..');
  const rendererSource = readFileSync(resolve(root, 'src', 'lib', 'native-terminal.ts'), 'utf8');
  const mainSource = readFileSync(resolve(root, 'electron', 'terminal-launch.ts'), 'utf8');

  function targetsIn(source: string): string {
    const match = /export const TERMINAL_TARGETS = \[([^\]]*)\] as const;/.exec(source);
    if (!match) throw new Error('TERMINAL_TARGETS is no longer a literal in both copies');
    return match[1].replace(/\s/g, '');
  }

  /** The body of a top-level `export function`, as written. */
  function bodyIn(source: string, name: string): string {
    const match = new RegExp(
      `export function ${name}\\([^)]*\\)[^{]*\\{\\n([\\s\\S]*?)\\n\\}`,
    ).exec(source);
    if (!match) throw new Error(`${name} changed shape and can no longer be compared as text`);
    return match[1];
  }

  it('offers exactly the same targets on both sides', () => {
    expect(targetsIn(rendererSource)).toBe(targetsIn(mainSource));
    // Pinned against the values under test, so the two copies cannot agree on a
    // set this suite is not the one asserting behaviour for.
    expect(targetsIn(mainSource)).toBe(TERMINAL_TARGETS.map((t) => `'${t}'`).join(','));
  });

  it('agrees on which platforms may offer what', () => {
    // The load-bearing one for Linux: if the renderer offered Ghostty where main
    // returns null, the picker would present a choice that always errors.
    expect(bodyIn(rendererSource, 'availableTerminalTargets')).toBe(
      bodyIn(mainSource, 'availableTerminalTargets'),
    );
  });

  it('agrees on which ids are accepted from persisted state', () => {
    expect(bodyIn(rendererSource, 'isTerminalTarget')).toBe(bodyIn(mainSource, 'isTerminalTarget'));
    expect(bodyIn(rendererSource, 'isExternalTerminalApp')).toBe(
      bodyIn(mainSource, 'isExternalTerminalApp'),
    );
  });

  it('agrees on the labels the two sides show and log', () => {
    // The renderer puts these in a tooltip and the settings card; main puts the
    // same word in the error message the renderer then displays. Two spellings
    // would read as two different features.
    const labels = (source: string) => {
      const match =
        /export const EXTERNAL_TERMINAL_LABELS: Record<ExternalTerminalApp, string> = \{([^}]*)\};/.exec(
          source,
        );
      if (!match) throw new Error('EXTERNAL_TERMINAL_LABELS is no longer a literal in both copies');
      return match[1].replace(/\s/g, '');
    };
    expect(labels(rendererSource)).toBe(labels(mainSource));
    expect(labels(mainSource)).toContain("ghostty:'Ghostty'");
  });

  it('keeps the argv table out of the renderer copy', () => {
    // The whole reason this is a duplication and not an exception in
    // `.dependency-cruiser.cjs`: the per-platform command lines are main's, and
    // the renderer has no business holding a second, unverified copy of them.
    expect(rendererSource).not.toContain('terminalLaunchSpec');
    expect(rendererSource).not.toContain('--working-directory');
  });
});
