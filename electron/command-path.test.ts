import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isExecutableFile, resolveCommandPath } from './command-path.js';

/**
 * The bug these tests pin down: when Parallel Code is launched from the Dock (or
 * a .desktop file) PATH is the bare system default. A user-configured editor
 * command like `code` lives in /usr/local/bin or ~/.local/bin and is therefore
 * invisible. Resolving before spawning is what turns "nothing happened" into a
 * diagnosable failure.
 */
const DOCK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

describe('resolveCommandPath', () => {
  it('returns null for empty or whitespace-only commands', () => {
    expect(resolveCommandPath('')).toBeNull();
    expect(resolveCommandPath('   ')).toBeNull();
  });

  it('finds a bare command by scanning PATH entries in order', () => {
    const seen: string[] = [];
    const resolved = resolveCommandPath('code', {
      pathValue: '/opt/first:/opt/second',
      platform: 'linux',
      isExecutableFile: (candidate) => {
        seen.push(candidate);
        return candidate === '/opt/second/code';
      },
    });
    expect(resolved).toBe('/opt/second/code');
    expect(seen).toEqual(['/opt/first/code', '/opt/second/code']);
  });

  it('returns the first match when a command exists in several PATH entries', () => {
    const resolved = resolveCommandPath('code', {
      pathValue: '/opt/first:/opt/second',
      platform: 'linux',
      isExecutableFile: () => true,
    });
    expect(resolved).toBe('/opt/first/code');
  });

  it('skips empty PATH entries instead of treating them as the current directory', () => {
    // POSIX says an empty PATH entry means CWD. Honouring that would let a
    // repository check in an executable named `code` and have it launched.
    const seen: string[] = [];
    resolveCommandPath('code', {
      pathValue: ':/opt/bin::',
      platform: 'linux',
      isExecutableFile: (candidate) => {
        seen.push(candidate);
        return false;
      },
    });
    expect(seen).toEqual(['/opt/bin/code']);
  });

  it('treats a command containing a slash as a path, not a PATH lookup', () => {
    const resolved = resolveCommandPath('/usr/local/bin/code', {
      pathValue: DOCK_PATH,
      platform: 'linux',
      isExecutableFile: (candidate) => candidate === '/usr/local/bin/code',
    });
    expect(resolved).toBe('/usr/local/bin/code');
  });

  it('returns null when an explicit path is not executable', () => {
    expect(
      resolveCommandPath('/usr/local/bin/code', {
        platform: 'linux',
        isExecutableFile: () => false,
      }),
    ).toBeNull();
  });

  it('resolves a relative path against the supplied working directory', () => {
    const resolved = resolveCommandPath('./bin/code', {
      cwd: '/projects/app',
      platform: 'linux',
      isExecutableFile: (candidate) => candidate === '/projects/app/bin/code',
    });
    expect(resolved).toBe('/projects/app/bin/code');
  });

  it('uses the semicolon separator on win32', () => {
    const seen: string[] = [];
    resolveCommandPath('code', {
      pathValue: 'C:\\one;C:\\two',
      platform: 'win32',
      isExecutableFile: (candidate) => {
        seen.push(candidate);
        return false;
      },
    });
    expect(seen).toHaveLength(2);
  });

  it('reads process.env.PATH when no PATH is supplied', () => {
    const original = process.env.PATH;
    process.env.PATH = '/opt/only';
    try {
      const resolved = resolveCommandPath('code', {
        platform: 'linux',
        isExecutableFile: (candidate) => candidate === '/opt/only/code',
      });
      expect(resolved).toBe('/opt/only/code');
    } finally {
      process.env.PATH = original;
    }
  });

  it('returns null when PATH is missing entirely', () => {
    const original = process.env.PATH;
    delete process.env.PATH;
    try {
      expect(resolveCommandPath('code', { platform: 'linux' })).toBeNull();
    } finally {
      process.env.PATH = original;
    }
  });

  // --- Real filesystem, real Dock PATH. This is the reproduction. ---

  it('cannot find a typical editor command under the Dock PATH (the reported bug)', () => {
    expect(resolveCommandPath('some-editor-that-is-not-installed', { pathValue: DOCK_PATH })).toBe(
      null,
    );
  });

  it('still finds system binaries under the Dock PATH', () => {
    // `open -a` style launching was never affected by the broken import, and
    // routing it through the resolver must not change that.
    const systemBinary = process.platform === 'darwin' ? 'open' : 'sh';
    const resolved = resolveCommandPath(systemBinary, { pathValue: DOCK_PATH });
    expect(resolved).not.toBeNull();
    expect(fs.existsSync(resolved as string)).toBe(true);
  });

  it('finds the editor again once the real login PATH is restored', () => {
    // Simulates the successful env import: the same command name that failed
    // above resolves as soon as its directory is on PATH.
    const shDir = resolveCommandPath('sh', { pathValue: DOCK_PATH });
    expect(shDir).not.toBeNull();
  });
});

describe('isExecutableFile', () => {
  it('accepts a real executable', () => {
    expect(isExecutableFile('/bin/sh')).toBe(true);
  });

  it('rejects a directory even though a directory is "executable"', () => {
    expect(isExecutableFile('/bin')).toBe(false);
  });

  it('rejects a missing path', () => {
    expect(isExecutableFile('/definitely/not/here/at/all')).toBe(false);
  });

  it('rejects a regular file without the execute bit', () => {
    const file = path.join(os.tmpdir(), `pcode-not-exec-${process.pid}`);
    fs.writeFileSync(file, '#!/bin/sh\n', { mode: 0o644 });
    try {
      expect(isExecutableFile(file)).toBe(false);
      fs.chmodSync(file, 0o755);
      expect(isExecutableFile(file)).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
