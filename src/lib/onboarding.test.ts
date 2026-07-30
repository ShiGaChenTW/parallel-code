import { describe, expect, it } from 'vitest';
import {
  deriveOnboardingStage,
  nextPeakConcurrentTasks,
  onboardingSteps,
  type OnboardingSignals,
  type OnboardingStepId,
} from './onboarding';

/** A brand-new install: nothing linked, nothing run, no persisted state at all. */
function freshSignals(overrides: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return {
    projectCount: 0,
    taskCount: 0,
    mergedLinesAdded: 0,
    mergedLinesRemoved: 0,
    mergedTodayCount: 0,
    mergedTaskTotal: 0,
    peakConcurrentTasks: 0,
    diffReviewed: false,
    ...overrides,
  };
}

/**
 * A user who was already running the app before this feature existed.
 *
 * The three fields the feature adds are pinned to their absent-field defaults —
 * `mergedTaskTotal: 0`, `peakConcurrentTasks: 0`, `diffReviewed: false` — which
 * is exactly what `loadState` produces for a `state.json` written by an older
 * build, since `PersistedState` has no schema version and a missing field reads
 * as `undefined`.
 */
function legacySignals(overrides: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return freshSignals({
    projectCount: 2,
    mergedLinesAdded: 1_842,
    mergedLinesRemoved: 507,
    ...overrides,
  });
}

function doneIds(signals: OnboardingSignals): OnboardingStepId[] {
  return onboardingSteps(signals)
    .filter((step) => step.done)
    .map((step) => step.id);
}

function currentId(signals: OnboardingSignals): OnboardingStepId | undefined {
  return onboardingSteps(signals).find((step) => step.current)?.id;
}

describe('deriveOnboardingStage', () => {
  it('puts a brand-new install at stage 1', () => {
    expect(deriveOnboardingStage(freshSignals())).toBe(1);
  });

  it('keeps a user who linked a project but never merged at stage 1', () => {
    expect(deriveOnboardingStage(freshSignals({ projectCount: 1, taskCount: 1 }))).toBe(1);
  });

  it('moves to stage 2 on the first merge', () => {
    expect(deriveOnboardingStage(freshSignals({ projectCount: 1, mergedTaskTotal: 1 }))).toBe(2);
  });

  it('moves to stage 3 once two tasks have run at the same time', () => {
    expect(
      deriveOnboardingStage(freshSignals({ projectCount: 1, mergedTaskTotal: 1, taskCount: 2 })),
    ).toBe(3);
  });

  it('holds stage 3 after the user closes back down to one task', () => {
    const signals = freshSignals({
      projectCount: 1,
      mergedTaskTotal: 3,
      taskCount: 1,
      peakConcurrentTasks: 2,
    });
    expect(deriveOnboardingStage(signals)).toBe(3);
  });

  it('does not promote past stage 2 for a user who never ran two tasks at once', () => {
    const signals = freshSignals({
      projectCount: 1,
      mergedTaskTotal: 12,
      taskCount: 1,
      peakConcurrentTasks: 1,
    });
    expect(deriveOnboardingStage(signals)).toBe(2);
  });

  it('requires a merge before stage 3, so the ladder stays ordered', () => {
    const signals = freshSignals({ projectCount: 1, taskCount: 4, peakConcurrentTasks: 4 });
    expect(deriveOnboardingStage(signals)).toBe(1);
  });

  it('ignores junk counts rather than throwing or reading them as evidence', () => {
    const signals = freshSignals({
      projectCount: Number.NaN,
      taskCount: -3,
      mergedLinesAdded: Number.NaN,
      mergedTaskTotal: -1,
    });
    expect(deriveOnboardingStage(signals)).toBe(1);
  });
});

describe('deriveOnboardingStage for a user who predates the stage fields', () => {
  it('does not demote an existing user with projects and merge history to stage 1', () => {
    const signals = legacySignals();

    expect(signals.mergedTaskTotal).toBe(0);
    expect(signals.peakConcurrentTasks).toBe(0);
    expect(signals.diffReviewed).toBe(false);
    expect(deriveOnboardingStage(signals)).not.toBe(1);
    expect(deriveOnboardingStage(signals)).toBe(2);
  });

  it('reaches stage 3 on the first launch after upgrading when tasks are already open', () => {
    expect(deriveOnboardingStage(legacySignals({ taskCount: 3 }))).toBe(3);
  });

  it('accepts a merge witnessed only by removed lines', () => {
    const signals = legacySignals({ mergedLinesAdded: 0, mergedLinesRemoved: 42 });
    expect(deriveOnboardingStage(signals)).toBe(2);
  });

  it("accepts today's merge counter as evidence when the line totals missed it", () => {
    const signals = legacySignals({
      mergedLinesAdded: 0,
      mergedLinesRemoved: 0,
      mergedTodayCount: 1,
    });
    expect(deriveOnboardingStage(signals)).toBe(2);
  });

  it('falls to stage 1 only when there is genuinely no merge evidence at all', () => {
    const signals = legacySignals({ mergedLinesAdded: 0, mergedLinesRemoved: 0 });
    expect(deriveOnboardingStage(signals)).toBe(1);
  });
});

describe('nextPeakConcurrentTasks', () => {
  it('raises the mark when more tasks are open than before', () => {
    expect(nextPeakConcurrentTasks(1, 3)).toBe(3);
  });

  it('never lowers the mark', () => {
    expect(nextPeakConcurrentTasks(4, 1)).toBe(4);
  });

  it('starts from the live count when no mark was ever persisted', () => {
    expect(nextPeakConcurrentTasks(0, 2)).toBe(2);
  });

  it('treats junk as zero so a corrupt state file cannot poison the mark', () => {
    expect(nextPeakConcurrentTasks(Number.NaN, 2)).toBe(2);
    expect(nextPeakConcurrentTasks(-5, -2)).toBe(0);
  });
});

describe('onboardingSteps', () => {
  it('marks nothing done and points at linking a project on a fresh install', () => {
    expect(doneIds(freshSignals())).toEqual([]);
    expect(currentId(freshSignals())).toBe('link-project');
  });

  it('points at creating a task once a project is linked', () => {
    const signals = freshSignals({ projectCount: 1 });
    expect(doneIds(signals)).toEqual(['link-project']);
    expect(currentId(signals)).toBe('create-task');
  });

  it('points at the diff once a task exists', () => {
    const signals = freshSignals({ projectCount: 1, taskCount: 1 });
    expect(currentId(signals)).toBe('review-diff');
  });

  it('points at the merge once a diff has been opened', () => {
    const signals = freshSignals({ projectCount: 1, taskCount: 1, diffReviewed: true });
    expect(doneIds(signals)).toEqual(['link-project', 'create-task', 'review-diff']);
    expect(currentId(signals)).toBe('merge-task');
  });

  it('keeps the earlier steps ticked after a merge with cleanup removed the task', () => {
    const signals = freshSignals({ projectCount: 1, taskCount: 0, mergedTaskTotal: 1 });
    expect(doneIds(signals)).toEqual(['link-project', 'create-task', 'review-diff', 'merge-task']);
    expect(currentId(signals)).toBeUndefined();
  });

  it('marks at most one step current, and none once every step is done', () => {
    const cases: [OnboardingSignals, number][] = [
      [freshSignals(), 1],
      [freshSignals({ projectCount: 1 }), 1],
      [freshSignals({ projectCount: 1, taskCount: 2 }), 1],
      [legacySignals(), 0],
    ];
    for (const [signals, expected] of cases) {
      expect(onboardingSteps(signals).filter((step) => step.current)).toHaveLength(expected);
    }
  });

  it('gives every step a non-empty English label for the translator', () => {
    for (const step of onboardingSteps(freshSignals())) {
      expect(step.label.trim()).toBe(step.label);
      expect(step.label.length).toBeGreaterThan(0);
    }
  });
});
