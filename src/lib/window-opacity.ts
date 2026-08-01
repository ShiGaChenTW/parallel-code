/**
 * Surface alpha: how much of the desktop the app's own backgrounds let through.
 *
 * WHAT THIS USED TO BE, AND WHY IT CHANGED
 *
 * This setting used to call Electron's `win.setOpacity()`. That sets the
 * NSWindow's alpha, which alpha-blends the *composited window* against whatever
 * is behind it — chrome, panels and glyphs alike. Mathematically it cannot do
 * anything else: it is one number applied to the finished picture. So the
 * wallpaper read straight through the letterforms, and the traffic-light buttons
 * faded with them.
 *
 * That is not what transparency means in a terminal. iTerm2, Ghostty, Alacritty,
 * kitty, WezTerm and Hyper all fade the *background* and leave glyphs at full
 * opacity — six products, no exceptions. Hyper is the closest architecture to
 * this one (Electron plus xterm.js) and does it in four lines: the user's alpha
 * goes on `backgroundColor`, `foregroundColor` is never touched, and xterm's
 * `allowTransparency` is switched on only when the background actually needs it.
 *
 * So the number persisted here no longer reaches `setOpacity`. It drives the
 * `--surface-alpha` custom property, which `styles.css` applies to background
 * layers and to nothing else. No text token is a function of it.
 *
 * WHY THE DEFAULT IS 1.00
 *
 * Not inertia — it is what every comparable product ships. All six terminals
 * above expose this as a slider and all six default it to fully opaque, so
 * transparency is something a user opts into rather than something an update
 * does to them. The old behaviour here was the opposite: switching blur on
 * forced a fixed 0.75 veil that could not be adjusted at all.
 *
 * WHY THE FLOOR MOVED FROM 0.60 TO 0.70
 *
 * `worstCaseSurfaceContrast()` models the layer stack rather than the
 * compositor. Body text sits at full opacity on a surface painted at `alpha`
 * over the window backdrop, which was itself painted at `alpha` over the
 * desktop — so the alpha is paid twice before the text's background is reached,
 * and the text term is not multiplied at all. Measured against `islands-dark`'s
 * `#bcbec4` on `#1c2630` over `#26282c`:
 *
 *   1.00 -> 8.25    0.85 -> 7.70    0.70 -> 6.21    0.60 -> 4.89
 *   0.95 -> 8.18    0.80 -> 7.30    0.65 -> 5.56    0.55 -> 4.22
 *   0.90 -> 8.00    0.75 -> 6.80
 *
 * By that measure alone 0.60 would still be fine — it clears 4.5:1 with room to
 * spare, where the `setOpacity` model it replaced needed 0.60 just to reach 3:1.
 * The floor is not set by this theme, though. `surface-alpha-contrast.test.ts`
 * runs the same composite across all eleven built-ins and two text tokens, and
 * the binding case is `classic`'s `--fg-muted` (`#8b8d93` on `#2d2e32`), which
 * starts at only 4.09:1 fully opaque because that theme puts its muted tone very
 * close to its surface:
 *
 *   1.00 -> 4.09    0.85 -> 3.82    0.75 -> 3.37    0.65 -> 2.77
 *   0.90 -> 3.97    0.80 -> 3.62    0.70 -> 3.08    0.60 -> 2.45
 *
 * 0.70 is the lowest step at which every built-in still clears 3:1 on secondary
 * text and 4.5:1 on body text; 0.65 does not. So the floor is derived from the
 * worst theme actually shipped rather than inherited from the mechanism this
 * replaced — 0.60 was carried over from a model that no longer describes
 * anything, and the new gate found it before a user did.
 *
 * A blurred desktop is not a gentler desktop: blurring removes spatial detail,
 * not mean luminance, and a white wallpaper blurs to white. So #ffffff and
 * #000000 stay the modelled extremes and no relaxation is available on the
 * grounds that vibrancy is doing something underneath. macOS's own material tint
 * sits between the app and the desktop and can only help; it is left out because
 * it is not a value this code can read.
 */

export const DEFAULT_WINDOW_OPACITY = 1;

/** See the file header: the lowest step at which every built-in theme still
 * clears 4.5:1 on body text and 3:1 on secondary text once composited over the
 * worst desktop. 0.65 does not — `classic` falls to 2.77:1. */
export const MIN_WINDOW_OPACITY = 0.7;

export const WINDOW_OPACITY_STEP = 0.05;

/**
 * Coerce anything — a persisted value from an older build, a hand-edited
 * state.json, a slider that produced 0.7500000000000001 — into a legal step.
 *
 * Out-of-range values clamp rather than reset: a state file that says 0.2 came
 * from someone who wanted the window faint, and 0.6 honours that better than
 * snapping back to fully opaque. Non-numbers are a different case entirely and
 * fall back to the default.
 *
 * Values written by the `setOpacity` era survive unchanged, and that is
 * deliberate. The number meant "fade the whole window to 0.8"; it now means
 * "paint backgrounds at 0.8". Both answer "how see-through do you want this",
 * and the new reading is strictly more legible at the same figure — so
 * migrating the value would be moving someone's setting to fix a problem they
 * no longer have.
 */
export function normalizeWindowOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WINDOW_OPACITY;
  const clamped = Math.min(DEFAULT_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, value));
  const steps = Math.round((clamped - MIN_WINDOW_OPACITY) / WINDOW_OPACITY_STEP);
  return Math.round((MIN_WINDOW_OPACITY + steps * WINDOW_OPACITY_STEP) * 100) / 100;
}

/** Whether the setting can do anything on this platform.
 *
 * Not a CSS question — the custom property applies everywhere — but a window
 * one. Painting a background at 0.8 only reveals the desktop if the window is
 * translucent, and on macOS the only route to that which this app takes is a
 * vibrancy material. Linux has no equivalent (`vibrancy` is `@platform darwin`),
 * so the slider would move and change nothing there. Deliberately the same rule
 * as `isWindowBlurSupported`, and the two settings are now one mechanism rather
 * than two that had to be kept apart. */
export function isWindowOpacitySupported(platform: string): boolean {
  return platform === 'darwin';
}

/** Body text and terminal surface of `islands-dark`, the default theme.
 * `--task-panel-bg` is the surface scrollback is actually read on, so it is the
 * one worth modelling. */
const REFERENCE_TEXT = '#bcbec4';
const REFERENCE_SURFACE = '#1c2630';

/** The window backdrop that surface is painted over — the colour `--bg` settles
 * to past its gradient stop, which covers nearly all of the window. */
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

/** One layer: `alpha` of `color` painted over `backdrop`. */
function composite(color: Rgb, backdrop: Rgb, alpha: number): Rgb {
  return [
    color[0] * alpha + backdrop[0] * (1 - alpha),
    color[1] * alpha + backdrop[1] * (1 - alpha),
    color[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

/**
 * WCAG contrast of default-theme body text on the terminal surface, once that
 * surface and the window backdrop beneath it have both been painted at `alpha`
 * over the least forgiving desktop.
 *
 * Two composites, not one, because that is the layer stack `styles.css` builds:
 * the backdrop veil at `--surface-alpha`, and the terminal surface at
 * `--surface-alpha` on top of it. Text is composited zero times — the whole
 * point of the mechanism — which is the structural difference from the
 * `setOpacity` model this replaced, where the compositor faded text and surface
 * together and the ratio collapsed about twice as fast.
 */
export function worstCaseSurfaceContrast(alpha: number): number {
  const text = toRgb(REFERENCE_TEXT);
  const surface = toRgb(REFERENCE_SURFACE);
  const backdrop = toRgb(REFERENCE_BACKDROP);
  return Math.min(
    ...EXTREME_BACKDROPS.map((hex) =>
      contrastRatio(text, composite(surface, composite(backdrop, toRgb(hex), alpha), alpha)),
    ),
  );
}

/**
 * How much the chosen alpha costs legibility, in WCAG terms.
 *
 * Both `reduced` and `poor` are now unreachable through the UI — that is what
 * the numbers above say and it is the point of the change — but the
 * classification stays total so the boundaries are testable and so a value
 * arriving from outside the slider is still described honestly.
 */
export type WindowOpacityReadability = 'ok' | 'reduced' | 'poor';

export function windowOpacityReadability(opacity: number): WindowOpacityReadability {
  const ratio = worstCaseSurfaceContrast(opacity);
  if (ratio >= 4.5) return 'ok';
  if (ratio >= 3) return 'reduced';
  return 'poor';
}
