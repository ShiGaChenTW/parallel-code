// AI CLI token usage — reads the usage records the CLIs already write locally.
//
// Zero network. Every byte comes from a file under the user's home directory
// that the CLI wrote itself; there is no `fetch`, no spawned command, and no
// vendor API. That is deliberate and load-bearing: asking a provider for
// account usage would need API keys the app does not hold, and would add a
// tenth entry to `OUTBOUND_SURFACES` weeks after the product committed to
// full-offline operation (PRD §13 Q3). This file leaves that list untouched.
//
// Watching follows the directory-watch + debounce shape already used by
// `steps.ts` and `handoff.ts` — the app's third use of it, so it is copied
// rather than reinvented. What differs is scale: these logs are hundreds of
// megabytes and never stop growing, so nothing here re-reads a whole file when
// it can avoid it. See `rescan` for how each provider stays incremental.
//
// What is read, precisely: JSON lines are parsed, four integer token fields and
// a directory path are taken out of them, and the parsed object is dropped. No
// prompt text, no code, no tool output is retained, logged, or sent anywhere.
// The only values that leave this module are integers and absolute paths that
// the renderer already knows because they are its own worktrees.

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BrowserWindow } from 'electron';
import { IPC } from './channels.js';
import { debug as logDebug, warn as logWarn, errMessage } from '../log.js';
import type {
  ProviderId,
  TokenTotals,
  TokenUsageProviderStatus,
  TokenUsageSnapshot,
} from './shared-types.js';
import {
  ZERO_TOTALS,
  accumulateMonotonic,
  addTotals,
  aggregateUsage,
  claudeProjectSlug,
  foldClaudeLines,
  foldCodexLines,
  foldGrokLines,
  matchKnownPath,
  splitCompleteLines,
  type UsageContribution,
} from './token-usage-parse.js';

const PROVIDERS: readonly ProviderId[] = ['claude', 'codex', 'grok'];

/** Debounce before a rescan, matching the 200ms used by steps/handoff, doubled
 *  because an active agent appends to these files far more often than it
 *  rewrites `steps.json`. */
const DEBOUNCE_MS = 400;

/** Bytes of a codex rollout read from the front, to find `session_meta.cwd`.
 *  It is the first line of the file; 8 KB is several times its observed size. */
const CODEX_HEAD_BYTES = 8 * 1024;

/** Bytes of a codex rollout read from the end, to find the last cumulative
 *  `token_count`. Rollouts reach 50 MB+ and the counter is cumulative, so the
 *  tail is all that is ever needed. Sized well above the largest observed gap
 *  between consecutive token_count records. */
const CODEX_TAIL_BYTES = 256 * 1024;

/** Chunk size for the append-oriented readers. Bounds peak memory when a file
 *  is read for the first time — a 24 MB transcript directory is normal. */
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

function homeDir(): string {
  return os.homedir();
}

export function claudeProjectsDir(): string {
  return path.join(homeDir(), '.claude', 'projects');
}

export function codexSessionsDir(): string {
  return path.join(homeDir(), '.codex', 'sessions');
}

export function grokLogFile(): string {
  return path.join(homeDir(), '.grok', 'logs', 'unified.jsonl');
}

// ---------------------------------------------------------------------------
// Low-level bounded reads
// ---------------------------------------------------------------------------

/** True for the errors that mean "this CLI is not installed", which is normal. */
function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Reads `length` bytes starting at `position`.
 *
 * The decoded string may begin or end mid-character; every caller either drops
 * the leading partial line or carries the trailing one forward, so no partial
 * character ever reaches a parser.
 */
async function readSlice(file: string, position: number, length: number): Promise<string> {
  if (length <= 0) return '';
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Reads `[from, to)` in bounded chunks, handing each batch of whole lines to
 * `onLines`, and returns the trailing partial line.
 *
 * Chunking matters because the first read of a project directory can be tens of
 * megabytes and the main process must not hold all of it at once.
 */
async function readLineRange(
  file: string,
  from: number,
  to: number,
  carryIn: string,
  onLines: (lines: string[]) => void,
): Promise<string> {
  const handle = await fsp.open(file, 'r');
  let carry = carryIn;
  try {
    const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(1, to - from)));
    let position = from;
    while (position < to) {
      const want = Math.min(buffer.length, to - position);
      const { bytesRead } = await handle.read(buffer, 0, want, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const { lines, remainder } = splitCompleteLines(
        carry + buffer.subarray(0, bytesRead).toString('utf8'),
      );
      carry = remainder;
      if (lines.length > 0) onLines(lines);
    }
  } finally {
    await handle.close();
  }
  return carry;
}

// ---------------------------------------------------------------------------
// Per-provider incremental state
// ---------------------------------------------------------------------------

/**
 * What has already been consumed from an append-only file.
 *
 * `ino` is the rotation detector and `offset` the truncation detector. If the
 * inode changed, the name now points at a different file and everything counted
 * from the old one has to go. If the file is shorter than what we already read,
 * it was truncated or rewritten in place and the same applies. Either way the
 * fix is identical: forget this file's contribution and read it again from
 * zero. Under-counting after a rotation would be silent and permanent;
 * re-reading is merely slow, and only once.
 */
interface AppendState {
  ino: number;
  offset: number;
  remainder: string;
}

interface ClaudeFileState extends AppendState {
  byPath: Map<string, TokenTotals>;
}

interface CodexFileState {
  size: number;
  mtimeMs: number;
  cwd: string | null;
  /** Last cumulative reading, for restart detection. */
  previous: TokenTotals | null;
  /** Tokens counted before a counter restart. */
  carried: TokenTotals;
  total: TokenTotals;
}

interface GrokState extends AppendState {
  sidToCwd: Map<string, string>;
  byPath: Map<string, TokenTotals>;
}

/** Per-file read state. Survives watcher restarts (the known-path set changes
 *  whenever a task opens or closes) so a re-subscribe costs nothing. */
const claudeFiles = new Map<string, ClaudeFileState>();
/** Dedupe keys per project directory. The duplicates are cross-file — resuming
 *  a session rewrites earlier assistant messages into a new transcript — so the
 *  set has to outlive any single file's state. */
const claudeSeen = new Map<string, Set<string>>();
const codexFiles = new Map<string, CodexFileState>();
let grokState: GrokState | null = null;

const skippedByProvider = new Map<ProviderId, number>();

/** Drops every cached read. Exported for tests and used when the app quits. */
export function resetTokenUsageState(): void {
  claudeFiles.clear();
  claudeSeen.clear();
  codexFiles.clear();
  grokState = null;
  skippedByProvider.clear();
}

function addSkipped(provider: ProviderId, n: number): void {
  if (n > 0) skippedByProvider.set(provider, (skippedByProvider.get(provider) ?? 0) + n);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

/**
 * Reads only the project directories that correspond to worktrees the app
 * knows about.
 *
 * `~/.claude/projects` holds 592 MB across 3659 transcripts on the machine this
 * was built against; the app's own worktrees account for 25 MB of it. Deriving
 * the directory name from each known path and reading only those is what makes
 * this affordable, and it also means transcripts for unrelated work are never
 * opened at all.
 */
async function scanClaude(knownPaths: readonly string[]): Promise<{
  contributions: UsageContribution[];
  status: TokenUsageProviderStatus;
}> {
  const root = claudeProjectsDir();
  const contributions: UsageContribution[] = [];

  let rootExists = true;
  try {
    await fsp.access(root);
  } catch {
    rootExists = false;
  }
  if (!rootExists) {
    return {
      contributions,
      status: { provider: 'claude', present: false, skipped: 0 },
    };
  }

  for (const known of knownPaths) {
    const dir = path.join(root, claudeProjectSlug(known));
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch (err) {
      // A worktree the user has never run Claude in simply has no directory.
      if (!isMissing(err)) {
        logWarn('token-usage', 'claude dir read failed', { err: errMessage(err) });
      }
      continue;
    }

    const transcripts: { file: string; stat: fs.Stats }[] = [];
    let rotated = false;
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      transcripts.push({ file, stat });
      const previous = claudeFiles.get(file);
      if (previous && (previous.ino !== stat.ino || stat.size < previous.offset)) rotated = true;
    }

    if (rotated) {
      // A transcript was rotated or truncated. The dedupe set is shared across
      // the whole directory, so re-reading only the affected file would drop
      // every record whose id is still remembered from the copy that is gone —
      // silent under-counting. Resetting the directory costs one re-read and
      // cannot be wrong.
      claudeSeen.delete(dir);
      for (const { file } of transcripts) claudeFiles.delete(file);
    }

    const seen = claudeSeen.get(dir) ?? new Set<string>();
    claudeSeen.set(dir, seen);

    for (const { file, stat } of transcripts) {
      let state = claudeFiles.get(file);
      if (!state) {
        state = { ino: stat.ino, offset: 0, remainder: '', byPath: new Map() };
        claudeFiles.set(file, state);
      }

      if (stat.size > state.offset) {
        const active = state;
        try {
          active.remainder = await readLineRange(
            file,
            active.offset,
            stat.size,
            active.remainder,
            (lines) => {
              const { byPath, skipped } = foldClaudeLines(lines, seen, known);
              addSkipped('claude', skipped);
              for (const [p, t] of byPath) {
                active.byPath.set(p, addTotals(active.byPath.get(p) ?? ZERO_TOTALS, t));
              }
            },
          );
          active.offset = stat.size;
        } catch (err) {
          logWarn('token-usage', 'claude file read failed', { err: errMessage(err) });
        }
      }

      for (const [recorded, t] of state.byPath) {
        const target = matchKnownPath(recorded, knownPaths);
        if (target !== null) contributions.push({ path: target, provider: 'claude', totals: t });
      }
    }
  }

  return {
    contributions,
    status: { provider: 'claude', present: true, skipped: skippedByProvider.get('claude') ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/** Every `rollout-*.jsonl` under the date-partitioned sessions tree. */
async function listCodexRollouts(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name.endsWith('.jsonl')) found.push(full);
    }
  };
  await walk(root, 0);
  return found;
}

/**
 * Two-phase read, because a rollout's working directory is inside the file.
 *
 * Phase one reads 8 KB from the front of any rollout whose directory is not
 * already cached — `session_meta` is line one — which costs about 2 MB across
 * the whole tree and, once cached, never repeats for that file. Phase two reads
 * 256 KB from the end, and only for rollouts that belong to a known worktree
 * and have changed since last time. The tail is enough because
 * `total_token_usage` is cumulative, so the last record in the file is the
 * answer for the entire file however large it has grown.
 *
 * The cost of this shape is that a rollout whose `cwd` changes mid-session
 * keeps the directory it was created in unless a `turn_context` happens to fall
 * inside the tail window. Sessions do not normally move, and the alternative is
 * re-reading half a gigabyte on every keystroke.
 */
async function scanCodex(knownPaths: readonly string[]): Promise<{
  contributions: UsageContribution[];
  status: TokenUsageProviderStatus;
}> {
  const root = codexSessionsDir();
  const contributions: UsageContribution[] = [];

  let files: string[];
  try {
    await fsp.access(root);
    files = await listCodexRollouts(root);
  } catch {
    return { contributions, status: { provider: 'codex', present: false, skipped: 0 } };
  }

  const live = new Set<string>();

  for (const file of files) {
    live.add(file);
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
    } catch {
      continue;
    }

    let state = codexFiles.get(file);
    if (!state) {
      state = {
        size: -1,
        mtimeMs: -1,
        cwd: null,
        previous: null,
        carried: ZERO_TOTALS,
        total: ZERO_TOTALS,
      };
      codexFiles.set(file, state);
    }

    if (state.cwd === null) {
      try {
        const head = await readSlice(file, 0, CODEX_HEAD_BYTES);
        state.cwd = foldCodexLines(splitCompleteLines(head).lines).cwd;
      } catch (err) {
        if (!isMissing(err)) {
          logWarn('token-usage', 'codex head read failed', { err: errMessage(err) });
        }
        continue;
      }
    }

    const target = state.cwd === null ? null : matchKnownPath(state.cwd, knownPaths);
    if (target === null) continue;

    const changed = stat.size !== state.size || stat.mtimeMs !== state.mtimeMs;
    if (changed) {
      try {
        const from = Math.max(0, stat.size - CODEX_TAIL_BYTES);
        const tail = await readSlice(file, from, stat.size - from);
        // Drop the first line when we started mid-file: it is a fragment.
        const raw = tail.split('\n');
        const lines = from > 0 ? raw.slice(1) : raw;
        const summary = foldCodexLines(lines);
        addSkipped('codex', summary.skipped);
        if (summary.cwd !== null) state.cwd = summary.cwd;
        if (summary.totals !== null) {
          const next = accumulateMonotonic(state.previous, state.carried, summary.totals);
          state.previous = summary.totals;
          state.carried = next.carried;
          state.total = next.total;
        }
        state.size = stat.size;
        state.mtimeMs = stat.mtimeMs;
      } catch (err) {
        logWarn('token-usage', 'codex tail read failed', { err: errMessage(err) });
      }
    }

    const resolved = state.cwd === null ? null : matchKnownPath(state.cwd, knownPaths);
    if (resolved !== null) {
      contributions.push({ path: resolved, provider: 'codex', totals: state.total });
    }
  }

  // Forget rollouts that have been deleted, so state does not grow forever.
  for (const key of [...codexFiles.keys()]) {
    if (!live.has(key)) codexFiles.delete(key);
  }

  return {
    contributions,
    status: { provider: 'codex', present: true, skipped: skippedByProvider.get('codex') ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Grok
// ---------------------------------------------------------------------------

/**
 * One shared append-only log for every grok session, so this is the
 * straightforward incremental case: read the bytes that arrived since last
 * time, carry the partial trailing line, and keep the sid→cwd table alive
 * because the `session created` record for a session sits far above the usage
 * records that reference it and will never be read again.
 *
 * A rotation resets that table too — which is correct rather than merely
 * convenient, since a rotated log's early records are gone and any surviving
 * usage line whose session record went with them must not be attributed by
 * guesswork.
 */
async function scanGrok(knownPaths: readonly string[]): Promise<{
  contributions: UsageContribution[];
  status: TokenUsageProviderStatus;
}> {
  const file = grokLogFile();
  const contributions: UsageContribution[] = [];

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    return { contributions, status: { provider: 'grok', present: false, skipped: 0 } };
  }

  if (grokState && (grokState.ino !== stat.ino || stat.size < grokState.offset)) {
    grokState = null;
  }
  if (!grokState) {
    grokState = {
      ino: stat.ino,
      offset: 0,
      remainder: '',
      sidToCwd: new Map(),
      byPath: new Map(),
    };
  }
  const state = grokState;

  if (stat.size > state.offset) {
    try {
      state.remainder = await readLineRange(
        file,
        state.offset,
        stat.size,
        state.remainder,
        (lines) => {
          const { byPath, skipped } = foldGrokLines(lines, state.sidToCwd);
          addSkipped('grok', skipped);
          for (const [p, t] of byPath) {
            state.byPath.set(p, addTotals(state.byPath.get(p) ?? ZERO_TOTALS, t));
          }
        },
      );
      state.offset = stat.size;
    } catch (err) {
      logWarn('token-usage', 'grok read failed', { err: errMessage(err) });
      return {
        contributions,
        status: { provider: 'grok', present: true, skipped: 0, error: errMessage(err) },
      };
    }
  }

  for (const [recorded, t] of state.byPath) {
    const target = matchKnownPath(recorded, knownPaths);
    if (target !== null) contributions.push({ path: target, provider: 'grok', totals: t });
  }

  return {
    contributions,
    status: { provider: 'grok', present: true, skipped: skippedByProvider.get('grok') ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Builds the current snapshot for a set of known worktree paths.
 *
 * A provider that throws for any reason contributes nothing and is reported
 * with an `error`; one whose directory is absent is reported `present: false`,
 * which the UI states plainly rather than treating as a fault. Neither stops
 * the other two.
 */
export async function buildTokenUsageSnapshot(
  knownPaths: readonly string[],
): Promise<TokenUsageSnapshot> {
  const scanners: Record<
    ProviderId,
    (paths: readonly string[]) => Promise<{
      contributions: UsageContribution[];
      status: TokenUsageProviderStatus;
    }>
  > = { claude: scanClaude, codex: scanCodex, grok: scanGrok };

  const contributions: UsageContribution[] = [];
  const providers: TokenUsageProviderStatus[] = [];

  for (const provider of PROVIDERS) {
    try {
      const result = await scanners[provider](knownPaths);
      contributions.push(...result.contributions);
      providers.push(result.status);
    } catch (err) {
      logWarn('token-usage', 'provider scan failed', { provider, err: errMessage(err) });
      providers.push({ provider, present: true, skipped: 0, error: errMessage(err) });
    }
  }

  const aggregate = aggregateUsage(contributions);
  return {
    paths: aggregate.paths,
    totals: aggregate.totals,
    byProvider: aggregate.byProvider,
    providers,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

interface WatchSet {
  watchers: fs.FSWatcher[];
  timeout: ReturnType<typeof setTimeout> | null;
  knownPaths: string[];
  scanning: boolean;
  /** A change arrived while a scan was running; run once more when it ends. */
  dirty: boolean;
  disposed: boolean;
}

let active: WatchSet | null = null;

/**
 * Directories worth watching.
 *
 * Watched individually rather than recursively: `fs.watch` with
 * `recursive: true` is an FSEvents stream on macOS but a recursive inotify
 * setup on Linux, and pointing that at 3659 transcript files is not something
 * to do for a usage counter. The codex tree is date-partitioned, so today's day
 * directory is watched directly and its parents are watched so tomorrow's
 * directory appearing is itself an event.
 */
function watchTargets(knownPaths: readonly string[]): string[] {
  const targets = new Set<string>();
  const claudeRoot = claudeProjectsDir();
  targets.add(claudeRoot);
  for (const known of knownPaths) {
    targets.add(path.join(claudeRoot, claudeProjectSlug(known)));
  }

  const codexRoot = codexSessionsDir();
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  targets.add(codexRoot);
  targets.add(path.join(codexRoot, year));
  targets.add(path.join(codexRoot, year, month));
  targets.add(path.join(codexRoot, year, month, day));

  targets.add(path.dirname(grokLogFile()));

  return [...targets];
}

function attachWatchers(set: WatchSet, onChange: () => void): void {
  for (const watcher of set.watchers) watcher.close();
  set.watchers = [];
  for (const dir of watchTargets(set.knownPaths)) {
    try {
      const watcher = fs.watch(dir, onChange);
      // A log directory can vanish while the app runs (a CLI uninstalled, a
      // rotation that removes the day directory). That is not an error, and it
      // must not take the process down through an unhandled 'error' event.
      watcher.on('error', (err) => {
        logDebug('token-usage', 'watcher error', { dir, err: errMessage(err) });
      });
      set.watchers.push(watcher);
    } catch {
      // Directory does not exist — the CLI is not installed, or has not run
      // today. Normal; the parent directory's watcher will fire when it appears.
    }
  }
}

function sendSnapshot(win: BrowserWindow, snapshot: TokenUsageSnapshot): void {
  if (win.isDestroyed()) return;
  win.webContents.send(IPC.TokenUsageUpdate, snapshot);
}

/**
 * Starts (or re-seeds) the usage watchers and returns the current snapshot.
 *
 * Called again whenever the renderer's set of worktrees changes. Cached read
 * state is module-level and deliberately survives that, so re-seeding costs a
 * directory listing rather than a re-read.
 */
export async function startTokenUsageWatcher(
  win: BrowserWindow,
  knownPaths: readonly string[],
): Promise<TokenUsageSnapshot> {
  const set: WatchSet = active ?? {
    watchers: [],
    timeout: null,
    knownPaths: [],
    scanning: false,
    dirty: false,
    disposed: false,
  };
  set.knownPaths = [...knownPaths];
  set.disposed = false;
  active = set;

  const rescan = (): void => {
    if (set.disposed) return;
    if (set.scanning) {
      set.dirty = true;
      return;
    }
    set.scanning = true;
    buildTokenUsageSnapshot(set.knownPaths)
      .then((snapshot) => {
        if (!set.disposed) sendSnapshot(win, snapshot);
      })
      .catch((err: unknown) => {
        logWarn('token-usage', 'rescan failed', { err: errMessage(err) });
      })
      .finally(() => {
        set.scanning = false;
        // Watchers are re-attached after each scan so a new codex day directory
        // or a newly created project directory starts being watched without a
        // separate timer.
        if (!set.disposed) attachWatchers(set, onChange);
        if (set.dirty && !set.disposed) {
          set.dirty = false;
          rescan();
        }
      });
  };

  const onChange = (): void => {
    if (set.disposed) return;
    if (set.timeout) clearTimeout(set.timeout);
    set.timeout = setTimeout(() => {
      set.timeout = null;
      rescan();
    }, DEBOUNCE_MS);
  };

  attachWatchers(set, onChange);
  return buildTokenUsageSnapshot(set.knownPaths);
}

export function stopTokenUsageWatcher(): void {
  if (!active) return;
  active.disposed = true;
  if (active.timeout) clearTimeout(active.timeout);
  for (const watcher of active.watchers) watcher.close();
  active.watchers = [];
  active = null;
}
