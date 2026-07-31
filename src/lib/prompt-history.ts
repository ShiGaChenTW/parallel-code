/**
 * The record of every prompt the user submitted inside one task.
 *
 * The store only ever kept `lastPrompt` — one string, overwritten on each send —
 * which answers "what did I just ask" and nothing else. This is the same funnel
 * widened to a list, so the task can answer "what have I asked, and where in the
 * terminal did each of those land".
 *
 * Two things submit a prompt, and both are here:
 *
 *  - `composer` — the prompt box, i.e. `sendPrompt` in `store/tasks.ts`. The
 *    initial prompt filled in at task creation also arrives this way: the
 *    renderer auto-send calls the same function.
 *  - `terminal` — text typed straight into xterm and ended with Enter, which
 *    `TerminalView`'s `onPromptDetected` already reconstructs and which never
 *    passes through `sendPrompt` at all.
 *
 * Entries are session-only by design; see `TaskPromptHistoryPanel` for why.
 *
 * The entry is a typed object rather than a bare string on purpose. Everything a
 * later action would need to act on one prompt — the text as submitted, the
 * agent it went to, when, and where it came from — is already on it, so adding
 * an action to a row is a new button and not a new data model.
 */

/** How a prompt reached the agent. */
export type PromptOrigin = 'composer' | 'terminal';

export interface PromptHistoryEntry {
  /** Per-task, monotonic. Doubles as the terminal marker key, so it must not be
   *  a list index: the cap drops entries from the front. */
  readonly id: number;
  /** The prompt exactly as the user submitted it, before any steps instruction
   *  is appended — what they wrote is what the history should show. */
  readonly text: string;
  /** The agent it was sent to. A task can have several. */
  readonly agentId: string;
  /** Epoch ms at submission. */
  readonly at: number;
  readonly origin: PromptOrigin;
}

/**
 * How many prompts one task keeps.
 *
 * Well past a long session's worth, and the ceiling exists only so a
 * days-long coordinator task cannot grow the list without bound. The terminal
 * scrollback runs out long before this does, so entries this old are almost
 * certainly unjumpable text by the time the cap reaches them.
 */
export const PROMPT_HISTORY_LIMIT = 200;

/** Preview length. Two lines at the panel's width, near enough. */
const PREVIEW_MAX = 160;

// C0/C1 control bytes + DEL. A pasted prompt can carry them, and the panel
// renders previews as plain text — same treatment terminal bookmarks give their
// labels.
// eslint-disable-next-line no-control-regex -- intentionally matching control chars
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Whether this submission belongs in the history.
 *
 * The terminal rule is the interesting one. Every Enter-terminated line typed
 * into a TUI agent comes through the same detector, so `y`, `n` and `2` answers
 * to the agent's own menus arrive looking exactly like prompts. One character is
 * never a prompt worth navigating back to, and it is the shape those answers
 * take; anything longer is kept, because guessing harder than that would start
 * dropping real prompts. The composer has no such ambiguity — text was typed
 * into a box and a send button was pressed — so a one-character send is honoured.
 */
export function isRecordablePrompt(text: string, origin: PromptOrigin): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return origin === 'composer' || trimmed.length > 1;
}

/** Next id for a task's history. One past the highest, never a length. */
export function nextPromptId(history: readonly PromptHistoryEntry[] | undefined): number {
  let max = 0;
  for (const entry of history ?? []) if (entry.id > max) max = entry.id;
  return max + 1;
}

/** History with `entry` appended, oldest dropped once `limit` is exceeded. */
export function appendPromptEntry(
  history: readonly PromptHistoryEntry[] | undefined,
  entry: PromptHistoryEntry,
  limit: number = PROMPT_HISTORY_LIMIT,
): PromptHistoryEntry[] {
  const next = [...(history ?? []), entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * One-line preview of a prompt.
 *
 * Returns empty when nothing printable survives, rather than a placeholder: the
 * caller renders a translated fallback, and this module cannot read the locale.
 */
export function promptPreview(text: string, max: number = PREVIEW_MAX): string {
  const flat = text.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

/** Submission time as zero-padded local `HH:MM`. */
export function promptTimeLabel(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
