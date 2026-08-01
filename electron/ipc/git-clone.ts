// Cloning a repository from a remote.
//
// Split out of `git.ts` rather than added to it. Everything in that file
// operates on a repository that already exists on this machine; this is the one
// operation that creates one, and the one that takes an arbitrary string from a
// text field and hands it to git. That difference is worth a file boundary:
// the URL validation below is a security control, and a security control buried
// among two thousand lines of diffing helpers is a security control nobody
// re-reads.
//
// AUTHENTICATION — the decision, and why.
//
// Private repositories work through the git credentials already on this
// machine: `gh auth setup-git`, an SSH key, or a configured credential helper.
// Parallel Code stores no token of its own for this.
//
// The alternative considered was the Huly shape — a token in the app, sealed
// with Electron's `safeStorage`. It was rejected for three reasons, in order of
// weight:
//
//  1. Huly has no choice. A Huly access token has no system-wide store to defer
//     to. Git does: every developer who can clone a private repo in a terminal
//     already has working credentials, and roughly none of them want to mint a
//     second PAT and paste it into a desktop app.
//  2. A token this app never holds is a token this app cannot leak — not
//     through a crash dump, not through a log line, not through the state file.
//     `safeStorage` narrows that surface; it does not remove it.
//  3. `git clone` consults the credential helper itself. Holding a token would
//     mean injecting it into the URL or writing a temporary helper — both of
//     which put the secret somewhere (a process argument list, a file) that the
//     "encrypted at rest" story does not actually cover.
//
// The cost of that choice is a user with no credentials configured, who gets a
// failure instead of a prompt. That cost is paid down in `classifyCloneFailure`
// below: the auth branch says which three commands fix it. A wrong error
// message is what makes credential problems miserable, not the absence of a
// token box.
//
// This decision is also what forces `cloneEnv`. Deferring to system credentials
// means git may want to *ask* for them, and a git that asks a pipe blocks
// forever. Prompting is therefore disabled outright, which converts an infinite
// spinner into a message naming the fix.

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { BrowserWindow } from 'electron';

import { debug as logDebug } from '../log.js';
import { OfflineModeError, isOfflineMode } from './offline.js';

// URL validation and folder naming live in a pure module, because the renderer
// needs the same answers to decide whether the Clone button is enabled and what
// to pre-fill the folder field with. They were two copies once and drifted
// within the hour. Re-exported here so callers of this module see one surface.
export { normalizeCloneUrl, repoFolderNameFromUrl, suggestedFolderName } from './clone-url.js';

/** Cap on retained stderr. Only the tail is ever used for a message. */
const STDERR_CAP = 8192;

/** Grace between asking a cancelled clone to stop and insisting. */
const KILL_GRACE_MS = 2000;

export type CloneFailureKind =
  | 'cancelled'
  | 'auth'
  | 'host-key'
  | 'not-found'
  | 'destination-exists'
  | 'destination-unwritable'
  | 'network'
  | 'disk-full'
  | 'unknown';

export interface CloneFailure {
  readonly kind: CloneFailureKind;
  readonly message: string;
}

/** How the process ended, as far as the classifier needs to know. */
export interface CloneExit {
  readonly cancelled: boolean;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | string | null;
}

/**
 * Turn git's stderr into a sentence that names the next action.
 *
 * Modelled on `envImportHint()`: the value of an error message is the
 * attribution, not the detail. "fatal: could not read Username for
 * 'https://github.com': terminal prompts disabled" is accurate and tells a user
 * nothing they can act on — worse, it reads as a bug in Parallel Code, because
 * *this app* is what disabled the prompts.
 *
 * The raw last git line is appended to the unknown branch only. Where we know
 * what happened, repeating git's phrasing after the explanation just invites
 * the user to read the confusing half.
 */
export function classifyCloneFailure(stderr: string, exit: CloneExit): CloneFailure {
  if (exit.cancelled) {
    return {
      kind: 'cancelled',
      message: 'Clone cancelled. Nothing was added, and the partial download was removed.',
    };
  }

  const text = stderr.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  // Order matters. An SSH publickey rejection also contains "could not read
  // from remote repository", and a host-key failure contains both — so the
  // most specific cause is tested first.
  if (has('host key verification failed', 'no matching host key')) {
    return {
      kind: 'host-key',
      message:
        "The server's host key is not trusted by this machine, so the connection was refused. " +
        'Clone the repository once from a terminal to review and accept the key, or add it to ' +
        'your known_hosts file. Parallel Code will not accept an unknown key on your behalf.',
    };
  }

  if (
    has(
      'could not read username',
      'could not read password',
      'authentication failed',
      'terminal prompts disabled',
      'permission denied (publickey',
      'invalid username or password',
      'support for password authentication was removed',
    )
  ) {
    return {
      kind: 'auth',
      message:
        'Git has no credentials for this repository on this machine. Parallel Code deliberately ' +
        'stores no token of its own, so it uses the git credentials you already have. Set them up ' +
        'once, in a terminal, with any of: `gh auth login` followed by `gh auth setup-git` for ' +
        'GitHub over HTTPS; an SSH key added to your account, then clone with the ' +
        '`git@host:owner/repo.git` form; or `git config --global credential.helper osxkeychain`. ' +
        'Then try again.',
    };
  }

  if (has('repository not found', 'not found', 'does not appear to be a git repository')) {
    return {
      kind: 'not-found',
      message:
        'No repository was found at that address. Check the URL for a typo — and note that a ' +
        'private repository you are not signed in to reports as "not found" rather than as a ' +
        'permission error, so this may be a credentials problem wearing a 404.',
    };
  }

  if (has('already exists and is not an empty directory', 'already exists')) {
    return {
      kind: 'destination-exists',
      message:
        'A folder of that name already exists in the destination. Choose a different folder name, ' +
        'pick another destination, or use "Choose a local folder" if the repository is already ' +
        'on this machine.',
    };
  }

  if (has('no space left on device', 'quota exceeded')) {
    return {
      kind: 'disk-full',
      message:
        'The disk ran out of space part-way through the clone. Free some space, or choose a ' +
        'destination on another volume, then try again.',
    };
  }

  if (has('permission denied', 'read-only file system', 'operation not permitted')) {
    return {
      kind: 'destination-unwritable',
      message:
        'Parallel Code could not write into the destination folder. Choose a destination you own ' +
        'and can write to — on macOS, also check that the folder is not one the app has not been ' +
        'granted access to in System Settings → Privacy & Security.',
    };
  }

  if (
    has(
      'could not resolve host',
      'unable to access',
      'connection timed out',
      'connection refused',
      'network is unreachable',
      'ssl certificate problem',
      'failed to connect',
    )
  ) {
    return {
      kind: 'network',
      message:
        'Parallel Code could not reach the server. Check your network connection and whether the ' +
        'host is reachable from this machine — a VPN or proxy may be required for an internal ' +
        'host. Offline mode is off, so it is not the cause.',
    };
  }

  const lastLine =
    stderr
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? '';

  const fallback = exit.signal
    ? `git clone was killed by signal ${String(exit.signal)}`
    : `git clone exited with code ${String(exit.code)}`;

  return {
    kind: 'unknown',
    message: `The clone failed and Parallel Code does not recognise the reason. Git said: ${
      lastLine || fallback
    }`,
  };
}

/**
 * The environment a clone runs in.
 *
 * The whole point is that git must never wait for input. Deferring to system
 * credentials (see the header) means git will try to ask for them when they are
 * missing, and a git that asks a pipe waits forever — the UI shows a
 * progress bar that never moves and the operation can only be cancelled.
 * Disabling prompting converts that into an immediate, classifiable failure.
 *
 * What is deliberately NOT done here: weakening host key checking. `BatchMode`
 * stops ssh asking whether to trust an unknown host, and the tempting fix is
 * `StrictHostKeyChecking=accept-new`. That would make the app trust whatever
 * answers on first contact, which is the exact moment the check exists for.
 * The failure is surfaced as its own `host-key` branch instead.
 */
export function cloneEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) env[k] = v;
  }

  env.GIT_TERMINAL_PROMPT = '0';

  // An askpass helper would pop a password box detached from this window —
  // a system dialog with no explanation, behind the app that caused it.
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  env.SSH_ASKPASS_REQUIRE = 'never';

  // Only when the user has not set one. Theirs may name an identity file or a
  // jump host, and overwriting it breaks precisely the people who configured it.
  if (!env.GIT_SSH_COMMAND) {
    env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  }

  return env;
}

/**
 * Pull a completion percentage out of a chunk of git progress output.
 *
 * Git rewrites one line with `\r`, so a single read routinely holds several
 * updates; the last is the current one. Returns `null` for output with no
 * percentage, which is most of it — the caller keeps the previous value rather
 * than flickering the bar back to zero between phases.
 */
export function parseCloneProgress(chunk: string): number | null {
  const matches = chunk.match(/(\d{1,3})%/g);
  if (!matches || matches.length === 0) return null;

  const last = matches[matches.length - 1];
  const value = Number.parseInt(last, 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export interface CloneOptions {
  /** Already normalised by `normalizeCloneUrl`. */
  readonly url: string;
  /** Existing directory the clone lands inside. */
  readonly parentDir: string;
  /** Single path segment, already validated. */
  readonly folderName: string;
  /** Renderer channel id for progress text. */
  readonly channelId: string;
  /** Caller-chosen handle for `cancelClone`. */
  readonly cloneId: string;
}

/** In-flight clones, so the renderer can cancel one by id. */
const activeClones = new Map<string, { proc: ChildProcess; cancelled: boolean }>();

/**
 * Ask an in-flight clone to stop. Returns false if it already finished.
 *
 * SIGTERM first: git removes its own partial checkout when it is allowed to
 * clean up, which is the difference between "cancel and retry" working and the
 * retry failing with "destination already exists". SIGKILL only if it ignores
 * that, and the directory removal below covers what SIGKILL leaves behind.
 */
export function cancelClone(cloneId: string): boolean {
  const entry = activeClones.get(cloneId);
  if (!entry) return false;

  entry.cancelled = true;
  entry.proc.kill('SIGTERM');

  const timer = setTimeout(() => {
    if (activeClones.get(cloneId) === entry) entry.proc.kill('SIGKILL');
  }, KILL_GRACE_MS);
  timer.unref?.();

  return true;
}

/** Best-effort removal of a directory this clone created and then abandoned. */
function removePartialClone(destPath: string): void {
  try {
    fs.rmSync(destPath, { recursive: true, force: true });
  } catch (err) {
    // Nothing the user can do about this, and it must not mask the real
    // failure that led here.
    logDebug('git', `clone cleanup failed for ${destPath}: ${String(err)}`);
  }
}

/**
 * Clone a repository, streaming git's progress to the renderer.
 *
 * Rejects with an `Error` whose message is already user-facing — every caller
 * of this renders it directly, so the classification has to happen here rather
 * than being left as an exercise for the UI.
 *
 * Resolves with the absolute path of the new working tree.
 */
export function cloneRepository(win: BrowserWindow, opts: CloneOptions): Promise<string> {
  // Before the spawn, for the same reason `pushTask` checks before its own:
  // the dialog renders a rejection where it would render a git error, so this
  // reads as "offline mode is on" immediately rather than as a connection
  // timeout a minute later.
  if (isOfflineMode()) return Promise.reject(new OfflineModeError('git-clone'));

  const destPath = path.join(opts.parentDir, opts.folderName);

  // Whether we created it decides whether we may remove it on failure. A clone
  // into a directory that already existed is refused by git anyway; this guard
  // is about never deleting something that was not ours.
  const existedBefore = fs.existsSync(destPath);

  return new Promise<string>((resolve, reject) => {
    logDebug('git', `clone ${opts.url} -> ${destPath}`);

    // `--` terminates option parsing, so a URL that survived validation but
    // still begins with a dash cannot become a flag.
    const proc = spawn('git', ['clone', '--progress', '--', opts.url, destPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cloneEnv(process.env),
    });

    const entry = { proc, cancelled: false };
    activeClones.set(opts.cloneId, entry);

    const send = (msg: string) => {
      if (!win.isDestroyed()) win.webContents.send(`channel:${opts.channelId}`, msg);
    };

    proc.stdout?.on('data', (chunk: Buffer) => send(chunk.toString('utf8')));

    let stderrBuf = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // git writes progress to stderr, so this stream is both the progress
      // feed and the error record. Only the tail is kept for the message.
      stderrBuf += text;
      if (stderrBuf.length > STDERR_CAP) stderrBuf = stderrBuf.slice(-STDERR_CAP);
      send(text);
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      activeClones.delete(opts.cloneId);
      fn();
    };

    proc.on('close', (code, signal) => {
      finish(() => {
        if (code === 0 && !entry.cancelled) {
          resolve(destPath);
          return;
        }
        if (!existedBefore) removePartialClone(destPath);
        const failure = classifyCloneFailure(stderrBuf, {
          cancelled: entry.cancelled,
          code,
          signal,
        });
        reject(new Error(failure.message));
      });
    });

    proc.on('error', (err) => {
      finish(() => {
        if (!existedBefore) removePartialClone(destPath);
        // ENOENT here means git itself is missing, which is a different
        // problem from anything git could have reported.
        const isMissingGit = (err as NodeJS.ErrnoException).code === 'ENOENT';
        reject(
          new Error(
            isMissingGit
              ? 'Parallel Code could not run `git`. Install git, or relaunch Parallel Code from a ' +
                  'terminal so it inherits your shell PATH.'
              : `Parallel Code could not start the clone: ${err.message}`,
          ),
        );
      });
    });
  });
}
