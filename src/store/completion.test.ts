import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalDateKey } from '../lib/date';
import { recordTaskMerged } from './completion';
import { onboardingStage } from './onboarding';
import { setStore, store } from './core';

beforeEach(() => {
  setStore('completedTaskDate', getLocalDateKey());
  setStore('completedTaskCount', 0);
  setStore('mergedTaskTotal', 0);
  setStore('mergedLinesAdded', 0);
  setStore('mergedLinesRemoved', 0);
  setStore('peakConcurrentTasks', 0);
  setStore('diffReviewed', false);
  setStore('projects', []);
});

describe('recordTaskMerged', () => {
  it('raises the lifetime total alongside the daily counter', () => {
    recordTaskMerged();
    recordTaskMerged();

    expect(store.completedTaskCount).toBe(2);
    expect(store.mergedTaskTotal).toBe(2);
  });

  it('keeps the lifetime total across the midnight rollover that resets the daily counter', () => {
    recordTaskMerged();
    expect(store.completedTaskCount).toBe(1);

    // Next day: the daily counter restarts, the lifetime total must not.
    setStore('completedTaskDate', '1999-12-31');
    recordTaskMerged();

    expect(store.completedTaskCount).toBe(1);
    expect(store.mergedTaskTotal).toBe(2);
  });

  it('carries a user out of stage 1 even when the merge moved no lines at all', () => {
    expect(onboardingStage()).toBe(1);

    // `recordMergedLines` returns early for a zero-line merge, so the line
    // totals stay at 0 and the lifetime counter is the only witness.
    recordTaskMerged();

    expect(store.mergedLinesAdded).toBe(0);
    expect(store.mergedLinesRemoved).toBe(0);
    expect(onboardingStage()).toBe(2);
  });
});
