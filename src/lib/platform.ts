export const isMac = navigator.userAgent.includes('Mac');
export const isLinux = navigator.userAgent.includes('Linux');

export const windowChromeTopInset = isMac ? 32 : isLinux ? 34 : 0;

/**
 * Display name for the primary modifier key: "Cmd" on macOS, "Ctrl" elsewhere.
 *
 * Only ever correct for the *modifier*. A tooltip that names a whole combo
 * wants `formatKeyCombo` against a resolved binding — gluing a literal key onto
 * this constant produces a string that ignores the user's rebinding, which is
 * exactly what the sidebar's Settings tooltip used to do.
 *
 * The `alt` twin that stood here went with the sidebar Tips block, its only
 * caller. `formatModifiers` spells Opt/Alt for anything that resolves a real
 * binding, so nothing else needed it.
 */
export const mod = isMac ? 'Cmd' : 'Ctrl';

/**
 * The running platform, spelled the way `process.platform` spells it, so
 * renderer code can ask predicates that main also asks — `window-opacity.ts`'s
 * support check is the same function on both sides of the IPC boundary, rather
 * than an `isMac` in the UI that has quietly stopped meaning the same thing.
 *
 * Windows is the fallback rather than a fourth case: it is not a published
 * target, and the two published ones are matched explicitly above.
 */
export const rendererPlatform: 'darwin' | 'linux' | 'win32' = isMac
  ? 'darwin'
  : isLinux
    ? 'linux'
    : 'win32';
