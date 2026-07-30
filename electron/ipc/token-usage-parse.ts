// Token-usage parsing — pure functions, no filesystem and no Electron.
//
// Every AI CLI Parallel Code dispatches already writes its own usage records to
// a local file. This module turns those lines into numbers. It makes no network
// request and cannot: there is nothing here but string and object handling.
// (Querying a vendor for account usage would need API keys the app does not
// hold and would break the offline promise made in PRD §13 Q3 — see
// `offline.ts`, whose OUTBOUND_SURFACES list this wave deliberately leaves at
// the length R2 set it to.)
//
// The formats are observed, not documented, so field names may drift with CLI
// versions. Every entry point here returns `null` for a line it does not
// recognise rather than throwing — one unknown record must never lose a whole
// file's worth of counts.

import type { ProviderId, TokenTotals } from './shared-types.js';

export const ZERO_TOTALS: TokenTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export function sumTotals(t: TokenTotals): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function isZeroTotals(t: TokenTotals): boolean {
  return sumTotals(t) === 0;
}

/**
 * Reads a numeric field, treating anything that is not a finite non-negative
 * number as absent. CLIs have been observed writing `null` for fields they did
 * not populate; a `NaN` leaking into a running total would poison every
 * downstream sum irreversibly, so the guard is on the way in, not the way out.
 */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parses one JSONL line into an object, or null for blank/malformed/non-object. */
export function parseJsonObjectLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * Splits an appended chunk into whole lines plus the leftover partial line.
 *
 * Incremental readers hand us whatever bytes arrived since the last read, and a
 * writer appending a record is not atomic — the tail is routinely half a JSON
 * object. Returning the remainder lets the caller prepend it to the next chunk
 * instead of discarding a record that was merely mid-flight.
 */
export function splitCompleteLines(chunk: string): { lines: string[]; remainder: string } {
  const lastNewline = chunk.lastIndexOf('\n');
  if (lastNewline === -1) return { lines: [], remainder: chunk };
  return {
    lines: chunk.slice(0, lastNewline).split('\n'),
    remainder: chunk.slice(lastNewline + 1),
  };
}

// --------------------------------------------------------------------------
// Path ↔ Claude project-directory slug
// --------------------------------------------------------------------------

/**
 * The directory name Claude Code uses for a project path.
 *
 * The transform is lossy in the other direction — `/Users/x/a_b` and
 * `/Users/x/a-b` both slug to `-Users-x-a-b` — so this is only ever used
 * forwards, to decide which directory to read for a path we already know.
 * Attribution itself comes from the `cwd` field inside each record.
 */
export function claudeProjectSlug(absolutePath: string): string {
  return absolutePath.replace(/[/\\_.]/g, '-');
}

// --------------------------------------------------------------------------
// Attributing a recorded directory to a known worktree
// --------------------------------------------------------------------------

/**
 * Maps a directory a CLI recorded onto one of the worktrees the app knows.
 *
 * Two things make this more than string equality. An agent may have been
 * started in a subdirectory, so a prefix has to count — but only on a path
 * boundary, or `/repo/app` would swallow `/repo/app-legacy`. And worktrees
 * routinely live inside their own project (`/repo/.worktrees/feature` under
 * `/repo`), so when several known paths match, the longest wins: usage belongs
 * to the worktree, not to the project containing it.
 *
 * Returns null when nothing matches, which is the normal case for the user's
 * work outside Parallel Code and means those counts are simply not shown.
 */
export function matchKnownPath(candidate: string, knownPaths: readonly string[]): string | null {
  let best: string | null = null;
  for (const known of knownPaths) {
    if (candidate !== known) {
      if (!candidate.startsWith(known)) continue;
      const nextChar = candidate.charAt(known.length);
      if (nextChar !== '/' && nextChar !== '\\') continue;
    }
    if (best === null || known.length > best.length) best = known;
  }
  return best;
}

// --------------------------------------------------------------------------
// Claude — ~/.claude/projects/<slug>/*.jsonl
// --------------------------------------------------------------------------

export interface ClaudeUsageRecord {
  /** `message.id:requestId`, or null when the record carries no identity. */
  dedupeKey: string | null;
  /** Absolute project path from the record's own `cwd`, or null. */
  cwd: string | null;
  totals: TokenTotals;
}

/**
 * Parses one line of a Claude Code session transcript.
 *
 * Only `message.usage` is read. `usage.iterations[]` is deliberately ignored:
 * measured across 1359 records carrying it, the iteration totals summed to
 * exactly the parent `usage` figures, so it is a breakdown of the same tokens
 * and adding it would double every count.
 *
 * Anthropic's `input_tokens` excludes cache reads and cache writes, so the four
 * fields are already disjoint and map across unchanged.
 */
export function parseClaudeUsageLine(line: string): ClaudeUsageRecord | null {
  const obj = parseJsonObjectLine(line);
  if (!obj) return null;

  const message = asRecord(obj['message']);
  // Newer transcripts nest usage under `message`; tolerate a top-level `usage`
  // too, since the shape has moved before and costs nothing to accept.
  const usage = asRecord(message?.['usage']) ?? asRecord(obj['usage']);
  if (!usage) return null;

  const totals: TokenTotals = {
    input: num(usage['input_tokens']),
    output: num(usage['output_tokens']),
    cacheRead: num(usage['cache_read_input_tokens']),
    cacheWrite: num(usage['cache_creation_input_tokens']),
  };
  if (isZeroTotals(totals)) return null;

  const messageId = message?.['id'];
  const requestId = obj['requestId'];
  const dedupeKey =
    typeof messageId === 'string' && messageId.length > 0
      ? `${messageId}:${typeof requestId === 'string' ? requestId : ''}`
      : null;

  const cwd = obj['cwd'];

  return {
    dedupeKey,
    cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : null,
    totals,
  };
}

/**
 * Folds a batch of Claude lines into per-path totals.
 *
 * `seen` is carried by the caller across incremental reads and across the files
 * of one project directory, because the duplicates are cross-file: resuming or
 * forking a session rewrites earlier assistant messages into the new
 * transcript. Measured on one project directory, 625 of 1369 usage records were
 * repeats — without this the totals are nearly double.
 *
 * Records with no `message.id` cannot be deduplicated and are counted once
 * each; that is the lesser error, since dropping them would silently lose real
 * usage.
 */
export function foldClaudeLines(
  lines: readonly string[],
  seen: Set<string>,
  fallbackCwd: string | null = null,
): { byPath: Map<string, TokenTotals>; skipped: number } {
  const byPath = new Map<string, TokenTotals>();
  let skipped = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const record = parseClaudeUsageLine(line);
    if (!record) {
      // Most lines in a transcript are user turns and tool results. Those are
      // not usage records and not failures; only a line that is not valid JSON
      // counts as skipped, so the number the UI shows means something.
      if (parseJsonObjectLine(line) === null) skipped++;
      continue;
    }
    if (record.dedupeKey !== null) {
      if (seen.has(record.dedupeKey)) continue;
      seen.add(record.dedupeKey);
    }
    const path = record.cwd ?? fallbackCwd;
    if (path === null) {
      skipped++;
      continue;
    }
    byPath.set(path, addTotals(byPath.get(path) ?? ZERO_TOTALS, record.totals));
  }

  return { byPath, skipped };
}

// --------------------------------------------------------------------------
// Codex — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// --------------------------------------------------------------------------

/**
 * Pulls the session working directory out of a rollout line.
 *
 * Three record shapes carry it: `session_meta` (first line of the file),
 * `turn_context`, and `event_msg/thread_settings_applied`. The first is the one
 * the head-read relies on; the others are accepted so a session that changed
 * directory mid-run still resolves.
 */
export function parseCodexCwdLine(line: string): string | null {
  const obj = parseJsonObjectLine(line);
  if (!obj) return null;
  const payload = asRecord(obj['payload']);
  if (!payload) return null;
  const direct = payload['cwd'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const threadSettings = asRecord(payload['thread_settings']);
  const nested = threadSettings?.['cwd'];
  return typeof nested === 'string' && nested.length > 0 ? nested : null;
}

/**
 * Pulls the running session total out of a `token_count` line.
 *
 * `info.total_token_usage` is cumulative for the session, so the last one in
 * the file is the answer for the whole file — which is why the reader only ever
 * needs the tail. Summing the per-turn `last_token_usage` instead over-counts:
 * measured on a 54 MB rollout it came to 129,617,191 against a true cumulative
 * 127,199,725, because retried turns emit their usage twice.
 *
 * OpenAI's `input_tokens` includes the cached prefix, so the cached portion is
 * subtracted out to keep `input` disjoint from `cacheRead` the way Anthropic
 * already reports it. `reasoning_output_tokens` is a subset of `output_tokens`
 * and is not added.
 */
export function parseCodexTotalLine(line: string): TokenTotals | null {
  const obj = parseJsonObjectLine(line);
  if (!obj) return null;
  const payload = asRecord(obj['payload']);
  if (!payload || payload['type'] !== 'token_count') return null;
  const info = asRecord(payload['info']);
  const total = asRecord(info?.['total_token_usage']);
  if (!total) return null;

  const cached = num(total['cached_input_tokens']);
  const rawInput = num(total['input_tokens']);
  return {
    input: Math.max(0, rawInput - cached),
    output: num(total['output_tokens']),
    cacheRead: cached,
    // Codex rollouts carry no cache-write counter; the field stays zero rather
    // than being guessed from another number.
    cacheWrite: 0,
  };
}

export interface CodexRolloutSummary {
  cwd: string | null;
  /** Last cumulative total seen, or null when the file has no token_count yet. */
  totals: TokenTotals | null;
  skipped: number;
}

/** Reduces rollout lines to the session cwd and its final cumulative total. */
export function foldCodexLines(lines: readonly string[]): CodexRolloutSummary {
  let cwd: string | null = null;
  let totals: TokenTotals | null = null;
  let skipped = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const obj = parseJsonObjectLine(line);
    if (!obj) {
      skipped++;
      continue;
    }
    const foundCwd = parseCodexCwdLine(line);
    if (foundCwd !== null) cwd = foundCwd;
    const foundTotals = parseCodexTotalLine(line);
    if (foundTotals !== null) totals = foundTotals;
  }

  return { cwd, totals, skipped };
}

// --------------------------------------------------------------------------
// Grok — ~/.grok/logs/unified.jsonl
// --------------------------------------------------------------------------

export type GrokRecord =
  | { kind: 'session'; sid: string; cwd: string }
  | { kind: 'usage'; sid: string; totals: TokenTotals };

/**
 * Classifies one line of grok's unified log.
 *
 * Unlike the other two, grok writes every session into one shared file, so the
 * working directory and the token counts arrive in different records joined by
 * `sid`: `session created` carries `ctx.cwd`, `shell.turn.inference_done`
 * carries the counts. Matching is on the presence of `ctx.prompt_tokens` rather
 * than on the exact `msg` string, so a renamed log message still counts.
 *
 * `prompt_tokens` includes the cached prefix (measured: it is never smaller
 * than `cached_prompt_tokens`), so the cached part is subtracted out.
 * `reasoning_tokens` is a subset of `completion_tokens` and is not added.
 */
export function parseGrokLine(line: string): GrokRecord | null {
  const obj = parseJsonObjectLine(line);
  if (!obj) return null;
  const sid = obj['sid'];
  if (typeof sid !== 'string' || sid.length === 0) return null;
  const ctx = asRecord(obj['ctx']);
  if (!ctx) return null;

  if (typeof ctx['prompt_tokens'] === 'number') {
    const cached = num(ctx['cached_prompt_tokens']);
    const prompt = num(ctx['prompt_tokens']);
    const totals: TokenTotals = {
      input: Math.max(0, prompt - cached),
      output: num(ctx['completion_tokens']),
      cacheRead: cached,
      cacheWrite: 0,
    };
    return isZeroTotals(totals) ? null : { kind: 'usage', sid, totals };
  }

  const cwd = ctx['cwd'];
  if (typeof cwd === 'string' && cwd.length > 0) return { kind: 'session', sid, cwd };

  return null;
}

/**
 * Folds grok lines into per-path totals.
 *
 * `sidToCwd` is owned by the caller so it survives incremental reads: the
 * `session created` record for a session sits far above the usage records that
 * reference it, and after the first read those earlier bytes are never read
 * again. Usage for a sid whose session record has not been seen is counted as
 * skipped rather than guessed onto some other path.
 */
export function foldGrokLines(
  lines: readonly string[],
  sidToCwd: Map<string, string>,
): { byPath: Map<string, TokenTotals>; skipped: number } {
  const byPath = new Map<string, TokenTotals>();
  let skipped = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const record = parseGrokLine(line);
    if (!record) {
      // Grok's unified log is mostly auth and model-catalog chatter; those are
      // not malformed, just uninteresting, and are not reported as skips.
      if (parseJsonObjectLine(line) === null) skipped++;
      continue;
    }
    if (record.kind === 'session') {
      sidToCwd.set(record.sid, record.cwd);
      continue;
    }
    const path = sidToCwd.get(record.sid);
    if (path === undefined) {
      skipped++;
      continue;
    }
    byPath.set(path, addTotals(byPath.get(path) ?? ZERO_TOTALS, record.totals));
  }

  return { byPath, skipped };
}

// --------------------------------------------------------------------------
// Monotonic counter accumulation
// --------------------------------------------------------------------------

/**
 * Folds a cumulative counter that may restart.
 *
 * Codex reports a session total that only grows — until it does not. A counter
 * going backwards means the source restarted (a compaction, a rewritten file),
 * and the tokens counted before the restart are still real, so the pre-restart
 * value is carried into a base rather than thrown away. When the counter simply
 * grew, the answer is the new value.
 */
export function accumulateMonotonic(
  previous: TokenTotals | null,
  carried: TokenTotals,
  next: TokenTotals,
): { carried: TokenTotals; total: TokenTotals } {
  if (previous !== null && sumTotals(next) < sumTotals(previous)) {
    const nextCarried = addTotals(carried, previous);
    return { carried: nextCarried, total: addTotals(nextCarried, next) };
  }
  return { carried, total: addTotals(carried, next) };
}

// --------------------------------------------------------------------------
// Aggregation
// --------------------------------------------------------------------------

export interface UsageContribution {
  path: string;
  provider: ProviderId;
  totals: TokenTotals;
}

export interface PathUsage {
  path: string;
  totals: TokenTotals;
  byProvider: Partial<Record<ProviderId, TokenTotals>>;
}

export interface UsageAggregate {
  paths: PathUsage[];
  totals: TokenTotals;
  byProvider: Partial<Record<ProviderId, TokenTotals>>;
}

/**
 * Merges per-provider contributions into the per-path table the UI renders.
 *
 * Rows are ordered by total tokens descending, then by path, so the table is
 * stable between refreshes and the busiest worktree is always first.
 */
export function aggregateUsage(contributions: readonly UsageContribution[]): UsageAggregate {
  const byPath = new Map<string, PathUsage>();
  let totals = ZERO_TOTALS;
  const byProvider: Partial<Record<ProviderId, TokenTotals>> = {};

  for (const c of contributions) {
    if (isZeroTotals(c.totals)) continue;
    const entry = byPath.get(c.path) ?? { path: c.path, totals: ZERO_TOTALS, byProvider: {} };
    entry.totals = addTotals(entry.totals, c.totals);
    entry.byProvider[c.provider] = addTotals(entry.byProvider[c.provider] ?? ZERO_TOTALS, c.totals);
    byPath.set(c.path, entry);

    totals = addTotals(totals, c.totals);
    byProvider[c.provider] = addTotals(byProvider[c.provider] ?? ZERO_TOTALS, c.totals);
  }

  const paths = [...byPath.values()].sort(
    (a, b) => sumTotals(b.totals) - sumTotals(a.totals) || a.path.localeCompare(b.path),
  );

  return { paths, totals, byProvider };
}
