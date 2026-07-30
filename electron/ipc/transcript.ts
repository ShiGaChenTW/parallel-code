// Session transcript — a timestamped, replayable lifecycle sequence on disk.
//
// Before this existed, everything the app knew about a task's life was live and
// ephemeral: `StepEntry` arrays in renderer state, attention transitions
// computed on the fly, a fixed 64KB terminal ring buffer. Restart the app and
// it was gone. This module is the durable half.
//
// ## Storage shape
//
// One append-only JSONL file per task: `<transcriptDir>/<taskId>.jsonl`. Not a
// field in `state.json` — that blob is a single JSON document rewritten in full
// through temp+rename on a 1s debounce, so an unbounded transcript would bloat
// every autosave and widen the crash window on every save. Not the user's
// worktree either: staying inside the application data directory means there is
// no `.gitignore` question to get wrong.
//
// ## Posture
//
// Off by default, and the default is the whole point. `trace.ts` sets the house
// style — `SAFE_FOR_TRACE` is empty, opt-in only — and a feature that records
// what your agents said has no business being quieter about it than the IPC
// tracer is. `appendTranscriptEvent` returns `false` without touching the
// filesystem while the switch is off; the directory is not even created.
//
// ## Layering
//
// Nothing here imports `electron`. The store takes its directory as a
// constructor argument, so the whole module is exercisable in vitest's
// `environment: 'node'` against a real temp directory — the same pure-function
// style as `log.ts`. Wiring resolves the real path (see `register.ts`).

import fs from 'fs';
import path from 'path';
import { redactSecrets } from './redact.js';
import type { TranscriptEvent, TranscriptEventKind } from './shared-types.js';

export type { TranscriptEvent, TranscriptEventKind };

/** Bumped only on a breaking change to the on-disk line shape. */
export const TRANSCRIPT_FORMAT_VERSION = 1;

/**
 * The event vocabulary, deliberately borrowed rather than invented. Each kind
 * maps to a detection module that already existed and already knew this:
 *
 *  - `agent`     — spawn/exit, from the agents store
 *  - `step`      — the six `StepEntry` stages (shared-types.ts)
 *  - `attention` — ready / needs_input / error (desktopNotifications.ts)
 *  - `merge`     — merge counts (completion.ts)
 *  - `pr-checks` — GitHub CI polling (pr-checks.ts)
 *  - `commit`    — branch commit polling (task-commit-polling.ts)
 *
 * The runtime guard lives next to the compile-time union it validates:
 * `satisfies` fails the build if a kind is added to one and not the other.
 */
export const TRANSCRIPT_EVENT_KINDS = [
  'agent',
  'step',
  'attention',
  'merge',
  'pr-checks',
  'commit',
] as const satisfies readonly TranscriptEventKind[];

export interface TranscriptLimits {
  /** Hard cap on events kept per task. */
  maxEvents: number;
  /** Hard cap on event age, globally. */
  maxAgeMs: number;
  /**
   * How far past `maxEvents` a file may grow before it is compacted back down.
   *
   * Compaction rewrites the whole file, so compacting on every append past the
   * cap would turn an O(1) append into an O(n) rewrite forever. With slack, the
   * rewrite is amortised across `slack` appends. The user-visible guarantee is
   * still exactly `maxEvents`, because `readTranscript` applies the cap on the
   * way out regardless of what the file transiently holds.
   */
  compactionSlack: number;
}

export const DEFAULT_TRANSCRIPT_LIMITS: TranscriptLimits = {
  maxEvents: 5000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  compactionSlack: 500,
};

// --- The switch -------------------------------------------------------------

// Default false so a first run — and every existing install — records nothing
// until the user asks for it. Mirrors `offline.ts`: main reads the persisted
// value at startup rather than waiting for a renderer round-trip, so there is
// no window in which the app is recording because a message was in flight.
let enabled = false;

export function isTranscriptEnabled(): boolean {
  return enabled;
}

export function setTranscriptEnabled(next: boolean): void {
  enabled = next;
}

/**
 * Read the persisted switch out of a raw `state.json` payload.
 *
 * Anything unparseable, absent, or merely truthy yields `false`. A corrupt
 * state file must not be able to turn recording *on* — consent has to be a
 * literal `true`, not a coincidence.
 */
export function parsePersistedTranscriptEnabled(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    return (parsed as Record<string, unknown>)['transcriptEnabled'] === true;
  } catch {
    return false;
  }
}

// --- Pure helpers -----------------------------------------------------------

/**
 * Task ids are `crypto.randomUUID()` in practice, but this value arrives over
 * IPC and is concatenated into a filesystem path, so it is validated as if it
 * were hostile: a conservative character class, a length bound, and an explicit
 * refusal of the two relative names a character class alone would let through.
 */
const TASK_ID_SHAPE = /^[A-Za-z0-9._-]{1,128}$/;

export function sanitiseTranscriptTaskId(taskId: unknown): string | null {
  if (typeof taskId !== 'string') return null;
  if (!TASK_ID_SHAPE.test(taskId)) return null;
  if (taskId === '.' || taskId === '..') return null;
  return taskId;
}

const MAX_SUMMARY_LEN = 512;
const MAX_DETAIL_LEN = 4096;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + '…' : value;
}

/**
 * Validate and normalise an event that arrived over IPC.
 *
 * The timestamp is stamped here, in main, and any caller-supplied `ts` is
 * ignored. Two reasons: a renderer clock is not the file's clock, and events
 * appended in the order main received them must also *read back* in that order
 * — retention trims by position, and a file whose lines are not monotonic makes
 * "the last 5000 events" a meaningless phrase. A step's own timestamp is not
 * lost; the emitter puts it in `detail`.
 *
 * Returns `null` for anything malformed rather than throwing: this sits behind
 * an IPC handler, and a renderer bug should drop one event, not raise into the
 * dispatch path.
 */
export function normaliseTranscriptEvent(raw: unknown, now: Date): TranscriptEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;

  const taskId = sanitiseTranscriptTaskId(v.taskId);
  if (taskId === null) return null;

  const kind = v.kind;
  if (typeof kind !== 'string') return null;
  if (!(TRANSCRIPT_EVENT_KINDS as readonly string[]).includes(kind)) return null;

  const status = typeof v.status === 'string' ? clip(v.status, 64) : '';
  if (status.length === 0) return null;

  const summary = typeof v.summary === 'string' ? clip(v.summary, MAX_SUMMARY_LEN) : '';
  if (summary.length === 0) return null;

  const detail =
    typeof v.detail === 'string' && v.detail ? clip(v.detail, MAX_DETAIL_LEN) : undefined;

  return {
    v: TRANSCRIPT_FORMAT_VERSION,
    ts: now.toISOString(),
    taskId,
    kind: kind as TranscriptEventKind,
    status,
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Mask known secret shapes in every free-text field.
 *
 * Called by `append` immediately before serialising — never after. Scanning a
 * file after the fact is not redaction, it is an apology: the bytes already
 * landed, already hit the page cache, and on a copy-on-write filesystem may
 * still be recoverable after the rewrite.
 */
export function redactTranscriptEvent(event: TranscriptEvent): TranscriptEvent {
  const summary = redactSecrets(event.summary);
  const detail = event.detail === undefined ? null : redactSecrets(event.detail);

  const fired = [...new Set([...summary.rules, ...(detail?.rules ?? [])])];
  if (fired.length === 0) return event;

  return {
    ...event,
    summary: summary.text,
    ...(detail === null ? {} : { detail: detail.text }),
    redacted: fired,
  };
}

/** One JSONL line, newline included. Newlines inside fields are JSON-escaped. */
export function serialiseTranscriptEvent(event: TranscriptEvent): string {
  return JSON.stringify(event) + '\n';
}

export interface ParsedTranscript {
  events: TranscriptEvent[];
  /** Lines that were not a usable event. A torn tail counts here, not as an error. */
  skipped: number;
}

/**
 * Parse a JSONL body, tolerating damage.
 *
 * An append-only file that a process was killed mid-write into will have a
 * truncated last line. That is a normal end state, not corruption, and it must
 * cost exactly one event — never the whole file. Every line is parsed
 * independently and anything unusable is counted and dropped.
 */
export function parseTranscriptJsonl(text: string): ParsedTranscript {
  const events: TranscriptEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    const event = parseTranscriptLine(line);
    if (event === null) skipped += 1;
    else events.push(event);
  }
  return { events, skipped };
}

function parseTranscriptLine(line: string): TranscriptEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  if (typeof v.ts !== 'string' || typeof v.taskId !== 'string') return null;
  if (typeof v.kind !== 'string' || !(TRANSCRIPT_EVENT_KINDS as readonly string[]).includes(v.kind))
    return null;
  if (typeof v.summary !== 'string' || typeof v.status !== 'string') return null;
  return {
    v: typeof v.v === 'number' ? v.v : TRANSCRIPT_FORMAT_VERSION,
    ts: v.ts,
    taskId: v.taskId,
    kind: v.kind as TranscriptEventKind,
    status: v.status,
    summary: v.summary,
    ...(typeof v.detail === 'string' ? { detail: v.detail } : {}),
    ...(Array.isArray(v.redacted)
      ? { redacted: v.redacted.filter((r) => typeof r === 'string') }
      : {}),
  };
}

/**
 * Apply both retention rules. Both are enforced, and whichever bites first wins:
 * an event is kept only if it is inside the age window *and* among the newest
 * `maxEvents`. A busy task hits the count cap in hours; an idle one is trimmed
 * by the age cap after a month.
 *
 * Unparseable timestamps are treated as expired. A line whose `ts` is not a date
 * cannot be shown on a timeline and cannot be aged out later, so keeping it
 * would mean keeping it forever.
 */
export function applyTranscriptRetention(
  events: readonly TranscriptEvent[],
  limits: TranscriptLimits,
  now: Date,
): TranscriptEvent[] {
  const cutoff = now.getTime() - limits.maxAgeMs;
  const withinAge = events.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= cutoff;
  });
  return withinAge.length > limits.maxEvents ? withinAge.slice(-limits.maxEvents) : withinAge;
}

// --- The store --------------------------------------------------------------

/**
 * Append-only JSONL storage rooted at a directory the caller supplies.
 *
 * Every method is failure-tolerant by design. A transcript is a diagnostic
 * convenience; a full disk or a permissions problem must degrade it to silence,
 * never break a merge or a spawn. Errors are reported through the return value
 * so the caller can log, and never thrown into a UI path.
 */
export class TranscriptStore {
  private readonly limits: TranscriptLimits;
  /** Line counts since this process last touched each file, for amortised compaction. */
  private readonly lineCounts = new Map<string, number>();

  constructor(
    private readonly dir: string,
    limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS,
  ) {
    this.limits = limits;
  }

  fileFor(taskId: string): string {
    return path.join(this.dir, `${taskId}.jsonl`);
  }

  /**
   * Redact, then write. Returns false when nothing was written — because the
   * switch is off, because the event was malformed, or because the filesystem
   * refused.
   */
  append(event: TranscriptEvent, now: Date = new Date()): boolean {
    if (!enabled) return false;
    if (sanitiseTranscriptTaskId(event.taskId) === null) return false;

    const safe = redactTranscriptEvent(event);
    const file = this.fileFor(event.taskId);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(file, serialiseTranscriptEvent(safe), 'utf8');
    } catch {
      return false;
    }

    const count = (this.lineCounts.get(event.taskId) ?? this.countLines(file)) + 1;
    this.lineCounts.set(event.taskId, count);
    if (count > this.limits.maxEvents + this.limits.compactionSlack) {
      this.compact(event.taskId, now);
    }
    return true;
  }

  /** Newest-last, with retention applied so a stale file cannot outlive its policy. */
  read(taskId: string, now: Date = new Date()): TranscriptEvent[] {
    if (sanitiseTranscriptTaskId(taskId) === null) return [];
    let text: string;
    try {
      text = fs.readFileSync(this.fileFor(taskId), 'utf8');
    } catch {
      return [];
    }
    return applyTranscriptRetention(parseTranscriptJsonl(text).events, this.limits, now);
  }

  /** Rewrite one task's file with only the events retention says to keep. */
  compact(taskId: string, now: Date = new Date()): void {
    const file = this.fileFor(taskId);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const kept = applyTranscriptRetention(parseTranscriptJsonl(text).events, this.limits, now);
    const body = kept.map(serialiseTranscriptEvent).join('');
    // temp+rename so a crash mid-compaction leaves the previous file intact.
    // The append path stays a plain O_APPEND write; only this rare path pays.
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, file);
      this.lineCounts.set(taskId, kept.length);
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* temp may not exist */
      }
    }
  }

  /**
   * Delete every transcript. Backs the Settings "clear transcripts" action.
   * Returns how many files went, so the UI can say something true.
   */
  clear(): number {
    let removed = 0;
    for (const name of this.listFiles()) {
      try {
        fs.unlinkSync(path.join(this.dir, name));
        removed += 1;
      } catch {
        /* already gone, or not ours to delete */
      }
    }
    this.lineCounts.clear();
    return removed;
  }

  /**
   * Enforce the global age window across every file, including tasks that will
   * never be written to again. Run at startup: without it, the count cap alone
   * would keep a dead task's last 5000 events forever, and "30 days" would be a
   * claim the code does not honour.
   *
   * A file whose every event has aged out is deleted rather than left empty.
   */
  sweep(now: Date = new Date()): number {
    let touched = 0;
    for (const name of this.listFiles()) {
      const taskId = name.slice(0, -'.jsonl'.length);
      const before = this.read(taskId, new Date(0));
      const after = applyTranscriptRetention(before, this.limits, now);
      if (after.length === before.length) continue;
      touched += 1;
      if (after.length === 0) {
        try {
          fs.unlinkSync(path.join(this.dir, name));
          this.lineCounts.delete(taskId);
        } catch {
          /* already gone */
        }
        continue;
      }
      this.compact(taskId, now);
    }
    return touched;
  }

  private listFiles(): string[] {
    try {
      return fs.readdirSync(this.dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return [];
    }
  }

  private countLines(file: string): number {
    try {
      return parseTranscriptJsonl(fs.readFileSync(file, 'utf8')).events.length;
    } catch {
      return 0;
    }
  }
}

// --- Process-wide instance --------------------------------------------------
//
// One store per process, created once the real directory is known. It lives
// here rather than in `register.ts` so the remote HTTP server can reach it
// without importing the IPC registration module (which would pull Electron into
// a module the remote surface has no business depending on).

let sharedStore: TranscriptStore | null = null;

export function initTranscriptStore(
  dir: string,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS,
): TranscriptStore {
  sharedStore = new TranscriptStore(dir, limits);
  return sharedStore;
}

/** Null before startup wiring runs — callers degrade to "no transcript". */
export function getTranscriptStore(): TranscriptStore | null {
  return sharedStore;
}

/**
 * Validate, redact and append one event that arrived over IPC.
 *
 * Returns false — silently, never throwing — when the switch is off, the store
 * is not wired yet, or the payload was malformed. A dropped transcript event is
 * never worth failing the caller's operation over.
 */
export function appendTranscriptEvent(raw: unknown, now: Date = new Date()): boolean {
  if (!enabled) return false;
  const store = sharedStore;
  if (store === null) return false;
  const event = normaliseTranscriptEvent(raw, now);
  if (event === null) return false;
  return store.append(event, now);
}
