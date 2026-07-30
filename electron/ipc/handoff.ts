import fs from 'fs';
import path from 'path';
import type { BrowserWindow } from 'electron';
import { IPC } from './channels.js';
import { appendGitInfoExcludeBlock } from './git-exclude.js';
import { debug as logDebug, warn as logWarn, error as logError, errMessage } from '../log.js';

/**
 * Watches `.claude/handoff.md` — one agent's structured handoff to the next.
 *
 * Deliberately the same shape as `steps.ts` (directory watch, 200ms debounce,
 * parent-watch until `.claude/` exists, automatic git exclude), because it is
 * the same problem: a file an agent writes into the worktree while the app is
 * running. What is *not* copied from `steps.ts` is the host-clock timestamp
 * backfill and its write-back — a handoff is prose with no event timeline, and
 * the app writing into a file whose only author is the agent would risk
 * clobbering a write in flight.
 */

interface HandoffWatcher {
  fsWatcher: fs.FSWatcher | null;
  timeout: ReturnType<typeof setTimeout> | null;
  handoffDir: string;
  handoffFile: string;
}

const watchers = new Map<string, HandoffWatcher>();

const HANDOFF_FILE_NAME = 'handoff.md';

/**
 * Ceiling on rendered handoff size.
 *
 * Neither `steps.ts` nor `plans.ts` caps its file, so this is the one place
 * that intentionally departs from the copied pattern. Handoff content is fed
 * through marked → shiki → DOMPurify and into the DOM; an agent that loops
 * while appending would otherwise stall the renderer. 256 KB is generous for
 * prose (the mobile notes route allows 100 KB) while still being a bound.
 */
export const MAX_HANDOFF_BYTES = 256 * 1024;

const TRUNCATION_NOTICE = '\n\n> _Handoff truncated — the file exceeds 256 KB._\n';

/** Built from code points: a raw NUL or U+FFFD in source is invisible in review. */
const NUL = String.fromCharCode(0);
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/**
 * Normalises raw file bytes into renderable markdown, or null for "no handoff".
 *
 * Markdown has no grammar to fail on, so "parsing" here means the four
 * judgements that would otherwise be scattered through the watcher and the
 * component: an empty or whitespace-only file is the same as no file (agents
 * commonly touch before writing); a BOM would stop a leading `#` from being a
 * heading; CRLF is normalised so the renderer sees one line ending; and content
 * past the ceiling is truncated at a line boundary with a visible marker.
 *
 * NUL bytes mean the file is not text at all — treated as absent rather than
 * rendered, since a partially-written binary blob is never a handoff.
 */
export function parseHandoffContent(raw: string): string | null {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (withoutBom.includes(NUL)) return null;

  const normalized = withoutBom.replace(/\r\n?/g, '\n');
  if (normalized.trim().length === 0) return null;

  if (Buffer.byteLength(normalized, 'utf8') <= MAX_HANDOFF_BYTES) return normalized;
  return `${truncateToBytes(normalized, MAX_HANDOFF_BYTES)}${TRUNCATION_NOTICE}`;
}

/**
 * Cuts a string to at most `maxBytes` of UTF-8 without leaving a broken
 * character or a half-written line. Decoding a byte slice that splits a
 * multi-byte sequence yields a trailing U+FFFD, which is dropped; the result is
 * then rewound to the last newline when there is one.
 */
function truncateToBytes(value: string, maxBytes: number): string {
  const sliced = Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8');
  const whole = sliced.endsWith(REPLACEMENT_CHAR) ? sliced.slice(0, -1) : sliced;
  const lastNewline = whole.lastIndexOf('\n');
  return lastNewline > 0 ? whole.slice(0, lastNewline + 1) : whole;
}

/** Reads and normalises `.claude/handoff.md`. Returns the content or null. */
function readHandoffFile(handoffFile: string): string | null {
  try {
    const raw = fs.readFileSync(handoffFile, 'utf-8');
    return parseHandoffContent(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // ENOENT is the normal "no handoff yet" case. Anything else (corrupt
      // file, permissions) deserves the full stack.
      logError('handoff', 'failed to read handoff file', e);
    }
    return null;
  }
}

/** Sends the current handoff content for a task to the renderer. */
function sendHandoffContent(win: BrowserWindow, taskId: string, handoffFile: string): void {
  if (win.isDestroyed()) return;
  const content = readHandoffFile(handoffFile);
  win.webContents.send(IPC.HandoffContent, { taskId, content });
}

/**
 * Registers `.claude/handoff.md` in the worktree's git exclude file, so a
 * handoff never shows up as an untracked file in the user's diff. Same
 * mechanism as `ensureStepsIgnored` in steps.ts.
 */
function ensureHandoffIgnored(worktreePath: string): void {
  appendGitInfoExcludeBlock(worktreePath, '.claude/handoff.md', '.claude/handoff.md\n', (err) => {
    logWarn('handoff', 'failed to update git exclude', { err: errMessage(err) });
  });
}

/**
 * Watches the `.claude` directory for changes to `handoff.md`.
 *
 * Watches the directory rather than the file because `fs.watch` on a single
 * file is unreliable with atomic writes (temp-file-then-rename), especially on
 * macOS. Changes are debounced 200ms before reading.
 *
 * If `.claude/` doesn't exist yet, the worktree root is watched until it
 * appears, then the watcher swaps over — the same trick steps.ts uses, chosen
 * over the 3s directory poll in plans.ts because there is only one directory to
 * wait for and it needs no timer.
 */
export function startHandoffWatcher(
  win: BrowserWindow,
  taskId: string,
  worktreePath: string,
): void {
  stopHandoffWatcher(taskId);
  ensureHandoffIgnored(worktreePath);

  const handoffDir = path.join(worktreePath, '.claude');
  const handoffFile = path.join(handoffDir, HANDOFF_FILE_NAME);

  const entry: HandoffWatcher = {
    fsWatcher: null,
    timeout: null,
    handoffDir,
    handoffFile,
  };

  // filename may be null on some platforms; when present, filter to handoff.md
  // — `.claude/` also holds steps.json and settings.local.json.
  const onChange = (event: string, filename: string | Buffer | null) => {
    logDebug('handoff', 'watch event', { taskId, event, filename: String(filename) });
    if (filename !== null && filename !== HANDOFF_FILE_NAME) return;
    const current = watchers.get(taskId);
    if (!current) return;
    if (current.timeout) clearTimeout(current.timeout);
    current.timeout = setTimeout(() => {
      current.timeout = null;
      sendHandoffContent(win, taskId, current.handoffFile);
    }, 200);
  };

  if (fs.existsSync(handoffDir)) {
    attachHandoffDirWatcher(entry, taskId, onChange);
  } else {
    try {
      const parentWatcher = fs.watch(worktreePath, (_event, filename) => {
        if (filename !== '.claude') return;
        if (!fs.existsSync(handoffDir)) return;
        parentWatcher.close();
        const current = watchers.get(taskId);
        if (!current) return;
        attachHandoffDirWatcher(current, taskId, onChange);
        if (fs.existsSync(handoffFile)) {
          sendHandoffContent(win, taskId, handoffFile);
        }
      });
      parentWatcher.on('error', (err) => {
        logError('handoff', 'parent watcher error', err, { worktreePath });
      });
      entry.fsWatcher = parentWatcher;
    } catch (err) {
      logError('handoff', 'failed to watch worktree root', err, { worktreePath });
    }
  }

  watchers.set(taskId, entry);

  // Initial read to catch a handoff written before the watcher was set up.
  if (fs.existsSync(handoffFile)) {
    sendHandoffContent(win, taskId, handoffFile);
  }
}

/** Attaches an fs.watch on the `.claude` directory and stores it on the entry. */
function attachHandoffDirWatcher(
  entry: HandoffWatcher,
  taskId: string,
  onChange: (event: string, filename: string | Buffer | null) => void,
): void {
  try {
    const watcher = fs.watch(entry.handoffDir, onChange);
    watcher.on('error', (err) => {
      logError('handoff', 'watcher error', err, { handoffDir: entry.handoffDir });
    });
    entry.fsWatcher = watcher;
    watchers.set(taskId, entry);
  } catch (err) {
    logError('handoff', 'failed to watch handoff dir', err, { handoffDir: entry.handoffDir });
  }
}

/** Stops and removes the handoff watcher for a given task. */
export function stopHandoffWatcher(taskId: string): void {
  const entry = watchers.get(taskId);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  if (entry.fsWatcher) entry.fsWatcher.close();
  watchers.delete(taskId);
}

/** Reads handoff.md from a worktree. Used for one-shot restore after a restart. */
export function readHandoffForWorktree(worktreePath: string): string | null {
  return readHandoffFile(path.join(worktreePath, '.claude', HANDOFF_FILE_NAME));
}

/** Stops all handoff watchers. */
export function stopAllHandoffWatchers(): void {
  for (const taskId of watchers.keys()) {
    stopHandoffWatcher(taskId);
  }
}
