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
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Budgets sized to catch dependency-scale regressions while leaving room for
 * ordinary feature growth. Measured 2026-07-30 after removing monaco-editor:
 * entry 1,266,514 B and total 15,262,119 B. Headroom is roughly 18%, so a
 * legitimate feature can land but re-adding a monaco-sized dependency cannot.
 * Verified by mutation: re-adding the monaco import pushes the entry chunk to
 * 5,004,337 B and this gate exits 1.
 *
 * Raising a budget is allowed — but do it in a commit that says why, so the
 * number keeps meaning something.
 */
export const BUDGETS = {
  'renderer entry chunk': 1_500_000,
  'dist total': 18_000_000,
};

/** Byte size of the renderer entry chunk (`dist/assets/index-<hash>.js`). */
export function entryChunkSize(distDir) {
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
  return statSync(join(assetsDir, matches[0])).size;
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
  try {
    measured = {
      'renderer entry chunk': entryChunkSize(distDir),
      'dist total': directorySize(distDir),
    };
  } catch (err) {
    console.error(`Cannot measure ${distDir}: ${err.message}`);
    console.error('Run `npm run build:frontend` first.');
    return 2;
  }
  const result = checkBudgets(measured, BUDGETS);
  console.log(formatReport(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
