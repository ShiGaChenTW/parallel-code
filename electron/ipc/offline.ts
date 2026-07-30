// Offline mode — the single switch that stops Parallel Code making outbound
// network requests of its own.
//
// Scope, deliberately: this gate covers network activity *Parallel Code
// decides to start*, whether it does so directly (a `fetch`, a WebSocket) or
// by invoking local tooling for a network round-trip (`gh`, `git push`,
// `docker build`, the `claude` CLI for inline Q&A). It does NOT cover the
// network activity of the third-party AI CLIs you dispatch as agents — those
// are tools you installed and authorised, they talk to their vendors under
// their own configuration, and the app neither can nor should intercept them.
//
// It is also deliberately NOT a network-layer interception (`session.
// webRequest` and friends). That would catch third-party CLI traffic too, and
// it would turn every blocked call into a silent timeout. A call-site gate
// fails loudly instead: each surface returns a legible "offline mode is on"
// message rather than spinning.

/** Every outbound surface the switch covers. Keep in sync with PRIVACY.md. */
export const OUTBOUND_SURFACES = [
  'update-check',
  'pr-checks',
  'ask-code-claude',
  'ask-code-minimax',
  'markdown-images',
  'huly',
  'git-push',
  'git-remote-head',
  'docker-build',
] as const;

export type OutboundSurface = (typeof OUTBOUND_SURFACES)[number];

/** User-facing reason, one per surface. Read by the renderer verbatim. */
const SURFACE_MESSAGES: Record<OutboundSurface, string> = {
  'update-check': 'Offline mode is on, so Parallel Code did not contact GitHub Releases.',
  'pr-checks': 'Offline mode is on, so PR check status is not being polled.',
  'ask-code-claude': 'Offline mode is on, so Ask About Code did not start the Claude CLI.',
  'ask-code-minimax': 'Offline mode is on, so Ask About Code did not call the MiniMax API.',
  'markdown-images': 'Offline mode is on, so external images in markdown were not loaded.',
  huly: 'Offline mode is on, so Parallel Code did not connect to your Huly server.',
  'git-push': 'Offline mode is on, so the branch was not pushed to origin.',
  'git-remote-head': 'Offline mode is on, so the default branch was resolved from local refs only.',
  'docker-build': 'Offline mode is on, so the Docker image was not built.',
};

/** The sentence a blocked surface reports. Suffixed so the fix is obvious. */
export function offlineMessage(surface: OutboundSurface): string {
  return `${SURFACE_MESSAGES[surface]} Turn it off in Settings to allow this.`;
}

/** Thrown by surfaces whose caller already renders a thrown error. */
export class OfflineModeError extends Error {
  readonly surface: OutboundSurface;
  readonly code = 'ERR_OFFLINE_MODE';

  constructor(surface: OutboundSurface) {
    super(offlineMessage(surface));
    this.name = 'OfflineModeError';
    this.surface = surface;
  }
}

// Default false so a first run — no state file yet — behaves exactly as it did
// before this feature existed. `initOfflineMode` overwrites it at startup from
// the same persisted value the renderer reads, so main is never guessing.
let enabled = false;

export function isOfflineMode(): boolean {
  return enabled;
}

export function setOfflineMode(next: boolean): void {
  enabled = next;
}

/** Throw unless the surface is allowed to reach the network right now. */
export function assertOnline(surface: OutboundSurface): void {
  if (enabled) throw new OfflineModeError(surface);
}

/**
 * Read the persisted switch out of a raw `state.json` payload.
 *
 * Main reads the file itself at startup rather than waiting for the renderer
 * to push the value. The updater fires a silent check ten seconds after
 * launch; a renderer round-trip is normally faster than that, but "normally"
 * is not a guarantee worth betting an offline promise on, and a synchronous
 * read of a file the app already loads costs nothing.
 *
 * Anything unparseable or non-boolean yields `false` — the pre-feature
 * behaviour — because a corrupt state file must not silently disable half the
 * app's features either.
 */
export function parsePersistedOfflineMode(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    return (parsed as Record<string, unknown>)['offlineMode'] === true;
  } catch {
    return false;
  }
}
