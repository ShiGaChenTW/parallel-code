#!/usr/bin/env node
/* global console, process */

/**
 * Renderer bundle size gate.
 *
 * Exists because an unused `monaco-editor` import once sat in the renderer entry
 * for several releases, costing 3.7 MB in the entry chunk plus 9.4 MB of worker
 * bundles, and nothing failed. `knip` could not see it (the import chain was
 * live), so the only durable guard is a size budget.
 *
 * Budgets are raw bytes, not gzip: in Electron the renderer loads from local
 * disk, so parse/compile of the raw bytes is the cost that matters.
 *
 * WHAT "renderer entry chunk" MEASURES, AND WHY IT CHANGED
 *
 * It used to measure `dist/assets/index-*.js` alone. That was true of the file
 * and false of the user. Once the startup-path diet split lazy chunks out of the
 * renderer, rolldown hoisted the newly-shared code into `platform-*.js`
 * (193,157 B) — a chunk the entry still imports *statically* and `index.html`
 * still `modulepreload`s. Nothing about startup cost had moved; only which file
 * held the bytes had. Measured on that build:
 *
 *   entry chunk only (what the gate reported)  1,038,196 B  = 69.2%
 *   entry + everything index.html preloads     1,232,561 B  = 82.2%
 *                                              ---------
 *   invisible to the gate                        194,365 B
 *
 * So the gate could be walked under simply by letting the bundler relocate code
 * one hop away, with no reduction in what a user pays before the app is usable.
 * It now sums the entry chunk plus every chunk `index.html` modulepreloads: the
 * bytes the renderer must fetch, parse and compile before it can start. The
 * ceiling stayed at 1,500,000 B through the change, which makes this strictly a
 * tightening — 82.2% used where 69.2% was reported before.
 *
 * The boundary is deliberate. Chunks reached only through `import()` are not
 * counted; they are not startup cost, and counting them would make this measure
 * "dist total" a second time. `build.modulePreload` is left on: `platform-*.js`
 * is pulled in by a static import carrying 200+ bindings, not by a preload
 * heuristic, so disabling preload would drop the `<link>` hint while keeping the
 * import edge — a slower start and a prettier number.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Budgets sized to catch dependency-scale regressions while leaving room for
 * ordinary feature growth. Measured 2026-07-30 after removing monaco-editor:
 * entry 1,266,514 B and total 15,262,119 B, under the entry-only measure.
 * Verified by mutation: re-adding the monaco import pushes the entry chunk to
 * 5,004,337 B and this gate exits 1.
 *
 * The ceilings did not move when the entry measure widened to entry + preloads
 * on 2026-07-31 — that is the point of the change. Under the wider measure the
 * same tree reports 1,232,561 B, so headroom is roughly 18% instead of the 31%
 * the narrower measure appeared to leave. A legitimate feature can still land;
 * a monaco-sized dependency still cannot, and now it cannot hide one chunk away
 * from the entry either.
 *
 * Raising a budget is allowed — but do it in a commit that says why, so the
 * number keeps meaning something.
 */
export const BUDGETS = {
  'renderer entry chunk': 1_500_000,
  'dist total': 18_000_000,
};

/**
 * Dist-relative paths of every chunk `index.html` asks the browser to preload.
 *
 * Pure so the parsing is testable without a build. Deliberately tolerant of
 * attribute order, quote style and href shape: a link this misses is a chunk
 * silently dropped from the measurement, which is the bug this gate exists to
 * avoid rather than reproduce.
 *
 * @param {string} html contents of `dist/index.html`
 * @returns {string[]} e.g. `['assets/platform-B5eFPIUU.js']`
 */
export function preloadedChunkPaths(html) {
  const paths = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?modulepreload\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (!href) continue;
    const value = href[2] ?? href[3] ?? '';
    const normalised = value.replace(/^\.?\//, '');
    if (normalised) paths.push(normalised);
  }
  return paths;
}

/** @typedef {{ path: string, size: number, preloaded: boolean }} StartupChunk */

/**
 * Every chunk the renderer loads before it can start: the entry chunk first,
 * then each chunk `index.html` modulepreloads. Chunks reached only through
 * `import()` are absent by design — see the file header.
 *
 * @param {string} distDir
 * @returns {StartupChunk[]}
 */
export function startupChunks(distDir) {
  const assetsDir = join(distDir, 'assets');
  const matches = readdirSync(assetsDir).filter((name) => /^index-.*\.js$/.test(name));
  if (matches.length === 0) {
    throw new Error(`No renderer entry chunk (index-*.js) found in ${assetsDir}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Expected exactly one index-*.js in ${assetsDir}, found: ${matches.join(', ')}`,
    );
  }
  const entryPath = `assets/${matches[0]}`;

  const indexHtml = join(distDir, 'index.html');
  let html;
  try {
    html = readFileSync(indexHtml, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${indexHtml}: ${err.message}`);
  }

  const chunks = [
    { path: entryPath, size: statSync(join(distDir, entryPath)).size, preloaded: false },
  ];
  const seen = new Set([entryPath]);
  for (const path of preloadedChunkPaths(html)) {
    if (seen.has(path)) continue;
    seen.add(path);
    let size;
    try {
      size = statSync(join(distDir, path)).size;
    } catch {
      throw new Error(`${indexHtml} preloads ${path}, but that file is not in ${distDir}`);
    }
    chunks.push({ path, size, preloaded: true });
  }
  return chunks;
}

/**
 * Byte size of the renderer's startup JavaScript: the entry chunk plus every
 * chunk `index.html` modulepreloads. Named for the budget key it feeds
 * (`renderer entry chunk`); the header explains why it is more than the entry.
 */
export function entryChunkSize(distDir) {
  return startupChunks(distDir).reduce((total, chunk) => total + chunk.size, 0);
}

/**
 * Human-readable composition of the startup measurement, so a failure says which
 * chunk grew instead of only that the total did.
 *
 * @param {StartupChunk[]} chunks
 */
export function formatStartupBreakdown(chunks) {
  const lines = ['note  "renderer entry chunk" = entry + every chunk index.html modulepreloads:'];
  for (const chunk of chunks) {
    const kind = chunk.preloaded ? 'modulepreload' : 'entry';
    lines.push(`note    ${chunk.path}  ${chunk.size.toLocaleString()} B  (${kind})`);
  }
  return lines.join('\n');
}

/** Total byte size of every file under `dir`, recursively. */
export function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : statSync(full).size;
  }
  return total;
}

/**
 * Compare measured sizes against budgets. Pure — no filesystem access — so the
 * pass/fail logic is testable without a real build.
 *
 * @param {Record<string, number>} measured name -> bytes
 * @param {Record<string, number>} budgets name -> byte ceiling
 */
export function checkBudgets(measured, budgets) {
  const checks = Object.entries(budgets).map(([name, budget]) => {
    const actual = measured[name];
    if (typeof actual !== 'number') {
      return { name, budget, actual: undefined, ok: false, reason: 'not measured' };
    }
    return {
      name,
      budget,
      actual,
      ok: actual <= budget,
      usedPct: (actual / budget) * 100,
    };
  });
  const unbudgeted = Object.keys(measured).filter((name) => !(name in budgets));
  return { checks, unbudgeted, ok: checks.every((check) => check.ok) };
}

export function formatReport(result) {
  const lines = [];
  for (const check of result.checks) {
    if (check.actual === undefined) {
      lines.push(`FAIL  ${check.name} — ${check.reason}`);
      continue;
    }
    const status = check.ok ? 'ok  ' : 'FAIL';
    const over = check.ok ? '' : `  (over by ${(check.actual - check.budget).toLocaleString()} B)`;
    lines.push(
      `${status}  ${check.name}: ${check.actual.toLocaleString()} B` +
        ` / ${check.budget.toLocaleString()} B budget` +
        ` — ${check.usedPct.toFixed(1)}% used${over}`,
    );
  }
  for (const name of result.unbudgeted) {
    lines.push(`note  ${name} measured but has no budget`);
  }
  if (!result.ok) {
    lines.push('');
    lines.push('Bundle size budget exceeded. Either shrink the bundle or raise the');
    lines.push('budget in scripts/check-bundle-size.mjs with a commit explaining why.');
  }
  return lines.join('\n');
}

function main(argv) {
  const distDir = argv[2] ?? 'dist';
  let measured;
  let chunks;
  try {
    chunks = startupChunks(distDir);
    measured = {
      'renderer entry chunk': chunks.reduce((total, chunk) => total + chunk.size, 0),
      'dist total': directorySize(distDir),
    };
  } catch (err) {
    console.error(`Cannot measure ${distDir}: ${err.message}`);
    console.error('Run `npm run build:frontend` first.');
    return 2;
  }
  const result = checkBudgets(measured, BUDGETS);
  console.log(formatReport(result));
  console.log(formatStartupBreakdown(chunks));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
