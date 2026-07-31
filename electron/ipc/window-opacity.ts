import type { BrowserWindow } from 'electron';

/**
 * Main-process half of the window opacity setting.
 *
 * The rationale for the range and the floor lives in `src/lib/window-opacity.ts`
 * — the renderer copy, which the arch gate (`no-renderer-importing-main`) forbids
 * importing from here and forbids the renderer importing from there. The two
 * files are kept in sync by hand, exactly as `app-icon.ts` is kept in sync with
 * `src/lib/app-icon.ts`. Both sides are tested, so a drift shows up as a failing
 * assertion rather than as a slider whose ends do not match what main honours.
 *
 * Nothing here imports `electron` at runtime — only the `BrowserWindow` type,
 * which erases — so this module is testable in the plain node environment vitest
 * runs in.
 */

/** Keep in sync with `src/lib/window-opacity.ts`. */
export const DEFAULT_WINDOW_OPACITY = 1;
export const MIN_WINDOW_OPACITY = 0.6;
export const WINDOW_OPACITY_STEP = 0.05;

/**
 * Whether this platform actually applies window opacity.
 *
 * From Electron 40's `electron.d.ts`, not from memory: `setOpacity` is tagged
 * `@platform win32,darwin` and documented "On Linux, does nothing"; `getOpacity`
 * is "On Linux, always returns 1"; the `opacity` constructor option is "only
 * implemented on Windows and macOS". macOS and Linux are this app's two
 * published targets, so half of them would get a control that does nothing —
 * hence the gate here and the withheld control in Settings.
 */
export function isWindowOpacitySupported(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Coerce an arbitrary value into a legal step. Applied to everything crossing
 * IPC and everything read off disk: `setOpacity` itself clamps to [0, 1], which
 * means a renderer bug asking for 0.02 would hand the user an invisible window
 * rather than an error.
 */
export function normalizeWindowOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WINDOW_OPACITY;
  const clamped = Math.min(DEFAULT_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, value));
  const steps = Math.round((clamped - MIN_WINDOW_OPACITY) / WINDOW_OPACITY_STEP);
  return Math.round((MIN_WINDOW_OPACITY + steps * WINDOW_OPACITY_STEP) * 100) / 100;
}

/**
 * Read the persisted opacity out of the raw `state.json` text.
 *
 * Takes the text rather than reading the file so it stays pure and testable, and
 * so the caller owns the one thing that can throw. A missing, unreadable or
 * malformed state file means a first launch or a corrupted profile; either way
 * the window opens opaque, which is the safe direction to fail.
 */
export function windowOpacityFromState(json: string | null): number {
  if (!json) return DEFAULT_WINDOW_OPACITY;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WINDOW_OPACITY;
    return normalizeWindowOpacity((parsed as { windowOpacity?: unknown }).windowOpacity);
  } catch {
    return DEFAULT_WINDOW_OPACITY;
  }
}

/**
 * Apply the opacity to the live window.
 *
 * Returns false instead of throwing when the platform does not implement it or
 * the window is gone, so the caller can log the honest reason rather than
 * reporting a success that never happened. Same contract as `applyAppIcon`.
 */
export function applyWindowOpacity(
  win: BrowserWindow | null,
  opacity: number,
  platform: string = process.platform,
): boolean {
  if (!isWindowOpacitySupported(platform)) return false;
  if (!win || win.isDestroyed()) return false;
  win.setOpacity(normalizeWindowOpacity(opacity));
  return true;
}
