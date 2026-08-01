import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIGHT_TERMINAL_THEME,
  getTerminalSearchDecorations,
  getTerminalTheme,
  getTerminalThemeForCustom,
  terminalBackground,
  terminalNeedsTransparency,
  theme,
} from './theme';
import { DEFAULT_WINDOW_OPACITY, MIN_WINDOW_OPACITY } from './window-opacity';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The xterm half of the mechanism, and the one place a real cost is paid.
 *
 * `allowTransparency: true` makes the WebGL addon rasterise its glyph atlas onto
 * a canvas created with `{alpha: true}`, which drops Chromium from subpixel to
 * greyscale antialiasing — the mechanism behind xtermjs#4212, open and unfixed,
 * where text looks thinner "even when color is opaque". It is not per-cell: the
 * whole atlas is affected.
 *
 * So it is gated, exactly as Hyper gates it, on the background actually needing
 * to be non-opaque. That makes the cost opt-in rather than shipped.
 */
describe('terminalNeedsTransparency', () => {
  it('is false at the default, so an untouched install pays nothing', () => {
    expect(terminalNeedsTransparency(true, DEFAULT_WINDOW_OPACITY)).toBe(false);
    expect(terminalNeedsTransparency(false, DEFAULT_WINDOW_OPACITY)).toBe(false);
  });

  it('is false with blur off however low the alpha goes', () => {
    // Without a vibrancy material the window is opaque, so a transparent canvas
    // would reveal the window backdrop and nothing else — all of the cost, none
    // of the effect.
    for (const alpha of [MIN_WINDOW_OPACITY, 0.75, 0.95]) {
      expect(terminalNeedsTransparency(false, alpha)).toBe(false);
    }
  });

  it('is true only when both halves are asked for', () => {
    for (const alpha of [MIN_WINDOW_OPACITY, 0.75, 0.95]) {
      expect(terminalNeedsTransparency(true, alpha)).toBe(true);
    }
  });
});

describe('terminalBackground', () => {
  it('hands xterm the theme colour untouched when transparency is not needed', () => {
    expect(terminalBackground('#1c2630', false)).toBe('#1c2630');
  });

  it('hands the colour to the DOM instead when it is', () => {
    // Hyper's move. `.shell-terminal-container` already paints --task-panel-bg at
    // --surface-alpha; if the canvas painted it again the terminal would sit one
    // multiplication deeper than every other surface and the slider would mean
    // something different under the text.
    expect(terminalBackground('#1c2630', true)).toBe('rgba(0,0,0,0)');
  });
});

describe('theme tokens', () => {
  it('exposes semantic diff and search colors', () => {
    expect(theme).toMatchObject({
      diffAddBg: 'var(--diff-add-bg)',
      diffRemoveBg: 'var(--diff-remove-bg)',
      searchMatch: 'var(--search-match)',
      searchMatchActive: 'var(--search-match-active)',
    });
  });
});

describe('getTerminalTheme', () => {
  it('derives a built-in terminal background from the preset task panel token', () => {
    const root = { dataset: { look: 'classic', customTheme: 'custom-id' } };
    vi.stubGlobal('document', {
      documentElement: root,
      getElementById: () => null,
    });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) =>
        name === '--task-panel-bg' && root.dataset.look === 'islands-light' ? '#fefefe' : '',
    }));

    expect(getTerminalTheme('islands-light').background).toBe('#fefefe');
    expect(root.dataset).toEqual({ look: 'classic', customTheme: 'custom-id' });
  });

  it('swaps only the background when transparency is needed', () => {
    const root = { dataset: { look: 'classic' } };
    vi.stubGlobal('document', { documentElement: root, getElementById: () => null });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => (name === '--task-panel-bg' ? '#fefefe' : ''),
    }));

    const opaque = getTerminalTheme('islands-light', false);
    const clear = getTerminalTheme('islands-light', true);

    // The foreground and all sixteen ANSI colours are identical. This is the
    // whole difference from `setOpacity`, which had no way to leave them alone.
    expect(clear).toEqual({ ...opaque, background: 'rgba(0,0,0,0)' });
    expect(clear).toMatchObject({ foreground: LIGHT_TERMINAL_THEME.foreground });
  });
});

describe('getTerminalThemeForCustom', () => {
  it('reads lightness from the theme colour, not from what xterm is handed', () => {
    // `rgba(0,0,0,0)` has a luminance of 0. Deriving the palette from it would
    // flip every light custom theme to the dark ANSI set the moment the user
    // moved the slider off 100%.
    const light = getTerminalThemeForCustom('#fefefe', true);
    expect(light.background).toBe('rgba(0,0,0,0)');
    expect(light).toMatchObject({ foreground: LIGHT_TERMINAL_THEME.foreground });
  });

  it('leaves a dark custom theme on the default palette', () => {
    const dark = getTerminalThemeForCustom('#1c2630', true);
    expect(dark.background).toBe('rgba(0,0,0,0)');
    expect(dark).not.toHaveProperty('foreground');
  });
});

describe('getTerminalSearchDecorations', () => {
  it('resolves the active preset search tokens for xterm', () => {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) =>
        name === '--search-match' ? '#112233' : name === '--search-match-active' ? '#445566' : '',
    }));

    expect(getTerminalSearchDecorations()).toEqual({
      matchBackground: 'rgba(17, 34, 51, 0.4)',
      matchOverviewRuler: '#112233',
      activeMatchBackground: 'rgba(68, 85, 102, 0.85)',
      activeMatchColorOverviewRuler: '#445566',
    });
  });

  it('falls back to readable search colors when custom token values are invalid', () => {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: () => 'not-a-color',
    }));

    expect(getTerminalSearchDecorations()).toEqual({
      matchBackground: 'rgba(255, 213, 79, 0.4)',
      matchOverviewRuler: '#ffd54f',
      activeMatchBackground: 'rgba(255, 138, 0, 0.85)',
      activeMatchColorOverviewRuler: '#ff8a00',
    });
  });
});
