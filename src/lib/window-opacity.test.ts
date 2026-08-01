import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_OPACITY,
  MIN_WINDOW_OPACITY,
  WINDOW_OPACITY_STEP,
  isWindowOpacitySupported,
  normalizeWindowOpacity,
  windowOpacityReadability,
  worstCaseSurfaceContrast,
} from './window-opacity';

describe('isWindowOpacitySupported', () => {
  // The rule moved when the mechanism did. It used to track `setOpacity`, which
  // Electron implements on macOS *and* Windows. The setting is now a CSS custom
  // property, and CSS works everywhere — so what gates it is no longer whether
  // the alpha can be applied but whether there is anything behind the window for
  // it to reveal. On this app's targets that means a vibrancy material, which is
  // darwin-only. Hence Windows is now false where it used to be true.
  it('is true on macOS, the only platform that can make the window translucent', () => {
    expect(isWindowOpacitySupported('darwin')).toBe(true);
  });

  it('is false on Linux, which has no vibrancy equivalent', () => {
    expect(isWindowOpacitySupported('linux')).toBe(false);
  });

  it('is false on Windows — the gate is translucency now, not setOpacity', () => {
    expect(isWindowOpacitySupported('win32')).toBe(false);
  });

  it('is false for a platform it has never heard of', () => {
    expect(isWindowOpacitySupported('freebsd')).toBe(false);
    expect(isWindowOpacitySupported('')).toBe(false);
  });

  it('agrees with the blur rule, because they are now one mechanism', () => {
    // Read as text rather than imported: the renderer blur copy is a sibling
    // module, but pinning the *rule* rather than the import is what catches
    // someone widening one of the two and not the other.
    const blur = readFileSync(resolve(__dirname, 'window-blur.ts'), 'utf8');
    expect(blur).toContain("return platform === 'darwin';");
  });
});

describe('normalizeWindowOpacity', () => {
  it('leaves a legal step alone', () => {
    expect(normalizeWindowOpacity(0.85)).toBe(0.85);
    expect(normalizeWindowOpacity(MIN_WINDOW_OPACITY)).toBe(MIN_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(DEFAULT_WINDOW_OPACITY)).toBe(DEFAULT_WINDOW_OPACITY);
  });

  it('clamps below the floor rather than resetting to opaque', () => {
    // Someone who persisted 0.2 wanted the window faint. The floor is the most
    // faint we will honour; snapping them back to 1 would discard the intent.
    expect(normalizeWindowOpacity(0.2)).toBe(MIN_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(0)).toBe(MIN_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(-4)).toBe(MIN_WINDOW_OPACITY);
  });

  it('clamps above the ceiling', () => {
    expect(normalizeWindowOpacity(1.4)).toBe(1);
  });

  it('snaps to the step grid', () => {
    expect(normalizeWindowOpacity(0.83)).toBe(0.85);
    expect(normalizeWindowOpacity(0.82)).toBe(0.8);
    // Float noise out of `Number(input.value) / 100` must not persist.
    expect(normalizeWindowOpacity(0.7500000000000001)).toBe(0.75);
  });

  it('returns clean two-decimal numbers for every step', () => {
    for (let v = MIN_WINDOW_OPACITY; v <= 1.0001; v += WINDOW_OPACITY_STEP) {
      const normalized = normalizeWindowOpacity(v);
      expect(normalized).toBe(Math.round(normalized * 100) / 100);
    }
  });

  it('falls back to the default for anything that is not a finite number', () => {
    expect(normalizeWindowOpacity(undefined)).toBe(DEFAULT_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(null)).toBe(DEFAULT_WINDOW_OPACITY);
    expect(normalizeWindowOpacity('0.8')).toBe(DEFAULT_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(NaN)).toBe(DEFAULT_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(Infinity)).toBe(DEFAULT_WINDOW_OPACITY);
    expect(normalizeWindowOpacity({})).toBe(DEFAULT_WINDOW_OPACITY);
  });
});

describe('worstCaseSurfaceContrast', () => {
  it('reports the theme contrast untouched at full opacity', () => {
    expect(worstCaseSurfaceContrast(1)).toBeCloseTo(8.25, 1);
  });

  it('falls monotonically as more desktop shows through', () => {
    let previous = Infinity;
    for (let v = 1; v >= MIN_WINDOW_OPACITY - 0.001; v -= WINDOW_OPACITY_STEP) {
      const ratio = worstCaseSurfaceContrast(v);
      expect(ratio).toBeLessThan(previous);
      previous = ratio;
    }
  });

  it('takes the worse of a white and a black desktop', () => {
    // A bright wallpaper is the harder case for a dark theme: it lifts the
    // surface toward the text faster than a black one drags it away.
    expect(worstCaseSurfaceContrast(0.6)).toBeCloseTo(4.89, 1);
  });

  /**
   * The claim the whole change rests on, as an assertion rather than a comment:
   * fading backgrounds instead of the composited window costs far less contrast
   * at the same setting.
   *
   * The old `worstCaseTextContrast` composited *both* terms — `setOpacity` fades
   * text and surface together — so the ratio collapsed toward 1 as the window
   * faded. Here the text term is never composited, and only the layers beneath
   * it are, so the ratio decays far more slowly. Reproduced inline because the
   * function it is being compared against no longer exists.
   */
  it('degrades far more slowly than fading the whole window did', () => {
    const toRgb = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const over = (
      c: [number, number, number],
      d: [number, number, number],
      a: number,
    ): [number, number, number] => [
      c[0] * a + d[0] * (1 - a),
      c[1] * a + d[1] * (1 - a),
      c[2] * a + d[2] * (1 - a),
    ];
    /** What `setOpacity` did: the compositor fades text and surface alike. */
    const oldModel = (alpha: number) =>
      Math.min(
        ...['#ffffff', '#000000'].map((hex) => {
          const desktop = toRgb(hex);
          return ratio(
            over(toRgb('#bcbec4'), desktop, alpha),
            over(toRgb('#181a1d'), desktop, alpha),
          );
        }),
      );

    for (const alpha of [0.6, 0.7, 0.8, 0.9]) {
      expect(
        worstCaseSurfaceContrast(alpha),
        `at ${alpha} the new mechanism must not be worse than the old one`,
      ).toBeGreaterThan(oldModel(alpha));
    }
    // At the floor the gap is the headline: the old model was scraping past 3:1,
    // the new one clears AA for body text.
    expect(oldModel(MIN_WINDOW_OPACITY)).toBeLessThan(4.5);
    expect(worstCaseSurfaceContrast(MIN_WINDOW_OPACITY)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('windowOpacityReadability', () => {
  it('calls full opacity ok', () => {
    expect(windowOpacityReadability(1)).toBe('ok');
  });

  // Every step the slider can reach clears WCAG AA for *body* text, not the
  // large-text 3:1 the old window-fading model had to settle for.
  it('holds WCAG AA for body text across the entire offered range', () => {
    for (let v = MIN_WINDOW_OPACITY; v <= 1.0001; v += WINDOW_OPACITY_STEP) {
      const step = normalizeWindowOpacity(v);
      expect(worstCaseSurfaceContrast(step), `${step} must clear 4.5:1`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(windowOpacityReadability(step)).toBe('ok');
    }
  });

  /**
   * The floor is deliberately *not* where this function runs out of room.
   *
   * It models `islands-dark`, the default and a comfortable theme: still more
   * than a point of headroom at the floor, and it would tolerate 0.60. The
   * binding case is `classic`'s `--fg-muted`, which starts at only 4.09:1 fully
   * opaque and drops under 3:1 at 0.65 — found by running the same composite
   * across all eleven built-ins in `surface-alpha-contrast.test.ts`. Anyone
   * lowering MIN on the strength of the numbers in *this* file would be reading
   * the wrong theme, so both halves are pinned here.
   */
  it('is not itself the binding constraint on the floor', () => {
    expect(worstCaseSurfaceContrast(MIN_WINDOW_OPACITY)).toBeGreaterThan(4.5);
    expect(worstCaseSurfaceContrast(MIN_WINDOW_OPACITY - WINDOW_OPACITY_STEP)).toBeGreaterThan(4.5);
  });

  it('sets the floor where the worst built-in theme runs out, not where this one does', () => {
    expect(MIN_WINDOW_OPACITY).toBe(0.7);

    // `classic`: --fg-muted #8b8d93 on --task-panel-bg #2d2e32, whose
    // --bg-elevated is the same colour. 0.70 clears 3:1; 0.65 does not.
    const toRgb = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const lum = ([r, g, b]: [number, number, number]) => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const over = (
      c: [number, number, number],
      d: [number, number, number],
      a: number,
    ): [number, number, number] => [
      c[0] * a + d[0] * (1 - a),
      c[1] * a + d[1] * (1 - a),
      c[2] * a + d[2] * (1 - a),
    ];
    const desktops: [number, number, number][] = [
      [255, 255, 255],
      [0, 0, 0],
    ];
    const classicMuted = (alpha: number) =>
      Math.min(
        ...desktops.map((desktop) => {
          const surface = toRgb('#2d2e32');
          const bg = over(surface, over(surface, desktop, alpha), alpha);
          const la = lum(toRgb('#8b8d93'));
          const lb = lum(bg);
          return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        }),
      );

    expect(classicMuted(MIN_WINDOW_OPACITY)).toBeGreaterThanOrEqual(3);
    expect(classicMuted(MIN_WINDOW_OPACITY - WINDOW_OPACITY_STEP)).toBeLessThan(3);
  });

  it('still classifies honestly below anything the slider can reach', () => {
    // Unreachable through the UI, but the classification stays total so a value
    // arriving from a hand-edited state file is described rather than flattered.
    expect(windowOpacityReadability(0.4)).toBe('poor');
  });

  it('never returns anything but ok for a value the slider can produce', () => {
    for (let v = MIN_WINDOW_OPACITY; v <= 1.0001; v += WINDOW_OPACITY_STEP) {
      expect(windowOpacityReadability(normalizeWindowOpacity(v))).toBe('ok');
    }
  });
});

/**
 * The default, asserted because it is a product decision rather than an
 * implementation detail: transparency is opt-in.
 *
 * Every terminal emulator surveyed — iTerm2, Ghostty, Alacritty, kitty, WezTerm,
 * Hyper — exposes this as a user setting and defaults it to fully opaque. The
 * behaviour this replaced did the opposite: switching blur on forced a fixed
 * 0.75 veil that could not be adjusted at all.
 */
describe('the default', () => {
  it('is fully opaque, so an untouched install looks exactly as it did', () => {
    expect(DEFAULT_WINDOW_OPACITY).toBe(1);
  });

  it('leaves the terminal on its opaque fast path at the default', async () => {
    const { terminalNeedsTransparency } = await import('./theme');
    for (const blurOn of [true, false]) {
      expect(terminalNeedsTransparency(blurOn, DEFAULT_WINDOW_OPACITY)).toBe(false);
    }
  });
});
