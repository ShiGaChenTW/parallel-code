import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Brand-asset consistency guards.
//
// `57c98e3` replaced the app icon (two bars + brackets in cyan) with a
// three-bar "progress" mark in six colourways, `terminal-green` being the
// default baked into icon.icns / icon.png. These tests pin down which surfaces
// follow the icon and — just as importantly — which deliberately do not.
//
// The load-bearing distinction:
//   * BRAND surfaces (icons, favicons, wordmarks) must carry the new mark.
//   * The desktop UI ACCENT is still #2ec8ff (`--accent` in styles.css). The
//     icon redesign did not restyle the app, so every #2ec8ff in src/remote/**
//     is the mobile SPA mirroring the desktop accent, not a stale brand mark.
//     Recolouring those would desync mobile from desktop, not fix anything.

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const read = (relPath: string): string => readFileSync(repoRoot + relPath, 'utf8');
const exists = (relPath: string): boolean => existsSync(repoRoot + relPath);

/** terminal-green colourway — the default variant baked into icon.icns/icon.png. */
const BRAND_BG = '#0E1F17';
const BRAND_TRACK = '#1E3A2C';
const BRAND_LIVE = '#7DFF9B';

/** The pre-`57c98e3` accent, still the desktop UI accent and the `classic` icon colour. */
const LEGACY_CYAN = '#2ec8ff';

/** Full-height rails of the three-bar mark, in the 512-unit icon space. */
const TRACK_BARS = ['M152 120 V 392', 'M256 120 V 392', 'M360 120 V 392'];
/** Filled portions — top-aligned, increasing length. */
const LIVE_BARS = ['M152 120 V 214', 'M256 120 V 296', 'M360 120 V 392'];

/** Signature fragments of the retired two-bar + brackets mark. */
const RETIRED_MARK_FRAGMENTS = ['M30 8 H47 V24 H30', 'M49 32 H32 V48 H49'];

/**
 * Brand surfaces that must render the new mark. `build/icon.svg` is the
 * reference the others are cut from; it ships via electron-builder's
 * `extraResources` and is asserted here so drift in it is caught too.
 */
const BRAND_ICON_ASSETS = [
  'build/icon.svg',
  'src/assets/logo.svg',
  'src/remote/public/icons/icon.svg',
];

const BRAND_WORDMARKS = ['build/logo-text.svg', 'build/logo-text-squared.svg'];

describe('brand icon assets carry the new three-bar mark', () => {
  it.each(BRAND_ICON_ASSETS)('%s draws all three tracks and all three live bars', (asset) => {
    const svg = read(asset);
    for (const bar of TRACK_BARS) expect(svg).toContain(bar);
    for (const bar of LIVE_BARS) expect(svg).toContain(bar);
  });

  it.each(BRAND_ICON_ASSETS)('%s uses the terminal-green colourway', (asset) => {
    const svg = read(asset);
    expect(svg).toContain(BRAND_BG);
    expect(svg).toContain(BRAND_TRACK);
    expect(svg).toContain(BRAND_LIVE);
  });

  it.each([...BRAND_ICON_ASSETS, ...BRAND_WORDMARKS])(
    '%s no longer carries the retired mark or the legacy cyan',
    (asset) => {
      const svg = read(asset);
      for (const fragment of RETIRED_MARK_FRAGMENTS) expect(svg).not.toContain(fragment);
      expect(svg.toLowerCase()).not.toContain(LEGACY_CYAN);
    },
  );
});

describe('wordmarks match the icon and stay legible on any page background', () => {
  it.each(BRAND_WORDMARKS)('%s draws the three-bar mark', (asset) => {
    const svg = read(asset);
    for (const bar of LIVE_BARS) expect(svg).toContain(bar);
  });

  // #7DFF9B on white is ~1.3:1 — unreadable. The README header renders on
  // GitHub's light *and* dark theme, so the wordmarks carry their own brand
  // plate rather than relying on the host page being dark.
  it.each(BRAND_WORDMARKS)('%s paints its own brand-background plate', (asset) => {
    const svg = read(asset);
    expect(svg).toMatch(new RegExp(`<rect[^>]*fill="${BRAND_BG}"`, 'i'));
  });
});

describe('superseded brand files are gone', () => {
  // Neither matched an electron-builder buildResources convention
  // (icon.icns / icon.ico / icon.png / background.png), neither appeared in
  // `extraResources`, and a repo-wide search found no referrer. They were
  // stale copies of the retired mark; build/icons/*.svg replaces them.
  it.each(['build/icon-rounded.svg', 'build/icon-squared.svg'])('%s is deleted', (asset) => {
    expect(exists(asset)).toBe(false);
  });
});

describe('the classic colourway keeps its legacy cyan', () => {
  // `classic` intentionally preserves the pre-redesign look as a selectable
  // variant. It is the one place the old mark and old colour still belong.
  it('build/icons/classic.svg still uses the legacy cyan', () => {
    expect(read('build/icons/classic.svg').toLowerCase()).toContain(LEGACY_CYAN);
  });

  it('the classic variant is registered as legacy with the cyan live colour', () => {
    const source = read('src/lib/app-icon.ts');
    expect(source).toMatch(/id:\s*'classic'/);
    expect(source.toLowerCase()).toContain(LEGACY_CYAN);
    expect(source).toMatch(/legacy:\s*true/);
  });
});

describe('the desktop wordmark stays theme-driven', () => {
  const sidebar = () => read('src/components/Sidebar.tsx');

  it('renders the three-bar mark', () => {
    const source = sidebar();
    for (const bar of LIVE_BARS) expect(source).toContain(bar);
  });

  it('no longer renders the retired mark', () => {
    const source = sidebar();
    for (const fragment of RETIRED_MARK_FRAGMENTS) expect(source).not.toContain(fragment);
  });

  // The sidebar mark sits inside 11 look presets plus custom themes, so it is
  // stroked with the active foreground rather than a fixed brand colour.
  // Hard-coding the brand green here would break every non-dark preset.
  it('strokes with the theme foreground, not a hard-coded brand colour', () => {
    const source = sidebar();
    expect(source).toMatch(/stroke=\{theme\.fg\}/);
    expect(source).not.toContain(BRAND_LIVE);
  });
});

describe('the mobile SPA keeps mirroring the desktop accent', () => {
  const rootBlock = (): string => {
    const css = read('src/styles.css');
    const match = /:root\s*\{([\s\S]*?)\}/.exec(css);
    if (!match) throw new Error('could not locate the :root block in src/styles.css');
    return match[1];
  };

  const tokenValue = (token: string): string => {
    const match = new RegExp(`--${token}:\\s*([^;]+);`).exec(rootBlock());
    if (!match) throw new Error(`--${token} is not defined in :root`);
    return match[1].trim();
  };

  // If the desktop ever moves off cyan, the mobile screens have to move with
  // it. Pinning them to the token rather than to a literal is what makes this
  // a consistency test instead of a colour freeze.
  it('the desktop accent is the colour the mobile screens hard-code', () => {
    expect(tokenValue('accent').toLowerCase()).toBe(LEGACY_CYAN);
  });

  it.each([
    'src/remote/AgentDetail.tsx',
    'src/remote/AgentList.tsx',
    'src/remote/ConnectScreen.tsx',
    'src/remote/NewTaskScreen.tsx',
    'src/remote/PairScreen.tsx',
  ])('%s still uses the desktop accent for its interactive chrome', (screen) => {
    expect(read(screen).toLowerCase()).toContain(tokenValue('accent').toLowerCase());
  });

  it('primary buttons pair the accent with the desktop accent-text colour', () => {
    const accentText = tokenValue('accent-text').toLowerCase();
    for (const screen of ['src/remote/ConnectScreen.tsx', 'src/remote/PairScreen.tsx']) {
      expect(read(screen).toLowerCase()).toContain(accentText);
    }
  });
});

describe('the mobile status palette stays semantically distinct', () => {
  const attention = () => read('src/remote/attention.ts');

  // BLUE means "working" and GREEN means "ready". Repainting BLUE with the
  // brand green would render two different states in one colour.
  it('the working colour is the accent, not the brand green', () => {
    const source = attention();
    expect(source).toMatch(new RegExp(`const BLUE = '${LEGACY_CYAN}';`, 'i'));
    expect(source).not.toContain(BRAND_LIVE);
  });

  it('every status colour is unique', () => {
    const colours = [...attention().matchAll(/^const [A-Z]+ = '(#[0-9a-fA-F]{6})';$/gm)].map(
      (match) => match[1].toLowerCase(),
    );
    expect(colours.length).toBeGreaterThanOrEqual(6);
    expect(new Set(colours).size).toBe(colours.length);
  });
});
