import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promisify } from 'util';

const { mockStat } = vi.hoisted(() => ({
  mockStat: vi.fn(),
}));

vi.mock('child_process', () => {
  const mockExecFile = vi.fn();
  (mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    file: unknown,
    args: unknown,
    opts: unknown,
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      mockExecFile(file, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { execFile: mockExecFile };
});

vi.mock('fs/promises', () => ({
  stat: mockStat,
}));

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
    on(): void {}
    show(): void {}
    close(): void {}
  },
}));

import { execFile } from 'child_process';
import {
  summarize,
  rollupBucket,
  isPrUrl,
  fetchPrStatus,
  detectPrUrlForBranch,
  __resetForTests,
  __getStateForTests,
  __runTickForTests,
  initPrChecks,
  refreshPrChecksWatcher,
  startPrChecksWatcher,
  applyOfflineMode,
  type PrCheckRun,
} from './pr-checks.js';
import { setOfflineMode } from './offline.js';

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;
type GhHandler = (args: string[], cb: ExecCb, cmd: string) => void;

function stubGh(handler: GhHandler): string[][] {
  const calls: string[][] = [];
  const impl = (cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
    calls.push(args);
    handler(args, cb, cmd);
  };
  vi.mocked(execFile).mockImplementation(impl as unknown as typeof execFile);
  return calls;
}

const run = (name: string, bucket: PrCheckRun['bucket']): PrCheckRun => ({
  name,
  bucket,
});

const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function fakeWindow(send: ReturnType<typeof vi.fn>): Parameters<typeof initPrChecks>[0] {
  return {
    on: vi.fn(),
    isDestroyed: () => false,
    isVisible: () => false,
    webContents: { send },
    show: vi.fn(),
    focus: vi.fn(),
  } as unknown as Parameters<typeof initPrChecks>[0];
}

beforeEach(() => {
  mockStat.mockResolvedValue({ isDirectory: () => true });
});

describe('summarize', () => {
  it('empty list is none with zero counts', () => {
    expect(summarize([])).toEqual({ overall: 'none', passing: 0, pending: 0, failing: 0 });
  });
  it('any pending wins over fail', () => {
    expect(summarize([run('a', 'pending'), run('b', 'fail')])).toEqual({
      overall: 'pending',
      passing: 0,
      pending: 1,
      failing: 1,
    });
  });
  it('fail without pending is failure', () => {
    expect(summarize([run('a', 'pass'), run('b', 'fail')])).toEqual({
      overall: 'failure',
      passing: 1,
      pending: 0,
      failing: 1,
    });
  });
  it('cancel counts as failure', () => {
    expect(summarize([run('a', 'pass'), run('b', 'cancel')])).toEqual({
      overall: 'failure',
      passing: 1,
      pending: 0,
      failing: 1,
    });
  });
  it('all pass is success', () => {
    expect(summarize([run('a', 'pass'), run('b', 'pass')])).toEqual({
      overall: 'success',
      passing: 2,
      pending: 0,
      failing: 0,
    });
  });
  it('skipping counts as passing', () => {
    expect(summarize([run('a', 'pass'), run('b', 'skipping')])).toEqual({
      overall: 'success',
      passing: 2,
      pending: 0,
      failing: 0,
    });
  });
});

describe('rollupBucket', () => {
  it('maps CheckRun conclusions', () => {
    expect(rollupBucket('COMPLETED', 'SUCCESS', undefined)).toBe('pass');
    expect(rollupBucket('COMPLETED', 'FAILURE', undefined)).toBe('fail');
    expect(rollupBucket('COMPLETED', 'TIMED_OUT', undefined)).toBe('fail');
    expect(rollupBucket('COMPLETED', 'STARTUP_FAILURE', undefined)).toBe('fail');
    expect(rollupBucket('COMPLETED', 'ACTION_REQUIRED', undefined)).toBe('fail');
    expect(rollupBucket('COMPLETED', 'STALE', undefined)).toBe('fail');
    expect(rollupBucket('COMPLETED', 'CANCELLED', undefined)).toBe('cancel');
    expect(rollupBucket('COMPLETED', 'SKIPPED', undefined)).toBe('skipping');
    expect(rollupBucket('COMPLETED', 'NEUTRAL', undefined)).toBe('skipping');
  });
  it('treats non-completed status as pending', () => {
    expect(rollupBucket('IN_PROGRESS', null as unknown as undefined, undefined)).toBe('pending');
    expect(rollupBucket('QUEUED', undefined, undefined)).toBe('pending');
    expect(rollupBucket('WAITING', undefined, undefined)).toBe('pending');
  });
  it('treats unknown conclusions as fail (safe default)', () => {
    expect(rollupBucket('COMPLETED', 'SOMETHING_NEW', undefined)).toBe('fail');
  });
  it('maps legacy status-context state', () => {
    expect(rollupBucket(undefined, undefined, 'SUCCESS')).toBe('pass');
    expect(rollupBucket(undefined, undefined, 'PENDING')).toBe('pending');
    expect(rollupBucket(undefined, undefined, 'FAILURE')).toBe('fail');
    expect(rollupBucket(undefined, undefined, 'ERROR')).toBe('fail');
    expect(rollupBucket(undefined, undefined, 'GARBAGE')).toBe('fail');
  });
  it('returns null when nothing useful is present', () => {
    expect(rollupBucket(undefined, undefined, undefined)).toBe(null);
  });
});

describe('isPrUrl', () => {
  it('accepts PR URLs', () => {
    expect(isPrUrl('https://github.com/acme/app/pull/42')).toBe(true);
    expect(isPrUrl('https://www.github.com/acme/app/pull/1')).toBe(true);
  });
  it('rejects issues, discussions, and non-github', () => {
    expect(isPrUrl('https://github.com/acme/app/issues/42')).toBe(false);
    expect(isPrUrl('https://gitlab.com/acme/app/pull/42')).toBe(false);
    expect(isPrUrl('not a url')).toBe(false);
    expect(isPrUrl('https://github.com/acme/app')).toBe(false);
    expect(isPrUrl('https://github.com/acme/app/pull/abc')).toBe(false);
  });
  it('rejects URLs carrying credentials', () => {
    expect(isPrUrl('https://user:pass@github.com/a/b/pull/1')).toBe(false);
    expect(isPrUrl('https://user@github.com/a/b/pull/1')).toBe(false);
  });
});

describe('fetchPrStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
  });

  it('parses statusCheckRollup conclusions into buckets', async () => {
    const payload = {
      state: 'OPEN',
      headRefOid: 'abc123',
      statusCheckRollup: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'lint', status: 'IN_PROGRESS', conclusion: null },
        { name: 'flake', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'doc', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { name: 'cancel', status: 'COMPLETED', conclusion: 'CANCELLED' },
        // Legacy status-context shape:
        { context: 'ci/legacy', state: 'SUCCESS' },
      ],
    };
    const calls = stubGh((_args, cb) => cb(null, JSON.stringify(payload), ''));
    const out = await fetchPrStatus('https://github.com/a/b/pull/1');
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('pr');
    expect(calls[0][1]).toBe('view');
    expect(out.state).toBe('OPEN');
    expect(out.headRefOid).toBe('abc123');
    expect(out.checks).toEqual([
      { name: 'build', bucket: 'pass' },
      { name: 'lint', bucket: 'pending' },
      { name: 'flake', bucket: 'fail' },
      { name: 'doc', bucket: 'skipping' },
      { name: 'cancel', bucket: 'cancel' },
      { name: 'ci/legacy', bucket: 'pass' },
    ]);
  });

  it('returns empty checks when response is malformed', async () => {
    stubGh((_args, cb) => cb(null, JSON.stringify(null), ''));
    const out = await fetchPrStatus('https://github.com/a/b/pull/1');
    expect(out).toEqual({ state: 'UNKNOWN', headRefOid: '', checks: [] });
  });
});

describe('detectPrUrlForBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
  });

  it('finds an open PR for a branch', async () => {
    const calls = stubGh((_args, cb) => {
      cb(
        null,
        JSON.stringify([
          {
            url: 'https://github.com/a/b/pull/11',
            headRefName: 'task/my-branch',
          },
        ]),
        '',
      );
    });
    await expect(detectPrUrlForBranch('/repo/worktree', 'task/my-branch')).resolves.toBe(
      'https://github.com/a/b/pull/11',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      'task/my-branch',
      '--json',
      'url,headRefName',
      '--limit',
      '20',
    ]);
  });

  it('does not require the local branch head to match the PR head', async () => {
    stubGh((_args, cb) =>
      cb(
        null,
        JSON.stringify([
          {
            url: 'https://github.com/a/b/pull/12',
            headRefName: 'task/ahead-locally',
            headRefOid: 'remote-sha',
          },
        ]),
        '',
      ),
    );
    await expect(detectPrUrlForBranch('/repo/worktree', 'task/ahead-locally')).resolves.toBe(
      'https://github.com/a/b/pull/12',
    );
  });

  it('returns null when the branch has no open PR', async () => {
    stubGh((_args, cb) => cb(null, JSON.stringify([]), ''));
    await expect(detectPrUrlForBranch('/repo/worktree', 'task/no-pr')).resolves.toBe(null);
  });

  it('returns null without invoking gh when the worktree path is gone', async () => {
    const err = new Error('missing worktree') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockStat.mockRejectedValueOnce(err);
    const calls = stubGh((_args, cb) => cb(null, JSON.stringify([]), ''));

    await expect(detectPrUrlForBranch('/repo/missing-worktree', 'task/no-pr')).resolves.toBe(null);

    expect(calls).toHaveLength(0);
  });

  it('rejects malformed PR URLs from gh output', async () => {
    stubGh((_args, cb) =>
      cb(
        null,
        JSON.stringify([
          {
            url: 'https://github.com/a/b/issues/12',
            headRefName: 'task/issue',
          },
        ]),
        '',
      ),
    );
    await expect(detectPrUrlForBranch('/repo/worktree', 'task/issue')).resolves.toBe(null);
  });
});

describe('refreshPrChecksWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
  });

  it('does not suppress the first fetched status after a post-push refresh', async () => {
    const send = vi.fn();
    initPrChecks(fakeWindow(send));
    stubGh((_args, cb) =>
      cb(
        null,
        JSON.stringify({
          state: 'OPEN',
          headRefOid: 'new-sha',
          statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
        '',
      ),
    );

    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    refreshPrChecksWatcher('t1');
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]).toMatchObject({ taskId: 't1', overall: 'pending' });
    expect(send.mock.calls[1][1]).toMatchObject({
      taskId: 't1',
      overall: 'success',
      passing: 1,
    });
  });

  it('keeps stale post-push status hidden until GitHub reports a new head', async () => {
    const send = vi.fn();
    initPrChecks(fakeWindow(send));
    const statuses = [
      {
        state: 'OPEN',
        headRefOid: 'old-sha',
        statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
      {
        state: 'OPEN',
        headRefOid: 'old-sha',
        statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
      {
        state: 'OPEN',
        headRefOid: 'new-sha',
        statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
    ];
    let nextStatus = 0;
    stubGh((_args, cb) => {
      const payload = statuses[Math.min(nextStatus, statuses.length - 1)];
      nextStatus += 1;
      cb(null, JSON.stringify(payload), '');
    });

    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(1);

    refreshPrChecksWatcher('t1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toMatchObject({ taskId: 't1', overall: 'pending' });

    await __runTickForTests();
    expect(send).toHaveBeenCalledTimes(2);

    await __runTickForTests();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][1]).toMatchObject({
      taskId: 't1',
      overall: 'success',
      passing: 1,
    });
  });
});

describe('startPrChecksWatcher — graceful degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
  });

  it('ignores non-PR URLs (no task registered)', () => {
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/issues/1',
      taskName: 'test',
    });
    expect(__getStateForTests().taskIds).toEqual([]);
  });

  it('disables session when gh is missing (ENOENT)', async () => {
    stubGh((_args, cb) => {
      const e = new Error('ENOENT') as NodeJS.ErrnoException;
      e.code = 'ENOENT';
      cb(e, '', '');
    });
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    // Allow the fire-and-forget refresh to settle.
    await new Promise((resolve) => setImmediate(resolve));
    expect(__getStateForTests().disabled).toBe(true);
    expect(__getStateForTests().disabledReason).toBe('missing');
  });

  it('disables session when gh reports not authenticated', async () => {
    stubGh((_args, cb) => {
      const e = new Error('auth') as Error & { stderr?: string };
      e.stderr = 'You are not logged into any GitHub hosts.';
      cb(e, '', 'You are not logged into any GitHub hosts.');
    });
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(__getStateForTests().disabled).toBe(true);
    expect(__getStateForTests().disabledReason).toBe('auth');
  });
});

describe('offline mode', () => {
  beforeEach(() => {
    __resetForTests();
    setOfflineMode(false);
  });

  afterEach(() => setOfflineMode(false));

  it('never forks gh while the switch is on', async () => {
    const calls = stubGh((_args, cb) => cb(null, '{}', ''));
    setOfflineMode(true);
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    await flushPromises();
    await __runTickForTests();
    await flushPromises();
    expect(calls).toHaveLength(0);
  });

  it('keeps the task registered, so polling resumes instead of needing a re-add', async () => {
    stubGh((_args, cb) => cb(null, '{}', ''));
    setOfflineMode(true);
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    await flushPromises();
    expect(__getStateForTests().taskIds).toEqual(['t1']);
  });

  it('does not latch `disabled` — the switch is reversible, a missing gh is not', async () => {
    stubGh((_args, cb) => cb(null, '{}', ''));
    setOfflineMode(true);
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    await flushPromises();
    expect(__getStateForTests().disabled).toBe(false);
  });

  it('refuses a direct fetchPrStatus call rather than letting it through', async () => {
    const calls = stubGh((_args, cb) => cb(null, '{}', ''));
    setOfflineMode(true);
    await expect(fetchPrStatus('https://github.com/a/b/pull/1')).rejects.toThrow(
      /Offline mode is on/,
    );
    expect(calls).toHaveLength(0);
  });

  it('answers "no PR" for branch detection instead of forking gh', async () => {
    const calls = stubGh((_args, cb) => cb(null, '[]', ''));
    setOfflineMode(true);
    await expect(detectPrUrlForBranch('/repo', 'feat/x')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('polls again once the switch goes back off, without waiting for a user action', async () => {
    const calls = stubGh((_args, cb) =>
      cb(null, JSON.stringify({ state: 'OPEN', headRefOid: 'sha', statusCheckRollup: [] }), ''),
    );
    setOfflineMode(true);
    startPrChecksWatcher({
      taskId: 't1',
      prUrl: 'https://github.com/a/b/pull/1',
      taskName: 'test',
    });
    await flushPromises();
    expect(calls).toHaveLength(0);

    setOfflineMode(false);
    applyOfflineMode(false);
    await flushPromises();
    expect(calls.length).toBeGreaterThan(0);
  });
});
