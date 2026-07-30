// Offline mode — store slice.
//
// The renderer owns the switch (it is persisted in `state.json` alongside every
// other setting) but most of the surfaces it governs live in the main process,
// so every change has to be pushed across IPC. Kept in its own module rather
// than in `ui.ts` so both `ui.ts` and `persistence.ts` can call it without
// introducing an import cycle — dependency-cruiser fails the build on one.

import { store, setStore } from './core';
import { fireAndForget } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';

/**
 * Tell the main process the current value.
 *
 * Also called once after `loadState`. That is belt-and-braces rather than the
 * primary mechanism: main reads the same field straight out of `state.json` at
 * startup, because the updater fires a silent check ten seconds after launch
 * and an offline promise should not depend on a renderer round-trip winning a
 * race. This push covers the remaining case — a first run with no state file,
 * where main defaulted and the renderer is the one holding the value.
 */
export function syncOfflineModeToMain(): void {
  fireAndForget(IPC.SetOfflineMode, { enabled: store.offlineMode });
}

export function setOfflineMode(enabled: boolean): void {
  setStore('offlineMode', enabled);
  syncOfflineModeToMain();
}
