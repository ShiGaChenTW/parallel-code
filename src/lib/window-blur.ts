/**
 * Window blur (macOS vibrancy): the value model and the platform rule.
 *
 * WHY THIS IS NOT JUST `setVibrancy()`
 *
 * Vibrancy is a native layer *behind* the web contents: macOS blurs whatever is
 * behind the window and paints it there. The renderer then paints on top of it.
 * This app paints an opaque backdrop — `html, body, #root { background: #0e1215 }`
 * in `styles.css`, a 100vw x 100vh `.app-shell` carrying `var(--bg)`, and above
 * those the task columns and terminal surfaces that cover nearly the whole
 * window. Turning vibrancy on alone produced no visible effect worth the name,
 * which is exactly what users reported: a little frosting round the edges and a
 * completely unchanged middle.
 *
 * WHY THE THEMES ARE STILL NOT TOUCHED
 *
 * There are eleven built-in presets plus user-authored custom themes, so "give
 * the background colours an alpha channel" is not a change that can be made
 * eleven times and then made again by every user. Two properties of this
 * codebase rule that out on the merits, not just on effort:
 *
 *   1. `--bg` is a `radial-gradient(...)` in nine of the eleven presets, not a
 *      colour. `color-mix()`, `colord().alpha()` and every other colour function
 *      take colours. There is no value-level transform that works on all eleven,
 *      let alone on a custom theme whose `--bg` nobody has seen.
 *   2. Every theme's internal contrast is gated by
 *      `custom-theme-contrast.test.ts`, which compares theme variables against
 *      each other. Rewriting those variables would invalidate that gate.
 *
 * So the alpha is applied to a *layer*, or to a *use* of a colour, never to the
 * colour itself. `styles.css` gives `#root` a `::before` veil painting
 * `var(--bg)` — gradient, colour or image, whatever the theme says — at
 * `--surface-alpha`, and thins the two surfaces above it with `color-mix()` at
 * the same figure. Every theme variable keeps the value its author wrote, so
 * that gate still audits exactly what it always audited. What it never covered —
 * the same text once these layers have been composited over a real desktop — is
 * modelled by `worstCaseSurfaceContrast()` in `window-opacity.ts`.
 *
 * WHERE THE ALPHA COMES FROM
 *
 * From the user, now. It used to be a constant here: 0.75, derived as the lowest
 * 0.05 step whose worst case still cleared WCAG 3:1, and deliberately fixed on
 * the argument that "one number with one derivation is defensible". The
 * derivation was sound and the conclusion was wrong twice over. 3:1 is the AA
 * threshold for *large text and graphical objects*; this is a full-screen
 * terminal at small monospace sizes, where the applicable figure is 4.5:1, so
 * 0.75 was being measured against the wrong line. And every terminal emulator
 * surveyed — iTerm2, Ghostty, Alacritty, kitty, WezTerm, Hyper — makes this
 * adjustable and defaults it to fully opaque, where this app forced 0.75 on
 * anyone who switched blur on and offered no way back. The number now lives in
 * `window-opacity.ts`, defaults to 1.00, and every step it can reach clears
 * 4.5:1.
 */

/**
 * The vibrancy materials offered, out of the fifteen Electron accepts.
 *
 * The rest are excluded on purpose. macOS materials are semantic — each is tuned
 * for the surface it names — and most of the fifteen name *controls*, not
 * windows: `menu`, `popover`, `tooltip`, `sheet`, `selection`, `titlebar` and
 * `header` are calibrated for small, transient, often floating UI, and stretched
 * across a 1400x900 window they read as flat wash rather than glass.
 * `appearance-based` is deprecated by Apple (10.14) and is not even in the
 * `setVibrancy()` union, only the constructor's — offering it would give a value
 * that works at launch and throws at runtime.
 *
 * What is left is the set macOS documents as *surface-scale*:
 *
 *   under-window   the material Apple specifies for a window's own background;
 *                  the correct default and the reason it is first here
 *   sidebar        thinner, lets noticeably more desktop through
 *   hud            darkest and most opaque-feeling; the restrained option, and
 *                  the one that costs the least contrast on a bright desktop
 *   fullscreen-ui  mid-weight, designed for full-surface coverage
 *
 * All four appear in both the `BrowserWindowConstructorOptions.vibrancy` union
 * and the `setVibrancy()` union in Electron 40's `electron.d.ts`, which is what
 * lets the same persisted value serve the launch path and the toggle path.
 */
export const WINDOW_BLUR_MATERIALS = ['under-window', 'sidebar', 'hud', 'fullscreen-ui'] as const;

export type WindowBlurMaterial = (typeof WINDOW_BLUR_MATERIALS)[number];

/** The setting's value: a material, or off. One value, so there is no illegal
 * "disabled but with a material" state to reconcile on load. */
export type WindowBlur = 'off' | WindowBlurMaterial;

/**
 * Off by default, and deliberately so. The translucency mechanism only engages
 * when this is not `'off'`, so an untouched install paints exactly what it
 * painted before this feature existed.
 */
export const DEFAULT_WINDOW_BLUR: WindowBlur = 'off';

/**
 * Whether the running platform actually applies window blur.
 *
 * Electron 40's own type definitions are the source, not folklore: both
 * `BrowserWindow.setVibrancy` and `BrowserWindowConstructorOptions.vibrancy` are
 * tagged `@platform darwin`. `backgroundMaterial` is the Windows equivalent and
 * is a different option with a different value set; this app publishes macOS and
 * Linux only, so it is irrelevant here. Linux has no equivalent at all — which
 * is why the setting is withheld there rather than rendered and left inert, the
 * same call `window-opacity.ts` makes for the same reason.
 *
 * Note this is a *narrower* rule than opacity's: opacity covers darwin and
 * win32, blur covers darwin alone.
 */
export function isWindowBlurSupported(platform: string): boolean {
  return platform === 'darwin';
}

/**
 * Coerce anything — a persisted value from an older build, a hand-edited
 * state.json, a material Apple has since removed — into a legal value.
 *
 * Unknown input falls back to `'off'` rather than to a material. Every other
 * direction risks handing someone a translucent window they did not ask for and
 * cannot explain, and `'off'` is the state in which the app is known to look
 * exactly as designed.
 */
export function normalizeWindowBlur(value: unknown): WindowBlur {
  if (typeof value !== 'string') return DEFAULT_WINDOW_BLUR;
  if (value === 'off') return 'off';
  return (WINDOW_BLUR_MATERIALS as readonly string[]).includes(value)
    ? (value as WindowBlurMaterial)
    : DEFAULT_WINDOW_BLUR;
}
