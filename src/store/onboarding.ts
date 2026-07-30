import { store, setStore } from './core';
import {
  deriveOnboardingStage,
  onboardingSteps,
  type OnboardingSignals,
  type OnboardingStage,
  type OnboardingStep,
} from '../lib/onboarding';

/**
 * Reactive read of the onboarding stage.
 *
 * Mirrors the split the codebase already uses for themes and translation:
 * `lib/onboarding.ts` holds the pure rules (unit-tested under vitest's node
 * environment), this file is the reactive projection of the store onto them.
 * Every property touched here is a store read, so calling `onboardingStage()`
 * inside JSX re-renders the caller when the underlying signal changes.
 */
function signals(): OnboardingSignals {
  return {
    projectCount: store.projects.length,
    // Counts active and collapsed tasks alike — `store.tasks` holds both,
    // while `taskOrder` also carries plain terminals.
    taskCount: Object.keys(store.tasks).length,
    mergedLinesAdded: store.mergedLinesAdded,
    mergedLinesRemoved: store.mergedLinesRemoved,
    mergedTodayCount: store.completedTaskCount,
    mergedTaskTotal: store.mergedTaskTotal,
    peakConcurrentTasks: store.peakConcurrentTasks,
    diffReviewed: store.diffReviewed,
  };
}

export function onboardingStage(): OnboardingStage {
  return deriveOnboardingStage(signals());
}

export function currentOnboardingSteps(): OnboardingStep[] {
  return onboardingSteps(signals());
}

/**
 * Record that the user has opened a diff.
 *
 * Called from the diff viewer itself rather than from each of the call sites
 * that open it, so a diff reached from the changed-files list, the commit view,
 * or Arena all count the same. Writes only on the first transition so the
 * autosave debounce is not woken on every open.
 */
export function recordDiffReviewed(): void {
  if (store.diffReviewed) return;
  setStore('diffReviewed', true);
}
