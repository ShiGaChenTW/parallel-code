import { describe, expect, it } from 'vitest';

import {
  formatTranscriptTime,
  toTimelineRows,
  transcriptEmptyMessage,
  transcriptSummaryLine,
} from './transcript-timeline';
import { translate, type Locale } from './i18n';
import type { TranscriptEvent } from '../ipc/types';

function event(over: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    v: 1,
    ts: new Date(2026, 6, 31, 14, 5, 9).toISOString(),
    taskId: 't1',
    kind: 'step',
    status: 'implementing',
    summary: 'wrote the writer',
    ...over,
  };
}

describe('formatTranscriptTime', () => {
  it('renders local wall-clock time zero-padded', () => {
    expect(formatTranscriptTime(new Date(2026, 6, 31, 4, 5, 6).toISOString())).toBe('04:05:06');
  });

  it('degrades rather than throwing on a timestamp that did not survive', () => {
    // Rendering must never be the thing that fails on a damaged line.
    expect(formatTranscriptTime('not-a-date')).toBe('--:--:--');
    expect(formatTranscriptTime('')).toBe('--:--:--');
  });
});

describe('toTimelineRows', () => {
  it('keeps the stored order — a timeline reads forwards', () => {
    const rows = toTimelineRows([
      event({ summary: 'first' }),
      event({ summary: 'second', ts: new Date(2026, 6, 31, 14, 6, 0).toISOString() }),
    ]);
    expect(rows.map((r) => r.summary)).toEqual(['first', 'second']);
  });

  it('labels each row with its kind and status', () => {
    expect(toTimelineRows([event({ kind: 'merge', status: 'merged' })])[0].label).toBe(
      'merge · merged',
    );
  });

  it('emits a date heading only when the local day changes', () => {
    const rows = toTimelineRows([
      event({ ts: new Date(2026, 6, 30, 23, 59, 0).toISOString() }),
      event({ ts: new Date(2026, 6, 31, 0, 1, 0).toISOString() }),
      event({ ts: new Date(2026, 6, 31, 9, 0, 0).toISOString() }),
    ]);
    expect(rows.map((r) => r.dateHeading)).toEqual(['2026-07-30', '2026-07-31', null]);
  });

  it('flags a row whose content was masked, so redaction is visible not silent', () => {
    const rows = toTimelineRows([event({ redacted: ['anthropic-api-key'] }), event()]);
    expect(rows.map((r) => r.redacted)).toEqual([true, false]);
  });

  it('treats an empty redacted array as not redacted', () => {
    expect(toTimelineRows([event({ redacted: [] })])[0].redacted).toBe(false);
  });

  it('normalises a missing detail to null rather than undefined', () => {
    expect(toTimelineRows([event()])[0].detail).toBeNull();
    expect(toTimelineRows([event({ detail: 'src/a.ts' })])[0].detail).toBe('src/a.ts');
  });

  it('gives every row a distinct key even when timestamps collide', () => {
    const rows = toTimelineRows([event(), event(), event()]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('handles an empty transcript', () => {
    expect(toTimelineRows([])).toEqual([]);
  });
});

describe('transcriptEmptyMessage', () => {
  it('distinguishes "nothing yet" from "not recording"', () => {
    expect(transcriptEmptyMessage(true)).toContain('No events recorded');
    expect(transcriptEmptyMessage(false)).toContain('are off');
  });

  it('tells the user where the switch is, so the empty state is actionable', () => {
    expect(transcriptEmptyMessage(false)).toContain('Settings → Privacy');
  });
});

describe('transcriptSummaryLine', () => {
  /** What the pane renders: the descriptor translated into `locale`. */
  const line = (locale: Locale, events: Parameters<typeof transcriptSummaryLine>[0]): string => {
    const summary = transcriptSummaryLine(events);
    return summary === null ? '' : translate(locale, summary.text, summary.params);
  };

  it('says nothing when there is nothing', () => {
    expect(transcriptSummaryLine([])).toBeNull();
    expect(line('en', [])).toBe('');
  });

  it('counts events, singular and plural', () => {
    expect(line('en', [event()])).toBe('1 event');
    expect(line('en', [event(), event()])).toBe('2 events');
  });

  it('surfaces how many rows were masked', () => {
    expect(line('en', [event({ redacted: ['jwt'] }), event()])).toBe(
      '2 events · 1 with redacted content',
    );
  });

  it('translates, because the count is a slot rather than a concatenated number', () => {
    expect(line('zh-TW', [event({ redacted: ['jwt'] }), event()])).toBe(
      '2 筆事件 · 其中 1 筆內容被遮蔽',
    );
  });
});
