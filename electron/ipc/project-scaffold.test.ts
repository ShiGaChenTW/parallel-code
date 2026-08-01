import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SPECGATE_COMMAND,
  createProjectFolder,
  runSpecgateInit,
  validateProjectFolderName,
} from './project-scaffold.js';

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-scaffold-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length) {
    const dir = tempRoots.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The name is joined onto a directory the user picked in a native folder
 * chooser. Everything rejected here is rejected because of that join.
 */
describe('validateProjectFolderName', () => {
  it('accepts an ordinary name', () => {
    const result = validateProjectFolderName('my-new-project');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe('my-new-project');
  });

  it('trims surrounding whitespace rather than creating a folder with it', () => {
    const result = validateProjectFolderName('  spaced  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe('spaced');
  });

  it('allows inner spaces, which macOS users genuinely use', () => {
    const result = validateProjectFolderName('My Project');
    expect(result.ok).toBe(true);
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(validateProjectFolderName('').ok).toBe(false);
    expect(validateProjectFolderName('   ').ok).toBe(false);
  });

  it('rejects a path separator, which would place the folder somewhere else', () => {
    expect(validateProjectFolderName('a/b').ok).toBe(false);
    expect(validateProjectFolderName('a\\b').ok).toBe(false);
  });

  it('rejects the dot segments outright', () => {
    expect(validateProjectFolderName('.').ok).toBe(false);
    expect(validateProjectFolderName('..').ok).toBe(false);
  });

  it('rejects a leading dot, which would hide the project from the user', () => {
    // Legal on disk, but a project folder nobody can see in Finder is a
    // support question, not a feature.
    expect(validateProjectFolderName('.hidden').ok).toBe(false);
  });

  it('rejects a leading dash, which reads as a flag to every CLI it is passed to', () => {
    expect(validateProjectFolderName('-rf').ok).toBe(false);
  });

  it('rejects control characters and NUL', () => {
    expect(validateProjectFolderName('a\0b').ok).toBe(false);
    expect(validateProjectFolderName('a\nb').ok).toBe(false);
  });

  it('rejects a name long enough to break the filesystem', () => {
    expect(validateProjectFolderName('x'.repeat(256)).ok).toBe(false);
  });

  it('always explains a rejection — the field renders the reason inline', () => {
    for (const bad of ['', '.', '..', 'a/b', '-rf', '.hidden', 'x'.repeat(256)]) {
      const result = validateProjectFolderName(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('createProjectFolder', () => {
  it('creates the folder and returns its absolute path', async () => {
    const parent = tempDir();
    const created = await createProjectFolder(parent, 'thing');
    expect(created).toBe(path.join(parent, 'thing'));
    expect(fs.statSync(created).isDirectory()).toBe(true);
  });

  it('refuses when something already exists at that path', async () => {
    // Not `mkdir -p`. Silently adopting an existing folder is how a "new
    // project" quietly becomes "the contents of whatever was already there".
    const parent = tempDir();
    fs.mkdirSync(path.join(parent, 'taken'));
    await expect(createProjectFolder(parent, 'taken')).rejects.toThrow(/already exists/i);
  });

  it('refuses a name that would escape the parent directory', async () => {
    const parent = tempDir();
    await expect(createProjectFolder(parent, '../escaped')).rejects.toThrow();
    expect(fs.existsSync(path.join(path.dirname(parent), 'escaped'))).toBe(false);
  });

  it('refuses when the parent does not exist, rather than creating a tree', async () => {
    const parent = path.join(tempDir(), 'no', 'such', 'place');
    await expect(createProjectFolder(parent, 'thing')).rejects.toThrow();
  });
});

/**
 * S.CodingFlow initialisation.
 *
 * `runSpecgateInit` is written against an injectable resolver and runner so the
 * "tool is not installed" branch is testable on a machine where it *is*
 * installed, and so the test suite never shells out to a real binary that
 * writes files.
 */
describe('runSpecgateInit', () => {
  it('names the documented command', () => {
    // Recorded as a constant so the verified command name is asserted rather
    // than buried in a spawn call.
    expect(SPECGATE_COMMAND).toBe('scvb-specgate');
  });

  it('reports a clean skip when the CLI is not on PATH', async () => {
    const result = await runSpecgateInit('/tmp/x', {
      resolve: () => null,
      run: () => Promise.reject(new Error('should not run')),
    });
    expect(result.ran).toBe(false);
    if (!result.ran) {
      // The folder was still created and the project still added, so this is
      // information, not a failure. It has to say what to install.
      expect(result.reason).toContain('scvb-specgate');
    }
  });

  it('runs `init` in the new folder when the CLI is present', async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const result = await runSpecgateInit('/tmp/newproj', {
      resolve: () => '/opt/homebrew/bin/scvb-specgate',
      run: (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        return Promise.resolve();
      },
    });

    expect(result.ran).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('/opt/homebrew/bin/scvb-specgate');
    // Exactly `init`, and nothing else. `setup --yes` is deliberately not run
    // here — it merges hooks into the project's .claude/settings.json, which is
    // a change to the user's agent configuration and not ours to make silently.
    expect(calls[0].args).toEqual(['init']);
    expect(calls[0].cwd).toBe('/tmp/newproj');
  });

  it('reports a failed init as a skip, not as a failed project creation', async () => {
    // The folder exists and the project is about to be added. Throwing here
    // would strand a created folder behind an error dialog.
    const result = await runSpecgateInit('/tmp/newproj', {
      resolve: () => '/opt/homebrew/bin/scvb-specgate',
      run: () => Promise.reject(new Error('exit 1: PRD.md is missing Non-Goals')),
    });
    expect(result.ran).toBe(false);
    if (!result.ran) expect(result.reason).toContain('Non-Goals');
  });
});
