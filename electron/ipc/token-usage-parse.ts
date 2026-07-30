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

import { protoPath, protoString, protoSubMessage, protoVarints } from './protobuf-scan.js';
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
 *
 * Pass `candidateExists: false` when the recorded directory is gone from disk;
 * see the comment in the body for why that has to disable the prefix rule.
 */
export function matchKnownPath(
  candidate: string,
  knownPaths: readonly string[],
  options: { candidateExists?: boolean } = {},
): string | null {
  // A directory that is no longer on disk is historical evidence, not a hint to
  // search upwards. Walking up would fold a deleted worktree's usage into
  // whichever surviving ancestor happens to be known — `/repo/.worktrees/gone`
  // silently inflating `/repo`, which is exactly the project layout this app
  // creates. Measured on this machine: 76 of 173 recorded Claude working
  // directories no longer exist, behind 10,953 usage records. An exact match is
  // still honoured, because that names the worktree rather than guessing at it.
  const exactOnly = options.candidateExists === false;

  let best: string | null = null;
  for (const known of knownPaths) {
    if (candidate !== known) {
      if (exactOnly) continue;
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

/**
 * Which service answered the request.
 *
 * Claude Code can be pointed at Google's Vertex AI instead of Anthropic's own
 * API, and when it is, the transcripts land in the same `~/.claude/projects`
 * tree with the same shape. They are a different account, a different quota and
 * a different bill, so folding them into one number describes nothing that
 * exists. Two markers identify them, either of which is sufficient: `_vrtx_`
 * inside the message id or request id, and the `@`-versioned model naming
 * (`claude-opus-4-8@20260514`) that only Vertex uses.
 */
export type ClaudeVendor = 'anthropic' | 'vertex';

export interface ClaudeUsageRecord {
  /** `message.id:requestId`, or null when the record carries no identity. */
  dedupeKey: string | null;
  /** Absolute project path from the record's own `cwd`, or null. */
  cwd: string | null;
  vendor: ClaudeVendor;
  totals: TokenTotals;
}

/** A deduplicated usage record, held per project directory. */
export interface ClaudeSeenRecord {
  path: string;
  vendor: ClaudeVendor;
  totals: TokenTotals;
}

/** True for an id, request id or model name that only Vertex AI produces. */
export function isVertexClaudeRecord(messageId: string, requestId: string, model: string): boolean {
  return messageId.includes('_vrtx_') || requestId.includes('_vrtx_') || model.includes('@');
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

  const messageId = typeof message?.['id'] === 'string' ? (message['id'] as string) : '';
  const rawRequestId = obj['requestId'];
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : '';
  const model = typeof message?.['model'] === 'string' ? (message['model'] as string) : '';
  const dedupeKey = messageId.length > 0 ? `${messageId}:${requestId}` : null;

  const cwd = obj['cwd'];

  return {
    dedupeKey,
    cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : null,
    vendor: isVertexClaudeRecord(messageId, requestId, model) ? 'vertex' : 'anthropic',
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
 *
 * The last occurrence of a key wins rather than the first. On this machine the
 * choice is worth exactly nothing — 36,268 usage records across 90 project
 * directories reduce to 18,362 keys, and every one of the 17,906 duplicates
 * carries a byte-identical usage value, so the two rules agree to 0.0000%. It
 * is here because it is also correct if a CLI ever streams a record and
 * rewrites it as the counts firm up, which is the behaviour CodexBar found on
 * its side. Holding the value instead of just the key is what makes that
 * possible, and it costs one small object per unique record.
 */
export function foldClaudeLines(
  lines: readonly string[],
  seen: Map<string, ClaudeSeenRecord>,
  fallbackCwd: string | null = null,
): { skipped: number } {
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
    const path = record.cwd ?? fallbackCwd;
    if (path === null) {
      skipped++;
      continue;
    }
    // A record with no identity cannot be deduplicated, so it gets a key that
    // can never collide and is counted once. `seen.size` only ever grows, which
    // is what makes that guarantee hold.
    const key = record.dedupeKey ?? ` anon:${seen.size}`;
    seen.set(key, { path, vendor: record.vendor, totals: record.totals });
  }

  return { skipped };
}

/**
 * Turns a directory's deduplicated records into per-path, per-vendor totals.
 *
 * Kept separate from the fold because the fold is called once per chunk of an
 * incremental read while this runs once per scan, over the whole directory.
 */
export function claudeTotalsByPath(
  seen: ReadonlyMap<string, ClaudeSeenRecord>,
): Map<string, Record<ClaudeVendor, TokenTotals>> {
  const byPath = new Map<string, Record<ClaudeVendor, TokenTotals>>();
  for (const record of seen.values()) {
    const entry = byPath.get(record.path) ?? { anthropic: ZERO_TOTALS, vertex: ZERO_TOTALS };
    entry[record.vendor] = addTotals(entry[record.vendor], record.totals);
    byPath.set(record.path, entry);
  }
  return byPath;
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
 * Normalises one of codex's usage objects.
 *
 * OpenAI's `input_tokens` includes the cached prefix, so the cached portion is
 * subtracted out to keep `input` disjoint from `cacheRead` the way Anthropic
 * already reports it. `reasoning_output_tokens` is a subset of `output_tokens`
 * and is not added.
 */
function codexUsage(raw: Record<string, unknown>): TokenTotals {
  const cached = num(raw['cached_input_tokens']);
  return {
    input: Math.max(0, num(raw['input_tokens']) - cached),
    output: num(raw['output_tokens']),
    cacheRead: cached,
    // Codex rollouts carry no cache-write counter; the field stays zero rather
    // than being guessed from another number.
    cacheWrite: 0,
  };
}

/** One `token_count` event: the running session total and that turn's own use. */
export interface CodexTokenEvent {
  /** Cumulative for the session, as codex reports it. */
  total: TokenTotals;
  /** What this turn alone used, or null when the record omits it. */
  last: TokenTotals | null;
  /** Epoch ms from the record's own `timestamp`, or null. */
  atMs: number | null;
}

export function parseCodexTokenEvent(line: string): CodexTokenEvent | null {
  const obj = parseJsonObjectLine(line);
  if (!obj) return null;
  const payload = asRecord(obj['payload']);
  if (!payload || payload['type'] !== 'token_count') return null;
  const info = asRecord(payload['info']);
  const total = asRecord(info?.['total_token_usage']);
  if (!total) return null;
  const last = asRecord(info?.['last_token_usage']);
  const timestamp = obj['timestamp'];
  const atMs = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;

  return {
    total: codexUsage(total),
    last: last ? codexUsage(last) : null,
    atMs: Number.isFinite(atMs) ? atMs : null,
  };
}

/** What the first line of a rollout says about the session it opens. */
export interface CodexSessionMeta {
  cwd: string | null;
  /** Epoch ms the rollout was created, or null. */
  startedAtMs: number | null;
  /**
   * True when this rollout was forked from another thread or spawned as a
   * subagent — meaning it opens with a replay of its parent's history.
   */
  inherited: boolean;
}

export function parseCodexSessionMeta(line: string): CodexSessionMeta | null {
  const obj = parseJsonObjectLine(line);
  if (!obj || obj['type'] !== 'session_meta') return null;
  const payload = asRecord(obj['payload']);
  if (!payload) return null;

  const source = asRecord(payload['source']);
  const inherited =
    typeof payload['forked_from_id'] === 'string' ||
    typeof payload['parent_thread_id'] === 'string' ||
    source?.['subagent'] !== undefined;

  const timestamp = obj['timestamp'] ?? payload['timestamp'];
  const startedAtMs = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;

  return {
    cwd: parseCodexCwdLine(line),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
    inherited,
  };
}

/**
 * How long after a rollout opens its replayed history is still arriving.
 *
 * A forked or subagent rollout begins by writing its parent's entire history
 * into the new file, `token_count` records included — measured here, one 770
 * event rollout shared its first 761 events with its parent, so counting them
 * charges the parent's whole session a second time. The replay is one
 * synchronous burst at session creation; real turns take seconds. Sweeping the
 * window against the cross-file ground truth on all 49 forked rollouts on this
 * machine: 1s got 48 right, 2s and 5s got all 49, 10s started swallowing
 * genuine first turns on 27 of them. 2s is the smallest exact value, so drift
 * in either direction fails towards counting a copied record rather than
 * discarding a real one — the same bias the Claude reader takes with records
 * that have no id.
 */
export const CODEX_REPLAY_WINDOW_MS = 2000;

/** True componentwise. Codex's counters advance independently. */
function totalsAtLeast(a: TokenTotals, b: TokenTotals): boolean {
  return (
    a.input >= b.input &&
    a.output >= b.output &&
    a.cacheRead >= b.cacheRead &&
    a.cacheWrite >= b.cacheWrite
  );
}

function subtractTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input - b.input,
    output: a.output - b.output,
    cacheRead: a.cacheRead - b.cacheRead,
    cacheWrite: a.cacheWrite - b.cacheWrite,
  };
}

function maxTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  };
}

/**
 * Everything a rollout reader has to remember between chunks.
 *
 * `watermark` is a componentwise high-water mark rather than the previous
 * reading, because that is what makes the interleaved case detectable.
 */
export interface CodexDeltaState {
  /** The directory in force for the events read so far. */
  cwd: string | null;
  watermark: TokenTotals | null;
  /** Latched once a reading falls below the watermark; never unlatches. */
  interleaved: boolean;
  sessionStartMs: number | null;
  /** Whether this rollout opens with a replay of a parent's history. */
  inherited: boolean;
  /** Set once the replay window has been left behind. */
  pastReplay: boolean;
  /**
   * Whether the rollout's own `session_meta` has been read.
   *
   * There can be more than one. A fork replays its parent's records verbatim
   * and the parent's `session_meta` is among them — so the second one seen
   * describes the *parent*: no fork marker, and a start time from whenever the
   * parent began. Letting it overwrite the first turns off the replay rule
   * exactly on the files that need it. Measured on this machine, that single
   * mistake left 784,610,389 tokens of replayed parent history being charged a
   * second time. Only the first `session_meta` is the identity of this file.
   */
  identified: boolean;
}

export function createCodexDeltaState(): CodexDeltaState {
  return {
    cwd: null,
    watermark: null,
    interleaved: false,
    sessionStartMs: null,
    inherited: false,
    pastReplay: false,
    identified: false,
  };
}

/**
 * What one `token_count` event added, given what has been seen before it.
 *
 * The cumulative counter is the authority on how much was really spent, but a
 * single cumulative number cannot be split — not by day, and not by worktree
 * when a session changes directory mid-run, which is the only reason this
 * feature exists. So the counter is differenced per event and the difference is
 * capped by that turn's own `last_token_usage`. A retry re-emits `last`, but the
 * cumulative counter does not advance twice, so on a retry the difference is
 * the smaller of the two and wins; that is what removes the 1.9% overshoot R3
 * measured from summing `last` while keeping per-event attribution.
 *
 * A reading below the watermark is deliberately *not* treated as a restart. It
 * can equally be a second fork lineage whose cumulative snapshots were written
 * into the same rollout, and re-baselining there would count the gap between
 * the lineages all over again. Instead the file latches as interleaved and
 * every later event falls back to its self-contained `last` value, which is
 * correct whichever lineage the event belongs to.
 */
export function codexEventDelta(
  state: Pick<CodexDeltaState, 'watermark' | 'interleaved' | 'inherited'>,
  event: CodexTokenEvent,
): { delta: TokenTotals; watermark: TokenTotals; interleaved: boolean } {
  const watermark = state.watermark;
  const advance = (delta: TokenTotals, interleaved: boolean) => ({
    delta,
    watermark: watermark === null ? event.total : maxTotals(watermark, event.total),
    interleaved,
  });

  // No baseline yet. The opening reading may already carry a whole inherited
  // session, so it establishes the baseline rather than being spent, and the
  // turn's own figure is what this event cost. All 16,794 `token_count` records
  // on this machine carry one; the fallback matters only if a CLI version stops
  // writing it, and it then keeps the reading for a session that started from
  // nothing and discards it for one that opened on someone else's history.
  if (watermark === null) {
    if (event.last !== null) return advance(event.last, state.interleaved);
    return advance(state.inherited ? ZERO_TOTALS : event.total, state.interleaved);
  }
  if (state.interleaved) return advance(event.last ?? ZERO_TOTALS, true);
  if (!totalsAtLeast(event.total, watermark)) return advance(event.last ?? ZERO_TOTALS, true);

  const totalsDelta = subtractTotals(event.total, watermark);
  if (event.last === null) return advance(totalsDelta, false);
  return advance(totalsAtLeast(event.last, totalsDelta) ? totalsDelta : event.last, false);
}

/**
 * Folds rollout lines into per-directory totals, advancing `state` in place.
 *
 * The directory is tracked as the file is walked — `session_meta`,
 * `turn_context` and `thread_settings_applied` all move it — so a session that
 * spans two worktrees is charged to each for the turns it actually ran there.
 */
export function foldCodexLines(
  lines: readonly string[],
  state: CodexDeltaState,
): { byPath: Map<string, TokenTotals>; skipped: number } {
  const byPath = new Map<string, TokenTotals>();
  let skipped = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (parseJsonObjectLine(line) === null) {
      skipped++;
      continue;
    }

    const meta = parseCodexSessionMeta(line);
    if (meta) {
      // Only the first one identifies this rollout; see `identified`.
      if (!state.identified) {
        state.identified = true;
        state.sessionStartMs = meta.startedAtMs;
        state.inherited = meta.inherited;
      }
      if (meta.cwd !== null) state.cwd = meta.cwd;
      continue;
    }

    const cwd = parseCodexCwdLine(line);
    if (cwd !== null) state.cwd = cwd;

    const event = parseCodexTokenEvent(line);
    if (event === null) continue;

    const { delta, watermark, interleaved } = codexEventDelta(state, event);
    state.watermark = watermark;
    state.interleaved = interleaved;

    if (isCodexReplayEvent(state, event)) continue;
    state.pastReplay = true;

    if (state.cwd === null || isZeroTotals(delta)) continue;
    byPath.set(state.cwd, addTotals(byPath.get(state.cwd) ?? ZERO_TOTALS, delta));
  }

  return { byPath, skipped };
}

/**
 * Whether this event belongs to the parent history a fork replayed into its own
 * file rather than to work this session did.
 *
 * Only the leading run counts: once one live event has been seen the session is
 * past its replay for good, so a later burst of fast turns is never mistaken
 * for one.
 */
function isCodexReplayEvent(state: CodexDeltaState, event: CodexTokenEvent): boolean {
  if (!state.inherited || state.pastReplay) return false;
  if (state.sessionStartMs === null || event.atMs === null) return false;
  return event.atMs - state.sessionStartMs <= CODEX_REPLAY_WINDOW_MS;
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
// Antigravity (agy) — ~/.gemini/antigravity-cli/conversations/<uuid>.db
// --------------------------------------------------------------------------
//
// The only provider here that does not write JSONL. Antigravity keeps one
// SQLite database per conversation, with the counters inside protobuf blobs in
// `gen_metadata` — one row per LLM generation. Field *numbers* are all the wire
// format carries, so the mapping below was recovered from the getters in the
// `agy` Go binary and then checked arithmetically against real data; see
// `AGY_STATS_*` and the drift check in `parseAgyGenerationBlob`.

/** `gen_metadata.data` → field 1 → field 4 is the `ModelUsageStats` message. */
const AGY_STATS_PATH = [1, 4] as const;

/** Field numbers inside `ModelUsageStats`. */
const AGY_STATS_INPUT = 2;
const AGY_STATS_OUTPUT = 3;
const AGY_STATS_CACHE_READ = 5;
const AGY_STATS_RESPONSE_OUTPUT = 9;
const AGY_STATS_THINKING_OUTPUT = 10;

/**
 * Where `trajectory_metadata_blob.data` keeps the workspace this conversation
 * ran in. Field 7 holds it at the top level; field 1 is a workspace submessage
 * whose own field 1 repeats it, and is used as a fallback so a layout change
 * that moves one of the two still resolves.
 */
const AGY_TRAJECTORY_WORKSPACE = 7;
const AGY_TRAJECTORY_WORKSPACE_MESSAGE = 1;
const AGY_WORKSPACE_URI = 1;

export interface AgyGeneration {
  totals: TokenTotals;
  /**
   * Whether this row carried the `response_output` / `thinking_output`
   * breakdown that the drift check relies on, and whether it added up.
   *
   * Null means the row reported no breakdown at all, so there was nothing to
   * check — not that the check passed.
   */
  breakdownOk: boolean | null;
}

/**
 * Turns one absolute `file://` URI into a path.
 *
 * Antigravity records the workspace as a URI, and a path containing a space or
 * a non-ASCII character arrives percent-encoded. A URI that will not decode is
 * rejected rather than half-decoded, because a mangled path would either match
 * no worktree (harmless) or, far worse, match the wrong one.
 */
export function agyWorkspacePath(uri: string): string | null {
  if (!uri.startsWith('file:///')) return null;
  const encoded = uri.slice('file://'.length);
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.length > 1 ? decoded.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * The directory a conversation ran in, from its one `trajectory_metadata_blob`
 * row, or null when the conversation records no workspace at all.
 *
 * That null is a real and common state rather than a parse failure: measured on
 * this machine, 5 of 9 conversations carry no workspace, all of them
 * single-generation sessions started outside any project. Their usage is real
 * but unattributable, and the caller reports it as skipped instead of guessing
 * a directory for it.
 */
export function parseAgyWorkspaceBlob(data: Uint8Array): string | null {
  const direct = protoString(data, AGY_TRAJECTORY_WORKSPACE);
  if (direct !== null) {
    const path = agyWorkspacePath(direct);
    if (path !== null) return path;
  }
  const nested = protoSubMessage(data, AGY_TRAJECTORY_WORKSPACE_MESSAGE);
  if (nested === null) return null;
  const uri = protoString(nested, AGY_WORKSPACE_URI);
  return uri === null ? null : agyWorkspacePath(uri);
}

/**
 * Decodes one `gen_metadata` row into token counts.
 *
 * Antigravity's `input_tokens` excludes the cached prefix — measured, 24 of 36
 * rows report a cache read larger than their input, which could not happen if
 * input contained it. So the four counters are already disjoint and map across
 * unchanged, the way Anthropic's do, with no subtraction.
 *
 * `cache_write_tokens` is deliberately absent. The `agy` binary names such a
 * getter but no row has ever been observed populating a field for it, so
 * inventing one from another number would be fabrication; the counter stays
 * zero, as it does for codex and grok.
 *
 * The returned `breakdownOk` is the schema-drift canary. Field numbers here are
 * inferred from a stripped Go binary with no `.proto` to check them against,
 * and the one independent piece of evidence that field 3 really is the output
 * count is that `response_output + thinking_output == output` — which holds on
 * all 36 rows on this machine. If a CLI release renumbers these fields, that
 * sum is what breaks first, and it breaks loudly instead of quietly returning
 * numbers from the wrong counters.
 */
export function parseAgyGenerationBlob(data: Uint8Array): AgyGeneration | null {
  const stats = protoPath(data, ...AGY_STATS_PATH);
  if (stats === null) return null;
  const values = protoVarints(stats);

  const output = values.get(AGY_STATS_OUTPUT) ?? 0;
  const totals: TokenTotals = {
    input: num(values.get(AGY_STATS_INPUT)),
    output: num(output),
    cacheRead: num(values.get(AGY_STATS_CACHE_READ)),
    cacheWrite: 0,
  };
  if (isZeroTotals(totals)) return null;

  const response = values.get(AGY_STATS_RESPONSE_OUTPUT);
  const thinking = values.get(AGY_STATS_THINKING_OUTPUT);
  // Only a row that reports the breakdown can be checked against it. A model
  // that stops reporting one is not evidence of drift, and failing it closed
  // would discard usage over a field that was merely optional.
  const breakdownOk =
    response === undefined && thinking === undefined
      ? null
      : num(response) + num(thinking) === output;

  return { totals, breakdownOk };
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
