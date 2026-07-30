import { store, setStore } from './core';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { isIssueCacheStale } from '../lib/huly-issues';
import type { HulyIssue } from '../ipc/types';

/**
 * Reactive state and IPC calls for the Huly read path.
 *
 * All the interesting logic — the issue/task join, staleness, branch naming —
 * lives in `lib/huly-issues.ts` so it is testable under `environment: 'node'`.
 * This file is the plumbing around it.
 */

let inFlight: Promise<void> | null = null;

export function hulyConfigured(): boolean {
  return store.hulyProjectIdentifier.trim() !== '';
}

export function setHulyProjectIdentifier(identifier: string): void {
  setStore('hulyProjectIdentifier', identifier.trim());
  // The cached list belongs to the previous project; keeping it would show the
  // wrong issues until the next refresh lands.
  setStore('hulyIssues', []);
  setStore('hulyIssuesFetchedAt', 0);
}

export async function saveHulyCredentials(
  url: string,
  workspace: string,
  token: string,
): Promise<void> {
  await invoke(IPC.HulySaveCredentials, { url, workspace, token });
}

export async function clearHulyCredentials(): Promise<void> {
  await invoke(IPC.HulyClearCredentials);
  setStore('hulyIssues', []);
  setStore('hulyIssuesFetchedAt', 0);
}

export function hasHulyCredentials(): Promise<boolean> {
  return invoke<boolean>(IPC.HulyHasCredentials);
}

export function testHulyConnection(): Promise<{ ok: boolean; projects: string[] }> {
  return invoke<{ ok: boolean; projects: string[] }>(IPC.HulyTestConnection);
}

/**
 * Refresh the cached issue list.
 *
 * Concurrent callers share one request: the picker refreshes on open, and a
 * second open while the first is still in flight should not double-fetch.
 * On failure the cache is left alone — a stale list beats an empty one, and the
 * caller surfaces the error.
 */
export function refreshHulyIssues(force = false): Promise<void> {
  const identifier = store.hulyProjectIdentifier.trim();
  if (identifier === '') return Promise.resolve();
  if (!force && !isIssueCacheStale(store.hulyIssuesFetchedAt, Date.now())) {
    return Promise.resolve();
  }
  if (inFlight) return inFlight;

  inFlight = invoke<HulyIssue[]>(IPC.HulyListIssues, { projectIdentifier: identifier })
    .then((issues) => {
      setStore('hulyIssues', issues);
      setStore('hulyIssuesFetchedAt', Date.now());
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
