import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveCommandPath } from '../command-path.js';
import {
  branchNameArg,
  openExternalHttpUrl,
  optionalBaseBranch,
  projectRootArg,
  resolveSpawnExecutable,
  selectMcpJsonDir,
  validateEditorCommand,
  validateExternalTerminalApp,
  validateExternalHttpUrl,
  worktreePathArg,
} from './register.js';

describe('selectMcpJsonDir', () => {
  it('returns worktreePath when defined', () => {
    expect(selectMcpJsonDir('/worktrees/my-task', '/project')).toBe('/worktrees/my-task');
  });

  it('returns projectRoot when worktreePath is undefined', () => {
    expect(selectMcpJsonDir(undefined, '/project')).toBe('/project');
  });

  it('returns empty string when worktreePath is empty string (nullish coalescing only catches null/undefined)', () => {
    expect(selectMcpJsonDir('', '/project')).toBe('');
  });
});

describe('validateExternalHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(validateExternalHttpUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
    expect(validateExternalHttpUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('normalizes protocol and host casing', () => {
    expect(validateExternalHttpUrl('HTTPS://EXAMPLE.COM/pr/1')).toBe('https://example.com/pr/1');
  });

  it('rejects non-web protocols', () => {
    expect(() => validateExternalHttpUrl('file:///etc/passwd')).toThrow(
      'url must use http or https',
    );
    expect(() => validateExternalHttpUrl('javascript:alert(1)')).toThrow(
      'url must use http or https',
    );
  });

  it('rejects invalid and non-string values', () => {
    expect(() => validateExternalHttpUrl('not a url')).toThrow('url must be a valid URL');
    expect(() => validateExternalHttpUrl(undefined)).toThrow('url must be a string');
  });
});

describe('Git IPC argument helpers', () => {
  it('returns validated absolute paths', () => {
    expect(projectRootArg({ projectRoot: '/repo' })).toBe('/repo');
    expect(worktreePathArg({ worktreePath: '/repo/.worktrees/task' })).toBe(
      '/repo/.worktrees/task',
    );
  });

  it('rejects invalid absolute path fields', () => {
    expect(() => projectRootArg({ projectRoot: 'relative' })).toThrow(
      'projectRoot must be absolute',
    );
    expect(() => worktreePathArg({ worktreePath: '/tmp/../repo' })).toThrow(
      'worktreePath must not contain ".."',
    );
  });

  it('normalizes optional baseBranch using existing Git handler semantics', () => {
    expect(optionalBaseBranch({})).toBeUndefined();
    expect(optionalBaseBranch({ baseBranch: '' })).toBeUndefined();
    expect(optionalBaseBranch({ baseBranch: 'feature/base' })).toBe('feature/base');
  });

  it('rejects invalid branch fields', () => {
    expect(() => branchNameArg({ branchName: '../main' })).toThrow('branchName');
    expect(() => optionalBaseBranch({ baseBranch: '../main' })).toThrow('baseBranch');
  });
});

describe('openExternalHttpUrl', () => {
  it('opens the normalized URL', async () => {
    const opened: string[] = [];

    await openExternalHttpUrl('HTTPS://EXAMPLE.COM/pr/1', async (url) => {
      opened.push(url);
    });

    expect(opened).toEqual(['https://example.com/pr/1']);
  });

  it('does not call the opener for invalid URLs', async () => {
    const opened: string[] = [];

    await expect(
      openExternalHttpUrl('file:///etc/passwd', async (url) => {
        opened.push(url);
      }),
    ).rejects.toThrow('url must use http or https');

    expect(opened).toEqual([]);
  });

  it('does not include the URL in opener failure errors', async () => {
    await expect(
      openExternalHttpUrl('https://example.com/?token=secret', async (url) => {
        throw new Error(`OS refused ${url}`);
      }),
    ).rejects.toThrow('Failed to open external URL');
  });
});

/**
 * PATH as an app launched from the Dock (macOS) or a .desktop file (Linux)
 * actually sees it. Every editor a user configures lives outside this.
 */
const DOCK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

describe('validateEditorCommand', () => {
  it('accepts a plain command name and trims it', () => {
    expect(validateEditorCommand('  code  ')).toBe('code');
  });

  it('accepts an absolute path', () => {
    expect(validateEditorCommand('/usr/local/bin/code')).toBe('/usr/local/bin/code');
  });

  it('rejects empty and non-string values', () => {
    expect(() => validateEditorCommand('')).toThrow('editorCommand must be a non-empty string');
    expect(() => validateEditorCommand('   ')).toThrow('editorCommand must be a non-empty string');
    expect(() => validateEditorCommand(undefined)).toThrow(
      'editorCommand must be a non-empty string',
    );
    expect(() => validateEditorCommand(42)).toThrow('editorCommand must be a non-empty string');
  });

  it('still rejects every shell metacharacter the handler used to reject', () => {
    // Resolution was added after this gate, never in place of it. These cases
    // are the regression fence for that ordering.
    for (const cmd of [
      'code; rm -rf /',
      'code && curl evil.sh',
      'code | tee',
      'code `whoami`',
      'code $(whoami)',
      'code > /etc/passwd',
      'code < /etc/passwd',
      'code {a,b}',
      'code [a]',
      "code 'x'",
      'code "x"',
      'code *',
      'code ?',
      'code !',
      'code #',
      '~/bin/code',
      'code\\x',
    ]) {
      expect(() => validateEditorCommand(cmd)).toThrow('shell metacharacters');
    }
  });
});

/**
 * The terminal picker's gate. Deliberately an allowlist rather than the
 * character filter `validateEditorCommand` uses: this value is never typed by a
 * user, only chosen from two cards, so anything else arriving here came from a
 * hand-edited state file or a bug — and in both cases the right answer is to
 * refuse before spawning, not to sanitise.
 */
describe('validateExternalTerminalApp', () => {
  it('accepts the two launchable apps', () => {
    expect(validateExternalTerminalApp('ghostty')).toBe('ghostty');
    expect(validateExternalTerminalApp('alacritty')).toBe('alacritty');
  });

  it('refuses the built-in panel, which is not a thing main can launch', () => {
    // The renderer handles this branch itself and never reaches IPC with it, so
    // seeing it here means the setting leaked into the wrong path.
    expect(() => validateExternalTerminalApp('builtin')).toThrow('app must be one of');
  });

  it('refuses anything outside the list rather than guessing', () => {
    for (const bad of [undefined, null, 42, {}, '', 'iterm2', 'system', 'x-terminal-emulator']) {
      expect(() => validateExternalTerminalApp(bad)).toThrow('app must be one of');
    }
  });
});

describe('resolveSpawnExecutable', () => {
  const okStatus = {
    state: 'ok' as const,
    attempts: 1,
    lastError: null,
    visiblePath: '/usr/local/bin:/usr/bin:/bin',
  };
  const failedStatus = {
    state: 'failed' as const,
    attempts: 3,
    lastError: 'spawn /bin/zsh ETIMEDOUT',
    visiblePath: DOCK_PATH,
  };

  it('returns the absolute path so spawn never has to search PATH itself', async () => {
    await expect(
      resolveSpawnExecutable('code', {
        waitForEnv: async () => okStatus,
        resolve: () => '/usr/local/bin/code',
      }),
    ).resolves.toBe('/usr/local/bin/code');
  });

  it('waits for the PATH import before resolving', async () => {
    // The race the retry introduces: resolving first would consult the stale
    // PATH and report a perfectly installed editor as missing.
    const order: string[] = [];
    await resolveSpawnExecutable('code', {
      waitForEnv: async () => {
        order.push('wait');
        return okStatus;
      },
      resolve: () => {
        order.push('resolve');
        return '/usr/local/bin/code';
      },
    });
    expect(order).toEqual(['wait', 'resolve']);
  });

  it('blames the editor setting when PATH was imported correctly', async () => {
    await expect(
      resolveSpawnExecutable('code', {
        waitForEnv: async () => okStatus,
        resolve: () => null,
      }),
    ).rejects.toThrow(/Could not find "code" in PATH\. Check that it is installed/);
  });

  it('blames the PATH import when that is what actually failed', async () => {
    // The whole fix in one assertion: the user set `code`, `code` is installed,
    // and the reason it will not launch has nothing to do with the setting.
    await expect(
      resolveSpawnExecutable('code', {
        waitForEnv: async () => failedStatus,
        resolve: () => null,
      }),
    ).rejects.toThrow(/could not load your shell PATH at startup/);
  });

  it('shows the PATH it can actually see, so the claim is checkable', async () => {
    await expect(
      resolveSpawnExecutable('code', {
        waitForEnv: async () => failedStatus,
        resolve: () => null,
      }),
    ).rejects.toThrow(/\/usr\/bin:\/bin:\/usr\/sbin:\/sbin/);
  });

  // --- Real resolver, real filesystem, the Dock's PATH ---

  it('reproduces the bug end to end with a real PATH search', async () => {
    await expect(
      resolveSpawnExecutable('code', {
        waitForEnv: async () => failedStatus,
        resolve: (command) => resolveCommandPath(command, { pathValue: DOCK_PATH }),
      }),
    ).rejects.toThrow(/Could not find "code"/);
  });

  it('leaves `open`-style launching working under the Dock PATH', async () => {
    // macOS `open` lives in /usr/bin and was never affected. Routing everything
    // through the resolver must not regress the case that already worked.
    const systemBinary = process.platform === 'darwin' ? 'open' : 'sh';
    await expect(
      resolveSpawnExecutable(systemBinary, {
        waitForEnv: async () => failedStatus,
        resolve: (command) => resolveCommandPath(command, { pathValue: DOCK_PATH }),
      }),
    ).resolves.toMatch(/^\/(usr\/)?bin\//);
  });

  it('finds the same command once the login PATH has been imported', async () => {
    const loginPath = `${path.dirname(process.execPath)}:${DOCK_PATH}`;
    await expect(
      resolveSpawnExecutable(path.basename(process.execPath), {
        waitForEnv: async () => okStatus,
        resolve: (command) => resolveCommandPath(command, { pathValue: loginPath }),
      }),
    ).resolves.toBe(process.execPath);
  });
});
