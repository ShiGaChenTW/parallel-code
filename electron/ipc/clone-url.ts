// Deciding what counts as a clonable repository address. The authoritative copy.
//
// This is the security boundary. `git clone` accepts transports that execute
// commands — `ext::sh -c whoami` runs `sh` — so a URL reaching git unfiltered
// is a remote code execution primitive wearing a text input. That is why the
// transport check is an allowlist and not a blocklist: git's transport set is
// extensible, and a blocklist of today's dangerous names silently admits the
// one a credential helper adds tomorrow.
//
// The renderer keeps its own copy in `src/lib/clone-url.ts` to decide whether
// the Clone button is enabled. That copy is an affordance and this one is the
// gate: `no-renderer-importing-main` forbids sharing a module, and the reverse
// import is blocked by `electron/tsconfig.json`'s `rootDir`. The two are held
// together by `parity with the renderer copy` in `clone-url.test.ts`, which
// compares the function bodies as text — the same mechanism `window-blur` uses
// for the same reason.
//
// Whichever way the two ever disagree, this file wins, because this is the one
// that runs before `git` is spawned.
//
// KEEP THE FUNCTION BODIES BELOW BYTE-IDENTICAL TO THE RENDERER COPY.

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
 * Returning `null` rather than throwing is what lets the renderer copy use the
 * same shape for live validation, so a rejection normally never becomes an
 * error message at all — the button is simply not enabled.
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
 * The name is joined onto a chosen path, so `..` arriving here is the
 * difference between cloning into a folder and cloning over one.
 *
 * Deliberately does not use `path.basename` — it did in its first draft, and a
 * Node import in this file is exactly what disqualifies it from being shared.
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
