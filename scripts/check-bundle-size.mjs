#!/usr/bin/env node
/* global console, process, Buffer */

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
 *
 * WHY CSS HAS ITS OWN BUDGET
 *
 * Fixing the JS measure left the same seam one layer out. `index.html` links a
 * stylesheet — 78,304 B on the build that prompted this — and the browser will
 * not paint until it has fetched and parsed it. Render-blocking, paid before the
 * first frame, and until now covered only by `dist total`, where it was 0.43% of
 * a figure already sitting at 85.3%. A stylesheet could have quadrupled and moved
 * that gate by one and a half points. A budget that cannot react to the thing it
 * nominally covers is not covering it.
 *
 * It is budgeted separately from JS rather than folded in, because the two grow
 * for different reasons and at different scales. CSS grows with the number of
 * components and themes; JS grows with dependencies. At 6% of the JS figure, CSS
 * could triple inside a combined number and move it by ~3.5% — indistinguishable
 * from ordinary JS churn. Two quantities that differ 16x in size only stay
 * legible as two numbers.
 *
 * WHAT COUNTS AS RENDER-BLOCKING CSS
 *
 * Every stylesheet `index.html` links, plus any inline `<style>` in the document.
 * The inline case is counted for the same reason the preloaded chunks are: if it
 * were not, the cheapest route under the budget would be to paste the rules into
 * the document, which is strictly worse for the user — uncacheable, and re-sent
 * on every load. Same shape of bypass, closed at the same time.
 *
 * Three things are deliberately outside it:
 *
 *   - CSS emitted for lazily-imported components (`ArenaOverlay-*.css`, 18,502 B)
 *     is not linked from `index.html`; it arrives with the component that needs
 *     it. Same boundary as `import()`ed JS, drawn for the same reason.
 *   - Font files reached through `url()` are not followed. 43 woff2 files
 *     totalling 576 KB hang off `@font-face` rules in the entry stylesheet, but
 *     the browser applies its own font strategy: `unicode-range` subsetting means
 *     it fetches the one or two subsets a page actually uses, and text renders
 *     without them. Counting all 576 KB as startup cost would be false by an
 *     order of magnitude and would fight the earlier decision not to bundle CJK
 *     font subsets.
 *   - `@import`ed CSS is not resolved. It is also not ignored: a counted
 *     stylesheet containing `@import` makes this gate throw. See below.
 *
 * THE @import ASSUMPTION
 *
 * `@import` pulls in further render-blocking bytes that never appear in the
 * `<link>` list, so it is exactly the seam this change exists to close. The build
 * has none today — lightningcss inlines imports — so resolving them would be
 * dead code, and half-resolving them (relative paths, `layer()`, `supports()`,
 * media-conditional imports, remote URLs that have no size on disk) would
 * reintroduce the silent undercount in a more confident-looking form.
 *
 * So the assumption is asserted instead of assumed: find `@import` in a counted
 * stylesheet and the gate fails loudly, naming the file. The assumption that has
 * to break for this to fire is the build no longer inlining imports — a Vite or
 * lightningcss config change, or a remote `@import` that cannot be inlined. When
 * it fires, someone decides whether to inline it or teach this function to walk
 * the graph; what they will not do is quietly measure the wrong number. The scan
 * is a plain substring match on minified CSS, so a rule like `content: "@import"`
 * would trip it too. That trade is on purpose: a false alarm is a five-minute
 * conversation, a false negative is the bug this whole file exists to prevent.
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
 *
 * `renderer startup CSS` was added 2026-07-31 at 120,000 B against a measured
 * 78,513 B, and is sized from this repo's own history rather than from a round
 * number. Source CSS under `src/` went 46,089 B -> 77,703 B between 2026-02-24
 * and 2026-07-31 once the initial build-out settled — about 6.1 KB a month, and
 * about 1.7 KB a month across the last three as the UI matured. The 41,487 B of
 * headroom is therefore roughly seven months of growth at the historical rate and
 * over two years at the current one. A gate that needs raising every quarter
 * teaches people to raise it.
 *
 * The other end: 120,000 B is 1.53x today's render-blocking CSS, so it blocks any
 * single addition that makes the user's pre-paint cost half again as large — full
 * Bootstrap (~230 KB minified), un-purged Tailwind (megabytes), the complete Font
 * Awesome CSS (~57 KB minified, landing at ~135 KB), the whole highlight.js theme
 * set. It deliberately does not block one ~32 KB component stylesheet: that is
 * indistinguishable from six months of ordinary feature growth, and a gate that
 * cannot tell those apart should not pretend to.
 *
 * Note this leaves proportionally more slack than the JS budget (65% used against
 * 82.5%). That is not inconsistency. Percentage-of-budget is the wrong yardstick
 * across two quantities 16x apart in size; months-of-headroom is the right one,
 * and by that measure the two are close.
 *
 * Verified by mutation, both directions, because either alone proves half the
 * proposition.
 *
 * Bulk: importing katex's and plyr's stylesheets into the eager entry produces
 * 138,969 B and this gate exits 1 — while `dist total` stayed green at 91.6%
 * through the very same change. That is the whole reason this budget exists
 * separately instead of being left to the total.
 *
 * Relocation: moving xterm's stylesheet out of the JS import chain and into a
 * `<link rel="stylesheet">` in the source `index.html` produced a byte-identical
 * entry stylesheet — same 78,304 B, same `C7g6y5J4` hash, still 130 xterm rules
 * inside it — and this measure held at exactly 78,513 B. The reason is worth
 * writing down: Vite merges *all* statically-reachable CSS into one stylesheet
 * and emits separate CSS files only for `import()`ed chunks. So the multi-`<link>`
 * case cannot currently be reached by moving code around, and the relocation
 * bypass that bit the JS measure has no CSS equivalent today. The measure still
 * sums every link rather than globbing `index-*.css`, and a fixture test pins
 * that behaviour, because "the bundler happens not to do this" is a fact about
 * this Vite version, not a property of the metric.
 */
export const BUDGETS = {
  'renderer entry chunk': 1_500_000,
  'renderer startup CSS': 120_000,
  'dist total': 18_000_000,
};

/**
 * Value of attribute `name` on a single tag, or `undefined`. Handles double
 * quotes, single quotes and no quotes.
 *
 * @param {string} tag e.g. `<link rel="stylesheet" href="./assets/index.css">`
 * @param {string} name
 * @returns {string | undefined}
 */
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  if (!match) return undefined;
  return match[2] ?? match[3] ?? match[4];
}

/**
 * Dist-relative hrefs of every `<link>` carrying `rel` token `rel`.
 *
 * One parser for both budgets on purpose. A link this misses is a file silently
 * dropped from a measurement, which is the bug these gates exist to avoid rather
 * than reproduce — so the tolerance (attribute order, quote style, href shape,
 * `rel` as a space-separated token list) is worth having in exactly one place
 * where it can be tested once and relied on twice.
 *
 * @param {string} html contents of `dist/index.html`
 * @param {string} rel lowercase rel token, e.g. `'modulepreload'`
 * @returns {string[]}
 */
function linkedHrefs(html, rel) {
  const paths = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rels = (attribute(tag, 'rel') ?? '').toLowerCase().trim().split(/\s+/);
    if (!rels.includes(rel)) continue;
    const href = attribute(tag, 'href');
    if (!href) continue;
    const normalised = href.replace(/^\.?\//, '');
    if (normalised) paths.push(normalised);
  }
  return paths;
}

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
  return linkedHrefs(html, 'modulepreload');
}

/**
 * Dist-relative paths of every stylesheet `index.html` links — the CSS the
 * browser must fetch and parse before it can paint.
 *
 * @param {string} html contents of `dist/index.html`
 * @returns {string[]} e.g. `['assets/index-C7g6y5J4.css']`
 */
export function stylesheetPaths(html) {
  return linkedHrefs(html, 'stylesheet');
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

/** @typedef {{ path: string, size: number, kind: 'stylesheet' | 'inline <style>' }} StartupStyle */

/**
 * Every source of render-blocking CSS the document commits to: each stylesheet
 * `index.html` links, then its inline `<style>` blocks as one entry.
 *
 * Throws rather than undercounts — on a linked stylesheet missing from disk, and
 * on `@import` inside one. See the file header for why `@import` is asserted
 * against instead of resolved.
 *
 * @param {string} distDir
 * @returns {StartupStyle[]}
 */
export function startupStylesheets(distDir) {
  const indexHtml = join(distDir, 'index.html');
  let html;
  try {
    html = readFileSync(indexHtml, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${indexHtml}: ${err.message}`);
  }

  const styles = [];
  for (const path of stylesheetPaths(html)) {
    // Size from stat, same as the JS side; contents only to assert on @import.
    let size;
    let css;
    try {
      size = statSync(join(distDir, path)).size;
      css = readFileSync(join(distDir, path), 'utf8');
    } catch {
      throw new Error(`${indexHtml} links ${path}, but that file is not in ${distDir}`);
    }
    if (css.includes('@import')) {
      throw new Error(
        `${path} contains @import, which pulls in render-blocking CSS that is not in ` +
          `index.html's link list — so this budget would undercount it. Inline the import ` +
          `at build time, or teach startupStylesheets() to resolve the import graph.`,
      );
    }
    styles.push({ path, size, kind: 'stylesheet' });
  }

  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce(
    (total, [, body]) => total + Buffer.byteLength(body),
    0,
  );
  if (inline > 0) styles.push({ path: 'index.html', size: inline, kind: 'inline <style>' });

  return styles;
}

/**
 * Byte size of the CSS the renderer must parse before its first frame: every
 * stylesheet `index.html` links, plus its inline `<style>` blocks.
 */
export function stylesheetSize(distDir) {
  return startupStylesheets(distDir).reduce((total, style) => total + style.size, 0);
}

/**
 * Human-readable composition of the CSS measurement, so a failure says which
 * stylesheet grew instead of only that the total did.
 *
 * @param {StartupStyle[]} styles
 */
export function formatStylesheetBreakdown(styles) {
  const lines = [
    'note  "renderer startup CSS" = every stylesheet index.html links, inline included:',
  ];
  for (const style of styles) {
    lines.push(`note    ${style.path}  ${style.size.toLocaleString()} B  (${style.kind})`);
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
  let styles;
  try {
    chunks = startupChunks(distDir);
    styles = startupStylesheets(distDir);
    measured = {
      'renderer entry chunk': chunks.reduce((total, chunk) => total + chunk.size, 0),
      'renderer startup CSS': styles.reduce((total, style) => total + style.size, 0),
      'dist total': directorySize(distDir),
    };
  } catch (err) {
    console.error(`Cannot measure ${distDir}: ${err.message}`);
    console.error('If dist/ is missing or stale, run `npm run build:frontend` first.');
    return 2;
  }
  const result = checkBudgets(measured, BUDGETS);
  console.log(formatReport(result));
  console.log(formatStartupBreakdown(chunks));
  console.log(formatStylesheetBreakdown(styles));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
