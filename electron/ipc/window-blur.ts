import type { BrowserWindow } from 'electron';

/**
 * Main-process half of the window blur setting.
 *
 * The rationale for the material set, the veil and the platform rule lives in
 * `src/lib/window-blur.ts` — the renderer copy, which the arch gate
 * (`no-renderer-importing-main`) forbids importing from here and forbids the
 * renderer importing from there. The two files are kept in sync by hand, exactly
 * as `window-opacity.ts` is kept in sync with `src/lib/window-opacity.ts`. Both
 * sides are tested, and `window-blur.test.ts` compares them as source text, so a
 * drift shows up as a failing assertion rather than as a settings list offering
 * a material main will not honour.
 *
 * Nothing here imports `electron` at runtime — only the `BrowserWindow` type,
 * which erases — so this module is testable in the plain node environment vitest
 * runs in.
 */

/** Keep in sync with `src/lib/window-blur.ts`. */
export const WINDOW_BLUR_MATERIALS = ['under-window', 'sidebar', 'hud', 'fullscreen-ui'] as const;

export type WindowBlurMaterial = (typeof WINDOW_BLUR_MATERIALS)[number];

export type WindowBlur = 'off' | WindowBlurMaterial;

export const DEFAULT_WINDOW_BLUR: WindowBlur = 'off';

/**
 * The window's background colour in each state, and the reason this option is
 * set at all.
 *
 * Vibrancy is painted *behind* the web contents, so it is only visible if the
 * web contents has no opaque backdrop of its own. `#00000000` is the fully
 * transparent background that lets it through. This is deliberately not
 * `transparent: true`, which is a constructor-only flag that cannot be undone at
 * runtime and which also costs the window its native shadow and rounded corners
 * — a permanent structural change in exchange for a setting the user must be
 * able to switch off.
 *
 * `WINDOW_BACKDROP_OPAQUE` is the off state, and it is the same `#0e1215` that
 * `styles.css` gives `html, body, #root`. Matching it is what makes switching
 * blur off restore the *exact* previous appearance rather than something close
 * to it, and `window-blur.test.ts` reads the value back out of `styles.css` so
 * the two cannot drift apart. Electron's own default here is white, which this
 * app never wanted: before this change the option was simply unset, so a
 * fraction of a second of white could show before the renderer painted.
 */
export const WINDOW_BACKDROP_OPAQUE = '#0e1215';
export const WINDOW_BACKDROP_TRANSPARENT = '#00000000';

/**
 * How the vibrancy material should track window activity.
 *
 * Unset means `followWindow`, which is Electron's documented default and the
 * reason the effect looked broken: macOS desaturates an `NSVisualEffectView`
 * into a flat grey panel the moment its window resigns key. For a tool that
 * lives beside a browser and an editor, that is most of the time the window is
 * on screen — so the material was only ever seen at its best in the instant
 * after a click. `active` pins it to `NSVisualEffectStateActive`, which is what
 * Safari's sidebar, Raycast and Arc all do, and it is the fix Electron itself
 * points at: electron#46120 ("Maintain vibrancy effect in inactive windows") was
 * closed as not-planned precisely because this option already exists.
 *
 * It is passed at construction unconditionally on macOS, not only when a
 * material is set, and that is deliberate rather than sloppy. The option has no
 * setter — electron#25513 is still open — and it is read when the vibrant NSView
 * is first created, which for a window that launches with blur off happens later,
 * inside a runtime `setVibrancy()`. Passing it only alongside a constructor
 * `vibrancy` would give the correct behaviour to users who quit with blur on and
 * `followWindow` to everyone who switched it on afterwards: the same setting,
 * two appearances, decided by a history the user cannot see. Handing it over up
 * front costs nothing when no material is ever set — nothing reads it — and is
 * the only way to make the two paths agree.
 */
export const WINDOW_VISUAL_EFFECT_STATE = 'active' as const;

/**
 * Whether this platform actually applies window blur.
 *
 * From Electron 40's `electron.d.ts`, not from memory: both `setVibrancy` and
 * the `vibrancy` constructor option are tagged `@platform darwin`. Linux, this
 * app's other published target, has no equivalent — `backgroundMaterial` is the
 * Windows option and a different value set entirely. So the control is withheld
 * in Settings rather than rendered and left inert.
 */
export function isWindowBlurSupported(platform: string): boolean {
  return platform === 'darwin';
}

/**
 * Coerce an arbitrary value into a legal setting. Applied to everything crossing
 * IPC and everything read off disk: `setVibrancy` throws on a value outside its
 * union, so an unrecognised string reaching it would take down the handler
 * rather than degrade.
 */
export function normalizeWindowBlur(value: unknown): WindowBlur {
  if (typeof value !== 'string') return DEFAULT_WINDOW_BLUR;
  if (value === 'off') return 'off';
  return (WINDOW_BLUR_MATERIALS as readonly string[]).includes(value)
    ? (value as WindowBlurMaterial)
    : DEFAULT_WINDOW_BLUR;
}

/**
 * Read the persisted blur out of the raw `state.json` text.
 *
 * Takes the text rather than reading the file so it stays pure and testable, and
 * so the caller owns the one thing that can throw. A missing, unreadable or
 * malformed state file means a first launch or a corrupted profile; either way
 * the window opens opaque, which is the safe direction to fail.
 */
export function windowBlurFromState(json: string | null): WindowBlur {
  if (!json) return DEFAULT_WINDOW_BLUR;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WINDOW_BLUR;
    return normalizeWindowBlur((parsed as { windowBlur?: unknown }).windowBlur);
  } catch {
    return DEFAULT_WINDOW_BLUR;
  }
}

/**
 * The blur to actually apply, given the setting and the OS accessibility flag.
 *
 * "Reduce transparency" is not a preference this app gets to weigh against its
 * own taste. Apple's wording on `accessibilityDisplayShouldReduceTransparency`
 * is imperative: "If this property is `true`, don't use semitransparent
 * backgrounds in the user interface. For example, use only opaque windows."
 *
 * Honouring it is also a bug fix rather than politeness. macOS forces the
 * vibrancy material off when the flag is set, but nothing told the renderer that
 * — so the CSS still made `html`, `body`, `#root` and `.app-shell` transparent
 * over a window backdrop that was `#00000000` because blur was nominally on. The
 * user's reward for turning on an accessibility setting was a window with a hole
 * in it. The renderer half is the `prefers-reduced-transparency` media query in
 * `styles.css`, which Chromium derives from the same OS flag; this is the
 * main-process half, and the two have to agree or the hole simply moves.
 *
 * The stored setting is deliberately not rewritten. Someone who turns the
 * accessibility flag off again gets the material they chose back, rather than an
 * app that quietly forgot on their behalf.
 *
 * Kept a pure function of an explicitly passed boolean rather than reading
 * `nativeTheme` here, so this module still imports nothing from `electron` at
 * runtime and stays testable in the plain node environment.
 */
export function effectiveWindowBlur(blur: unknown, reducedTransparency: boolean): WindowBlur {
  return reducedTransparency ? 'off' : normalizeWindowBlur(blur);
}

/**
 * Apply the blur to the live window.
 *
 * The off path is the one that matters most, and it is deliberately total:
 * `setVibrancy(null)` removes the native layer (Electron documents null and the
 * empty string as the removal signal) *and* the background colour goes back to
 * opaque. Doing only the first would leave a window whose web contents is still
 * transparent — an app that is permanently see-through with nothing behind it,
 * which is the single worst outcome this feature can produce. The renderer half
 * of the restoration is the `data-window-blur` attribute being removed, which
 * makes every veil rule in `styles.css` stop matching.
 *
 * Order matters on the way on: the background is cleared before the material is
 * set, so there is no frame in which vibrancy is active behind an opaque
 * backdrop. On the way off it is reversed — the material goes first, so there is
 * no frame in which an opaque backdrop hides nothing.
 *
 * Returns false instead of throwing when the platform does not implement it or
 * the window is gone, so the caller can log the honest reason rather than
 * reporting a success that never happened. Same contract as `applyWindowOpacity`.
 */
export function applyWindowBlur(
  win: BrowserWindow | null,
  blur: WindowBlur,
  platform: string = process.platform,
): boolean {
  if (!isWindowBlurSupported(platform)) return false;
  if (!win || win.isDestroyed()) return false;
  const normalized = normalizeWindowBlur(blur);
  if (normalized === 'off') {
    win.setVibrancy(null);
    win.setBackgroundColor(WINDOW_BACKDROP_OPAQUE);
  } else {
    win.setBackgroundColor(WINDOW_BACKDROP_TRANSPARENT);
    win.setVibrancy(normalized);
  }
  return true;
}
