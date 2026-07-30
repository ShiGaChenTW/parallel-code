// Session transcript — store slice and the emission surface.
//
// The renderer owns the switch (persisted in `state.json` with every other
// setting) but the file lives in the main process, so every event crosses IPC.
// Kept in its own module rather than in `ui.ts` so the six detection modules
// and `persistence.ts` can all call it without an import cycle — the same
// reason `offline.ts` sits where it does. dependency-cruiser fails the build
// on a cycle, so this is structural, not stylistic.
//
// Everything here is fire-and-forget by design. A transcript is a diagnostic
// convenience: it must never be able to fail a merge, a spawn, or a PR poll.
// Main drops malformed events silently and returns nothing.

import { store, setStore } from './core';
import { fireAndForget, invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import type { TranscriptEvent, TranscriptEventInput } from '../ipc/types';

/**
 * Push the current value to main.
 *
 * Belt-and-braces, exactly as with offline mode: main reads the same field out
 * of `state.json` at startup, because a recording switch that depends on a
 * renderer round-trip winning a race is not a switch. This covers the remaining
 * case — a first run with no state file, where the renderer holds the value.
 */
export function syncTranscriptEnabledToMain(): void {
  fireAndForget(IPC.SetTranscriptEnabled, { enabled: store.transcriptEnabled });
}

export function setTranscriptEnabled(enabled: boolean): void {
  setStore('transcriptEnabled', enabled);
  syncTranscriptEnabledToMain();
}

/** Delete every transcript on disk. Returns how many files went. */
export async function clearTranscripts(): Promise<number> {
  const result = await invoke<{ removed: number }>(IPC.ClearTranscripts);
  return result?.removed ?? 0;
}

export async function readTranscript(taskId: string): Promise<TranscriptEvent[]> {
  const events = await invoke<TranscriptEvent[]>(IPC.ReadTranscript, { taskId });
  return Array.isArray(events) ? events : [];
}

/**
 * Record one lifecycle event.
 *
 * The switch is checked here as well as in main. That is not redundancy for its
 * own sake: the renderer check means a disabled install does no IPC at all, so
 * the feature costs literally nothing when off — and main's check means a
 * renderer bug cannot start recording without consent. Two gates, two different
 * failure modes covered.
 */
export function recordTranscriptEvent(event: TranscriptEventInput): void {
  if (!store.transcriptEnabled) return;
  if (!event.taskId) return;
  fireAndForget(IPC.AppendTranscriptEvent, { event });
}
