// Offline mode — renderer-side decision logic.
//
// The main-process half of this switch lives in `electron/ipc/offline.ts`.
// The two are deliberately separate modules rather than one shared one:
// dependency-cruiser forbids the renderer importing main-process code (only
// `channels.ts` and `prompt-detect.ts` are excepted), and the two halves share
// nothing but a boolean. Duplicating a boolean beats punching a hole in the
// architecture rule.
//
// What the renderer owns is the one outbound surface that lives here rather
// than in main: markdown rendered into the DOM can carry
// `<img src="https://…">`, and the renderer fetches that the moment the
// content is shown — leaking the viewer's IP and the resource URL to a host
// nobody chose. See PRIVACY.md, "Rendered markdown".

// The count of covered surfaces deliberately does NOT live here. It has one
// home — `OUTBOUND_SURFACES` in `electron/ipc/offline.ts` — and the numbers in
// PRIVACY.md and PRD 7.1 are checked against that array by a test. A second
// copy here would be a thing to forget to update.

/**
 * True when loading `url` would reach a host off this machine.
 *
 * Only schemes that cause the renderer to make a network request count.
 * `data:` and `blob:` are already in memory; `file:` is the local disk; a
 * relative or root-relative path resolves against the app's own origin. A
 * protocol-relative `//host/x` inherits the page scheme and does reach out,
 * which is exactly the case a naive `startsWith('http')` check misses.
 */
export function isExternalResourceUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('//')) return true;

  // A scheme is `letter *( letter / digit / "+" / "-" / "." ) ":"`. Anything
  // that does not match that shape is a relative reference, which is local.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!scheme) return false;

  const protocol = scheme[1].toLowerCase();
  return protocol === 'http' || protocol === 'https' || protocol === 'ftp';
}

/** Alt text substituted for an image the switch declined to load. */
export const BLOCKED_IMAGE_ALT = 'Image not loaded — offline mode is on';

/** Marks a blocked `<img>` so it is visibly distinct from a broken one. */
export const BLOCKED_IMAGE_ATTR = 'data-offline-blocked';

/**
 * The subset of `Element` this module needs.
 *
 * Declared structurally rather than taking `Element` so the decision stays
 * testable: vitest runs `environment: 'node'` with no DOM, and DOMPurify — the
 * only thing that ever hands us a real node — cannot even load there. Four
 * methods are enough to pin the behaviour, and a real `Element` satisfies the
 * shape at the call site.
 */
export interface AttributeBearingNode {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Neutralise an `<img>` that would fetch from another host.
 *
 * Returns true when the node was changed. Non-images and local sources are
 * left exactly as they were — the switch is about outbound requests, and a
 * relative or `data:` image makes none.
 */
export function blockExternalImage(node: AttributeBearingNode): boolean {
  if (node.tagName.toUpperCase() !== 'IMG') return false;
  const src = node.getAttribute('src');
  if (src === null || !isExternalResourceUrl(src)) return false;
  node.removeAttribute('src');
  // `srcset` is a second, independent fetch path. Removing only `src` would
  // leave a responsive image still loading from the host it was hiding behind.
  node.removeAttribute('srcset');
  node.setAttribute('alt', BLOCKED_IMAGE_ALT);
  node.setAttribute(BLOCKED_IMAGE_ATTR, 'true');
  return true;
}

/**
 * Persisted-state reader for the switch.
 *
 * Absent means off, which keeps an upgrade from an older `state.json` behaving
 * exactly as it did before the switch existed. Only a literal `true` turns it
 * on: a truthy-but-not-boolean value in a hand-edited or corrupt file is a
 * question, and the safe answer to a question about a privacy switch is not to
 * silently assume the user wanted their features disabled.
 */
export function readPersistedOfflineMode(raw: unknown): boolean {
  return raw === true;
}
