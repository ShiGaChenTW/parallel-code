import { describe, expect, it } from 'vitest';

import {
  ZERO_TOTALS,
  accumulateMonotonic,
  addTotals,
  aggregateUsage,
  claudeProjectSlug,
  foldClaudeLines,
  foldCodexLines,
  foldGrokLines,
  isZeroTotals,
  matchKnownPath,
  parseClaudeUsageLine,
  parseCodexCwdLine,
  parseCodexTotalLine,
  parseGrokLine,
  parseJsonObjectLine,
  splitCompleteLines,
  sumTotals,
} from './token-usage-parse.js';
import type { TokenTotals } from './shared-types.js';

const WT = '/Users/dev/project';
const WT2 = '/Users/dev/project-feature';

function totals(input: number, output: number, cacheRead = 0, cacheWrite = 0): TokenTotals {
  return { input, output, cacheRead, cacheWrite };
}

// ---------------------------------------------------------------------------
// Generic line handling
// ---------------------------------------------------------------------------

describe('parseJsonObjectLine', () => {
  it('parses a JSON object', () => {
    expect(parseJsonObjectLine('{"a":1}')).toEqual({ a: 1 });
  });

  it.each([
    ['blank', ''],
    ['whitespace', '   '],
    ['truncated object', '{"a":1'],
    ['not JSON at all', 'this is not json'],
    ['a JSON array', '[1,2,3]'],
    ['a bare string', '"hello"'],
    ['a bare number', '42'],
    ['null', 'null'],
  ])('returns null for %s', (_label, line) => {
    expect(parseJsonObjectLine(line)).toBeNull();
  });
});

describe('splitCompleteLines', () => {
  it('keeps a trailing partial line as the remainder', () => {
    expect(splitCompleteLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      remainder: '{"c":',
    });
  });

  it('returns everything as remainder when no newline has arrived', () => {
    expect(splitCompleteLines('{"a":')).toEqual({ lines: [], remainder: '{"a":' });
  });

  it('returns an empty remainder when the chunk ends on a newline', () => {
    expect(splitCompleteLines('{"a":1}\n')).toEqual({ lines: ['{"a":1}'], remainder: '' });
  });

  it('handles an empty chunk', () => {
    expect(splitCompleteLines('')).toEqual({ lines: [], remainder: '' });
  });
});

describe('totals arithmetic', () => {
  it('adds field by field', () => {
    expect(addTotals(totals(1, 2, 3, 4), totals(10, 20, 30, 40))).toEqual(totals(11, 22, 33, 44));
  });

  it('sums and detects zero', () => {
    expect(sumTotals(totals(1, 2, 3, 4))).toBe(10);
    expect(isZeroTotals(ZERO_TOTALS)).toBe(true);
    expect(isZeroTotals(totals(0, 0, 0, 1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Known-path matching
// ---------------------------------------------------------------------------

describe('matchKnownPath', () => {
  it('matches an exact path', () => {
    expect(matchKnownPath(WT, [WT, WT2])).toBe(WT);
  });

  it('matches a subdirectory of a known worktree', () => {
    expect(matchKnownPath(`${WT}/src/lib`, [WT])).toBe(WT);
  });

  it('does not match across a path-component boundary', () => {
    expect(matchKnownPath('/Users/dev/project-legacy', [WT])).toBeNull();
  });

  it('prefers the worktree over the project that contains it', () => {
    const project = '/repo';
    const worktree = '/repo/.worktrees/feature';
    expect(matchKnownPath(`${worktree}/src`, [project, worktree])).toBe(worktree);
  });

  it('returns null when nothing is known', () => {
    expect(matchKnownPath(WT, [])).toBeNull();
    expect(matchKnownPath('/somewhere/else', [WT, WT2])).toBeNull();
  });

  it('handles Windows-style separators in a recorded path', () => {
    expect(matchKnownPath('C:\\repo\\src', ['C:\\repo'])).toBe('C:\\repo');
  });
});

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

function claudeLine(
  over: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    cwd: WT,
    requestId: 'req_1',
    message: {
      id: 'msg_1',
      usage: {
        input_tokens: 2,
        output_tokens: 566,
        cache_creation_input_tokens: 43107,
        cache_read_input_tokens: 20433,
        ...usage,
      },
    },
    ...over,
  });
}

describe('parseClaudeUsageLine', () => {
  it('reads the four usage fields and the record cwd', () => {
    expect(parseClaudeUsageLine(claudeLine())).toEqual({
      dedupeKey: 'msg_1:req_1',
      cwd: WT,
      totals: totals(2, 566, 20433, 43107),
    });
  });

  it('accepts a top-level usage object for forward compatibility', () => {
    const line = JSON.stringify({ cwd: WT, usage: { input_tokens: 5, output_tokens: 7 } });
    expect(parseClaudeUsageLine(line)?.totals).toEqual(totals(5, 7));
  });

  it('ignores usage.iterations — it is a breakdown of the same tokens, not extra', () => {
    const line = claudeLine(
      {},
      {
        iterations: [
          { input_tokens: 2, output_tokens: 566, cache_read_input_tokens: 20433 },
          { input_tokens: 999999, output_tokens: 999999 },
        ],
      },
    );
    expect(parseClaudeUsageLine(line)?.totals).toEqual(totals(2, 566, 20433, 43107));
  });

  it('treats missing numeric fields as zero rather than failing', () => {
    const line = JSON.stringify({ cwd: WT, message: { id: 'm', usage: { output_tokens: 9 } } });
    expect(parseClaudeUsageLine(line)?.totals).toEqual(totals(0, 9));
  });

  it.each([
    ['null', null],
    ['a string', '1234'],
    ['negative', -5],
    ['NaN-producing object', {}],
  ])('ignores an input_tokens that is %s', (_label, value) => {
    const line = JSON.stringify({
      cwd: WT,
      message: { id: 'm', usage: { input_tokens: value, output_tokens: 4 } },
    });
    const parsed = parseClaudeUsageLine(line);
    expect(parsed?.totals.input).toBe(0);
    expect(Number.isFinite(parsed?.totals.input ?? NaN)).toBe(true);
  });

  it.each([
    ['a malformed line', '{"cwd":'],
    ['a record with no usage', JSON.stringify({ type: 'user', cwd: WT })],
    ['a usage object that is all zeroes', JSON.stringify({ cwd: WT, usage: { input_tokens: 0 } })],
    ['an unknown schema', JSON.stringify({ tokens: { in: 5, out: 5 } })],
    ['a blank line', ''],
  ])('returns null for %s', (_label, line) => {
    expect(parseClaudeUsageLine(line)).toBeNull();
  });

  it('has no dedupe key when the record carries no message id', () => {
    const line = JSON.stringify({ cwd: WT, usage: { input_tokens: 1 } });
    expect(parseClaudeUsageLine(line)?.dedupeKey).toBeNull();
  });
});

describe('foldClaudeLines', () => {
  it('sums records per cwd', () => {
    const seen = new Set<string>();
    const lines = [
      claudeLine({ requestId: 'r1' }, {}),
      claudeLine({ requestId: 'r2', cwd: WT2 }, {}),
    ];
    const { byPath } = foldClaudeLines(lines, seen);
    expect(byPath.get(WT)).toEqual(totals(2, 566, 20433, 43107));
    expect(byPath.get(WT2)).toEqual(totals(2, 566, 20433, 43107));
  });

  it('counts a repeated message.id:requestId only once', () => {
    const seen = new Set<string>();
    const line = claudeLine();
    const { byPath } = foldClaudeLines([line, line, line], seen);
    expect(byPath.get(WT)).toEqual(totals(2, 566, 20433, 43107));
  });

  it('carries dedupe state across calls, as incremental reads require', () => {
    const seen = new Set<string>();
    const line = claudeLine();
    foldClaudeLines([line], seen);
    const second = foldClaudeLines([line], seen);
    expect(second.byPath.size).toBe(0);
  });

  it('counts records without an id every time rather than dropping them', () => {
    const seen = new Set<string>();
    const line = JSON.stringify({ cwd: WT, usage: { input_tokens: 10 } });
    const { byPath } = foldClaudeLines([line, line], seen);
    expect(byPath.get(WT)?.input).toBe(20);
  });

  it('skips bad lines but keeps the good ones in the same batch', () => {
    const seen = new Set<string>();
    const { byPath, skipped } = foldClaudeLines(
      ['{"broken":', 'not json', claudeLine(), '{"type":"user"}'],
      seen,
    );
    // Only the two malformed lines count as skipped — a user turn carries no
    // usage and is not a failure.
    expect(skipped).toBe(2);
    expect(byPath.get(WT)).toEqual(totals(2, 566, 20433, 43107));
  });

  it('falls back to the directory-derived path when a record has no cwd', () => {
    const seen = new Set<string>();
    const line = JSON.stringify({ message: { id: 'm', usage: { input_tokens: 4 } } });
    const { byPath } = foldClaudeLines([line], seen, WT);
    expect(byPath.get(WT)?.input).toBe(4);
  });

  it('skips a record with no cwd and no fallback rather than guessing', () => {
    const seen = new Set<string>();
    const line = JSON.stringify({ message: { id: 'm', usage: { input_tokens: 4 } } });
    const { byPath, skipped } = foldClaudeLines([line], seen, null);
    expect(byPath.size).toBe(0);
    expect(skipped).toBe(1);
  });
});

describe('claudeProjectSlug', () => {
  it('matches the directory name Claude Code writes', () => {
    expect(claudeProjectSlug('/Users/scottchen/Documents/20_Projects/fork_parallel-code')).toBe(
      '-Users-scottchen-Documents-20-Projects-fork-parallel-code',
    );
  });

  it('is lossy, which is why attribution uses the in-record cwd instead', () => {
    expect(claudeProjectSlug('/Users/x/a_b')).toBe(claudeProjectSlug('/Users/x/a-b'));
  });
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

function codexTokenLine(total: Record<string, unknown>, last?: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, ...(last ? { last_token_usage: last } : {}) },
    },
  });
}

describe('parseCodexCwdLine', () => {
  it('reads session_meta.payload.cwd', () => {
    const line = JSON.stringify({ type: 'session_meta', payload: { cwd: WT } });
    expect(parseCodexCwdLine(line)).toBe(WT);
  });

  it('reads turn_context.payload.cwd', () => {
    const line = JSON.stringify({ type: 'turn_context', payload: { cwd: WT2 } });
    expect(parseCodexCwdLine(line)).toBe(WT2);
  });

  it('reads the nested thread_settings.cwd', () => {
    const line = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'thread_settings_applied', thread_settings: { cwd: WT } },
    });
    expect(parseCodexCwdLine(line)).toBe(WT);
  });

  it.each([
    ['a malformed line', '{"payload"'],
    ['a line with no payload', '{"type":"response_item"}'],
    ['an empty cwd', JSON.stringify({ payload: { cwd: '' } })],
    ['a non-string cwd', JSON.stringify({ payload: { cwd: 42 } })],
  ])('returns null for %s', (_label, line) => {
    expect(parseCodexCwdLine(line)).toBeNull();
  });
});

describe('parseCodexTotalLine', () => {
  it('subtracts the cached prefix out of input_tokens', () => {
    const line = codexTokenLine({
      input_tokens: 1000,
      cached_input_tokens: 900,
      output_tokens: 50,
      reasoning_output_tokens: 20,
      total_tokens: 1050,
    });
    // reasoning is a subset of output and must not be added on top.
    expect(parseCodexTotalLine(line)).toEqual(totals(100, 50, 900, 0));
  });

  it('never produces a negative input if cached exceeds input', () => {
    const line = codexTokenLine({ input_tokens: 10, cached_input_tokens: 99 });
    expect(parseCodexTotalLine(line)?.input).toBe(0);
  });

  it.each([
    ['a non-token_count event', JSON.stringify({ payload: { type: 'agent_message' } })],
    ['a token_count with no info', JSON.stringify({ payload: { type: 'token_count' } })],
    ['a malformed line', '{"payload":{'],
    [
      'a line with only last_token_usage',
      JSON.stringify({
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5 } } },
      }),
    ],
  ])('returns null for %s', (_label, line) => {
    expect(parseCodexTotalLine(line)).toBeNull();
  });
});

describe('foldCodexLines', () => {
  it('takes the last cumulative total, not the sum of every event', () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: WT } }),
      codexTokenLine({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 }),
      codexTokenLine({ input_tokens: 300, cached_input_tokens: 0, output_tokens: 40 }),
    ];
    expect(foldCodexLines(lines)).toEqual({
      cwd: WT,
      totals: totals(300, 40),
      skipped: 0,
    });
  });

  it('lets a later turn_context move the session to another directory', () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: WT } }),
      JSON.stringify({ type: 'turn_context', payload: { cwd: WT2 } }),
      codexTokenLine({ input_tokens: 5, output_tokens: 5 }),
    ];
    expect(foldCodexLines(lines).cwd).toBe(WT2);
  });

  it('reports no totals for a session that has not been counted yet', () => {
    const lines = [JSON.stringify({ type: 'session_meta', payload: { cwd: WT } })];
    expect(foldCodexLines(lines).totals).toBeNull();
  });

  it('skips malformed lines and still returns the good data around them', () => {
    const lines = [
      '{"type":"session_meta"',
      JSON.stringify({ type: 'session_meta', payload: { cwd: WT } }),
      'garbage',
      codexTokenLine({ input_tokens: 7, output_tokens: 3 }),
    ];
    const result = foldCodexLines(lines);
    expect(result.skipped).toBe(2);
    expect(result.cwd).toBe(WT);
    expect(result.totals).toEqual(totals(7, 3));
  });
});

describe('accumulateMonotonic', () => {
  it('replaces the previous value while the counter grows', () => {
    const result = accumulateMonotonic(totals(10, 10), ZERO_TOTALS, totals(30, 30));
    expect(result.total).toEqual(totals(30, 30));
    expect(result.carried).toEqual(ZERO_TOTALS);
  });

  it('carries the pre-reset value forward when the counter restarts', () => {
    const result = accumulateMonotonic(totals(100, 100), ZERO_TOTALS, totals(5, 5));
    expect(result.carried).toEqual(totals(100, 100));
    expect(result.total).toEqual(totals(105, 105));
  });

  it('treats the first observation as the whole total', () => {
    expect(accumulateMonotonic(null, ZERO_TOTALS, totals(7, 7)).total).toEqual(totals(7, 7));
  });
});

// ---------------------------------------------------------------------------
// Grok
// ---------------------------------------------------------------------------

describe('parseGrokLine', () => {
  it('reads a usage record and subtracts the cached prefix', () => {
    const line = JSON.stringify({
      sid: 's1',
      msg: 'shell.turn.inference_done',
      ctx: {
        prompt_tokens: 100000,
        cached_prompt_tokens: 40000,
        completion_tokens: 900,
        reasoning_tokens: 500,
      },
    });
    // reasoning is inside completion; adding it would double-count.
    expect(parseGrokLine(line)).toEqual({
      kind: 'usage',
      sid: 's1',
      totals: totals(60000, 900, 40000, 0),
    });
  });

  it('reads a session record', () => {
    const line = JSON.stringify({ sid: 's1', msg: 'session created', ctx: { cwd: WT } });
    expect(parseGrokLine(line)).toEqual({ kind: 'session', sid: 's1', cwd: WT });
  });

  it('matches on the token field rather than the log message text', () => {
    const line = JSON.stringify({
      sid: 's1',
      msg: 'some.renamed.event',
      ctx: { prompt_tokens: 10, completion_tokens: 2 },
    });
    expect(parseGrokLine(line)?.kind).toBe('usage');
  });

  it.each([
    ['a malformed line', '{"sid":'],
    ['a record with no sid', JSON.stringify({ ctx: { prompt_tokens: 5 } })],
    ['a record with no ctx', JSON.stringify({ sid: 's1', msg: 'agent initialized' })],
    ['unrelated auth chatter', JSON.stringify({ sid: 's1', ctx: { has_cached_token: true } })],
    ['a zero-token usage record', JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 0 } })],
  ])('returns null for %s', (_label, line) => {
    expect(parseGrokLine(line)).toBeNull();
  });
});

describe('foldGrokLines', () => {
  it('joins usage to a cwd through the sid', () => {
    const map = new Map<string, string>();
    const lines = [
      JSON.stringify({ sid: 's1', ctx: { cwd: WT } }),
      JSON.stringify({ sid: 's2', ctx: { cwd: WT2 } }),
      JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 100, completion_tokens: 10 } }),
      JSON.stringify({ sid: 's2', ctx: { prompt_tokens: 200, completion_tokens: 20 } }),
    ];
    const { byPath } = foldGrokLines(lines, map);
    expect(byPath.get(WT)).toEqual(totals(100, 10));
    expect(byPath.get(WT2)).toEqual(totals(200, 20));
  });

  it('keeps the sid map across calls so incremental reads still attribute', () => {
    const map = new Map<string, string>();
    foldGrokLines([JSON.stringify({ sid: 's1', ctx: { cwd: WT } })], map);
    const later = foldGrokLines(
      [JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 50, completion_tokens: 5 } })],
      map,
    );
    expect(later.byPath.get(WT)).toEqual(totals(50, 5));
  });

  it('skips usage for a sid it has never seen a session record for', () => {
    const map = new Map<string, string>();
    const { byPath, skipped } = foldGrokLines(
      [JSON.stringify({ sid: 'unknown', ctx: { prompt_tokens: 50 } })],
      map,
    );
    expect(byPath.size).toBe(0);
    expect(skipped).toBe(1);
  });

  it('does not count routine non-usage chatter as skipped records', () => {
    const map = new Map<string, string>();
    const { skipped } = foldGrokLines(
      [
        JSON.stringify({ sid: 's1', msg: 'auth started', ctx: { has_cached_token: true } }),
        JSON.stringify({ ts: 1, msg: 'model catalog: fetching' }),
      ],
      map,
    );
    expect(skipped).toBe(0);
  });

  it('counts a genuinely malformed line as skipped', () => {
    const map = new Map<string, string>();
    expect(foldGrokLines(['{"sid":', 'nonsense'], map).skipped).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

describe('aggregateUsage', () => {
  it('merges providers under one path and keeps the per-provider split', () => {
    const result = aggregateUsage([
      { path: WT, provider: 'claude', totals: totals(10, 1) },
      { path: WT, provider: 'codex', totals: totals(20, 2) },
    ]);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].totals).toEqual(totals(30, 3));
    expect(result.paths[0].byProvider.claude).toEqual(totals(10, 1));
    expect(result.paths[0].byProvider.codex).toEqual(totals(20, 2));
    expect(result.totals).toEqual(totals(30, 3));
  });

  it('orders rows by total tokens descending', () => {
    const result = aggregateUsage([
      { path: WT, provider: 'claude', totals: totals(1, 1) },
      { path: WT2, provider: 'claude', totals: totals(100, 100) },
    ]);
    expect(result.paths.map((p) => p.path)).toEqual([WT2, WT]);
  });

  it('breaks ties on path so the table does not reshuffle between refreshes', () => {
    const result = aggregateUsage([
      { path: '/b', provider: 'claude', totals: totals(5, 5) },
      { path: '/a', provider: 'claude', totals: totals(5, 5) },
    ]);
    expect(result.paths.map((p) => p.path)).toEqual(['/a', '/b']);
  });

  it('drops zero contributions instead of rendering empty rows', () => {
    const result = aggregateUsage([{ path: WT, provider: 'grok', totals: ZERO_TOTALS }]);
    expect(result.paths).toEqual([]);
    expect(result.totals).toEqual(ZERO_TOTALS);
  });

  it('returns an empty aggregate for no contributions', () => {
    expect(aggregateUsage([])).toEqual({ paths: [], totals: ZERO_TOTALS, byProvider: {} });
  });
});
