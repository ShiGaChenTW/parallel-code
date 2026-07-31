/**
 * Window opacity: the value model, the platform rule, and the readability floor.
 *
 * WHY THE FLOOR IS NOT A ROUND NUMBER PICKED BY FEEL
 *
 * Electron's `win.setOpacity()` alpha-blends the *composited window* — chrome,
 * panels, and glyphs alike — against whatever is behind it. That is not what a
 * terminal emulator means by transparency. iTerm2 and Alacritty fade the
 * terminal's background and leave the text opaque, which is why 0.7 looks fine
 * there; here 0.7 fades the text too, and the desktop wallpaper reads straight
 * through the letterforms. So the usable range is much narrower than a terminal
 * user's intuition suggests, and the floor has to come from contrast, not taste.
 *
 * `worstCaseTextContrast()` models the compositor: it blends the default dark
 * theme's body text (`--fg`) and its panel surface (`--bg-elevated`) against the
 * two extreme desktops a user can have — pure white and pure black — and returns
 * the lower of the two resulting WCAG ratios. Measured against `islands-dark`
 * (#bcbec4 on #181a1d, 9.38:1 opaque):
 *
 *   1.00 → 9.38    0.85 → 6.56    0.75 → 4.89    0.65 → 3.68
 *   0.95 → 8.51    0.80 → 5.67    0.70 → 4.23    0.60 → 3.21    0.55 → 2.82
 *
 * 4.5:1 is WCAG AA for body text; 3:1 is AA for large text and the last point at
 * which a glyph is reliably separable from what is behind it. 0.60 is the lowest
 * step that still clears 3:1 on the worst desktop; 0.55 does not. That is the
 * floor, and `window-opacity.test.ts` asserts exactly that boundary, so the
 * number cannot drift without the reason drifting with it.
 *
 * The secondary argument for a floor — an app faded to nothing is an app whose
 * settings dialog the user cannot find again — is real but weaker: `setOpacity`
 * does not affect hit-testing, so a nearly invisible window is still clickable.
 * Contrast is the binding constraint, so contrast sets the number.
 *
 * The existing theme contrast gate (`custom-theme-contrast.test.ts`) is
 * unaffected by any of this: it checks CSS variables against each other, and the
 * compositor runs after the renderer has already painted. Those ratios stay
 * exactly as tested *inside* the window. What this file models is the one thing
 * that gate never covered — the final composite against the desktop.
 */

export const DEFAULT_WINDOW_OPACITY = 1;

/** See the file header: the lowest step that still clears 3:1 on any desktop. */
export const MIN_WINDOW_OPACITY = 0.6;

export const WINDOW_OPACITY_STEP = 0.05;

/**
 * Whether the running platform actually applies window opacity.
 *
 * Electron 40's own type definitions are the source, not folklore:
 * `BrowserWindow.setOpacity` is tagged `@platform win32,darwin` and documented
 * "On Linux, does nothing"; `getOpacity` is documented "On Linux, always returns
 * 1"; the `opacity` constructor option says "only implemented on Windows and
 * macOS". Linux is a no-op, silently — which is why the setting is withheld
 * there rather than rendered and left inert.
 */
export function isWindowOpacitySupported(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Coerce anything — a persisted value from an older build, a hand-edited
 * state.json, a slider that produced 0.7500000000000001 — into a legal step.
 *
 * Out-of-range values clamp rather than reset: a state file that says 0.2 came
 * from someone who wanted the window faint, and 0.6 honours that better than
 * snapping back to fully opaque. Non-numbers are a different case entirely and
 * fall back to the default.
 */
export function normalizeWindowOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WINDOW_OPACITY;
  const clamped = Math.min(DEFAULT_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, value));
  const steps = Math.round((clamped - MIN_WINDOW_OPACITY) / WINDOW_OPACITY_STEP);
  return Math.round((MIN_WINDOW_OPACITY + steps * WINDOW_OPACITY_STEP) * 100) / 100;
}

/** Body text and panel surface of `islands-dark`, the default theme. */
const REFERENCE_TEXT = '#bcbec4';
const REFERENCE_SURFACE = '#181a1d';

/** The two extremes of what can sit behind the window. */
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

/** What the compositor does: `opacity` of the window over `backdrop`. */
function composite(color: Rgb, backdrop: Rgb, opacity: number): Rgb {
  return [
    color[0] * opacity + backdrop[0] * (1 - opacity),
    color[1] * opacity + backdrop[1] * (1 - opacity),
    color[2] * opacity + backdrop[2] * (1 - opacity),
  ];
}

/**
 * WCAG contrast of default-theme body text on its panel, after the window has
 * been composited at `opacity` over the least forgiving desktop background.
 */
export function worstCaseTextContrast(opacity: number): number {
  const text = toRgb(REFERENCE_TEXT);
  const surface = toRgb(REFERENCE_SURFACE);
  return Math.min(
    ...EXTREME_BACKDROPS.map((hex) => {
      const backdrop = toRgb(hex);
      return contrastRatio(
        composite(text, backdrop, opacity),
        composite(surface, backdrop, opacity),
      );
    }),
  );
}

/**
 * How much the chosen opacity costs legibility, in WCAG terms.
 *
 * `poor` is unreachable through the UI — that is the floor's whole job — but the
 * classification stays total so the boundary is testable and so a value arriving
 * from outside the slider is still described honestly.
 */
export type WindowOpacityReadability = 'ok' | 'reduced' | 'poor';

export function windowOpacityReadability(opacity: number): WindowOpacityReadability {
  const ratio = worstCaseTextContrast(opacity);
  if (ratio >= 4.5) return 'ok';
  if (ratio >= 3) return 'reduced';
  return 'poor';
}
