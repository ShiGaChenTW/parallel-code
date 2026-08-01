/**
 * Contrast audit for every built-in theme *after* the surface alpha has been
 * applied — the gate that covers what `custom-theme-contrast.test.ts` cannot.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CHANGE TO THAT ONE
 *
 * `custom-theme-contrast.test.ts` parses the CSS variables out of `styles.css`
 * and checks them against each other. That is an audit of the palette a theme
 * author wrote, and it is still exactly right: this change edits no theme
 * variable, so every ratio it measures is unchanged and it was left untouched —
 * not relaxed, not deleted, not given an exception for translucency.
 *
 * What it never covered is the composite. It compares `--fg` to
 * `--task-panel-bg` as if that surface were opaque, and once `--surface-alpha`
 * is below 1 it is not: the surface is painted over the window backdrop, which
 * is painted over the user's desktop. Text that clears 4.5:1 against the theme's
 * own colour can still fail against what the eye actually sees. Neither file can
 * do both jobs — one holds the desktop out of the model deliberately, the other
 * exists to put it in — so this is a second gate rather than a rewrite.
 *
 * WHAT IT MODELS
 *
 * Per theme, per offered alpha step, for the two text tokens that carry real
 * content:
 *
 *   surface  = --task-panel-bg  over ( --bg-elevated over desktop ) at alpha
 *   text     = --fg / --fg-muted, never composited
 *
 * `--bg-elevated` stands in for the window backdrop because `--bg` is a
 * gradient in nine of the eleven presets and has no single colour; it is the
 * nearest flat token a theme declares and sits in the same range as the colour
 * those gradients settle to. Two composites, matching the layer stack in
 * `styles.css`: the veil, then the surface on top of it.
 *
 * The desktop extremes are white and black. Blur does not soften them — it
 * removes spatial detail, not mean luminance, and a white wallpaper blurs to
 * white.
 *
 * THE THRESHOLD
 *
 * 4.5:1 for `--fg` — WCAG AA for body text, which is what terminal scrollback
 * is. `--fg-muted` is held to 3:1: it is used for timestamps, labels and
 * secondary chrome, which is the "large text and graphical objects" case, and
 * holding it to the body-text line would fail themes whose muted tone is
 * deliberately quiet at full opacity too.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { MIN_WINDOW_OPACITY, WINDOW_OPACITY_STEP, normalizeWindowOpacity } from './window-opacity';
import { CSS_VARS } from './custom-theme';
import type { CssVar } from './custom-theme';

const CSS_VAR_SET = new Set<string>(CSS_VARS);
const VAR_RE = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*;?\s*$/;

function parseVars(body: string): Partial<Record<CssVar, string>> {
  const vars: Partial<Record<CssVar, string>> = {};
  for (const line of body.split('\n')) {
    const match = VAR_RE.exec(line);
    if (match && CSS_VAR_SET.has(match[1])) vars[match[1] as CssVar] = match[2].trim();
  }
  return vars;
}

function parseThemesFromCss(css: string): Record<string, Partial<Record<CssVar, string>>> {
  const themes: Record<string, Partial<Record<CssVar, string>>> = {};
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(css);
  const rootVars = rootMatch ? parseVars(rootMatch[1]) : {};

  const blockRe = /(html\[data-look='[^']+'\](?:\s*,\s*html\[data-look='[^']+'\])*)\s*\{([^}]*)\}/g;
  const nameRe = /data-look='([^']+)'/g;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(css)) !== null) {
    const names: string[] = [];
    nameRe.lastIndex = 0;
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = nameRe.exec(blockMatch[1])) !== null) names.push(nameMatch[1]);
    const vars = parseVars(blockMatch[2]);
    for (const name of names) themes[name] = { ...rootVars, ...(themes[name] ?? {}), ...vars };
  }
  return themes;
}

type Rgb = readonly [number, number, number];

/** Accepts the `#rgb` and `#rrggbb` forms the presets actually use. */
function toRgb(hex: string): Rgb | null {
  const value = hex.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  const full =
    value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value;
  return [
    parseInt(full.slice(1, 3), 16),
    parseInt(full.slice(3, 5), 16),
    parseInt(full.slice(5, 7), 16),
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

function composite(color: Rgb, backdrop: Rgb, alpha: number): Rgb {
  return [
    color[0] * alpha + backdrop[0] * (1 - alpha),
    color[1] * alpha + backdrop[1] * (1 - alpha),
    color[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

const EXTREME_DESKTOPS: Rgb[] = [
  [255, 255, 255],
  [0, 0, 0],
];

/** Every alpha the slider can produce, worst first. */
const OFFERED_ALPHAS = (() => {
  const steps: number[] = [];
  for (let v = MIN_WINDOW_OPACITY; v <= 1.0001; v += WINDOW_OPACITY_STEP) {
    steps.push(normalizeWindowOpacity(v));
  }
  return steps;
})();

const themes = parseThemesFromCss(readFileSync(resolve(__dirname, '../styles.css'), 'utf8'));

/** Worst ratio of `text` on the composited terminal surface, over either desktop. */
function worstComposited(text: Rgb, surface: Rgb, backdrop: Rgb, alpha: number): number {
  return Math.min(
    ...EXTREME_DESKTOPS.map((desktop) =>
      contrastRatio(text, composite(surface, composite(backdrop, desktop, alpha), alpha)),
    ),
  );
}

describe('built-in theme contrast under the surface alpha', () => {
  it('found the themes to audit', () => {
    expect(Object.keys(themes).length).toBeGreaterThanOrEqual(10);
  });

  it('audits every alpha the slider can reach, floor included', () => {
    expect(OFFERED_ALPHAS[0]).toBe(MIN_WINDOW_OPACITY);
    expect(OFFERED_ALPHAS[OFFERED_ALPHAS.length - 1]).toBe(1);
  });

  for (const [name, vars] of Object.entries(themes)) {
    it(`${name} — text stays legible at every offered alpha`, () => {
      const surface = toRgb(vars['--task-panel-bg'] ?? '');
      const backdrop = toRgb(vars['--bg-elevated'] ?? '');
      const fg = toRgb(vars['--fg'] ?? '');
      const fgMuted = toRgb(vars['--fg-muted'] ?? '');

      // Every built-in declares these as plain hex. A theme that stopped doing
      // so would silently drop out of the audit, so say so instead.
      expect(surface, `${name} --task-panel-bg is not a plain hex colour`).not.toBeNull();
      expect(backdrop, `${name} --bg-elevated is not a plain hex colour`).not.toBeNull();
      expect(fg, `${name} --fg is not a plain hex colour`).not.toBeNull();
      expect(fgMuted, `${name} --fg-muted is not a plain hex colour`).not.toBeNull();
      if (!surface || !backdrop || !fg || !fgMuted) return;

      for (const alpha of OFFERED_ALPHAS) {
        const body = worstComposited(fg, surface, backdrop, alpha);
        expect(
          body,
          `${name}: --fg on --task-panel-bg at alpha ${alpha} is ${body.toFixed(2)}:1, below WCAG AA 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);

        const muted = worstComposited(fgMuted, surface, backdrop, alpha);
        expect(
          muted,
          `${name}: --fg-muted on --task-panel-bg at alpha ${alpha} is ${muted.toFixed(2)}:1, below 3:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  /**
   * The property that makes the floor meaningful: contrast has to fall as more
   * desktop shows through, or the floor is guarding nothing. A theme whose
   * ratios moved non-monotonically would mean the model is wrong, not that the
   * theme is safe.
   */
  it('degrades monotonically in every theme, so the floor is the worst case', () => {
    for (const [name, vars] of Object.entries(themes)) {
      const surface = toRgb(vars['--task-panel-bg'] ?? '');
      const backdrop = toRgb(vars['--bg-elevated'] ?? '');
      const fg = toRgb(vars['--fg'] ?? '');
      if (!surface || !backdrop || !fg) continue;

      const descending = [...OFFERED_ALPHAS].sort((a, b) => b - a);
      let previous = Infinity;
      for (const alpha of descending) {
        const ratio = worstComposited(fg, surface, backdrop, alpha);
        expect(ratio, `${name} is not monotonic at alpha ${alpha}`).toBeLessThan(previous);
        previous = ratio;
      }
    }
  });

  /**
   * The audit this file supplements must still be there, and must still be
   * auditing the palette rather than the composite. If someone ever "fixes" a
   * failure here by loosening that file, this says so.
   */
  it('leaves the palette audit in place and unrelaxed', () => {
    const palette = readFileSync(resolve(__dirname, 'custom-theme-contrast.test.ts'), 'utf8');
    expect(palette).toContain('checkThemeContrast(vars)');
    expect(palette).toContain('expect(warnings).toEqual([])');
    // No allowance list, no skipped theme, no threshold override.
    expect(palette).not.toMatch(/it\.skip|describe\.skip|toBeLessThanOrEqual\(\s*\d/);
  });
});
