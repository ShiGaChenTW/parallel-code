// Rendering logic for the Timeline tab.
//
// Separated from the component for the usual reason: vitest runs
// `environment: 'node'` with no DOM harness, so anything left inside a Solid
// component is untestable. TimelineRow is a plain data shape; the component
// maps rows to elements and does nothing else.

import type { TranscriptEvent, TranscriptEventKind } from '../ipc/types';

export interface TimelineRow {
  /** Stable key for the `<For>`, unique within a render. */
  id: string;
  /** Local wall-clock time, `HH:MM:SS`. */
  time: string;
  /** Local date, shown only on the first row of each day. */
  dateHeading: string | null;
  kind: TranscriptEventKind;
  /** Short kind/status label, e.g. `step · implementing`. */
  label: string;
  summary: string;
  detail: string | null;
  /** True when redaction fired — the UI marks the row so masking is visible. */
  redacted: boolean;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format the timestamp for display, tolerating a line whose `ts` did not
 * survive whatever wrote it. An unparseable timestamp shows as `--:--:--`
 * rather than `Invalid Date`, and never throws in a render path.
 */
export function formatTranscriptTime(ts: string): string {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '--:--:--';
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function dateKey(ts: string): string | null {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * Turn stored events into display rows.
 *
 * Events arrive oldest-first, which is the order a timeline reads in. A date
 * heading is emitted whenever the local day changes, so a task worked on across
 * several days is legible without every row carrying a full date.
 */
export function toTimelineRows(events: readonly TranscriptEvent[]): TimelineRow[] {
  let lastDate: string | null = null;
  return events.map((event, index) => {
    const day = dateKey(event.ts);
    const dateHeading = day !== null && day !== lastDate ? day : null;
    if (day !== null) lastDate = day;
    return {
      id: `${index}:${event.ts}`,
      time: formatTranscriptTime(event.ts),
      dateHeading,
      kind: event.kind,
      label: `${event.kind} · ${event.status}`,
      summary: event.summary,
      detail: event.detail ?? null,
      redacted: Array.isArray(event.redacted) && event.redacted.length > 0,
    };
  });
}

/**
 * What the pane says when it has no rows.
 *
 * Two different empty states, deliberately distinguished: "recording is off" is
 * a thing you can fix, and telling someone "no events yet" when the feature was
 * never switched on is how a user concludes the feature is broken.
 */
export function transcriptEmptyMessage(enabled: boolean): string {
  return enabled
    ? 'No events recorded for this task yet.'
    : 'Session transcripts are off. Turn on Settings → Privacy → Record session transcripts to start recording this task.';
}

/** Summary line for the pane header: how much is here, and was anything masked. */
export function transcriptSummaryLine(events: readonly TranscriptEvent[]): string {
  if (events.length === 0) return '';
  const masked = events.filter((e) => Array.isArray(e.redacted) && e.redacted.length > 0).length;
  const base = events.length === 1 ? '1 event' : `${events.length} events`;
  if (masked === 0) return base;
  return `${base} · ${masked} with redacted content`;
}
