import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_BLUR,
  WINDOW_BLUR_MATERIALS,
  WINDOW_BLUR_VEIL_ALPHA,
  isWindowBlurSupported,
  normalizeWindowBlur,
  worstCaseChromeContrast,
} from './window-blur';

describe('isWindowBlurSupported', () => {
  it('is macOS only — narrower than the opacity rule', () => {
    expect(isWindowBlurSupported('darwin')).toBe(true);
    expect(isWindowBlurSupported('win32')).toBe(false);
    expect(isWindowBlurSupported('linux')).toBe(false);
  });
});

describe('normalizeWindowBlur', () => {
  it('passes the offered materials and off through', () => {
    for (const material of WINDOW_BLUR_MATERIALS) {
      expect(normalizeWindowBlur(material)).toBe(material);
    }
    expect(normalizeWindowBlur('off')).toBe('off');
  });

  it('falls back to off, never to a material', () => {
    // The safe direction: nobody gets a translucent window they did not ask for.
    for (const bad of [undefined, null, 42, {}, 'menu', 'appearance-based', '']) {
      expect(normalizeWindowBlur(bad)).toBe(DEFAULT_WINDOW_BLUR);
    }
  });
});

describe('the offered material set', () => {
  it('leads with the material macOS specifies for window backgrounds', () => {
    expect(WINDOW_BLUR_MATERIALS[0]).toBe('under-window');
  });

  it('stays a shortlist of surface-scale materials', () => {
    expect([...WINDOW_BLUR_MATERIALS]).toEqual(['under-window', 'sidebar', 'hud', 'fullscreen-ui']);
  });

  it('excludes appearance-based, which setVibrancy does not accept', () => {
    // It is in the constructor's union but not `setVibrancy`'s, so offering it
    // would give a value that works at launch and throws when toggled.
    expect([...WINDOW_BLUR_MATERIALS]).not.toContain('appearance-based');
  });
});

/**
 * The veil floor, derived rather than chosen. See the file header of
 * `window-blur.ts`: body text is *not* faded by the veil (unlike `setOpacity`,
 * which fades glyphs and surface together), so the only question is how much
 * desktop is allowed to wash out the backdrop behind the chrome that sits
 * directly on it.
 */
describe('worstCaseChromeContrast', () => {
  it('is the opaque theme contrast when nothing shows through', () => {
    expect(worstCaseChromeContrast(1)).toBeCloseTo(7.95, 1);
  });

  it('degrades monotonically as more desktop shows through', () => {
    const samples = [1, 0.9, 0.8, 0.75, 0.7, 0.6].map(worstCaseChromeContrast);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1]);
    }
  });

  it('puts the boundary exactly where the shipped alpha sits', () => {
    // This is the assertion that pins the number to its reason. 3:1 is WCAG AA
    // for large text and graphical objects; 0.75 is the lowest 0.05 step that
    // clears it and 0.70 does not, which is why 0.75 is what ships.
    expect(worstCaseChromeContrast(0.75)).toBeGreaterThanOrEqual(3);
    expect(worstCaseChromeContrast(0.7)).toBeLessThan(3);
    expect(WINDOW_BLUR_VEIL_ALPHA).toBe(0.75);
    expect(worstCaseChromeContrast(WINDOW_BLUR_VEIL_ALPHA)).toBeGreaterThanOrEqual(3);
  });

  it('models a blurred desktop as no gentler than a sharp one', () => {
    // Blur removes spatial detail, not mean luminance: a white wallpaper blurs
    // to white. So the extremes stay #ffffff / #000000 and no relaxation is
    // available on the grounds that the backdrop is blurred now. If someone
    // narrows the modelled extremes, this goes red.
    const source = readFileSync(resolve(__dirname, 'window-blur.ts'), 'utf8');
    expect(source).toContain("EXTREME_BACKDROPS = ['#ffffff', '#000000']");
  });
});

/**
 * The mechanism's central claim, asserted against the stylesheet: the alpha is
 * applied to a *layer*, never to a theme value. This is what makes it work
 * across eleven presets and every user-authored theme without any of them being
 * edited — and what keeps `custom-theme-contrast.test.ts` valid, since the
 * variables it gates are untouched.
 */
describe('the veil never rewrites a theme value', () => {
  const css = readFileSync(resolve(__dirname, '..', 'styles.css'), 'utf8');
  const blurBlock = css.slice(
    css.indexOf('/* --- Window blur (macOS vibrancy)'),
    css.indexOf('\nbody {', css.indexOf('/* --- Window blur (macOS vibrancy)')),
  );

  it('carries the alpha on opacity, not on a colour', () => {
    // `--bg` is a radial-gradient in nine of the eleven presets, so there is no
    // colour function that could do this even in principle.
    expect(blurBlock).toContain(`opacity: ${WINDOW_BLUR_VEIL_ALPHA}`);
  });

  it('consumes var(--bg) rather than naming any colour of its own', () => {
    expect(blurBlock).toContain('background: var(--bg)');
  });

  it('redefines no custom property at all', () => {
    // A `--foo:` declaration inside this block would mean a theme value was
    // being overridden, which is exactly what this design refuses to do.
    expect(blurBlock).not.toMatch(/^\s*--[a-z-]+:/m);
  });

  /**
   * The renderer half of the "Reduce transparency" fix. The main half withholds
   * the vibrancy material; this has to withdraw the CSS that assumed it, or the
   * app paints a see-through page over a window with nothing behind it.
   */
  describe('reduced transparency', () => {
    const reduced = blurBlock.slice(
      blurBlock.indexOf('@media (prefers-reduced-transparency: reduce)'),
    );

    it('is honoured at all', () => {
      expect(blurBlock).toContain('@media (prefers-reduced-transparency: reduce)');
    });

    it('puts the opaque backdrop back on every surface the veil made transparent', () => {
      // Not "no longer transparent" but the exact colour the unblurred app
      // paints — the same value main writes as WINDOW_BACKDROP_OPAQUE.
      expect(reduced).toMatch(
        /html\[data-window-blur\],\s*html\[data-window-blur\] body,\s*html\[data-window-blur\] #root\s*\{\s*background: #0e1215;/,
      );
    });

    it('hands .app-shell its theme background back at equal weight', () => {
      // The rule it is undoing used `!important` to beat App.tsx's inline style,
      // so anything less than `!important` here would lose to it and leave the
      // shell transparent.
      expect(reduced).toMatch(/\.app-shell\s*\{\s*background: var\(--bg\) !important;/);
    });

    it('removes the veil rather than merely opacifying it', () => {
      expect(reduced).toMatch(/#root::before\s*\{\s*display: none;/);
    });
  });

  it('leaves panel, island and terminal surfaces alone', () => {
    // Terminal text sits on --task-panel-bg. If the veil ever touched these,
    // scrollback legibility would become a function of the user's wallpaper.
    for (const surface of [
      '--task-panel-bg',
      '--island-bg',
      '--task-container-bg',
      '--bg-elevated',
    ]) {
      expect(blurBlock, `${surface} must not appear in the blur block`).not.toContain(surface);
    }
  });
});
