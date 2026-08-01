import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_BLUR,
  WINDOW_BLUR_MATERIALS,
  isWindowBlurSupported,
  normalizeWindowBlur,
} from './window-blur';
import { CSS_VARS } from './custom-theme';

describe('isWindowBlurSupported', () => {
  it('is macOS only', () => {
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
 * The fixed veil alpha is gone, and this is the assertion that keeps it gone.
 *
 * It was 0.75, derived as the lowest 0.05 step clearing WCAG 3:1 and fixed on
 * the argument that a slider "can only make things worse". Two things were wrong
 * with that. 3:1 is the AA threshold for large text and graphical objects, and
 * this app is a full-screen terminal at small monospace sizes, where the line is
 * 4.5:1 — so the number was checked against the wrong one. And every terminal
 * emulator surveyed makes this adjustable and defaults it to opaque, where this
 * forced 0.75 on anyone who turned blur on with no way back.
 */
describe('the veil alpha is the user’s, not a constant', () => {
  const source = readFileSync(resolve(__dirname, 'window-blur.ts'), 'utf8');

  it('exports no fixed alpha', () => {
    expect(source).not.toContain('WINDOW_BLUR_VEIL_ALPHA');
  });

  it('keeps no contrast model of its own', () => {
    // There is one model now, in `window-opacity.ts`, and it covers the deeper
    // and therefore harder case: text on a surface that is itself over the
    // composited backdrop. Two models would have drifted.
    expect(source).not.toContain('worstCaseChromeContrast');
    expect(source).not.toContain('EXTREME_BACKDROPS');
  });

  it('models a blurred desktop as no gentler than a sharp one', () => {
    // Blur removes spatial detail, not mean luminance: a white wallpaper blurs
    // to white. So the extremes stay #ffffff / #000000 and no relaxation is
    // available on the grounds that the backdrop is blurred now. The assertion
    // followed the model to the file that now owns it.
    const opacity = readFileSync(resolve(__dirname, 'window-opacity.ts'), 'utf8');
    expect(opacity).toContain("EXTREME_BACKDROPS = ['#ffffff', '#000000']");
  });
});

/**
 * The mechanism's central claim, asserted against the stylesheet: the alpha is
 * applied to a *layer* or to a *use* of a colour, never to the colour itself.
 * That is what makes it work across eleven presets and every user-authored theme
 * without any of them being edited — and what keeps
 * `custom-theme-contrast.test.ts` meaningful, since the variables it gates are
 * untouched.
 */
describe('the blur block never rewrites a theme value', () => {
  const css = readFileSync(resolve(__dirname, '..', 'styles.css'), 'utf8');
  const blurBlock = css.slice(
    css.indexOf('/* --- Window blur (macOS vibrancy)'),
    css.indexOf('\nbody {', css.indexOf('/* --- Window blur (macOS vibrancy)')),
  );

  it('drives the veil from the setting rather than a hard-coded number', () => {
    // `--bg` is a radial-gradient in nine of the eleven presets, so no colour
    // function could carry this alpha even in principle. It has to be `opacity`
    // on a layer — and the number is now the user's, not a constant.
    expect(blurBlock).toContain('opacity: var(--surface-alpha)');
    expect(blurBlock).not.toMatch(/opacity: 0\.\d+/);
  });

  it('consumes var(--bg) rather than naming any colour of its own', () => {
    expect(blurBlock).toContain('background: var(--bg)');
  });

  it('redefines no theme variable', () => {
    // The audited palette — everything `custom-theme-contrast.test.ts` checks —
    // must survive this block untouched. `--surface-alpha` is the one custom
    // property allowed here, and it is an input to the block rather than a
    // colour a theme author wrote.
    const declared = [...blurBlock.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]);
    expect(declared).toEqual(['--surface-alpha']);
    for (const themeVar of CSS_VARS) {
      expect(declared, `${themeVar} must not be redefined here`).not.toContain(themeVar);
    }
  });

  /**
   * The layer stack, which is the whole reason the effect was invisible before.
   *
   * Vibrancy is painted behind the web contents, and `.task-column` and
   * `.shell-terminal-container` are opaque theme colours covering nearly the
   * entire window — so the blur was working underneath a lid. These rules are
   * what lift it.
   */
  describe('the surfaces that used to hide the vibrancy', () => {
    for (const [selector, token] of [
      ['.task-column', '--task-container-bg'],
      ['.shell-terminal-container', '--task-panel-bg'],
    ] as const) {
      it(`paints ${selector} at the surface alpha`, () => {
        // color-mix on the *use*, never on the token: the token stays whatever
        // its theme author wrote, and only this painting of it is thinned.
        const rule = new RegExp(
          `html\\[data-window-blur\\] \\${selector} \\{\\s*background: color-mix\\(\\s*in srgb,\\s*var\\(${token}\\) calc\\(var\\(--surface-alpha\\) \\* 100%\\),\\s*transparent\\s*\\) !important;`,
        );
        expect(blurBlock).toMatch(rule);
      });
    }

    it('drops the row that painted the same colour twice', () => {
      // `.shell-terminals-row` carries --task-container-bg directly on top of
      // .task-column's --task-container-bg. Mixing it would be one more
      // multiplication in the stack for no visible difference at any alpha.
      expect(blurBlock).toMatch(
        /html\[data-window-blur\] \.shell-terminals-row \{\s*background: transparent !important;/,
      );
    });

    it('needs !important on each, to beat the inline style it is overriding', () => {
      // Every one of these backgrounds is written as a component inline style,
      // which no stylesheet rule outranks without it.
      for (const selector of [
        '.task-column',
        '.shell-terminals-row',
        '.shell-terminal-container',
      ]) {
        const rule = blurBlock.slice(blurBlock.indexOf(`${selector} {`));
        expect(rule.slice(0, rule.indexOf('}'))).toContain('!important');
      }
    });
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

    it('forces the surface alpha back to 1, which neutralises every color-mix', () => {
      // One declaration instead of repeating each surface rule with a different
      // value — and `!important` because App.tsx writes `--surface-alpha` as an
      // inline style on the same element, which otherwise wins the cascade.
      expect(reduced).toMatch(/html\[data-window-blur\] \{\s*--surface-alpha: 1 !important;\s*\}/);
    });
  });

  it('leaves the floating surfaces alone', () => {
    // Dialogs, popovers and cards sit on --island-bg and --bg-elevated. They
    // float above the app rather than forming the background stack behind the
    // terminal, so thinning them would cost readability without revealing any
    // vibrancy the surfaces below have not already revealed. No terminal
    // emulator makes its settings window see-through either.
    for (const surface of ['--island-bg', '--bg-elevated']) {
      expect(blurBlock, `${surface} must not appear in the blur block`).not.toContain(surface);
    }
  });
});
