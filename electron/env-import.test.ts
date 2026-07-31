import { describe, expect, it, vi } from 'vitest';
import {
  applyImportedEnv,
  buildEnvDumpScript,
  createEnvImporter,
  envImportHint,
  parseEnvDump,
  SENTINEL,
} from './env-import.js';

function dump(vars: Record<string, string>, sentinel = SENTINEL): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}\0`)
    .join('');
  return `noise from .zshrc\n${sentinel}${body}${sentinel}trailing noise`;
}

describe('buildEnvDumpScript', () => {
  it('brackets the dump with sentinels so shell rc noise can be discarded', () => {
    const script = buildEnvDumpScript('__X__');
    expect(script.startsWith("printf '__X__'")).toBe(true);
    expect(script.endsWith("printf '__X__'")).toBe(true);
  });

  it('falls back to `env -0` when perl is unavailable', () => {
    // macOS always ships perl; minimal Linux images (Alpine, slim Debian,
    // AppImage hosts) often do not. Without a fallback the dump comes back
    // empty and the import fails for a reason no log ever mentioned.
    expect(buildEnvDumpScript()).toContain('|| env -0');
  });
});

describe('parseEnvDump', () => {
  it('extracts null-delimited key=value pairs from between the sentinels', () => {
    const vars = parseEnvDump(dump({ PATH: '/usr/local/bin:/usr/bin', FOO: 'bar' }));
    expect(vars?.get('PATH')).toBe('/usr/local/bin:/usr/bin');
    expect(vars?.get('FOO')).toBe('bar');
  });

  it('keeps values that themselves contain "="', () => {
    const vars = parseEnvDump(dump({ OPTS: 'a=1,b=2' }));
    expect(vars?.get('OPTS')).toBe('a=1,b=2');
  });

  it('returns null when the sentinels are missing', () => {
    expect(parseEnvDump('command not found: perl')).toBeNull();
  });

  it('returns null when only one sentinel was printed (dump crashed midway)', () => {
    expect(parseEnvDump(`${SENTINEL}PATH=/usr/bin`)).toBeNull();
  });

  it('returns null for an empty dump instead of reporting success', () => {
    // The pre-fix code returned early here with no log line at all — the
    // quietest possible failure.
    expect(parseEnvDump(`${SENTINEL}${SENTINEL}`)).toBeNull();
  });

  it('ignores malformed entries with no key', () => {
    const vars = parseEnvDump(`${SENTINEL}=novalue\0PATH=/usr/bin\0${SENTINEL}`);
    expect(vars?.size).toBe(1);
    expect(vars?.get('PATH')).toBe('/usr/bin');
  });
});

describe('applyImportedEnv', () => {
  it('copies imported variables into the target environment', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
    const applied = applyImportedEnv(new Map([['PATH', '/usr/local/bin:/usr/bin:/bin']]), env);
    expect(applied).toBe(1);
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('refuses to import variables that would alter the Electron runtime', () => {
    const env: NodeJS.ProcessEnv = {};
    applyImportedEnv(
      new Map([
        ['NODE_OPTIONS', '--inspect'],
        ['DYLD_INSERT_LIBRARIES', '/tmp/evil.dylib'],
        ['LD_PRELOAD', '/tmp/evil.so'],
        ['ELECTRON_RUN_AS_NODE', '1'],
        ['PATH', '/usr/local/bin'],
      ]),
      env,
    );
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.PATH).toBe('/usr/local/bin');
  });
});

describe('createEnvImporter', () => {
  const okOutput = `${SENTINEL}PATH=/usr/local/bin:/usr/bin\0${SENTINEL}`;

  function importer(overrides: Parameters<typeof createEnvImporter>[0] = {}) {
    return createEnvImporter({
      platform: 'darwin',
      shell: () => '/bin/zsh',
      env: {},
      retryDelaysMs: [],
      schedule: (fn) => fn(),
      log: () => {},
      ...overrides,
    });
  }

  it('starts out pending before the import runs', () => {
    const imp = importer({ runSync: () => okOutput });
    expect(imp.status().state).toBe('pending');
  });

  it('imports the environment on the first synchronous attempt', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
    const imp = importer({ env, runSync: () => okOutput });
    imp.start();
    expect(imp.status().state).toBe('ok');
    expect(imp.status().attempts).toBe(1);
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
  });

  it('passes the login shell and the -ilc dump script to the runner', () => {
    const runSync = vi.fn(() => okOutput);
    importer({ runSync }).start();
    const [shell, args] = runSync.mock.calls[0] as unknown as [string, string[], number];
    expect(shell).toBe('/bin/zsh');
    expect(args[0]).toBe('-ilc');
    expect(args[1]).toContain(SENTINEL);
  });

  it('skips the import entirely on win32', () => {
    const runSync = vi.fn(() => okOutput);
    const imp = importer({ platform: 'win32', runSync });
    imp.start();
    expect(imp.status().state).toBe('skipped');
    expect(runSync).not.toHaveBeenCalled();
  });

  it('retries asynchronously when the first attempt times out', async () => {
    // The measured shell cost is ~0.4s against a 5s timeout, so a timeout means
    // transient contention at launch, not a broken shell. Giving up after one
    // try is what made the failure permanent for that session.
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
    const imp = importer({
      env,
      retryDelaysMs: [10],
      runSync: () => {
        throw new Error('ETIMEDOUT');
      },
      runAsync: async () => okOutput,
    });
    imp.start();
    expect(imp.status().state).toBe('pending');
    const settled = await imp.settled();
    expect(settled.state).toBe('ok');
    expect(settled.attempts).toBe(2);
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
  });

  it('gives up after the configured retries and records the failure', async () => {
    const imp = importer({
      retryDelaysMs: [1, 2],
      runSync: () => {
        throw new Error('spawn zsh ETIMEDOUT');
      },
      runAsync: async () => {
        throw new Error('spawn zsh ETIMEDOUT');
      },
    });
    imp.start();
    const settled = await imp.settled();
    expect(settled.state).toBe('failed');
    expect(settled.attempts).toBe(3);
    expect(settled.lastError).toContain('ETIMEDOUT');
  });

  it('treats an empty dump as a failure worth retrying, not as success', async () => {
    // Missing perl on Linux produced exactly this: output with no usable pairs.
    let calls = 0;
    const imp = importer({
      retryDelaysMs: [1],
      runSync: () => {
        calls += 1;
        return `${SENTINEL}${SENTINEL}`;
      },
      runAsync: async () => {
        calls += 1;
        return okOutput;
      },
    });
    imp.start();
    const settled = await imp.settled();
    expect(calls).toBe(2);
    expect(settled.state).toBe('ok');
  });

  it('resolves settled() immediately once the import already succeeded', async () => {
    const imp = importer({ runSync: () => okOutput });
    imp.start();
    await expect(imp.settled(5000)).resolves.toMatchObject({ state: 'ok' });
  });

  it('stops waiting after the bound so a UI action never hangs on a retry', async () => {
    // The race the retry introduces: a spawn could read PATH before the retry
    // lands. Consumers wait — but only for a bounded window.
    const imp = importer({
      retryDelaysMs: [10_000],
      schedule: (fn, ms) => {
        void fn;
        void ms;
      },
      runSync: () => {
        throw new Error('ETIMEDOUT');
      },
      runAsync: async () => okOutput,
    });
    imp.start();
    const settled = await imp.settled(5);
    expect(settled.state).toBe('pending');
  });

  it('is idempotent — a second start() does not re-import', () => {
    const runSync = vi.fn(() => okOutput);
    const imp = importer({ runSync });
    imp.start();
    imp.start();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it('logs each failed attempt so the reason survives in the app log', () => {
    const log = vi.fn();
    const imp = importer({
      log,
      runSync: () => {
        throw new Error('boom');
      },
    });
    imp.start();
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain('boom');
  });
});

describe('envImportHint', () => {
  it('explains the PATH import failure and how to work around it', () => {
    const hint = envImportHint({
      state: 'failed',
      attempts: 3,
      lastError: 'spawn /bin/zsh ETIMEDOUT',
      visiblePath: '/usr/bin:/bin',
    });
    expect(hint).toContain('PATH');
    expect(hint).toContain('/usr/bin:/bin');
    expect(hint).toContain('ETIMEDOUT');
  });

  it('returns null when the import succeeded — no hint to give', () => {
    expect(
      envImportHint({ state: 'ok', attempts: 1, lastError: null, visiblePath: null }),
    ).toBeNull();
  });

  it('returns null while the import is still in flight', () => {
    expect(
      envImportHint({ state: 'pending', attempts: 1, lastError: null, visiblePath: null }),
    ).toBeNull();
  });
});
