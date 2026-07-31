import { execFile, execFileSync } from 'child_process';
import { resolveUserShell } from './user-shell.js';

/**
 * Import the user's login-shell environment into this process.
 *
 * WHY
 *
 * When launched from a .desktop file (AppImage) or the macOS Dock, the app
 * inherits a minimal environment — often just PATH=/usr/bin:/bin:/usr/sbin:/sbin.
 * Every CLI tool the app spawns (claude, codex, the user's editor) lives
 * somewhere else, so without this import nothing user-configured can be found.
 *
 * Uses -ilc (interactive + login) to source both .zprofile/.profile AND
 * .zshrc/.bashrc, where version managers (nvm, volta, fnm) add to PATH. The
 * dump is bracketed by sentinel markers so noisy shell init output (compinit
 * warnings, conda banners, welcome messages) can be discarded.
 *
 * Trade-off: -i triggers .zshrc side effects. Login-only (-lc) would be quieter
 * but would miss tools only added in .bashrc/.zshrc. Another trade-off:
 * inheriting the *full* environment can pull in large variables (certificates,
 * tokens, kubeconfig), so we set a generous maxBuffer.
 *
 * WHAT CHANGED AND WHY
 *
 * This used to be a single synchronous attempt whose failure path was one
 * `console.warn`. Two problems with that:
 *
 *  1. The shell costs ~0.4s against a 5s timeout, so a timeout is transient
 *     contention at launch, not a broken shell — but one attempt made a
 *     momentary hiccup permanent for the whole session. Hence the retries.
 *  2. A dump that produced no usable pairs returned early without logging
 *     anything at all. That is the Linux failure mode: perl is guaranteed on
 *     macOS but not on minimal Linux images, so the dump came back empty and
 *     silent. Hence the `env -0` fallback, and hence "empty" now counting as a
 *     failure rather than a success.
 *
 * Retries introduce a race — something could spawn before a late import lands.
 * Consumers close it by awaiting `awaitEnvImport(bound)` before resolving a
 * command name; the bound keeps a UI action from ever hanging on a retry.
 */

export const SENTINEL = '__PCODE_ENV__';

/**
 * Skip vars that would alter Electron/Node runtime behavior if a user's shell
 * rc sets them — those belong to our process, not the login shell.
 */
export const PROTECTED_ENV_KEYS: ReadonlySet<string> = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);

/** How long a single import attempt may take. Measured cost is ~0.4s. */
const ATTEMPT_TIMEOUT_MS = 5000;

/** Backoff for the async retries that follow a failed first attempt. */
const RETRY_DELAYS_MS = [500, 2000];

const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * The dump command run inside the login shell.
 *
 * perl first — it is present on every macOS install and prints a clean
 * null-delimited dump. `env -0` is the fallback for Linux images that ship no
 * perl; both GNU coreutils and BSD env support -0. Every character here is a
 * module constant, never user input.
 */
export function buildEnvDumpScript(sentinel: string = SENTINEL): string {
  const perlDump = `perl -e 'print "$_=$ENV{$_}\\0" for keys %ENV' 2>/dev/null`;
  return `printf '${sentinel}' && { ${perlDump} || env -0; } && printf '${sentinel}'`;
}

/** Parse a sentinel-bracketed dump. Returns null when nothing usable came back. */
export function parseEnvDump(raw: string, sentinel: string = SENTINEL): Map<string, string> | null {
  const startIdx = raw.indexOf(sentinel);
  const endIdx = raw.lastIndexOf(sentinel);
  if (startIdx === -1 || endIdx === -1 || startIdx === endIdx) return null;

  const block = raw.slice(startIdx + sentinel.length, endIdx);
  const vars = new Map<string, string>();
  for (const entry of block.split('\0')) {
    if (!entry) continue;
    const eqIdx = entry.indexOf('=');
    if (eqIdx <= 0) continue;
    vars.set(entry.slice(0, eqIdx), entry.slice(eqIdx + 1));
  }
  return vars.size > 0 ? vars : null;
}

/** Merge imported variables into `env`, skipping the protected keys. */
export function applyImportedEnv(
  vars: Map<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): number {
  let applied = 0;
  for (const [key, value] of vars) {
    if (PROTECTED_ENV_KEYS.has(key)) continue;
    env[key] = value;
    applied += 1;
  }
  return applied;
}

export type EnvImportState = 'pending' | 'ok' | 'failed' | 'skipped';

export interface EnvImportStatus {
  state: EnvImportState;
  attempts: number;
  lastError: string | null;
  /** PATH as the app can actually see it — the concrete evidence in an error. */
  visiblePath: string | null;
}

export interface EnvImporterDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  shell?: () => string;
  timeoutMs?: number;
  retryDelaysMs?: number[];
  runSync?: (shell: string, args: string[], timeoutMs: number) => string;
  runAsync?: (shell: string, args: string[], timeoutMs: number) => Promise<string>;
  schedule?: (fn: () => void, ms: number) => void;
  log?: (message: string, error?: unknown) => void;
}

export interface EnvImporter {
  /** Runs attempt one synchronously, then schedules retries if it failed. */
  start(): void;
  status(): EnvImportStatus;
  /**
   * Resolves once the import settles. `maxWaitMs` bounds the wait so a caller
   * blocked on a pending retry proceeds with whatever PATH it currently has.
   */
  settled(maxWaitMs?: number): Promise<EnvImportStatus>;
}

function defaultRunSync(shell: string, args: string[], timeoutMs: number): string {
  return execFileSync(shell, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
  });
}

function defaultRunAsync(shell: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      args,
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_BUFFER },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export function createEnvImporter(deps: EnvImporterDeps = {}): EnvImporter {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const shell = deps.shell ?? (() => resolveUserShell());
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const retryDelaysMs = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const runSync = deps.runSync ?? defaultRunSync;
  const runAsync = deps.runAsync ?? defaultRunAsync;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  const log =
    deps.log ??
    ((message: string, error?: unknown) =>
      error === undefined ? console.warn(message) : console.warn(message, error));

  let state: EnvImportState = 'pending';
  let attempts = 0;
  let lastError: string | null = null;
  let started = false;
  const waiters: Array<(status: EnvImportStatus) => void> = [];

  function snapshot(): EnvImportStatus {
    return { state, attempts, lastError, visiblePath: env.PATH ?? null };
  }

  function settle(next: Exclude<EnvImportState, 'pending'>): void {
    state = next;
    const status = snapshot();
    while (waiters.length > 0) waiters.shift()?.(status);
  }

  function ingest(raw: string): boolean {
    const vars = parseEnvDump(raw);
    if (!vars) {
      lastError = 'login shell produced no usable environment dump';
      return false;
    }
    applyImportedEnv(vars, env);
    return true;
  }

  function args(): string[] {
    return ['-ilc', buildEnvDumpScript()];
  }

  function retry(index: number): void {
    if (index >= retryDelaysMs.length) {
      log(`[env-import] giving up after ${attempts} attempts: ${lastError}`);
      settle('failed');
      return;
    }
    schedule(() => {
      attempts += 1;
      runAsync(shell(), args(), timeoutMs).then(
        (raw) => {
          if (ingest(raw)) {
            log(`[env-import] recovered login shell environment on attempt ${attempts}`);
            settle('ok');
          } else {
            log(`[env-import] attempt ${attempts} failed: ${lastError}`);
            retry(index + 1);
          }
        },
        (err: unknown) => {
          lastError = err instanceof Error ? err.message : String(err);
          log(`[env-import] attempt ${attempts} failed: ${lastError}`, err);
          retry(index + 1);
        },
      );
    }, retryDelaysMs[index] as number);
  }

  return {
    start(): void {
      if (started) return;
      started = true;

      if (platform === 'win32') {
        settle('skipped');
        return;
      }

      attempts = 1;
      try {
        if (ingest(runSync(shell(), args(), timeoutMs))) {
          settle('ok');
          return;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      log(`[env-import] attempt 1 failed: ${lastError}`);
      retry(0);
    },

    status: snapshot,

    settled(maxWaitMs?: number): Promise<EnvImportStatus> {
      if (state !== 'pending') return Promise.resolve(snapshot());
      return new Promise<EnvImportStatus>((resolve) => {
        let done = false;
        const finish = (status: EnvImportStatus) => {
          if (done) return;
          done = true;
          resolve(status);
        };
        waiters.push(finish);
        if (maxWaitMs !== undefined && maxWaitMs >= 0) {
          const timer = setTimeout(() => finish(snapshot()), maxWaitMs);
          // Never hold the process open just to watch for a late import.
          timer.unref?.();
        }
      });
    },
  };
}

const defaultImporter = createEnvImporter();

/** Kick off the import. Call once, as early in main as possible. */
export function startEnvImport(): void {
  defaultImporter.start();
}

export function getEnvImportStatus(): EnvImportStatus {
  return defaultImporter.status();
}

/**
 * Wait for the import to settle before resolving a command name.
 *
 * This is the race guard for the retry path: without it, a spawn that happens
 * between a failed first attempt and a successful retry would resolve against
 * the stale PATH. Bounded, so a click never hangs on a shell that is wedged.
 */
export function awaitEnvImport(maxWaitMs = 3000): Promise<EnvImportStatus> {
  return defaultImporter.settled(maxWaitMs);
}

/**
 * A user-facing explanation for why a command could not be found — but only
 * when the PATH import is genuinely the reason.
 *
 * Deliberately not a startup dialog. The failure is intermittent and often
 * harmless (a user who never configured an editor never notices), so an alert
 * at launch would be noise. Instead the two facts are joined at the moment they
 * actually collide: the user asks for their editor, we cannot find it, and we
 * say why in the same breath.
 */
export function envImportHint(status: EnvImportStatus = getEnvImportStatus()): string | null {
  if (status.state !== 'failed') return null;
  return (
    `Parallel Code could not load your shell PATH at startup ` +
    `(${status.lastError ?? 'unknown error'}), so it can only see: ` +
    `${status.visiblePath ?? '(no PATH)'}. ` +
    `Relaunch Parallel Code from a terminal, or enter an absolute path instead.`
  );
}
