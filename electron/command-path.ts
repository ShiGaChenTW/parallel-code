import fs from 'fs';
import path from 'path';

/**
 * Resolve a command name to an absolute executable path, the way a shell would.
 *
 * WHY THIS EXISTS
 *
 * `spawn('code', [dir])` without a shell hands the bare name to execvp, which
 * searches PATH inside the child process. When the app is launched from the
 * Dock (macOS) or a .desktop file (Linux), PATH is the bare system default —
 * /usr/bin:/bin:/usr/sbin:/sbin — and every editor a user actually configures
 * (/usr/local/bin/code, ~/.local/bin/zed, a Homebrew or nvm shim) is invisible.
 * The spawn fails with a naked `spawn code ENOENT`, which reads as "the setting
 * is broken" rather than "this process cannot see your PATH".
 *
 * Resolving first turns that into a decision we can explain: either we hand
 * spawn an absolute path we have already confirmed is an executable file, or we
 * refuse with a message that names the real cause.
 *
 * This is a narrowing, not a loosening. Callers still validate their input
 * before getting here; resolution only ever converts an accepted name into a
 * path that has been stat'd and access-checked.
 */

export interface ResolveCommandPathDeps {
  /** PATH string to search. Defaults to `process.env.PATH`. */
  pathValue?: string;
  /** Executable-file predicate. Injectable so the search order is testable. */
  isExecutableFile?: (candidate: string) => boolean;
  platform?: NodeJS.Platform;
  /** Base for relative commands like `./bin/code`. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * True only for a regular file with the execute bit set.
 *
 * The directory check matters: `fs.accessSync(dir, X_OK)` succeeds for any
 * traversable directory, so without it a PATH entry containing a *directory*
 * named `code` would resolve and then fail at spawn time — the exact class of
 * confusing failure this module exists to remove.
 */
export function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandPath(
  command: string,
  deps: ResolveCommandPathDeps = {},
): string | null {
  const value = command.trim();
  if (!value) return null;

  const platform = deps.platform ?? process.platform;
  const isExec = deps.isExecutableFile ?? isExecutableFile;

  // A name with a separator in it is a path, not a PATH lookup — same rule
  // execvp uses. Relative forms resolve against the process working directory,
  // which is what spawn would have done anyway.
  const hasSeparator = value.includes('/') || (platform === 'win32' && value.includes('\\'));
  if (hasSeparator) {
    const absolute = path.resolve(deps.cwd ?? process.cwd(), value);
    return isExec(absolute) ? absolute : null;
  }

  const pathValue = deps.pathValue ?? process.env.PATH ?? '';
  const separator = platform === 'win32' ? ';' : ':';

  for (const entry of pathValue.split(separator)) {
    // POSIX reads an empty PATH entry as the current directory. We deliberately
    // do not: the working directory here is a user's repository, and honouring
    // the empty entry would let a checked-in file named `code` be launched.
    if (!entry) continue;
    const candidate = path.resolve(entry, value);
    if (isExec(candidate)) return candidate;
  }

  return null;
}
