// Shaping the six event kinds.
//
// Every decision about *whether* an event is worth recording, and what it
// should say, lives here as a pure function. The six detection modules are
// left as one-line call sites, and vitest (`environment: 'node'`, no DOM) can
// exercise the logic without mounting anything — the same split the codebase
// already uses for `task-notes-tabs.ts` and `merge-readiness.ts`.
//
// The bias throughout is toward silence. A transcript is only useful if
// scrolling it tells you what happened; a poller that re-announces an unchanged
// state every five seconds produces 17,000 lines a day and buries the six that
// mattered. So every function that observes a poll returns `null` unless
// something actually changed, and every function that observes a *list* returns
// events only for entries it has not seen before.

import type { CommitInfo, StepEntry, TranscriptEventInput } from '../ipc/types';

// --- 1. Agent lifecycle ------------------------------------------------------

export function agentSpawnedEvent(taskId: string, agentName: string): TranscriptEventInput {
  return {
    taskId,
    kind: 'agent',
    status: 'spawned',
    summary: `${agentName} started`,
  };
}

export function agentExitedEvent(
  taskId: string,
  agentName: string,
  exit: { exit_code: number | null; signal: string | null },
): TranscriptEventInput {
  const how =
    exit.signal !== null
      ? `signal ${exit.signal}`
      : exit.exit_code === null
        ? 'unknown status'
        : `exit ${exit.exit_code}`;
  return {
    taskId,
    kind: 'agent',
    status: exit.exit_code === 0 ? 'exited' : 'failed',
    summary: `${agentName} ended (${how})`,
  };
}

// --- 2. Steps ----------------------------------------------------------------

/**
 * Identity for a step entry.
 *
 * Position is not identity: agents rewrite `steps.json` wholesale, so an entry
 * can shift index without being new. Timestamp plus summary is stable across a
 * rewrite and distinct across genuinely new work.
 */
export function stepKey(step: StepEntry): string {
  return `${step.timestamp}\0${step.status}\0${step.summary}`;
}

export interface NewStepEvents {
  events: TranscriptEventInput[];
  /** Keys the caller should remember so these are not emitted twice. */
  keys: string[];
}

/**
 * Events for steps that have not been recorded yet.
 *
 * `seen` empty means this is the first observation of the task. That is not
 * treated as "everything is new" for a restored task — the caller seeds `seen`
 * on restore. Here, an empty `seen` genuinely does emit, which is what a
 * freshly spawned agent's first step should do.
 */
export function newStepEvents(
  taskId: string,
  seen: ReadonlySet<string>,
  steps: readonly StepEntry[],
): NewStepEvents {
  const events: TranscriptEventInput[] = [];
  const keys: string[] = [];
  for (const step of steps) {
    if (typeof step?.summary !== 'string' || typeof step?.status !== 'string') continue;
    const key = stepKey(step);
    if (seen.has(key) || keys.includes(key)) continue;
    keys.push(key);
    const detailParts = [
      step.detail,
      step.next ? `next: ${step.next}` : undefined,
      step.files_touched?.length ? step.files_touched.join(', ') : undefined,
      // Sub-agent attribution, so a coordinator's transcript can be read back
      // per delegated worker rather than as one interleaved stream.
      step.agent_id ? `agent: ${step.agent_id}` : undefined,
    ].filter((part): part is string => typeof part === 'string' && part.length > 0);
    events.push({
      taskId,
      kind: 'step',
      status: step.status,
      summary: step.summary,
      ...(detailParts.length > 0 ? { detail: detailParts.join(' · ') } : {}),
    });
  }
  return { events, keys };
}

// --- 3. Attention transitions ------------------------------------------------

const ATTENTION_SUMMARY: Record<string, string> = {
  ready: 'ready for review',
  needs_input: 'needs your input',
  error: 'hit an error',
  working: 'working',
  idle: 'idle',
};

/**
 * A transition, or `null`.
 *
 * `previous === undefined` is the watcher populating its map on mount, not a
 * transition — recording it would stamp every task with a spurious event every
 * time the app started.
 */
export function attentionTransitionEvent(
  taskId: string,
  previous: string | undefined,
  current: string,
): TranscriptEventInput | null {
  if (previous === undefined || previous === current) return null;
  return {
    taskId,
    kind: 'attention',
    status: current,
    summary: `Task ${ATTENTION_SUMMARY[current] ?? current}`,
    detail: `${previous} → ${current}`,
  };
}

// --- 4. Merge ----------------------------------------------------------------

export function mergeEvent(
  taskId: string,
  result: { main_branch: string; lines_added: number; lines_removed: number },
): TranscriptEventInput {
  return {
    taskId,
    kind: 'merge',
    status: 'merged',
    summary: `Merged into ${result.main_branch}`,
    detail: `+${Math.max(0, Math.floor(result.lines_added))}/-${Math.max(
      0,
      Math.floor(result.lines_removed),
    )} lines`,
  };
}

// --- 5. PR / CI polling ------------------------------------------------------

export interface PrChecksSnapshot {
  overall: string;
  passing: number;
  pending: number;
  failing: number;
}

/**
 * A CI state change, or `null`.
 *
 * PR checks are polled every 30 seconds while a PR is pending. Recording each
 * poll would drown the timeline, so only a change in the overall verdict or in
 * the pass/fail/pending counts is worth a line.
 */
export function prChecksEvent(
  taskId: string,
  previous: PrChecksSnapshot | undefined,
  next: PrChecksSnapshot,
): TranscriptEventInput | null {
  if (
    previous &&
    previous.overall === next.overall &&
    previous.passing === next.passing &&
    previous.pending === next.pending &&
    previous.failing === next.failing
  ) {
    return null;
  }
  return {
    taskId,
    kind: 'pr-checks',
    status: next.overall,
    summary: `PR checks ${next.overall}`,
    detail: `${next.passing} passing, ${next.pending} pending, ${next.failing} failing`,
  };
}

// --- 6. Commit status --------------------------------------------------------

export interface NewCommitEvents {
  events: TranscriptEventInput[];
  /** The full hash list to remember for the next comparison. */
  hashes: string[];
}

/**
 * Events for commits that appeared since the last poll.
 *
 * `previous === undefined` is the first poll after mount. It seeds the baseline
 * and emits nothing: the branch's existing history is not news, and dumping it
 * would put fifty lines into the transcript every time a panel scrolled into
 * view.
 */
export function newCommitEvents(
  taskId: string,
  previous: readonly string[] | undefined,
  commits: readonly CommitInfo[],
): NewCommitEvents {
  const hashes = commits.map((c) => c.hash);
  if (previous === undefined) return { events: [], hashes };
  const known = new Set(previous);
  const events = commits
    .filter((c) => !known.has(c.hash))
    // The list arrives newest-first; a transcript reads oldest-first.
    .reverse()
    .map((c) => ({
      taskId,
      kind: 'commit' as const,
      status: 'committed',
      summary: c.message.split('\n')[0]?.slice(0, 200) || '(no message)',
      detail: c.hash.slice(0, 12),
    }));
  return { events, hashes };
}
