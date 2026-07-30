// AI CLI token usage — store slice.
//
// Deliberately a standalone signal rather than a field on the persisted app
// store: this is derived from files on disk that are the source of truth, so
// saving it into `state.json` would only create a second copy that could
// disagree. Everything here is recomputed by the main process from the CLIs'
// own logs; nothing is persisted, and nothing leaves the machine.

import { createEffect, createSignal, onCleanup } from 'solid-js';
import { store } from './core';
import { fireAndForget, invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import type { TokenUsageSnapshot } from '../ipc/types';

const EMPTY: TokenUsageSnapshot = {
  paths: [],
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  byProvider: {},
  providers: [],
  updatedAt: 0,
};

const [snapshot, setSnapshot] = createSignal<TokenUsageSnapshot>(EMPTY);

export { snapshot as tokenUsage };

/**
 * The worktrees usage is attributed to.
 *
 * Both open and collapsed tasks count — a collapsed task has still spent its
 * tokens — and the project roots are included so work done in a project before
 * a worktree existed is not invisible. Sorted so the array is stable and a
 * re-render does not look like a change to the effect below.
 */
function knownWorktreePaths(): string[] {
  const paths = new Set<string>();
  for (const taskId of [...store.taskOrder, ...store.collapsedTaskOrder]) {
    const task = store.tasks[taskId];
    if (task?.worktreePath) paths.add(task.worktreePath);
  }
  for (const project of store.projects) {
    if (project.path) paths.add(project.path);
  }
  return [...paths].sort();
}

/**
 * Subscribes to usage updates and re-seeds the watcher when the worktree set
 * changes.
 *
 * The re-seed is guarded on the joined path list rather than on the array
 * identity, because Solid's store hands back a new array on any task mutation
 * and re-invoking on every keystroke would have main re-listing directories
 * constantly.
 */
export function startTokenUsageSubscription(): () => void {
  let disposed = false;
  let lastKey = '';

  const off = window.electron.ipcRenderer.on(IPC.TokenUsageUpdate, (data: unknown) => {
    if (disposed || !data || typeof data !== 'object') return;
    const next = data as Partial<TokenUsageSnapshot>;
    if (!Array.isArray(next.paths) || !Array.isArray(next.providers)) return;
    setSnapshot(next as TokenUsageSnapshot);
  });

  createEffect(() => {
    const paths = knownWorktreePaths();
    const key = paths.join('\0');
    if (key === lastKey) return;
    lastKey = key;
    invoke<TokenUsageSnapshot>(IPC.StartTokenUsageWatcher, { worktreePaths: paths })
      .then((initial) => {
        if (!disposed && initial) setSnapshot(initial);
      })
      .catch((err: unknown) => {
        console.warn('[token-usage] failed to start watcher:', err);
      });
  });

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    off();
    fireAndForget(IPC.StopTokenUsageWatcher);
  };

  onCleanup(cleanup);
  return cleanup;
}
