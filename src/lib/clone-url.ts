// The renderer's copy of the clone-URL value model.
//
// WHY THIS IS A COPY AND NOT AN IMPORT
//
// The main-process original is `electron/ipc/clone-url.ts`. The two cannot be
// one file: `no-renderer-importing-main` forbids `src/` reaching into
// `electron/`, and `electron/tsconfig.json`'s `rootDir` forbids the reverse.
//
// The first version of this work widened the dependency-cruiser allowlist to
// share one module instead. That was the wrong call, and this repo had already
// litigated it — see `parity with the renderer copy` in
// `electron/ipc/window-blur.test.ts`, which is the same shape for the same
// reason. Two arguments settled it:
//
//  1. The existing allowlist entries (`channels.ts`, `prompt-detect.ts`) are
//     inert by construction — a JSON re-export and a regex. This module is not:
//     its first draft used `path.basename` for the traversal check, a Node
//     import, in a file sitting next to `git-clone.ts`, which spawns
//     subprocesses. The allowlist condition is "no Node/Electron deps", and
//     this is a module that demonstrably drifts toward them. Widening a gate
//     for a file that trends the wrong way is how gates stop meaning anything.
//  2. A widened gate is inherited by every future edit; a parity test is not.
//     The test below fails loudly and names what diverged.
//
// Drift is the cost of copying, and it is a real one — the button that greys
// out has to grey out on exactly the addresses main refuses, or the refusal
// message becomes reachable by ordinary typing. That is what the parity test in
// `electron/ipc/clone-url.test.ts` exists to prevent. It compares these
// function bodies as text, so an edit to one that is not made to the other is a
// red test rather than a bug report.
//
// KEEP THE FUNCTION BODIES BELOW BYTE-IDENTICAL TO THE MAIN COPY.

/** `owner/repo`, the shorthand every README uses. */
const SHORTHAND = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** `user@host:path/to/repo` — git's scp-like SSH form, which is not a URL. */
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

/** Transports we will hand to git, and no others. */
const ALLOWED_SCHEMES = new Set(['https:', 'ssh:']);

/**
 * Normalise a pasted string into something safe to pass to `git clone`, or
 * `null` if it is not a remote repository reference we will act on.
 *
 * In the renderer this decides whether the Clone button is enabled. It is NOT
 * the security boundary — the copy in the main process is, and it runs again on
 * every request. This one exists so the button tells the truth.
 */
export function normalizeCloneUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/\s/.test(value)) return null;
  if (value.startsWith('-')) return null;
  if (SHORTHAND.test(value)) {
    const [owner, repo] = value.split('/');
    if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
    return `https://github.com/${owner}/${repo}.git`;
  }
  if (SCP_LIKE.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol.toLowerCase())) return null;
  if (!parsed.hostname) return null;
  return value;
}

/**
 * The folder name a URL suggests: its last path segment, minus `.git`.
 *
 * `null` when that segment could escape the parent directory the user picked.
 */
export function repoFolderNameFromUrl(url: string): string | null {
  const value = url.trim();
  if (!value || /\s/.test(value)) return null;
  const isScp = SCP_LIKE.test(value);
  let pathPart = isScp ? value.slice(value.indexOf(':') + 1) : value;
  if (!isScp) {
    try {
      pathPart = new URL(value).pathname;
    } catch {
      pathPart = value;
    }
  }
  const segments = pathPart.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  const name = last.replace(/\.git$/i, '');
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  return name;
}

/**
 * The folder name for a text field: `repoFolderNameFromUrl` with '' for null.
 *
 * Bound straight to an input value, where `null` would render as "null".
 */
export function suggestedFolderName(rawUrl: string): string {
  return repoFolderNameFromUrl(rawUrl) ?? '';
}
