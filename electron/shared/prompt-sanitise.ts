import { stripAnsi } from './prompt-detect.js';

/**
 * Content-layer sanitisation for prompts that reach another agent's PTY without
 * a human pressing the keys.
 *
 * Why this exists: a coordinator can read attacker-controlled text out of one
 * task (`get_task_output` / `get_task_diff`) and forward it into another task's
 * terminal, where the receiving CLI interprets the bytes as literal keystrokes.
 * Bracketed paste is NOT a boundary here — it stops the target's line editor
 * treating newlines as Enter, but the raw bytes still reach the PTY, and a
 * payload can close the paste bracket itself with ESC[201~.
 *
 * This module is deliberately pure so it can be unit tested without a PTY, and
 * lives in `electron/shared/` next to `prompt-detect.ts` because the delivery
 * path and the readiness detector share the same escape-sequence vocabulary.
 *
 * Scope note: this is the CONTENT layer only. It does not authorise the caller.
 * `writeToAgent` still has no per-caller authorisation — that is tracked
 * separately and is not addressed here.
 */

/**
 * Control characters removed after `stripAnsi` has taken out well-formed escape
 * sequences. Keeps TAB (U+0009) and LF (U+000A) because legitimate multi-line
 * prompts need them — every other C0 control, DEL, and the whole C1 block are
 * keystrokes or escape introducers, never content. U+009B in particular is the
 * 8-bit CSI introducer, which `stripAnsi` already treats as hostile.
 */
// eslint-disable-next-line no-control-regex -- the point of this module is to remove control characters.
const RESIDUAL_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Line separator normalisation. CR is Enter when it reaches a PTY, so a payload
 * carrying `\r` can submit a line the coordinator never intended to send.
 * CRLF and lone CR both collapse to LF, which preserves the text's line
 * structure while removing the CR byte.
 */
const LINE_SEPARATORS = /\r\n|\r/g;

/**
 * Provenance header prefixed to prompts delivered by automation rather than by
 * the human at the keyboard. Its absence is the signal that matters: after this
 * change, an unmarked message in a sub-agent's transcript came from the human UI.
 *
 * Deliberately a single line of plain declarative text. It issues no
 * instruction, because the receiving CLI reads it as ordinary prompt content
 * and cannot be relied on to treat it as metadata.
 */
export const AUTOMATED_PROMPT_PROVENANCE =
  '[parallel-code] Sent by the coordinator agent through send_prompt; not typed by the human operator.';

/**
 * Byte budget the provenance header is allowed to add on top of the caller's
 * prompt. Callers size their own limits against `MAX_PROMPT_BYTES + this`.
 */
export const MAX_PROVENANCE_HEADER_BYTES = 256;

export interface AutomatedPrompt {
  /** Sanitised prompt with no provenance header. Empty means the payload was all control characters. */
  body: string;
  /** Full payload to write to the PTY: header + body when marked, otherwise the body. */
  text: string;
  /** Characters dropped by sanitisation, before trimming. Zero means the payload was already clean. */
  removed: number;
}

/**
 * Strip everything that would be interpreted as a keystroke or an escape
 * sequence rather than as text. Idempotent: sanitising an already-sanitised
 * string returns it unchanged, so it is safe to apply again at the delivery
 * boundary as a backstop.
 */
export function sanitisePromptBody(raw: string): string {
  return scrub(raw).trim();
}

/** The removal pipeline, untrimmed, so callers can measure what it dropped. */
function scrub(raw: string): string {
  return stripAnsi(raw).replace(LINE_SEPARATORS, '\n').replace(RESIDUAL_CONTROL_CHARS, '');
}

/**
 * Build the payload for a prompt delivered by automation: sanitise the body,
 * then attach the provenance header.
 *
 * Callers must check `body` for emptiness and reject rather than deliver a
 * lone header — a payload that sanitises away to nothing was pure control
 * characters, which is exactly the case worth refusing loudly.
 */
export function buildAutomatedPrompt(
  raw: string,
  opts: { withProvenance: boolean },
): AutomatedPrompt {
  const preTrim = scrub(raw);
  const body = preTrim.trim();
  return {
    body,
    text: opts.withProvenance && body ? `${AUTOMATED_PROMPT_PROVENANCE}\n${body}` : body,
    removed: raw.length - preTrim.length,
  };
}
