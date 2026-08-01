import { colord } from 'colord';
import type { LookPreset } from './look';
import { CSS_VARS } from './custom-theme';
import type { CssVar } from './custom-theme';

/** Theme tokens referencing CSS variables defined in styles.css */
export const theme = {
  // Backgrounds (3-tier: black → task columns → panels inside)
  bg: 'var(--bg)',
  bgElevated: 'var(--bg-elevated)',
  bgInput: 'var(--bg-input)',
  bgHover: 'var(--bg-hover)',
  bgSelected: 'var(--bg-selected)',
  bgSelectedSubtle: 'var(--bg-selected-subtle)',

  // Borders
  border: 'var(--border)',
  borderSubtle: 'var(--border-subtle)',
  borderFocus: 'var(--border-focus)',

  // Text
  fg: 'var(--fg)',
  fgMuted: 'var(--fg-muted)',
  fgSubtle: 'var(--fg-subtle)',

  // Accent
  accent: 'var(--accent)',
  accentHover: 'var(--accent-hover)',
  accentText: 'var(--accent-text)',
  link: 'var(--link)',

  // Semantic
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',

  // Island containers (task columns, sidebar)
  islandBg: 'var(--island-bg)',
  islandBorder: 'var(--island-border)',
  islandRadius: 'var(--island-radius)',
  taskContainerBg: 'var(--task-container-bg)',
  taskPanelBg: 'var(--task-panel-bg)',

  diffAddBg: 'var(--diff-add-bg)',
  diffRemoveBg: 'var(--diff-remove-bg)',
  searchMatch: 'var(--search-match)',
  searchMatchActive: 'var(--search-match-active)',
} as const;

// GitHub-light-ish xterm palette (text, cursor, selection + 16 ANSI colors)
// for light terminal backgrounds, so colored output (claude prompts,
// ls --color, git status) stays legible on white. Shared by the built-in
// islands-light preset and any custom theme with a light background.
export const LIGHT_TERMINAL_THEME = {
  foreground: '#1f2329',
  cursor: '#1f2329',
  cursorAccent: '#ffffff',
  selectionBackground: '#cfe1ff',
  black: '#24292e',
  red: '#cf222e',
  green: '#116329',
  yellow: '#8a6d00',
  blue: '#0550ae',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#0969da',
  brightMagenta: '#6639ba',
  brightCyan: '#3192aa',
  brightWhite: '#1f2329',
} as const;

/**
 * Whether the terminal's own background has to stop being opaque.
 *
 * Hyper's exact condition, for its exact reason: `allowTransparency` costs
 * something, so it is switched on only when the background actually needs it.
 * The cost is not theoretical here. With `allowTransparency: true` the WebGL
 * addon rasterises its glyph atlas onto a canvas created with `{alpha: true}`,
 * which drops Chromium from subpixel to greyscale antialiasing — the mechanism
 * behind xtermjs#4212 ("text is abnormally thin ... even when color is opaque"),
 * open and unfixed. It applies to every cell, not only translucent ones.
 *
 * Gating it on the setting means the default install never pays it: at
 * `--surface-alpha: 1`, or with blur off, this is false and the terminal renders
 * exactly as it does today, subpixel AA included. Only a user who has both
 * turned blur on and moved the slider off 1.00 opts into the trade.
 */
export function terminalNeedsTransparency(blurOn: boolean, surfaceAlpha: number): boolean {
  return blurOn && surfaceAlpha < 1;
}

/**
 * The background xterm should paint, given whether transparency is needed.
 *
 * When it is not, this is the theme's own opaque colour, exactly as before. When
 * it is, the canvas goes fully transparent and the colour comes from
 * `.shell-terminal-container` behind it — Hyper's
 * `needTransparency ? 'rgba(0,0,0,0)' : props.backgroundColor` move.
 *
 * Handing the colour to the DOM rather than to xterm is what keeps the layer
 * count honest. `styles.css` already paints that element at `--surface-alpha`;
 * if the canvas also painted the same colour at the same alpha, the terminal
 * region would sit one multiplication deeper than the model in
 * `window-opacity.ts` describes, and the slider would mean something different
 * under the text than everywhere else.
 */
export function terminalBackground(themeBackground: string, needsTransparency: boolean): string {
  return needsTransparency ? 'rgba(0,0,0,0)' : themeBackground;
}

/**
 * Returns an xterm-compatible theme object for the given preset.
 * For light-background presets we override xterm's defaults (white text,
 * white-ish bright ANSI palette) so plain output stays readable.
 *
 * `needsTransparency` only ever changes `background`. The foreground and the
 * sixteen ANSI colours are untouched at every alpha — the difference between
 * this and `setOpacity`, stated as a function signature.
 */
export function getTerminalTheme(preset: LookPreset, needsTransparency = false) {
  const background = terminalBackground(
    readCssVarsForPreset(preset)['--task-panel-bg'] ?? '#000000',
    needsTransparency,
  );
  if (preset === 'islands-light') {
    return { background, ...LIGHT_TERMINAL_THEME };
  }
  return { background };
}

/**
 * Reads all CSS custom property values for a built-in preset by temporarily
 * switching data-look on the root element. No repaint occurs between the switch
 * and restore since getComputedStyle is synchronous within a single JS task.
 */
export function readCssVarsForPreset(presetId: string): Partial<Record<CssVar, string>> {
  const el = document.documentElement;
  const savedLook = el.dataset.look;
  const savedCustomTheme = el.dataset.customTheme;
  // Suppress the active custom-theme overlay so computed vars come from the
  // built-in preset alone, not from any custom stylesheet on top of it.
  const styleEl = document.getElementById('custom-theme-style') as HTMLStyleElement | null;
  const savedStyleContent = styleEl?.textContent ?? null;

  el.dataset.look = presetId;
  delete el.dataset.customTheme;
  if (styleEl) styleEl.textContent = '';

  const style = getComputedStyle(el);
  const result: Partial<Record<CssVar, string>> = {};
  for (const v of CSS_VARS) {
    const val = style.getPropertyValue(v).trim();
    if (val) result[v as CssVar] = val;
  }

  if (savedLook !== undefined) {
    el.dataset.look = savedLook;
  } else {
    delete el.dataset.look;
  }
  if (savedCustomTheme !== undefined) {
    el.dataset.customTheme = savedCustomTheme;
  }
  if (styleEl && savedStyleContent !== null) styleEl.textContent = savedStyleContent;

  return result;
}

/** Returns an xterm-compatible theme object for a custom theme.
 *
 * Lightness is read from the theme's own colour, never from the value handed to
 * xterm: `rgba(0,0,0,0)` has a luminance of 0 and would flip every light custom
 * theme to the dark ANSI palette the moment the user moved the slider. */
export function getTerminalThemeForCustom(bg: string, needsTransparency = false) {
  const isLight = (() => {
    try {
      return colord(bg).luminance() > 0.5;
    } catch {
      return false;
    }
  })();
  const background = terminalBackground(bg, needsTransparency);

  if (isLight) {
    return { background, ...LIGHT_TERMINAL_THEME };
  }
  return { background };
}

export function getTerminalSearchDecorations() {
  const style = getComputedStyle(document.documentElement);
  const rawMatch = style.getPropertyValue('--search-match').trim();
  const rawActive = style.getPropertyValue('--search-match-active').trim();
  const match = colord(rawMatch).isValid() ? rawMatch : '#ffd54f';
  const active = colord(rawActive).isValid() ? rawActive : '#ff8a00';

  return {
    matchBackground: colord(match).alpha(0.4).toRgbString(),
    matchOverviewRuler: match,
    activeMatchBackground: colord(active).alpha(0.85).toRgbString(),
    activeMatchColorOverviewRuler: active,
  } as const;
}

/** Generates a styled banner (warning/error/info) using color-mix for background+border. */
export function bannerStyle(color: string): Record<string, string> {
  return {
    color,
    background: `color-mix(in srgb, ${color} 8%, transparent)`,
    padding: '8px 12px',
    'border-radius': '8px',
    border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
  };
}

/** Shared style for uppercase section label headings in dialogs. */
export const sectionLabelStyle: Record<string, string> = {
  'font-size': '12px',
  color: 'var(--fg-muted)',
  'text-transform': 'uppercase',
  'letter-spacing': '0.05em',
};
