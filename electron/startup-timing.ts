import { debug, getMinLevel } from './log.js';

/**
 * Startup timing marks.
 *
 * Emitted at `debug` level, so a production build (`minLevel` is `warn`, see
 * log.ts) writes nothing and pays nothing. Measurement runs use a non-production
 * build, where debug is on.
 *
 * Each mark carries an absolute `atMs`. The relative log timestamp alone cannot
 * see Electron's own boot time, which happens before any of our code runs — the
 * measuring harness records its spawn time and subtracts.
 *
 * Parsed by scripts/measure-startup.mjs.
 */

/** Grep anchor. Changing this breaks scripts/measure-startup.mjs. */
const STARTUP_MARK_MSG = 'startup mark';

export type StartupMark = 'main-module-loaded' | 'app-ready' | 'window-created' | 'renderer-loaded';

const seen = new Set<StartupMark>();

/**
 * Record a startup mark. Idempotent per mark: `did-finish-load` fires again on
 * reload, and a second "renderer-loaded" would make a reload look like a
 * startup. Only the first occurrence is a startup measurement.
 */
export function markStartup(mark: StartupMark): void {
  if (getMinLevel() !== 'debug') return;
  if (seen.has(mark)) return;
  seen.add(mark);
  debug('startup', STARTUP_MARK_MSG, { mark, atMs: Date.now() });
}
