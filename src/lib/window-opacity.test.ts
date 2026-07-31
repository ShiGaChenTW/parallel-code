import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_OPACITY,
  MIN_WINDOW_OPACITY,
  WINDOW_OPACITY_STEP,
  isWindowOpacitySupported,
  normalizeWindowOpacity,
  windowOpacityReadability,
  worstCaseTextContrast,
} from './window-opacity';

describe('isWindowOpacitySupported', () => {
  // Electron 40's electron.d.ts: setOpacity is `@platform win32,darwin` and
  // documented "On Linux, does nothing". macOS and Linux are the two published
  // targets, so this predicate is the difference between a working setting and
  // a dead slider for half the users.
  it('is true on macOS', () => {
    expect(isWindowOpacitySupported('darwin')).toBe(true);
  });

  it('is false on Linux, where Electron implements setOpacity as a no-op', () => {
    expect(isWindowOpacitySupported('linux')).toBe(false);
  });

  it('is true on Windows, the other platform Electron implements it on', () => {
    expect(isWindowOpacitySupported('win32')).toBe(true);
  });

  it('is false for a platform it has never heard of', () => {
    expect(isWindowOpacitySupported('freebsd')).toBe(false);
    expect(isWindowOpacitySupported('')).toBe(false);
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

describe('worstCaseTextContrast', () => {
  it('reports the theme contrast untouched at full opacity', () => {
    expect(worstCaseTextContrast(1)).toBeCloseTo(9.38, 1);
  });

  it('falls monotonically as the window fades', () => {
    let previous = Infinity;
    for (let v = 1; v >= MIN_WINDOW_OPACITY - 0.001; v -= WINDOW_OPACITY_STEP) {
      const ratio = worstCaseTextContrast(v);
      expect(ratio).toBeLessThan(previous);
      previous = ratio;
    }
  });

  it('takes the worse of a white and a black desktop', () => {
    // A bright wallpaper is the harder case for a dark theme: it lifts the panel
    // toward the text faster than a black one drags the text toward the panel.
    expect(worstCaseTextContrast(0.6)).toBeCloseTo(3.21, 1);
  });
});

describe('windowOpacityReadability', () => {
  it('calls full opacity ok', () => {
    expect(windowOpacityReadability(1)).toBe('ok');
  });

  it('holds WCAG AA for body text down to 0.75', () => {
    expect(worstCaseTextContrast(0.75)).toBeGreaterThanOrEqual(4.5);
    expect(windowOpacityReadability(0.75)).toBe('ok');
  });

  it('reports reduced once body text drops under 4.5:1', () => {
    expect(windowOpacityReadability(0.7)).toBe('reduced');
  });

  // The floor's justification, pinned. MIN is the lowest step that still clears
  // 3:1 — WCAG AA for large text — against the worst desktop; one step lower
  // does not. Move MIN and this test says so.
  it('keeps the floor above the 3:1 legibility threshold', () => {
    expect(windowOpacityReadability(MIN_WINDOW_OPACITY)).toBe('reduced');
    expect(worstCaseTextContrast(MIN_WINDOW_OPACITY)).toBeGreaterThanOrEqual(3);
  });

  it('would call one step below the floor poor, which is why the floor is there', () => {
    expect(windowOpacityReadability(MIN_WINDOW_OPACITY - WINDOW_OPACITY_STEP)).toBe('poor');
  });

  it('never returns poor for any value the slider can produce', () => {
    for (let v = MIN_WINDOW_OPACITY; v <= 1.0001; v += WINDOW_OPACITY_STEP) {
      expect(windowOpacityReadability(normalizeWindowOpacity(v))).not.toBe('poor');
    }
  });
});
