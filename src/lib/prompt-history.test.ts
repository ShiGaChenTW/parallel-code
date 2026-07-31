import { describe, expect, it } from 'vitest';
import {
  PROMPT_HISTORY_LIMIT,
  appendPromptEntry,
  isRecordablePrompt,
  nextPromptId,
  promptPreview,
  promptTimeLabel,
  type PromptHistoryEntry,
} from './prompt-history';

function entry(over: Partial<PromptHistoryEntry> = {}): PromptHistoryEntry {
  return {
    id: 1,
    text: 'hello',
    agentId: 'agent-1',
    at: 1_700_000_000_000,
    origin: 'composer',
    ...over,
  };
}

describe('isRecordablePrompt', () => {
  it('records ordinary composer prompts', () => {
    expect(isRecordablePrompt('fix the failing test', 'composer')).toBe(true);
  });

  it('records ordinary prompts typed straight into the terminal', () => {
    expect(isRecordablePrompt('fix the failing test', 'terminal')).toBe(true);
  });

  it('rejects blank and whitespace-only text from either origin', () => {
    expect(isRecordablePrompt('', 'composer')).toBe(false);
    expect(isRecordablePrompt('   \n\t ', 'composer')).toBe(false);
    expect(isRecordablePrompt('  ', 'terminal')).toBe(false);
  });

  // Typing into a TUI agent goes through the same funnel as a real prompt, so
  // every "y", "2", "n" answer to a menu would otherwise land in the history.
  it('rejects single-character terminal input as a menu answer, not a prompt', () => {
    expect(isRecordablePrompt('y', 'terminal')).toBe(false);
    expect(isRecordablePrompt('2', 'terminal')).toBe(false);
  });

  it('keeps single-character text sent from the composer, which is deliberate', () => {
    expect(isRecordablePrompt('y', 'composer')).toBe(true);
  });
});

describe('nextPromptId', () => {
  it('starts at 1 for an empty history', () => {
    expect(nextPromptId([])).toBe(1);
    expect(nextPromptId(undefined)).toBe(1);
  });

  it('is one past the highest id, so ids stay unique after the cap drops entries', () => {
    expect(nextPromptId([entry({ id: 7 }), entry({ id: 3 })])).toBe(8);
  });
});

describe('appendPromptEntry', () => {
  it('appends in submission order', () => {
    const one = entry({ id: 1, text: 'first' });
    const two = entry({ id: 2, text: 'second' });
    expect(appendPromptEntry([one], two).map((e) => e.text)).toEqual(['first', 'second']);
  });

  it('appends to an absent history', () => {
    expect(appendPromptEntry(undefined, entry())).toHaveLength(1);
  });

  it('drops the oldest entries once the cap is reached', () => {
    const history = Array.from({ length: 3 }, (_, i) => entry({ id: i + 1 }));
    const capped = appendPromptEntry(history, entry({ id: 4 }), 3);
    expect(capped.map((e) => e.id)).toEqual([2, 3, 4]);
  });

  it('has a cap large enough not to bite in a normal session', () => {
    expect(PROMPT_HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
  });

  it('does not mutate the history it is given', () => {
    const history = [entry({ id: 1 })];
    appendPromptEntry(history, entry({ id: 2 }), 1);
    expect(history).toHaveLength(1);
  });
});

describe('promptPreview', () => {
  it('returns short single-line text unchanged', () => {
    expect(promptPreview('run the tests')).toBe('run the tests');
  });

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(promptPreview('first line\n\n  second   line\t')).toBe('first line second line');
  });

  // Prompts get pasted from anywhere; a stray escape byte must not garble the row.
  it('strips control characters', () => {
    expect(promptPreview('clean\x1b[31m text')).toBe('clean[31m text');
  });

  it('truncates past the limit and marks the truncation', () => {
    const preview = promptPreview('x'.repeat(400), 20);
    expect(preview).toHaveLength(20);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('does not mark text that fits exactly', () => {
    expect(promptPreview('x'.repeat(20), 20)).toBe('x'.repeat(20));
  });

  // Empty rather than a baked-in English placeholder: the caller renders a
  // translated fallback, since this module cannot read the locale.
  it('returns empty when nothing printable survives', () => {
    expect(promptPreview(' \x00 ')).toBe('');
  });
});

describe('promptTimeLabel', () => {
  it('formats as zero-padded 24-hour local time', () => {
    const at = new Date(2026, 0, 2, 9, 5).getTime();
    expect(promptTimeLabel(at)).toBe('09:05');
  });

  it('formats afternoon times without a meridiem', () => {
    const at = new Date(2026, 0, 2, 17, 42).getTime();
    expect(promptTimeLabel(at)).toBe('17:42');
  });
});
