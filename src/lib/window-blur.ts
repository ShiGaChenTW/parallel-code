/**
 * Window blur (macOS vibrancy): the value model, the platform rule, and the one
 * number that decides how much desktop is allowed through.
 *
 * WHY THIS IS NOT JUST `setVibrancy()`
 *
 * Vibrancy is a native layer *behind* the web contents: macOS blurs whatever is
 * behind the window and paints it there. The renderer then paints on top of it.
 * This app paints an opaque backdrop — `html, body, #root { background: #0e1215 }`
 * in `styles.css`, and a 100vw x 100vh `.app-shell` carrying `var(--bg)` — so
 * without a second change the native blur is painted and then completely
 * covered. Turning vibrancy on alone produces no visible effect at all.
 *
 * WHY THE THEMES ARE NOT TOUCHED
 *
 * There are eleven built-in presets plus user-authored custom themes, so
 * "give the background colours an alpha channel" is not a change that can be
 * made eleven times and then made again by every user. Two properties of this
 * codebase rule that approach out on the merits, not just on effort:
 *
 *   1. `--bg` is a `radial-gradient(...)` in nine of the eleven presets, not a
 *      colour. `color-mix()`, `colord().alpha()` and every other colour function
 *      take colours. There is no value-level transform that works on all eleven,
 *      let alone on a custom theme whose `--bg` nobody has seen.
 *   2. Every theme's internal contrast is already gated by
 *      `custom-theme-contrast.test.ts`, which compares theme variables against
 *      each other. Rewriting those variables would invalidate that gate.
 *
 * So the alpha is applied to a *layer*, never to a value. `styles.css` gives
 * `#root` a `::before` veil that paints `var(--bg)` — whatever the active theme
 * says that is, gradient or colour or image — at `WINDOW_BLUR_VEIL_ALPHA`, and
 * the opaque backdrops above are switched to `transparent`. The veil holds no
 * text, so nothing is faded except the backdrop itself. That is the whole
 * difference from `setOpacity`, which fades the composited window *including*
 * the glyphs and is why its floor had to be 0.60.
 *
 * The consequence worth stating plainly: **panels stay opaque.** Islands, task
 * columns, the terminal surface (`--task-panel-bg`) and every dialog keep
 * exactly the background their theme author wrote, because no theme variable is
 * touched. Terminal text therefore sits on the same opaque surface it always
 * did, at the same contrast, in every theme including custom ones. Only the
 * window's own backdrop — the frame the islands float on — becomes translucent.
 *
 * WHY 0.75
 *
 * A little chrome does sit directly on that backdrop (the macOS titlebar strip,
 * the sidebar-collapse affordance), so the veil cannot go arbitrarily thin.
 * `worstCaseChromeContrast()` models it the way `window-opacity.ts` modelled the
 * composited window: default-theme body text, unfaded, against the backdrop
 * blended over the least forgiving desktop. Measured against `islands-dark`
 * (#bcbec4 on the #26282c that fills the gradient past its 18% stop):
 *
 *   1.00 -> 7.95    0.90 -> 5.81    0.80 -> 4.15    0.70 -> 2.98
 *   0.95 -> 6.84    0.85 -> 4.91    0.75 -> 3.51    0.65 -> 2.55
 *
 * 3:1 is the WCAG AA threshold for large text and graphical objects, and the
 * last point at which a glyph is reliably separable from what is behind it.
 * 0.75 is the lowest 0.05 step that still clears it; 0.70 does not.
 * `window-blur.test.ts` asserts exactly that boundary, so the number cannot
 * drift without the reason drifting with it.
 *
 * `islands-dark` is not merely the default here, it is the worst case among the
 * eleven built-ins: at 0.75 every other preset lands between 5.05 (`classic`)
 * and 6.69 (`islands-light`), because their backdrops sit further from mid-grey
 * than its #26282c does. Deriving the floor from the reference theme therefore
 * over-protects the other ten rather than under-protecting them.
 *
 * Note what is *not* claimed: a blurred desktop is not a gentler desktop.
 * Blurring removes spatial detail, not mean luminance — a white wallpaper blurs
 * to white. So #ffffff and #000000 remain the correct extremes here, exactly as
 * they were for window opacity, and no relaxation is available on the grounds
 * that "the backdrop is blurred now". macOS's own material tint sits between the
 * veil and the desktop and can only help; it is left out of the model because it
 * is not a value this code can read.
 *
 * The veil alpha is fixed rather than exposed as a slider. One number with one
 * derivation is defensible; a slider would need a floor, and the floor would be
 * this same number with a control bolted above it that can only make things
 * worse.
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

/** See the file header: the lowest 0.05 step whose worst case still clears 3:1. */
export const WINDOW_BLUR_VEIL_ALPHA = 0.75;

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

/** Body text and backdrop of `islands-dark`, the default theme. `#26282c` is the
 * colour its `--bg` radial-gradient settles to past its 18% stop, i.e. what
 * covers nearly all of the window. */
const REFERENCE_TEXT = '#bcbec4';
const REFERENCE_BACKDROP = '#26282c';

/** The two extremes of what can sit behind the window. Blur does not move them:
 * it removes detail, not luminance. */
const EXTREME_BACKDROPS = ['#ffffff', '#000000'] as const;

type Rgb = readonly [number, number, number];

function toRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What the veil does: `alpha` of the theme backdrop over `backdrop`. */
function composite(color: Rgb, backdrop: Rgb, alpha: number): Rgb {
  return [
    color[0] * alpha + backdrop[0] * (1 - alpha),
    color[1] * alpha + backdrop[1] * (1 - alpha),
    color[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

/**
 * WCAG contrast of default-theme body text against the window backdrop, after
 * the veil has been composited at `alpha` over the least forgiving desktop.
 *
 * The text term is deliberately *not* composited: the veil carries no text, so
 * glyphs keep their full opacity. That is the structural difference from
 * `worstCaseTextContrast()` in `window-opacity.ts`, where the compositor fades
 * text and surface together.
 */
export function worstCaseChromeContrast(alpha: number): number {
  const text = toRgb(REFERENCE_TEXT);
  const surface = toRgb(REFERENCE_BACKDROP);
  return Math.min(
    ...EXTREME_BACKDROPS.map((hex) => contrastRatio(text, composite(surface, toRgb(hex), alpha))),
  );
}
