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
  preloadedChunkPaths,
  startupChunks,
} from './check-bundle-size.mjs';

/** Temp dirs created by fixtures, removed after each test. */
const created = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a throwaway `dist/` whose files have exact byte sizes.
 *
 * @param {{ assets: Record<string, number>, preload?: string[], html?: string }} spec
 *   `assets` maps a file name under `assets/` to its byte size; `preload` lists
 *   the file names index.html should modulepreload.
 * @returns {string} path to the fixture dist directory
 */
function makeDist({ assets, preload = [], html }) {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-gate-'));
  created.push(dist);
  mkdirSync(join(dist, 'assets'));
  for (const [name, size] of Object.entries(assets)) {
    writeFileSync(join(dist, 'assets', name), 'x'.repeat(size));
  }
  const links = preload
    .map((name) => `<link rel="modulepreload" crossorigin href="./assets/${name}">`)
    .join('\n    ');
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
