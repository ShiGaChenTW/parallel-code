import { produce } from 'solid-js/store';
import { getLocalDateKey } from '../lib/date';
import { store, setStore } from './core';
import { recordTranscriptEvent } from './transcript';
import { mergeEvent } from '../lib/transcript-events';
import type { MergeResult } from '../ipc/types';

/**
 * `merged` is optional so the counter semantics are unchanged for callers that
 * only want the tally. When it is supplied — which the real merge path always
 * does — the merge also lands in the task's transcript. Keeping the emission
 * here rather than at the call site keeps one event kind to one detection
 * module, which is what makes the six kinds auditable.
 */
export function recordTaskMerged(merged?: { taskId: string; result: MergeResult }): void {
  const today = getLocalDateKey();
  setStore(
    produce((s) => {
      // Lifetime total, kept alongside the daily counter rather than derived
      // from it: `completedTaskCount` rolls over at midnight, so it cannot
      // answer "has this user ever merged" the morning after their first merge.
      s.mergedTaskTotal += 1;
      if (s.completedTaskDate !== today) {
        s.completedTaskDate = today;
        s.completedTaskCount = 1;
        return;
      }
      s.completedTaskCount += 1;
    }),
  );
  if (merged) recordTranscriptEvent(mergeEvent(merged.taskId, merged.result));
}

export function getMergedTasksTodayCount(): number {
  return store.completedTaskDate === getLocalDateKey() ? store.completedTaskCount : 0;
}

export function recordMergedLines(linesAdded: number, linesRemoved: number): void {
  const safeAdded = Number.isFinite(linesAdded) ? Math.max(0, Math.floor(linesAdded)) : 0;
  const safeRemoved = Number.isFinite(linesRemoved) ? Math.max(0, Math.floor(linesRemoved)) : 0;
  if (safeAdded === 0 && safeRemoved === 0) return;

  setStore(
    produce((s) => {
      s.mergedLinesAdded += safeAdded;
      s.mergedLinesRemoved += safeRemoved;
    }),
  );
}

export function getMergedLineTotals(): { added: number; removed: number } {
  return {
    added: store.mergedLinesAdded,
    removed: store.mergedLinesRemoved,
  };
}
