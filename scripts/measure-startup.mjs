#!/usr/bin/env node
/* global console, process, setTimeout, clearTimeout */

/**
 * Cold-start measurement harness.
 *
 * Launches the built app N times with a throwaway profile, reads the `startup
 * mark` debug lines emitted by electron/startup-timing.ts, and reports medians.
 *
 * Medians over N runs, not a single sample: an earlier attempt at measuring idle
 * memory with one sample produced a 346–523 MB spread and no usable conclusion.
 *
 * Each run's t0 is this process's own spawn timestamp, not the app's first mark.
 * Electron's boot happens before any of our code runs and is part of what the
 * user waits for.
 *
 * Usage: node scripts/measure-startup.mjs [runs]
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MARK_ORDER = ['main-module-loaded', 'app-ready', 'window-created', 'renderer-loaded'];
const RUN_TIMEOUT_MS = 30_000;

/**
 * Extract `{ mark: atMs }` from captured stdout. Pure, so the parsing is
 * testable without launching Electron.
 */
export function parseStartupMarks(text) {
  const marks = {};
  for (const line of text.split('\n')) {
    if (!line.includes('startup mark')) continue;
    const braceAt = line.indexOf('{');
    if (braceAt < 0) continue;
    let payload;
    try {
      payload = JSON.parse(line.slice(braceAt));
    } catch {
      continue; // a truncated line is not a measurement
    }
    if (typeof payload?.mark !== 'string' || typeof payload?.atMs !== 'number') continue;
    // First occurrence wins; a reload must not overwrite the startup value.
    if (!(payload.mark in marks)) marks[payload.mark] = payload.atMs;
  }
  return marks;
}

/** Elapsed ms from spawn to each mark. Returns null when a mark is missing. */
export function elapsedFromSpawn(marks, spawnedAtMs) {
  const out = {};
  for (const mark of MARK_ORDER) {
    out[mark] = typeof marks[mark] === 'number' ? marks[mark] - spawnedAtMs : null;
  }
  return out;
}

export function median(values) {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Per-mark median/min/max across runs, plus how many runs actually reported it. */
export function summarize(runs) {
  return MARK_ORDER.map((mark) => {
    const values = runs.map((run) => run[mark]).filter((v) => typeof v === 'number');
    return {
      mark,
      n: values.length,
      median: median(values),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    };
  });
}

export function formatSummary(summary, runCount) {
  const lines = [`cold start over ${runCount} run(s), ms from process spawn:`, ''];
  for (const row of summary) {
    if (row.median === null) {
      lines.push(`  ${row.mark.padEnd(20)} not reported`);
      continue;
    }
    const spread = row.min === row.max ? '' : `  (${row.min}–${row.max})`;
    const missing = row.n < runCount ? `  [only ${row.n}/${runCount} runs]` : '';
    lines.push(`  ${row.mark.padEnd(20)} ${String(row.median).padStart(6)} ms${spread}${missing}`);
  }
  return lines.join('\n');
}

function runOnce(index) {
  return new Promise((resolve) => {
    const profile = `/tmp/pcstartup-${process.pid}-${index}`;
    const spawnedAtMs = Date.now();
    const child = spawn(
      './node_modules/.bin/electron',
      ['--no-sandbox', `--user-data-dir=${profile}`, 'dist-electron/main.js'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let output = '';
    const collect = (chunk) => {
      output += chunk;
      // Stop as soon as the last mark lands; waiting longer only adds noise.
      if (output.includes(MARK_ORDER[MARK_ORDER.length - 1])) finish();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let done = false;
    const timer = setTimeout(finish, RUN_TIMEOUT_MS);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      setTimeout(() => {
        try {
          rmSync(profile, { recursive: true, force: true });
        } catch {
          // a leftover temp profile is not worth failing a measurement over
        }
        resolve(elapsedFromSpawn(parseStartupMarks(output), spawnedAtMs));
      }, 500);
    }
  });
}

async function main(argv) {
  const runs = Number(argv[2] ?? 5);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error('Usage: node scripts/measure-startup.mjs [runs]');
    return 2;
  }
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(await runOnce(i));
  }
  const summary = summarize(results);
  console.log(formatSummary(summary, runs));
  return summary.every((row) => row.n === runs) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
