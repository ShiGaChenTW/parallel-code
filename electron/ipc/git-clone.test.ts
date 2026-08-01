import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classifyCloneFailure, cloneEnv, parseCloneProgress } from './git-clone.js';
import { setOfflineMode } from './offline.js';

beforeEach(() => setOfflineMode(false));
afterEach(() => setOfflineMode(false));

/**
 * Every branch here exists because the raw git message for it is either
 * meaningless to a non-git user or actively misleading. The assertion each test
 * makes is not about wording — it is that the message names the *next action*.
 */
describe('classifyCloneFailure', () => {
  it('reports a cancel as a cancel, not as a git error', () => {
    const failure = classifyCloneFailure('', { cancelled: true, code: null, signal: 'SIGTERM' });
    expect(failure.kind).toBe('cancelled');
    expect(failure.message).toContain('cancel');
  });

  it('turns "could not read Username" into credential setup instructions', () => {
    // What a private HTTPS repo produces once terminal prompting is disabled.
    // Raw, it reads as a bug in the app.
    const failure = classifyCloneFailure(
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('auth');
    expect(failure.message).toContain('gh auth login');
    expect(failure.message).toContain('SSH');
  });

  it('treats an HTTPS authentication failure as the same credential problem', () => {
    const failure = classifyCloneFailure(
      'fatal: Authentication failed for https://github.com/a/b',
      {
        cancelled: false,
        code: 128,
        signal: null,
      },
    );
    expect(failure.kind).toBe('auth');
    expect(failure.message).toContain('gh auth login');
  });

  it('treats an SSH publickey rejection as a credential problem naming SSH', () => {
    const failure = classifyCloneFailure(
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('auth');
    expect(failure.message).toContain('SSH');
  });

  it('says a "not found" may simply be a private repo you cannot see', () => {
    // GitHub returns 404 rather than 403 for a private repo you are not
    // authorised for, so "check the URL" alone sends people the wrong way.
    const failure = classifyCloneFailure(
      "remote: Repository not found.\nfatal: repository 'https://github.com/a/b/' not found",
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('not-found');
    expect(failure.message).toContain('private');
  });

  it('names the destination when the folder is already taken', () => {
    const failure = classifyCloneFailure(
      "fatal: destination path 'solid' already exists and is not an empty directory.",
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('destination-exists');
    expect(failure.message).toMatch(/name|folder/i);
  });

  it('distinguishes an unresolvable host from a credential problem', () => {
    const failure = classifyCloneFailure(
      "fatal: unable to access 'https://github.com/a/b/': Could not resolve host: github.com",
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('network');
    expect(failure.message).toMatch(/connection|network|offline/i);
  });

  it('reports a full disk as a full disk', () => {
    const failure = classifyCloneFailure('fatal: write error: No space left on device', {
      cancelled: false,
      code: 128,
      signal: null,
    });
    expect(failure.kind).toBe('disk-full');
    expect(failure.message).toMatch(/space/i);
  });

  it('reports an unwritable destination separately from a full disk', () => {
    const failure = classifyCloneFailure(
      "fatal: could not create work tree dir 'x': Permission denied",
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('destination-unwritable');
    expect(failure.message).toMatch(/permission|write/i);
  });

  it('reports an untrusted SSH host key as its own thing', () => {
    // BatchMode means ssh cannot ask "are you sure?", so this arrives as a
    // hard failure where an interactive terminal would have offered a prompt.
    const failure = classifyCloneFailure(
      'Host key verification failed.\nfatal: Could not read from remote repository.',
      { cancelled: false, code: 128, signal: null },
    );
    expect(failure.kind).toBe('host-key');
    expect(failure.message).toContain('known_hosts');
  });

  it('falls back to the last git line rather than swallowing it', () => {
    const failure = classifyCloneFailure('warning: something\nfatal: some unfamiliar git problem', {
      cancelled: false,
      code: 128,
      signal: null,
    });
    expect(failure.kind).toBe('unknown');
    expect(failure.message).toContain('some unfamiliar git problem');
  });

  it('never returns an empty message, even from a silent failure', () => {
    const failure = classifyCloneFailure('', { cancelled: false, code: 1, signal: null });
    expect(failure.message.trim().length).toBeGreaterThan(0);
  });

  it('gives every kind a distinct message', () => {
    const samples: string[] = [
      'fatal: could not read Username',
      'remote: Repository not found.',
      "fatal: destination path 'x' already exists and is not an empty directory.",
      'Could not resolve host: github.com',
      'No space left on device',
      "could not create work tree dir 'x': Permission denied",
      'Host key verification failed.',
      'fatal: unfamiliar',
    ];
    const messages = samples.map(
      (s) => classifyCloneFailure(s, { cancelled: false, code: 128, signal: null }).message,
    );
    expect(new Set(messages).size).toBe(samples.length);
  });
});

/**
 * The environment is not a detail. Without it a clone of a private repo over
 * HTTPS blocks forever on a username prompt written to a pipe nobody reads —
 * the UI shows a spinner that never resolves and the only cure is Cancel.
 */
describe('cloneEnv', () => {
  it('disables git terminal prompting so a private repo fails instead of hanging', () => {
    expect(cloneEnv({}).GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('puts ssh in batch mode for the same reason', () => {
    expect(cloneEnv({}).GIT_SSH_COMMAND).toContain('BatchMode=yes');
  });

  it('leaves a GIT_SSH_COMMAND the user configured alone', () => {
    // Their command may point at a specific identity file or a jump host.
    // Overwriting it would break exactly the users who set it deliberately.
    const env = cloneEnv({ GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' });
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work');
  });

  it('does not weaken host key checking', () => {
    // `accept-new` would silently trust whatever answers on first contact,
    // which is the one moment host key checking exists for.
    expect(cloneEnv({}).GIT_SSH_COMMAND).not.toContain('StrictHostKeyChecking=no');
    expect(cloneEnv({}).GIT_SSH_COMMAND).not.toContain('StrictHostKeyChecking=accept-new');
  });

  it('removes askpass helpers so no GUI password box appears behind the app', () => {
    const env = cloneEnv({ GIT_ASKPASS: '/usr/bin/x11-ssh-askpass', SSH_ASKPASS: '/usr/bin/x' });
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.SSH_ASKPASS).toBeUndefined();
  });

  it('carries the rest of the environment through — PATH above all', () => {
    // The credential helper, `gh`, and ssh itself are all found via PATH, and
    // that PATH is the one the login-shell import repaired.
    const env = cloneEnv({ PATH: '/usr/bin:/opt/homebrew/bin', HOME: '/Users/x' });
    expect(env.PATH).toBe('/usr/bin:/opt/homebrew/bin');
    expect(env.HOME).toBe('/Users/x');
  });
});

describe('parseCloneProgress', () => {
  it('reads the percentage out of a receiving-objects line', () => {
    expect(parseCloneProgress('Receiving objects:  47% (470/1000)')).toBe(47);
  });

  it('reads resolving-deltas too, which is the tail of a large clone', () => {
    expect(parseCloneProgress('Resolving deltas: 100% (500/500), done.')).toBe(100);
  });

  it('takes the last percentage in a chunk carrying several progress writes', () => {
    // git rewrites the same line with \r; one read can contain many.
    expect(
      parseCloneProgress('Receiving objects:  10% (1/10)\rReceiving objects:  90% (9/10)'),
    ).toBe(90);
  });

  it('returns null for output that carries no percentage', () => {
    expect(parseCloneProgress('Cloning into "solid"...')).toBeNull();
    expect(parseCloneProgress('')).toBeNull();
  });

  it('ignores a percentage outside 0-100 rather than driving a broken bar', () => {
    expect(parseCloneProgress('Receiving objects: 900% (9/1)')).toBeNull();
  });
});
