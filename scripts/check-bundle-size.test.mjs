import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUDGETS,
  checkBudgets,
  entryChunkSize,
  formatReport,
  formatStartupBreakdown,
  formatStylesheetBreakdown,
  preloadedChunkPaths,
  startupChunks,
  startupStylesheets,
  stylesheetPaths,
  stylesheetSize,
} from './check-bundle-size.mjs';

/** Temp dirs created by fixtures, removed after each test. */
const created = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a throwaway `dist/` whose files have exact byte sizes.
 *
 * @param {{
 *   assets: Record<string, number | string>,
 *   preload?: string[],
 *   stylesheets?: string[],
 *   html?: string,
 * }} spec
 *   `assets` maps a file name under `assets/` to its byte size, or to literal
 *   contents when a test needs to look inside the file; `preload` lists the file
 *   names index.html should modulepreload and `stylesheets` the ones it should
 *   link as a stylesheet.
 * @returns {string} path to the fixture dist directory
 */
function makeDist({ assets, preload = [], stylesheets = [], html }) {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-gate-'));
  created.push(dist);
  mkdirSync(join(dist, 'assets'));
  for (const [name, spec] of Object.entries(assets)) {
    writeFileSync(join(dist, 'assets', name), typeof spec === 'number' ? 'x'.repeat(spec) : spec);
  }
  const links = [
    ...preload.map((name) => `<link rel="modulepreload" crossorigin href="./assets/${name}">`),
    ...stylesheets.map((name) => `<link rel="stylesheet" crossorigin href="./assets/${name}">`),
  ].join('\n    ');
  writeFileSync(
    join(dist, 'index.html'),
    html ?? `<!doctype html><html><head>\n    ${links}\n  </head><body></body></html>`,
  );
  return dist;
}

describe('check-bundle-size', () => {
  it('passes when every measurement is within budget', () => {
    const result = checkBudgets({ a: 100, b: 200 }, { a: 100, b: 500 });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.ok)).toEqual([true, true]);
  });

  it('treats a measurement exactly at budget as passing', () => {
    expect(checkBudgets({ a: 500 }, { a: 500 }).ok).toBe(true);
  });

  it('fails when a measurement exceeds its budget by a single byte', () => {
    const result = checkBudgets({ a: 501 }, { a: 500 });
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: 'a', actual: 501, budget: 500, ok: false });
  });

  it('fails when a budgeted measurement is missing rather than silently passing', () => {
    const result = checkBudgets({}, { a: 500 });
    expect(result.ok).toBe(false);
    expect(result.checks[0].reason).toBe('not measured');
  });

  it('reports measurements that have no budget without failing', () => {
    const result = checkBudgets({ a: 1, extra: 2 }, { a: 500 });
    expect(result.ok).toBe(true);
    expect(result.unbudgeted).toEqual(['extra']);
  });

  it('names the overage in the report so CI output is actionable', () => {
    const report = formatReport(checkBudgets({ a: 1_200 }, { a: 1_000 }));
    expect(report).toContain('FAIL');
    expect(report).toContain('over by 200 B');
    expect(report).toContain('scripts/check-bundle-size.mjs');
  });

  it('keeps budgets above the sizes measured when the gate was introduced', () => {
    // Guards against someone "fixing" a failure by lowering a budget below the
    // known-good baseline, which would make the gate unfailable-but-meaningless.
    expect(BUDGETS['renderer entry chunk']).toBeGreaterThanOrEqual(1_266_514);
    expect(BUDGETS['dist total']).toBeGreaterThanOrEqual(15_262_119);
  });

  it('keeps the entry budget tight enough to catch a monaco-scale regression', () => {
    // Measured, not guessed: re-adding the monaco import produced a 5,004,337 B
    // entry chunk. A budget that would still pass at that size is not a gate.
    expect(BUDGETS['renderer entry chunk']).toBeLessThan(5_004_337);
  });

  it('budgets CSS separately from JS rather than folding them into one number', () => {
    // At 6% of the JS figure, render-blocking CSS could triple and move a
    // combined number by ~3.5% — inside the noise of ordinary JS growth. The
    // two only stay meaningful as two.
    expect(BUDGETS['renderer startup CSS']).toBeDefined();
    expect(BUDGETS['renderer startup CSS']).not.toBe(BUDGETS['renderer entry chunk']);
  });

  it('keeps the CSS budget above the size measured when the CSS gate was introduced', () => {
    expect(BUDGETS['renderer startup CSS']).toBeGreaterThanOrEqual(78_513);
  });

  it('keeps the CSS budget tight enough to catch a dependency-scale stylesheet', () => {
    // Measured, not guessed: pulling katex's and plyr's stylesheets into the
    // eager entry produced 138,969 B of render-blocking CSS and this gate exits
    // 1. A budget that would still pass at that size is not a gate.
    //
    // The same build left `dist total` green at 91.6% — which is why this budget
    // had to exist separately rather than trusting the total to notice.
    expect(BUDGETS['renderer startup CSS']).toBeLessThan(138_969);
  });
});

describe('preloadedChunkPaths', () => {
  it('finds every modulepreload href as a dist-relative path', () => {
    const html = `
      <link rel="modulepreload" crossorigin href="./assets/preload-helper-kNaey6uv.js">
      <link rel="modulepreload" crossorigin href="./assets/platform-B5eFPIUU.js">
    `;
    expect(preloadedChunkPaths(html)).toEqual([
      'assets/preload-helper-kNaey6uv.js',
      'assets/platform-B5eFPIUU.js',
    ]);
  });

  it('ignores links that are not modulepreload', () => {
    const html = `
      <link rel="stylesheet" href="./assets/index-abc.css">
      <link rel="icon" href="./favicon.ico">
      <link rel="preload" as="font" href="./assets/inter.woff2">
      <link rel="modulepreload" href="./assets/platform-abc.js">
    `;
    expect(preloadedChunkPaths(html)).toEqual(['assets/platform-abc.js']);
  });

  it('does not depend on attribute order or quote style', () => {
    const html = `
      <link crossorigin href='./assets/a.js' rel='modulepreload'>
      <link href="./assets/b.js" rel="modulepreload">
    `;
    expect(preloadedChunkPaths(html)).toEqual(['assets/a.js', 'assets/b.js']);
  });

  it('normalises root-relative and bare hrefs', () => {
    const html = `
      <link rel="modulepreload" href="/assets/a.js">
      <link rel="modulepreload" href="b.js">
    `;
    expect(preloadedChunkPaths(html)).toEqual(['assets/a.js', 'b.js']);
  });

  it('returns nothing when the build preloads nothing', () => {
    expect(preloadedChunkPaths('<!doctype html><html></html>')).toEqual([]);
  });

  it('reads a rel token from a multi-valued rel attribute', () => {
    // `rel` is a space-separated token list. Matching it as a prefix would drop
    // a chunk whenever the token is not written first — a silent undercount.
    const html = `<link rel="preload modulepreload" href="./assets/a.js">`;
    expect(preloadedChunkPaths(html)).toEqual(['assets/a.js']);
  });

  it('tolerates unquoted attribute values', () => {
    expect(preloadedChunkPaths('<link rel=modulepreload href=./assets/a.js>')).toEqual([
      'assets/a.js',
    ]);
  });
});

describe('stylesheetPaths', () => {
  it('finds every stylesheet href as a dist-relative path', () => {
    const html = `
      <link rel="stylesheet" crossorigin href="./assets/index-C7g6y5J4.css">
      <link rel="stylesheet" crossorigin href="./assets/theme-abc.css">
    `;
    expect(stylesheetPaths(html)).toEqual(['assets/index-C7g6y5J4.css', 'assets/theme-abc.css']);
  });

  it('ignores links that are not stylesheets', () => {
    const html = `
      <link rel="modulepreload" href="./assets/platform-abc.js">
      <link rel="icon" type="image/svg+xml" href="./assets/logo-DGL6L7Tw.svg">
      <link rel="preload" as="font" href="./assets/inter.woff2">
      <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
    `;
    expect(stylesheetPaths(html)).toEqual(['assets/index-abc.css']);
  });

  it('does not depend on attribute order or quote style', () => {
    const html = `
      <link crossorigin href='./assets/a.css' rel='stylesheet'>
      <link href="./assets/b.css" rel="stylesheet">
    `;
    expect(stylesheetPaths(html)).toEqual(['assets/a.css', 'assets/b.css']);
  });

  it('normalises root-relative and bare hrefs', () => {
    const html = `
      <link rel="stylesheet" href="/assets/a.css">
      <link rel="stylesheet" href="b.css">
    `;
    expect(stylesheetPaths(html)).toEqual(['assets/a.css', 'b.css']);
  });

  it('returns nothing when the document links no stylesheet', () => {
    expect(stylesheetPaths('<!doctype html><html></html>')).toEqual([]);
  });
});

describe('stylesheetSize (render-blocking CSS)', () => {
  it('sums every stylesheet index.html links', () => {
    const dist = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': 78_304, 'theme-b.css': 4_000 },
      stylesheets: ['index-a.css', 'theme-b.css'],
    });
    expect(stylesheetSize(dist)).toBe(82_304);
  });

  it('is not fooled by moving rules out of the entry stylesheet into a second link', () => {
    // The CSS analogue of the platform-*.js hoist the JS measure was blind to:
    // splitting the same rules across two <link>s costs the user exactly as much
    // before first paint, so the number must not move.
    const oneSheet = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': 78_304 },
      stylesheets: ['index-a.css'],
    });
    const twoSheets = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': 40_000, 'split-b.css': 38_304 },
      stylesheets: ['index-a.css', 'split-b.css'],
    });
    expect(stylesheetSize(twoSheets)).toBe(stylesheetSize(oneSheet));
  });

  it('counts inline <style> in index.html, which is render-blocking too', () => {
    // Otherwise the cheapest way under the budget is to paste the rules into the
    // document, which is strictly worse for the user: uncacheable and repeated
    // on every load.
    const dist = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': 1_000 },
      html: '<!doctype html><html><head><link rel="stylesheet" href="./assets/index-a.css"><style>body{color:red}</style></head><body></body></html>',
    });
    expect(stylesheetSize(dist)).toBe(1_000 + 'body{color:red}'.length);
  });

  it('ignores CSS that index.html does not link', () => {
    // ArenaOverlay-*.css is emitted alongside a lazily-imported component and
    // arrives with it, not before first paint. Counting it would turn this into
    // "dist total" with extra steps.
    const dist = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': 78_304, 'ArenaOverlay-b.css': 18_502 },
      stylesheets: ['index-a.css'],
    });
    expect(stylesheetSize(dist)).toBe(78_304);
  });

  it('does not follow url() references, so font files stay out', () => {
    // 43 woff2 files totalling 576 KB are referenced from the entry stylesheet.
    // The browser applies its own font strategy — unicode-range subsetting means
    // it fetches one or two — so they are not a render-blocking cost.
    const css = '@font-face{src:url(./inter-cyrillic-400-normal-obahsSVq.woff2)}';
    const dist = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': css, 'inter.woff2': 500_000 },
      stylesheets: ['index-a.css'],
    });
    expect(stylesheetSize(dist)).toBe(css.length);
  });

  it('throws when index.html links a stylesheet that is not on disk', () => {
    const dist = makeDist({
      assets: { 'index-a.js': 10 },
      stylesheets: ['gone.css'],
    });
    expect(() => stylesheetSize(dist)).toThrow(/gone\.css/);
  });

  it('throws when a counted stylesheet uses @import rather than undercounting it', () => {
    // @import pulls in more render-blocking bytes that are not in the <link>
    // list. The build inlines imports today, so this is an assumption, not a
    // fact — and it fails loudly the day it stops holding.
    const dist = makeDist({
      assets: {
        'index-a.js': 10,
        'index-a.css': '@import url("./more.css");body{color:red}',
        'more.css': 50_000,
      },
      stylesheets: ['index-a.css'],
    });
    expect(() => stylesheetSize(dist)).toThrow(/@import/);
  });

  it('reads zero when the build links no stylesheet at all', () => {
    // Honest rather than defensive: no linked CSS means no render-blocking CSS.
    // If a future build inlines it into JS instead, those bytes land in the
    // entry-chunk budget, which is where they would then belong.
    const dist = makeDist({ assets: { 'index-a.js': 10 } });
    expect(stylesheetSize(dist)).toBe(0);
  });
});

describe('startupStylesheets breakdown', () => {
  it('lists each linked stylesheet with its size', () => {
    const dist = makeDist({
      assets: { 'index-a.js': 10, 'index-a.css': 78_304, 'theme-b.css': 4_000 },
      stylesheets: ['index-a.css', 'theme-b.css'],
    });
    expect(startupStylesheets(dist)).toEqual([
      { path: 'assets/index-a.css', size: 78_304, kind: 'stylesheet' },
      { path: 'assets/theme-b.css', size: 4_000, kind: 'stylesheet' },
    ]);
  });

  it('renders a breakdown so a failure names the stylesheet that grew', () => {
    const lines = formatStylesheetBreakdown([
      { path: 'assets/index-a.css', size: 78_304, kind: 'stylesheet' },
      { path: 'index.html', size: 180, kind: 'inline <style>' },
    ]);
    expect(lines).toContain('assets/index-a.css');
    expect(lines).toContain('78,304 B');
    expect(lines).toContain('inline <style>');
  });
});

describe('entryChunkSize (startup JS, not just the entry chunk)', () => {
  it('sums the entry chunk and every preloaded chunk', () => {
    const dist = makeDist({
      assets: { 'index-a.js': 1000, 'platform-b.js': 300, 'preload-helper-c.js': 50 },
      preload: ['preload-helper-c.js', 'platform-b.js'],
    });
    expect(entryChunkSize(dist)).toBe(1350);
  });

  it('is not fooled by moving code out of the entry into a preloaded chunk', () => {
    // This is the bypass the gate missed: rolldown hoisted 193,157 B of shared
    // code out of the entry into platform-*.js, which the entry still imports
    // statically and index.html still modulepreloads. The reported number fell
    // by 194,365 B while the bytes a user pays at startup did not move at all.
    const allInEntry = makeDist({ assets: { 'index-a.js': 1_232_561 } });
    const hoistedOut = makeDist({
      assets: { 'index-a.js': 1_038_196, 'platform-b.js': 193_157, 'preload-helper-c.js': 1_208 },
      preload: ['preload-helper-c.js', 'platform-b.js'],
    });
    expect(entryChunkSize(allInEntry)).toBe(1_232_561);
    expect(entryChunkSize(hoistedOut)).toBe(entryChunkSize(allInEntry));
  });

  it('counts weight added to a preloaded chunk even when the entry does not grow', () => {
    const before = makeDist({
      assets: { 'index-a.js': 1_038_196, 'platform-b.js': 193_157 },
      preload: ['platform-b.js'],
    });
    const after = makeDist({
      assets: { 'index-a.js': 1_038_196, 'platform-b.js': 693_157 },
      preload: ['platform-b.js'],
    });
    expect(entryChunkSize(after) - entryChunkSize(before)).toBe(500_000);
    expect(checkBudgets({ 'renderer entry chunk': entryChunkSize(after) }, BUDGETS).ok).toBe(false);
  });

  it('ignores lazy chunks that index.html does not preload', () => {
    // A chunk only reachable through import() is not startup cost, and counting
    // it would turn the gate into "dist total" with extra steps.
    const dist = makeDist({
      assets: { 'index-a.js': 1000, 'platform-b.js': 300, 'mermaid-lazy.js': 900_000 },
      preload: ['platform-b.js'],
    });
    expect(entryChunkSize(dist)).toBe(1300);
  });

  it('does not double-count the entry chunk if it is also preloaded', () => {
    const dist = makeDist({
      assets: { 'index-a.js': 1000, 'platform-b.js': 300 },
      preload: ['index-a.js', 'platform-b.js'],
    });
    expect(entryChunkSize(dist)).toBe(1300);
  });

  it('throws when index.html preloads a chunk that is not on disk', () => {
    // Silently skipping a missing preload would under-count — the exact class of
    // bug this change exists to remove.
    const dist = makeDist({
      assets: { 'index-a.js': 1000 },
      preload: ['platform-gone.js'],
    });
    expect(() => entryChunkSize(dist)).toThrow(/platform-gone\.js/);
  });

  it('throws when index.html is missing rather than measuring the entry alone', () => {
    const dist = makeDist({ assets: { 'index-a.js': 1000 } });
    rmSync(join(dist, 'index.html'));
    expect(() => entryChunkSize(dist)).toThrow(/index\.html/);
  });

  it('still refuses to guess when there is no entry chunk', () => {
    const dist = makeDist({ assets: { 'platform-b.js': 300 } });
    expect(() => entryChunkSize(dist)).toThrow(/index-\*\.js/);
  });

  it('still refuses to guess when there are several entry chunks', () => {
    const dist = makeDist({ assets: { 'index-a.js': 1, 'index-b.js': 2 } });
    expect(() => entryChunkSize(dist)).toThrow(/exactly one/);
  });
});

describe('startupChunks breakdown', () => {
  it('lists the entry first, then each preloaded chunk with its size', () => {
    const dist = makeDist({
      assets: { 'index-a.js': 1000, 'platform-b.js': 300 },
      preload: ['platform-b.js'],
    });
    expect(startupChunks(dist)).toEqual([
      { path: 'assets/index-a.js', size: 1000, preloaded: false },
      { path: 'assets/platform-b.js', size: 300, preloaded: true },
    ]);
  });

  it('renders a breakdown so a failure names the chunk that grew', () => {
    const lines = formatStartupBreakdown([
      { path: 'assets/index-a.js', size: 1_038_196, preloaded: false },
      { path: 'assets/platform-b.js', size: 193_157, preloaded: true },
    ]);
    expect(lines).toContain('assets/index-a.js');
    expect(lines).toContain('193,157 B');
    expect(lines).toContain('modulepreload');
  });
});
