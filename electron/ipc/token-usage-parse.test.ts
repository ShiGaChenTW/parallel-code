import { describe, expect, it } from 'vitest';

import {
  CODEX_REPLAY_WINDOW_MS,
  ZERO_TOTALS,
  addTotals,
  aggregateUsage,
  claudeProjectSlug,
  claudeTotalsByPath,
  codexEventDelta,
  createCodexDeltaState,
  foldClaudeLines,
  foldCodexLines,
  foldGrokLines,
  isVertexClaudeRecord,
  isZeroTotals,
  matchKnownPath,
  parseClaudeUsageLine,
  parseCodexCwdLine,
  parseCodexSessionMeta,
  parseCodexTokenEvent,
  parseGrokLine,
  parseJsonObjectLine,
  splitCompleteLines,
  sumTotals,
  type ClaudeSeenRecord,
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

  // Correction five. A worktree that has been removed is its own project's
  // history; walking up to the surviving repo that contained it would move its
  // usage onto a different worktree's row.
  it('does not walk a deleted worktree up into the project that contained it', () => {
    const project = '/repo';
    const deleted = '/repo/.worktrees/gone';
    expect(matchKnownPath(deleted, [project], { candidateExists: true })).toBe(project);
    expect(matchKnownPath(deleted, [project], { candidateExists: false })).toBeNull();
  });

  it('still attributes a deleted directory that is itself a known path', () => {
    expect(matchKnownPath(WT, [WT], { candidateExists: false })).toBe(WT);
  });

  it('keeps the prefix rule for a directory that still exists', () => {
    expect(matchKnownPath(`${WT}/src`, [WT], { candidateExists: true })).toBe(WT);
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
      vendor: 'anthropic',
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

function newSeen(): Map<string, ClaudeSeenRecord> {
  return new Map<string, ClaudeSeenRecord>();
}

/** Anthropic-side totals for a path, which is what every pre-Vertex test meant. */
function anthropicAt(seen: Map<string, ClaudeSeenRecord>, path: string): TokenTotals | undefined {
  return claudeTotalsByPath(seen).get(path)?.anthropic;
}

describe('foldClaudeLines', () => {
  it('sums records per cwd', () => {
    const seen = newSeen();
    const lines = [
      claudeLine({ requestId: 'r1' }, {}),
      claudeLine({ requestId: 'r2', cwd: WT2 }, {}),
    ];
    foldClaudeLines(lines, seen);
    expect(anthropicAt(seen, WT)).toEqual(totals(2, 566, 20433, 43107));
    expect(anthropicAt(seen, WT2)).toEqual(totals(2, 566, 20433, 43107));
  });

  it('counts a repeated message.id:requestId only once', () => {
    const seen = newSeen();
    const line = claudeLine();
    foldClaudeLines([line, line, line], seen);
    expect(anthropicAt(seen, WT)).toEqual(totals(2, 566, 20433, 43107));
  });

  it('carries dedupe state across calls, as incremental reads require', () => {
    const seen = newSeen();
    const line = claudeLine();
    foldClaudeLines([line], seen);
    foldClaudeLines([line], seen);
    expect(seen.size).toBe(1);
    expect(anthropicAt(seen, WT)).toEqual(totals(2, 566, 20433, 43107));
  });

  // Correction six. Measured on this machine the rule never changes a number —
  // all 17,906 duplicates across 90 project directories carry identical usage —
  // but it is the rule that stays correct if a CLI ever rewrites a record as
  // its counts firm up.
  it('lets the last write for a key win over the first', () => {
    const seen = newSeen();
    const partial = claudeLine({}, { output_tokens: 1 });
    const complete = claudeLine({}, { output_tokens: 900 });
    foldClaudeLines([partial, complete], seen);
    expect(anthropicAt(seen, WT)?.output).toBe(900);
  });

  it('counts records without an id every time rather than dropping them', () => {
    const seen = newSeen();
    const line = JSON.stringify({ cwd: WT, usage: { input_tokens: 10 } });
    foldClaudeLines([line, line], seen);
    expect(anthropicAt(seen, WT)?.input).toBe(20);
  });

  it('skips bad lines but keeps the good ones in the same batch', () => {
    const seen = newSeen();
    const { skipped } = foldClaudeLines(
      ['{"broken":', 'not json', claudeLine(), '{"type":"user"}'],
      seen,
    );
    // Only the two malformed lines count as skipped — a user turn carries no
    // usage and is not a failure.
    expect(skipped).toBe(2);
    expect(anthropicAt(seen, WT)).toEqual(totals(2, 566, 20433, 43107));
  });

  it('falls back to the directory-derived path when a record has no cwd', () => {
    const seen = newSeen();
    const line = JSON.stringify({ message: { id: 'm', usage: { input_tokens: 4 } } });
    foldClaudeLines([line], seen, WT);
    expect(anthropicAt(seen, WT)?.input).toBe(4);
  });

  it('skips a record with no cwd and no fallback rather than guessing', () => {
    const seen = newSeen();
    const line = JSON.stringify({ message: { id: 'm', usage: { input_tokens: 4 } } });
    const { skipped } = foldClaudeLines([line], seen, null);
    expect(seen.size).toBe(0);
    expect(skipped).toBe(1);
  });
});

// Correction three. Vertex-served Claude Code writes into the same transcript
// tree; it is a different account against a different quota, so it is counted
// under its own provider rather than summed into `claude`.
describe('Vertex AI Claude records', () => {
  it.each([
    ['_vrtx_ in the message id', 'msg_vrtx_01abc', '', ''],
    ['_vrtx_ in the request id', '', 'req_vrtx_01abc', ''],
    ['an @-versioned model name', '', '', 'claude-opus-4-8@20260514'],
  ])('detects %s', (_label, id, req, model) => {
    expect(isVertexClaudeRecord(id, req, model)).toBe(true);
  });

  it('leaves a first-party record alone', () => {
    expect(isVertexClaudeRecord('msg_01abc', 'req_01abc', 'claude-opus-5')).toBe(false);
  });

  it('tags the parsed record with the vendor that served it', () => {
    expect(parseClaudeUsageLine(claudeLine())?.vendor).toBe('anthropic');
    const vertex = claudeLine({ requestId: 'req_vrtx_9' });
    expect(parseClaudeUsageLine(vertex)?.vendor).toBe('vertex');
  });

  it('keeps the two vendors in separate totals under one path', () => {
    const seen = newSeen();
    foldClaudeLines(
      [
        claudeLine({ requestId: 'r1' }, { input_tokens: 10, output_tokens: 0 }),
        claudeLine(
          { requestId: 'req_vrtx_2', message: { id: 'm2', usage: { input_tokens: 7 } } },
          {},
        ),
      ],
      seen,
    );
    const split = claudeTotalsByPath(seen).get(WT);
    expect(split?.anthropic.input).toBe(10);
    expect(split?.vertex.input).toBe(7);
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

const T0 = Date.parse('2026-07-31T00:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function codexTokenLine(
  total: Record<string, unknown>,
  last?: Record<string, unknown>,
  timestamp?: string,
): string {
  return JSON.stringify({
    ...(timestamp ? { timestamp } : {}),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, ...(last ? { last_token_usage: last } : {}) },
    },
  });
}

function codexSessionMetaLine(payload: Record<string, unknown>, timestamp = at(0)): string {
  return JSON.stringify({ timestamp, type: 'session_meta', payload });
}

/** `input_tokens` is raw in a rollout; the parser subtracts the cached prefix. */
function cumulative(input: number, output: number, cached = 0): Record<string, unknown> {
  return { input_tokens: input + cached, cached_input_tokens: cached, output_tokens: output };
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

describe('parseCodexTokenEvent', () => {
  it('subtracts the cached prefix out of input_tokens', () => {
    const line = codexTokenLine({
      input_tokens: 1000,
      cached_input_tokens: 900,
      output_tokens: 50,
      reasoning_output_tokens: 20,
      total_tokens: 1050,
    });
    // reasoning is a subset of output and must not be added on top.
    expect(parseCodexTokenEvent(line)?.total).toEqual(totals(100, 50, 900, 0));
  });

  it('never produces a negative input if cached exceeds input', () => {
    const line = codexTokenLine({ input_tokens: 10, cached_input_tokens: 99 });
    expect(parseCodexTokenEvent(line)?.total.input).toBe(0);
  });

  it('reads the turn total alongside the running total', () => {
    const line = codexTokenLine(cumulative(300, 40), cumulative(20, 5), at(1000));
    const event = parseCodexTokenEvent(line);
    expect(event?.total).toEqual(totals(300, 40));
    expect(event?.last).toEqual(totals(20, 5));
    expect(event?.atMs).toBe(T0 + 1000);
  });

  it('reports a null turn total when the record omits one', () => {
    expect(parseCodexTokenEvent(codexTokenLine(cumulative(1, 1)))?.last).toBeNull();
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
    expect(parseCodexTokenEvent(line)).toBeNull();
  });
});

describe('parseCodexSessionMeta', () => {
  it('reads the directory, the start time and an ordinary session', () => {
    expect(parseCodexSessionMeta(codexSessionMetaLine({ cwd: WT }))).toEqual({
      cwd: WT,
      startedAtMs: T0,
      inherited: false,
    });
  });

  it.each([
    ['forked_from_id', { forked_from_id: '019f-parent' }],
    ['parent_thread_id', { parent_thread_id: '019f-parent' }],
    ['a subagent source', { source: { subagent: { thread_spawn: { depth: 1 } } } }],
  ])('marks a rollout opened from %s as inheriting a history', (_label, extra) => {
    expect(parseCodexSessionMeta(codexSessionMetaLine({ cwd: WT, ...extra }))?.inherited).toBe(
      true,
    );
  });

  it('returns null for any line that is not a session_meta', () => {
    expect(parseCodexSessionMeta(codexTokenLine(cumulative(1, 1)))).toBeNull();
    expect(parseCodexSessionMeta('{"type":"session_meta"')).toBeNull();
  });
});

// Correction one. The cumulative counter is authoritative on how much was spent
// but cannot be divided; the per-event difference can be, and capping it by the
// turn's own figure keeps a retry from being charged twice.
describe('codexEventDelta', () => {
  const fresh = { watermark: null, interleaved: false, inherited: false };

  it('spends nothing on the first event, which only sets the baseline', () => {
    const event = { total: totals(500, 50), last: totals(20, 5), atMs: T0 };
    const result = codexEventDelta(fresh, event);
    expect(result.delta).toEqual(totals(20, 5));
    expect(result.watermark).toEqual(totals(500, 50));
  });

  it('takes the difference of the counter when it is the smaller of the two', () => {
    const state = { watermark: totals(100, 10), interleaved: false, inherited: false };
    const event = { total: totals(130, 14), last: totals(90, 40), atMs: T0 };
    // The counter advanced by 30/4 while the turn claims 90/40 — a retry
    // re-emitted its own figure, and the counter is the one that did not lie.
    expect(codexEventDelta(state, event).delta).toEqual(totals(30, 4));
  });

  it('falls back to the turn figure when the counter jumped further', () => {
    const state = { watermark: totals(100, 10), interleaved: false, inherited: false };
    const event = { total: totals(400, 90), last: totals(50, 20), atMs: T0 };
    expect(codexEventDelta(state, event).delta).toEqual(totals(50, 20));
  });

  it('uses the counter difference when the record carries no turn figure', () => {
    const state = { watermark: totals(100, 10), interleaved: false, inherited: false };
    const event = { total: totals(130, 14), last: null, atMs: T0 };
    expect(codexEventDelta(state, event).delta).toEqual(totals(30, 4));
  });

  it('caps componentwise, not on the sum', () => {
    const state = { watermark: totals(100, 10), interleaved: false, inherited: false };
    // Output advanced further than the turn claims even though the totals are
    // smaller overall, so the turn figure has to win.
    const event = { total: totals(105, 200), last: totals(50, 20), atMs: T0 };
    expect(codexEventDelta(state, event).delta).toEqual(totals(50, 20));
  });

  it('holds a componentwise high-water mark rather than the last reading', () => {
    const state = { watermark: totals(100, 50), interleaved: false, inherited: false };
    const event = { total: totals(120, 40), last: totals(20, 5), atMs: T0 };
    const result = codexEventDelta(state, event);
    expect(result.watermark).toEqual(totals(120, 50));
  });
});

// Correction two. A counter going backwards is not proof of a restart.
describe('codexEventDelta with a second lineage in one file', () => {
  it('latches interleaved instead of re-baselining when a reading drops', () => {
    const state = { watermark: totals(1000, 100), interleaved: false, inherited: false };
    const event = { total: totals(30, 3), last: totals(30, 3), atMs: T0 };
    const result = codexEventDelta(state, event);
    expect(result.interleaved).toBe(true);
    // The pre-drop value is *not* carried into a base — that is what would
    // charge the gap between the two lineages a second time.
    expect(result.delta).toEqual(totals(30, 3));
  });

  it('never unlatches once interleaved', () => {
    const state = { watermark: totals(1000, 100), interleaved: true, inherited: false };
    const event = { total: totals(2000, 200), last: totals(15, 5), atMs: T0 };
    const result = codexEventDelta(state, event);
    expect(result.interleaved).toBe(true);
    expect(result.delta).toEqual(totals(15, 5));
  });
});

describe('foldCodexLines', () => {
  it('charges each turn as it happens rather than taking the final reading', () => {
    const lines = [
      codexSessionMetaLine({ cwd: WT }),
      codexTokenLine(cumulative(100, 10), cumulative(100, 10), at(5000)),
      codexTokenLine(cumulative(300, 40), cumulative(200, 30), at(10000)),
    ];
    const { byPath, skipped } = foldCodexLines(lines, createCodexDeltaState());
    // 100/10 from the opening event, then the counter's own 200/30 step.
    expect(byPath.get(WT)).toEqual(totals(300, 40));
    expect(skipped).toBe(0);
  });

  it('lets a later turn_context move the session to another directory', () => {
    const state = createCodexDeltaState();
    foldCodexLines(
      [
        codexSessionMetaLine({ cwd: WT }),
        JSON.stringify({ type: 'turn_context', payload: { cwd: WT2 } }),
        codexTokenLine(cumulative(5, 5), cumulative(5, 5), at(5000)),
      ],
      state,
    );
    expect(state.cwd).toBe(WT2);
  });

  it('reports nothing for a session that has not been counted yet', () => {
    const { byPath } = foldCodexLines([codexSessionMetaLine({ cwd: WT })], createCodexDeltaState());
    expect(byPath.size).toBe(0);
  });

  it('skips malformed lines and still returns the good data around them', () => {
    const lines = [
      '{"type":"session_meta"',
      codexSessionMetaLine({ cwd: WT }),
      'garbage',
      codexTokenLine(cumulative(7, 3), cumulative(7, 3), at(5000)),
    ];
    const state = createCodexDeltaState();
    const result = foldCodexLines(lines, state);
    expect(result.skipped).toBe(2);
    expect(state.cwd).toBe(WT);
    expect(result.byPath.get(WT)).toEqual(totals(7, 3));
  });

  it('carries watermark state across chunks, as incremental reads require', () => {
    const state = createCodexDeltaState();
    const first = foldCodexLines(
      [
        codexSessionMetaLine({ cwd: WT }),
        codexTokenLine(cumulative(100, 10), cumulative(100, 10), at(5000)),
      ],
      state,
    );
    const second = foldCodexLines(
      [codexTokenLine(cumulative(160, 18), cumulative(60, 8), at(10000))],
      state,
    );
    expect(first.byPath.get(WT)).toEqual(totals(100, 10));
    // Not 160/18: the second chunk is differenced against what the first left.
    expect(second.byPath.get(WT)).toEqual(totals(60, 8));
  });

  // ---- the test this wave exists for -------------------------------------
  it('splits one session across the two worktrees it actually ran in', () => {
    const lines = [
      codexSessionMetaLine({ cwd: WT }),
      codexTokenLine(cumulative(100, 10), cumulative(100, 10), at(5000)),
      codexTokenLine(cumulative(250, 25), cumulative(150, 15), at(10000)),
      // The agent moves to the second worktree half way through the session.
      JSON.stringify({ type: 'turn_context', payload: { cwd: WT2 } }),
      codexTokenLine(cumulative(300, 31), cumulative(50, 6), at(15000)),
      codexTokenLine(cumulative(700, 80), cumulative(400, 49), at(20000)),
    ];
    const { byPath } = foldCodexLines(lines, createCodexDeltaState());

    expect(byPath.get(WT)).toEqual(totals(250, 25));
    expect(byPath.get(WT2)).toEqual(totals(450, 55));
    // And the split still adds up to what the final cumulative reading says,
    // which is the property the old last-reading-wins approach had and the
    // reason it was hard to give up.
    expect(addTotals(byPath.get(WT) ?? ZERO_TOTALS, byPath.get(WT2) ?? ZERO_TOTALS)).toEqual(
      totals(700, 80),
    );
  });

  it('cannot split a cumulative reading, which is why the deltas exist', () => {
    // The same session read the old way — one number, one directory, no answer
    // to "how much of this was the second worktree".
    const lines = [
      codexSessionMetaLine({ cwd: WT }),
      codexTokenLine(cumulative(100, 10), cumulative(100, 10), at(5000)),
      JSON.stringify({ type: 'turn_context', payload: { cwd: WT2 } }),
      codexTokenLine(cumulative(700, 80), cumulative(600, 70), at(20000)),
    ];
    const { byPath } = foldCodexLines(lines, createCodexDeltaState());
    expect([...byPath.keys()].sort()).toEqual([WT, WT2].sort());
  });

  it('removes the retry overshoot that summing the turn figures produces', () => {
    const lines = [
      codexSessionMetaLine({ cwd: WT }),
      codexTokenLine(cumulative(100, 10), cumulative(100, 10), at(5000)),
      // The turn is retried: the same figure is emitted twice but the counter
      // only advanced once.
      codexTokenLine(cumulative(150, 15), cumulative(50, 5), at(10000)),
      codexTokenLine(cumulative(150, 15), cumulative(50, 5), at(11000)),
    ];
    const { byPath } = foldCodexLines(lines, createCodexDeltaState());
    // Summing `last` would give 200/20. The counter says 150/15.
    expect(byPath.get(WT)).toEqual(totals(150, 15));
  });

  // ---- the second required test ------------------------------------------
  it('does not re-count the gap when a second lineage is written into one file', () => {
    const lines = [
      codexSessionMetaLine({ cwd: WT }),
      codexTokenLine(cumulative(1000, 100), cumulative(1000, 100), at(5000)),
      codexTokenLine(cumulative(5000, 500), cumulative(4000, 400), at(10000)),
      // A second fork lineage's snapshots land in the same rollout. The counter
      // drops. Treating that as a restart would carry 5000/500 into a base and
      // then add the second lineage on top — charging the first lineage twice.
      codexTokenLine(cumulative(80, 8), cumulative(80, 8), at(15000)),
      codexTokenLine(cumulative(140, 14), cumulative(60, 6), at(20000)),
    ];
    const { byPath } = foldCodexLines(lines, createCodexDeltaState());

    // Each lineage is charged its own self-contained turn figures once:
    // 1000/100 + 4000/400 + 80/8 + 60/6.
    expect(byPath.get(WT)).toEqual(totals(5140, 514));
    // The re-baselining rule this replaces would have produced 5000/500 carried
    // plus 140/14, i.e. 5140/514 for the second lineage *alone* on top of the
    // 5000/500 already counted — nearly double.
    expect(sumTotals(byPath.get(WT) ?? ZERO_TOTALS)).toBeLessThan(10000);
  });

  it('keeps counting a drop as its own lineage rather than restarting per event', () => {
    const state = createCodexDeltaState();
    foldCodexLines(
      [
        codexSessionMetaLine({ cwd: WT }),
        codexTokenLine(cumulative(1000, 100), cumulative(1000, 100), at(5000)),
        codexTokenLine(cumulative(50, 5), cumulative(50, 5), at(10000)),
      ],
      state,
    );
    expect(state.interleaved).toBe(true);
  });
});

// Correction four. A forked or subagent rollout opens by replaying its parent's
// entire history into its own file, `token_count` records included.
describe('foldCodexLines and a replayed parent history', () => {
  const replayed = (extra: Record<string, unknown>) => [
    codexSessionMetaLine({ cwd: WT, ...extra }),
    // Written in one burst at session creation — the parent's history.
    codexTokenLine(cumulative(1000, 100), cumulative(1000, 100), at(1)),
    codexTokenLine(cumulative(4000, 400), cumulative(3000, 300), at(3)),
    codexTokenLine(cumulative(9000, 900), cumulative(5000, 500), at(6)),
    // This session's own work, seconds later.
    codexTokenLine(cumulative(9200, 920), cumulative(200, 20), at(30000)),
    codexTokenLine(cumulative(9500, 950), cumulative(300, 30), at(60000)),
  ];

  it('charges a fork only for the turns it actually ran', () => {
    const { byPath } = foldCodexLines(
      replayed({ forked_from_id: '019f-parent' }),
      createCodexDeltaState(),
    );
    expect(byPath.get(WT)).toEqual(totals(500, 50));
  });

  it('charges an ordinary session for everything, replay rule or not', () => {
    const { byPath } = foldCodexLines(replayed({}), createCodexDeltaState());
    // 1000/100 baseline turn + 3000/300 + 5000/500 + 200/20 + 300/30.
    expect(byPath.get(WT)).toEqual(totals(9500, 950));
  });

  it('leaves the replay behind for good once a live turn has been seen', () => {
    const lines = [
      codexSessionMetaLine({ cwd: WT, forked_from_id: '019f-parent' }),
      codexTokenLine(cumulative(1000, 100), cumulative(1000, 100), at(1)),
      codexTokenLine(cumulative(1200, 120), cumulative(200, 20), at(30000)),
      // A fast follow-up turn must not be mistaken for more replay just because
      // the burst window would cover its offset from some other clock.
      codexTokenLine(cumulative(1500, 150), cumulative(300, 30), at(30500)),
    ];
    const { byPath } = foldCodexLines(lines, createCodexDeltaState());
    expect(byPath.get(WT)).toEqual(totals(500, 50));
  });

  it('counts everything when the records carry no timestamps to judge by', () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: WT, forked_from_id: 'p' } }),
      codexTokenLine(cumulative(1000, 100), cumulative(1000, 100)),
      codexTokenLine(cumulative(1200, 120), cumulative(200, 20)),
    ];
    const { byPath } = foldCodexLines(lines, createCodexDeltaState());
    expect(byPath.get(WT)).toEqual(totals(1200, 120));
  });

  it('draws the replay boundary at the documented window', () => {
    const inside = [
      codexSessionMetaLine({ cwd: WT, forked_from_id: 'p' }),
      codexTokenLine(cumulative(1000, 100), cumulative(1000, 100), at(CODEX_REPLAY_WINDOW_MS)),
      codexTokenLine(cumulative(1100, 110), cumulative(100, 10), at(CODEX_REPLAY_WINDOW_MS + 1)),
    ];
    expect(foldCodexLines(inside, createCodexDeltaState()).byPath.get(WT)).toEqual(totals(100, 10));
  });

  // Found against the real logs, not in a fixture. A fork replays its parent's
  // records verbatim and the parent's own `session_meta` is one of them. Taken
  // at face value that second record says "not a fork, started hours ago" and
  // switches the replay rule off on exactly the files that need it — measured,
  // that one mistake left 784,610,389 tokens of parent history charged twice.
  it('does not let the parent session_meta inside the replay steal the identity', () => {
    const lines = [
      codexSessionMetaLine({ cwd: WT, forked_from_id: '019f-parent' }, at(0)),
      codexTokenLine(cumulative(1000, 100), cumulative(1000, 100), at(1)),
      // The parent's own session_meta, replayed: no fork marker, older clock.
      codexSessionMetaLine({ cwd: WT }, at(-3_600_000)),
      codexTokenLine(cumulative(9000, 900), cumulative(8000, 800), at(3)),
      codexTokenLine(cumulative(9200, 920), cumulative(200, 20), at(30_000)),
    ];
    const state = createCodexDeltaState();
    const { byPath } = foldCodexLines(lines, state);
    expect(state.inherited).toBe(true);
    expect(state.sessionStartMs).toBe(T0);
    expect(byPath.get(WT)).toEqual(totals(200, 20));
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
