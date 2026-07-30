/**
 * Progressive disclosure stages.
 *
 * The app ships the whole surface — including Coordinator and Arena — to a
 * first-time user. This module decides how much of it to actively recommend,
 * based on what the user has already accomplished. Nothing here hides or
 * disables an entry point; a higher stage only adds guidance.
 *
 * Pure by construction: no store import, no reactivity, no DOM. `vitest` runs
 * with `environment: 'node'` and no DOM harness, so the stage rules have to be
 * testable without rendering anything. Components stay dumb renderers of what
 * this file returns.
 *
 * ## Why the stage is derived, not stored
 *
 * `state.json` has no schema version and no stage field. Migration in
 * `store/persistence.ts` works by existence/shape checks, so any field added
 * today reads as `undefined` for the users already running the app. A stage
 * stored as a plain number would therefore default to "stage 1" for every
 * existing user and demote them to the beginner path.
 *
 * So the stage is a function of usage evidence, and every input is either a
 * value that already existed in `state.json` (`mergedLinesAdded`,
 * `mergedLinesRemoved`, `completedTaskCount`) or a live count read off the
 * store (`taskCount`). The three fields this feature adds
 * (`mergedTaskTotal`, `peakConcurrentTasks`, `diffReviewed`) only ever raise
 * the stage — absent, they cost nothing, because an older signal covers the
 * same ground.
 */

/** 1 = first success, 2 = parallel work, 3 = advanced features. */
export type OnboardingStage = 1 | 2 | 3;

/**
 * Everything the stage rules are allowed to look at.
 *
 * Grouped by where the value comes from, because that is what makes the
 * "existing user is not demoted" property checkable by reading this list.
 */
export interface OnboardingSignals {
  /** Live: `store.projects.length`. */
  projectCount: number;
  /** Live: number of task records, active and collapsed. */
  taskCount: number;

  /** Pre-existing in `state.json`: cumulative lines merged, never reset. */
  mergedLinesAdded: number;
  /** Pre-existing in `state.json`: cumulative lines merged, never reset. */
  mergedLinesRemoved: number;
  /** Pre-existing in `state.json`: merges recorded today only (rolls daily). */
  mergedTodayCount: number;

  /** Added by this feature: lifetime merge count. 0 for pre-existing data. */
  mergedTaskTotal: number;
  /** Added by this feature: high-water mark of simultaneous tasks. 0 for pre-existing data. */
  peakConcurrentTasks: number;
  /** Added by this feature: the user has opened a diff at least once. false for pre-existing data. */
  diffReviewed: boolean;
}

export type OnboardingStepId = 'link-project' | 'create-task' | 'review-diff' | 'merge-task';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** English source text — the caller runs it through `tr()`. */
  label: string;
  done: boolean;
  /** The first step that is not done. At most one step is current. */
  current: boolean;
}

/** Treat junk (NaN, negative, non-number) as "no evidence" rather than throwing. */
function count(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Has the user ever merged a task?
 *
 * Four independent witnesses, because no single one is complete:
 *
 * - `mergedTaskTotal` is exact but only exists from this release onward.
 * - `mergedLinesAdded/Removed` are cumulative and pre-existing, but
 *   `recordMergedLines` returns early when a merge moved zero lines, so a
 *   whitespace-only merge leaves them at 0.
 * - `mergedTodayCount` is pre-existing but rolls over at midnight, so it only
 *   witnesses a merge that happened today.
 *
 * Any one of them firing is proof; the union is what keeps an existing user
 * out of stage 1.
 */
function hasMergedEver(signals: OnboardingSignals): boolean {
  return (
    count(signals.mergedTaskTotal) > 0 ||
    count(signals.mergedLinesAdded) > 0 ||
    count(signals.mergedLinesRemoved) > 0 ||
    count(signals.mergedTodayCount) > 0
  );
}

/**
 * How many tasks the user has had open at the same time, at most.
 *
 * The live count is itself evidence: someone with three tasks on screen right
 * now has demonstrably run three at once, whatever the persisted mark says.
 * Taking the max of the two is what lets an existing user reach stage 3 on the
 * first launch after upgrading, before `peakConcurrentTasks` has ever been
 * written.
 */
function concurrentTaskReach(signals: OnboardingSignals): number {
  return Math.max(count(signals.peakConcurrentTasks), count(signals.taskCount));
}

/**
 * Raise a persisted high-water mark. Monotonic on purpose — closing a task
 * must not walk the user back down a stage.
 */
export function nextPeakConcurrentTasks(previous: number, live: number): number {
  return Math.max(count(previous), count(live));
}

/**
 * Stage 3 requires a merge as well as concurrency, so the ladder stays ordered:
 * every stage-3 user is also a stage-2 user.
 *
 * The consequence is deliberate. Someone with two tasks open who has never
 * merged sits at stage 1 and is still pointed at the merge loop, because
 * Coordinator and Arena are both built on top of "a task produces a diff you
 * review and merge" — recommending them to someone who has not closed that
 * loop once is the failure mode this feature exists to prevent. Nothing is
 * hidden from them; they simply are not nudged toward it.
 */
export function deriveOnboardingStage(signals: OnboardingSignals): OnboardingStage {
  if (!hasMergedEver(signals)) return 1;
  return concurrentTaskReach(signals) >= 2 ? 3 : 2;
}

/**
 * The stage-1 checklist: link a project, create a task, see the diff, merge.
 *
 * `create-task` and `review-diff` also count as done once a merge has been
 * recorded. A merge with cleanup removes the task, so a user who merged their
 * only task has `taskCount === 0` — without that, the checklist would tick
 * backwards at the exact moment it should be celebrating.
 */
export function onboardingSteps(signals: OnboardingSignals): OnboardingStep[] {
  const merged = hasMergedEver(signals);
  const done: Record<OnboardingStepId, boolean> = {
    'link-project': count(signals.projectCount) > 0,
    'create-task': count(signals.taskCount) > 0 || signals.diffReviewed || merged,
    'review-diff': signals.diffReviewed || merged,
    'merge-task': merged,
  };
  const labels: Record<OnboardingStepId, string> = {
    'link-project': 'Link a project',
    'create-task': 'Create a task',
    'review-diff': 'Review the diff',
    'merge-task': 'Merge it back',
  };
  const ids: OnboardingStepId[] = ['link-project', 'create-task', 'review-diff', 'merge-task'];

  let currentAssigned = false;
  return ids.map((id) => {
    const isCurrent = !done[id] && !currentAssigned;
    if (isCurrent) currentAssigned = true;
    return { id, label: labels[id], done: done[id], current: isCurrent };
  });
}
