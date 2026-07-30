import { describe, expect, it } from 'vitest';

import {
  agentExitedEvent,
  agentSpawnedEvent,
  attentionTransitionEvent,
  mergeEvent,
  newCommitEvents,
  newStepEvents,
  prChecksEvent,
  stepKey,
  type PrChecksSnapshot,
} from './transcript-events';
import type { StepEntry } from '../ipc/types';

function step(over: Partial<StepEntry> = {}): StepEntry {
  return {
    summary: 'wrote the parser',
    status: 'implementing',
    timestamp: '2026-07-31T03:00:00.000Z',
    ...over,
  };
}

describe('agent lifecycle', () => {
  it('names the agent that started', () => {
    expect(agentSpawnedEvent('t1', 'Claude Code')).toEqual({
      taskId: 't1',
      kind: 'agent',
      status: 'spawned',
      summary: 'Claude Code started',
    });
  });

  it('distinguishes a clean exit from a failure, because only one needs attention', () => {
    expect(agentExitedEvent('t1', 'Codex', { exit_code: 0, signal: null }).status).toBe('exited');
    expect(agentExitedEvent('t1', 'Codex', { exit_code: 1, signal: null }).status).toBe('failed');
  });

  it('reports a signal in preference to an exit code', () => {
    expect(
      agentExitedEvent('t1', 'Codex', { exit_code: null, signal: 'SIGKILL' }).summary,
    ).toContain('signal SIGKILL');
  });

  it('says something legible when neither is known', () => {
    expect(agentExitedEvent('t1', 'Codex', { exit_code: null, signal: null }).summary).toContain(
      'unknown status',
    );
  });
});

describe('steps', () => {
  it('emits one event per new step', () => {
    const result = newStepEvents('t1', new Set(), [
      step({ summary: 'first' }),
      step({ summary: 'second', timestamp: '2026-07-31T03:01:00.000Z' }),
    ]);
    expect(result.events.map((e) => e.summary)).toEqual(['first', 'second']);
    expect(result.keys).toHaveLength(2);
  });

  it('does not re-emit a step it has already seen', () => {
    const first = newStepEvents('t1', new Set(), [step({ summary: 'only' })]);
    const second = newStepEvents('t1', new Set(first.keys), [step({ summary: 'only' })]);
    expect(second.events).toHaveLength(0);
  });

  it('survives an agent rewriting the array — position is not identity', () => {
    const seen = new Set([stepKey(step({ summary: 'old' }))]);
    const result = newStepEvents('t1', seen, [
      step({ summary: 'inserted', timestamp: '2026-07-31T02:59:00.000Z' }),
      step({ summary: 'old' }),
    ]);
    expect(result.events.map((e) => e.summary)).toEqual(['inserted']);
  });

  it('treats a status change on the same summary as a new step', () => {
    const seen = new Set([stepKey(step({ status: 'implementing' }))]);
    const result = newStepEvents('t1', seen, [step({ status: 'done' })]);
    expect(result.events.map((e) => e.status)).toEqual(['done']);
  });

  it('deduplicates within a single batch', () => {
    const result = newStepEvents('t1', new Set(), [step(), step()]);
    expect(result.events).toHaveLength(1);
  });

  it('folds detail, next, files and sub-agent id into one detail line', () => {
    const [event] = newStepEvents('t1', new Set(), [
      step({
        detail: 'used the shared parser',
        next: 'add retention',
        files_touched: ['a.ts', 'b.ts'],
        agent_id: 'auth-worker',
      }),
    ]).events;
    expect(event.detail).toBe(
      'used the shared parser · next: add retention · a.ts, b.ts · agent: auth-worker',
    );
  });

  it('omits detail entirely when there is nothing to say', () => {
    expect(newStepEvents('t1', new Set(), [step()]).events[0].detail).toBeUndefined();
  });

  it('skips malformed entries rather than emitting a blank line', () => {
    const junk = [null, {}, { summary: 5 }] as unknown as StepEntry[];
    expect(newStepEvents('t1', new Set(), junk).events).toHaveLength(0);
  });
});

describe('attention transitions', () => {
  it('records a genuine transition with both ends of it', () => {
    expect(attentionTransitionEvent('t1', 'working', 'ready')).toEqual({
      taskId: 't1',
      kind: 'attention',
      status: 'ready',
      summary: 'Task ready for review',
      detail: 'working → ready',
    });
  });

  it('stays silent on the initial population — an app restart is not a transition', () => {
    expect(attentionTransitionEvent('t1', undefined, 'ready')).toBeNull();
  });

  it('stays silent when nothing changed', () => {
    expect(attentionTransitionEvent('t1', 'ready', 'ready')).toBeNull();
  });

  it('falls back to the raw state name for a state it has no phrasing for', () => {
    expect(attentionTransitionEvent('t1', 'idle', 'something_new')?.summary).toBe(
      'Task something_new',
    );
  });
});

describe('merge', () => {
  it('records the branch and the line counts', () => {
    expect(mergeEvent('t1', { main_branch: 'main', lines_added: 120, lines_removed: 8 })).toEqual({
      taskId: 't1',
      kind: 'merge',
      status: 'merged',
      summary: 'Merged into main',
      detail: '+120/-8 lines',
    });
  });

  it('clamps nonsense counts rather than writing them out', () => {
    expect(
      mergeEvent('t1', { main_branch: 'main', lines_added: -5, lines_removed: 1.7 }).detail,
    ).toBe('+0/-1 lines');
  });
});

describe('PR checks', () => {
  const snapshot = (over: Partial<PrChecksSnapshot> = {}): PrChecksSnapshot => ({
    overall: 'pending',
    passing: 1,
    pending: 2,
    failing: 0,
    ...over,
  });

  it('records the first observation', () => {
    expect(prChecksEvent('t1', undefined, snapshot())?.summary).toBe('PR checks pending');
  });

  it('stays silent when a poll changed nothing — 30-second polling must not flood', () => {
    expect(prChecksEvent('t1', snapshot(), snapshot())).toBeNull();
  });

  it('records a verdict change', () => {
    expect(
      prChecksEvent('t1', snapshot(), snapshot({ overall: 'failure', failing: 1, pending: 1 }))
        ?.status,
    ).toBe('failure');
  });

  it('records a count change even when the verdict is unchanged', () => {
    expect(prChecksEvent('t1', snapshot(), snapshot({ passing: 2, pending: 1 }))?.detail).toBe(
      '2 passing, 1 pending, 0 failing',
    );
  });
});

describe('commits', () => {
  const commit = (hash: string, message = `msg ${hash}`) => ({ hash, message });

  it('seeds silently on the first poll — existing history is not news', () => {
    const result = newCommitEvents('t1', undefined, [commit('aaa'), commit('bbb')]);
    expect(result.events).toEqual([]);
    expect(result.hashes).toEqual(['aaa', 'bbb']);
  });

  it('emits only commits that appeared since the last poll', () => {
    const result = newCommitEvents('t1', ['bbb'], [commit('ccc'), commit('bbb')]);
    expect(result.events.map((e) => e.detail)).toEqual(['ccc']);
  });

  it('emits oldest-first, because a transcript reads forwards', () => {
    // `git log` hands back newest-first; the timeline must not.
    const result = newCommitEvents('t1', [], [commit('newest'), commit('older'), commit('oldest')]);
    expect(result.events.map((e) => e.detail)).toEqual(['oldest', 'older', 'newest']);
  });

  it('uses the first line of the message and bounds its length', () => {
    const [event] = newCommitEvents('t1', [], [commit('a', 'subject line\n\nbody text')]).events;
    expect(event.summary).toBe('subject line');
  });

  it('says something rather than nothing for an empty message', () => {
    expect(newCommitEvents('t1', [], [commit('a', '')]).events[0].summary).toBe('(no message)');
  });

  it('reports the full hash list back so the caller can advance its baseline', () => {
    expect(newCommitEvents('t1', ['x'], [commit('y')]).hashes).toEqual(['y']);
  });
});

describe('every emitter produces a kind the transcript vocabulary already has', () => {
  it('never invents a seventh kind', () => {
    // Borrowed vocabulary, not a new one. If a future emitter needs a kind that
    // is not here, that is a deliberate schema change, not an accident.
    const kinds = [
      agentSpawnedEvent('t', 'a').kind,
      newStepEvents('t', new Set(), [step()]).events[0].kind,
      attentionTransitionEvent('t', 'idle', 'ready')?.kind,
      mergeEvent('t', { main_branch: 'main', lines_added: 0, lines_removed: 0 }).kind,
      prChecksEvent('t', undefined, { overall: 'success', passing: 1, pending: 0, failing: 0 })
        ?.kind,
      newCommitEvents('t', [], [{ hash: 'a', message: 'm' }]).events[0].kind,
    ];
    expect(new Set(kinds)).toEqual(
      new Set(['agent', 'step', 'attention', 'merge', 'pr-checks', 'commit']),
    );
  });
});
