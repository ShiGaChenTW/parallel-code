import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// `buildPersistedState` itself performs no IPC, but importing `./persistence`
// pulls in the IPC module graph, which has no main-process bridge under
// vitest's `environment: 'node'`.
vi.mock('../lib/ipc', () => ({
  invoke: vi.fn(),
  fireAndForget: vi.fn(),
}));

import { persistedSnapshot } from './autosave';
import { buildPersistedState } from './persistence';
import { setStore } from './core';
import type { Task, Terminal } from './types';

/**
 * The autosave drift gate.
 *
 * `saveState()` (persistence.ts) and `persistedSnapshot()` (autosave.ts) are two
 * hand-written field lists. The snapshot is what `setupAutosave`'s effect reads,
 * so a field that saveState writes but the snapshot never reads has no reactive
 * dependency: changing it schedules no save, and the value survives only if the
 * `beforeunload` handler in App.tsx gets to run. A crash, a force-quit or a
 * power cut loses it.
 *
 * That drift shipped once already — `locale` among six others — with no gate to
 * catch it. These tests are the gate. They derive both key sets at runtime, so a
 * field added to `saveState` in future fails here without anyone remembering to
 * update a list.
 *
 * The two lists are deliberately NOT the same object. The snapshot is a change
 * *detector*, not a serializer: it reduces `terminals` to `{ name }` and `tasks`
 * to the subset of fields a user can edit, because it is recomputed on every
 * store mutation and pays a `JSON.stringify` each time. Deriving it from
 * `buildPersistedState()` would newly track `store.agents[*].def` and stringify
 * the full ~30-field persisted task shape on every keystroke. Hence: two lists,
 * one machine-checked relationship.
 */

/**
 * Keys `saveState()` writes that `persistedSnapshot()` deliberately does not
 * read. Every entry needs a reason — the reason is the whole point of the
 * exemption. Adding a key here is a conscious decision that losing a change to
 * it between the last save and a crash is acceptable, or that some other
 * snapshot field already changes whenever it does.
 */
const SNAPSHOT_EXEMPT_KEYS: Record<string, string> = {
  panelUserSizeMigratedV2:
    'Constant literal `true`, not a store field. It can never change, so it can never need a save.',
  hulyIssues:
    'Refetchable cache of Huly issues, potentially hundreds of objects. Stringifying it on every ' +
    'store mutation would cost more than losing it, which costs one API call. It is covered ' +
    'indirectly: `hulyIssuesFetchedAt` is in the snapshot and every writer of `hulyIssues` ' +
    '(huly.ts setHulyProjectIdentifier / clearHulyCredentials / refreshHulyIssues) writes both ' +
    'in the same breath, so the cheap number is a faithful proxy for the expensive array.',
};

const TASK_ID = 'drift-gate-task';
const TERMINAL_ID = 'drift-gate-terminal';

/**
 * Seed the store so every conditionally-built branch of `buildPersistedState`
 * materializes — notably `persisted.terminals`, which is only created when at
 * least one terminal exists.
 */
beforeAll(() => {
  setStore('tasks', TASK_ID, {
    id: TASK_ID,
    name: 'drift gate',
    notes: '',
    lastPrompt: '',
    branchName: 'chore/drift-gate',
    worktreePath: '/tmp/drift-gate-task',
    agentIds: [],
    shellAgentIds: [],
    gitIsolation: 'worktree',
  } as unknown as Task);
  setStore('terminals', TERMINAL_ID, {
    id: TERMINAL_ID,
    name: 'drift gate terminal',
    agentId: 'drift-gate-agent',
  } as unknown as Terminal);
  setStore('taskOrder', (order) => [...order, TASK_ID, TERMINAL_ID]);
});

afterAll(() => {
  setStore('taskOrder', (order) => order.filter((id) => id !== TASK_ID && id !== TERMINAL_ID));
  setStore('tasks', TASK_ID, undefined as unknown as Task);
  setStore('terminals', TERMINAL_ID, undefined as unknown as Terminal);
});

function persistedKeys(): string[] {
  return Object.keys(buildPersistedState());
}

function snapshotKeys(): string[] {
  return Object.keys(JSON.parse(persistedSnapshot()) as Record<string, unknown>);
}

describe('autosave snapshot covers everything persistence writes', () => {
  it('leaves no persisted field without a reactive dependency', () => {
    const inSnapshot = new Set(snapshotKeys());
    const uncovered = persistedKeys().filter(
      (key) => !inSnapshot.has(key) && !(key in SNAPSHOT_EXEMPT_KEYS),
    );

    expect(
      uncovered,
      `saveState() writes ${uncovered.length} field(s) that persistedSnapshot() never reads: ` +
        `${uncovered.join(', ')}.\n` +
        'Changing any of them schedules no save — the value survives only if beforeunload runs.\n' +
        'Fix by either adding the field to persistedSnapshot() in src/store/autosave.ts, or, if ' +
        'it is deliberately excluded, adding it to SNAPSHOT_EXEMPT_KEYS in this file with a reason.',
    ).toEqual([]);
  });

  it('tracks nothing that is never persisted', () => {
    const persisted = new Set(persistedKeys());
    const stray = snapshotKeys().filter((key) => !persisted.has(key));

    expect(
      stray,
      `persistedSnapshot() reads ${stray.length} field(s) that saveState() does not write: ` +
        `${stray.join(', ')}.\n` +
        'Each one wakes the 1000ms debounce for a change that is never saved. Remove it from ' +
        'persistedSnapshot() in src/store/autosave.ts, or add it to saveState().',
    ).toEqual([]);
  });

  it('exempts nothing that is already covered', () => {
    const inSnapshot = new Set(snapshotKeys());
    const redundant = Object.keys(SNAPSHOT_EXEMPT_KEYS).filter((key) => inSnapshot.has(key));

    expect(
      redundant,
      `SNAPSHOT_EXEMPT_KEYS lists ${redundant.join(', ')}, which persistedSnapshot() does read. ` +
        'Stale exemptions hide real drift — drop them.',
    ).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    for (const [key, reason] of Object.entries(SNAPSHOT_EXEMPT_KEYS)) {
      expect(reason.length, `SNAPSHOT_EXEMPT_KEYS.${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

/**
 * The gate above proves coverage at the level of key *names*. These prove the
 * thing that actually matters for each field that was missing: mutating it
 * changes the snapshot string.
 *
 * That is the same condition SolidJS uses to establish a reactive dependency —
 * a differing serialization means the value was read during the call, and a
 * store read inside a tracked scope is a tracked dependency. It has to be
 * asserted this way rather than by running `setupAutosave()` and watching a save
 * fire, because `vitest.config.ts` builds solid-js in SSR mode, where
 * `createEffect` is a no-op and no reactive graph exists at all.
 */
describe('previously-drifted fields move the snapshot', () => {
  const cases: [string, () => void, () => void][] = [
    [
      'showPromptInput',
      () => setStore('showPromptInput', false),
      () => setStore('showPromptInput', true),
    ],
    [
      'fontSmoothing',
      () => setStore('fontSmoothing', false),
      () => setStore('fontSmoothing', true),
    ],
    [
      'dockerImage',
      () => setStore('dockerImage', 'custom:tag'),
      () => setStore('dockerImage', 'parallel-code-agent:latest'),
    ],
    [
      'askCodeProvider',
      () => setStore('askCodeProvider', 'minimax'),
      () => setStore('askCodeProvider', 'claude'),
    ],
    [
      'verboseLogging',
      () => setStore('verboseLogging', true),
      () => setStore('verboseLogging', false),
    ],
    ['locale', () => setStore('locale', 'zh-TW'), () => setStore('locale', 'en')],
    ['mergedTaskTotal', () => setStore('mergedTaskTotal', 7), () => setStore('mergedTaskTotal', 0)],
    [
      'peakConcurrentTasks',
      () => setStore('peakConcurrentTasks', 4),
      () => setStore('peakConcurrentTasks', 0),
    ],
    ['diffReviewed', () => setStore('diffReviewed', true), () => setStore('diffReviewed', false)],
    [
      'keybindingMigrationDismissed',
      () => setStore('keybindingMigrationDismissed', true),
      () => setStore('keybindingMigrationDismissed', false),
    ],
    [
      'activeCustomThemeId',
      () => setStore('activeCustomThemeId', 'my-theme'),
      () => setStore('activeCustomThemeId', null),
    ],
    [
      'hulyProjectIdentifier',
      () => setStore('hulyProjectIdentifier', 'PROJ'),
      () => setStore('hulyProjectIdentifier', ''),
    ],
    [
      'hulyIssuesFetchedAt',
      () => setStore('hulyIssuesFetchedAt', 1_700_000_000_000),
      () => setStore('hulyIssuesFetchedAt', 0),
    ],
  ];

  for (const [field, apply, revert] of cases) {
    it(`${field} changes the snapshot`, () => {
      const before = persistedSnapshot();
      apply();
      const after = persistedSnapshot();
      revert();
      expect(after).not.toBe(before);
      expect(persistedSnapshot()).toBe(before);
    });
  }
});

/**
 * `locale` is the field the user actually felt: switching to 繁體中文 scheduled
 * no save, so an abnormal shutdown reverted the app to English.
 */
describe('locale specifically', () => {
  it('appears in the snapshot with its current value', () => {
    setStore('locale', 'zh-TW');
    const snapshot = JSON.parse(persistedSnapshot()) as { locale?: string };
    setStore('locale', 'en');
    expect(snapshot.locale).toBe('zh-TW');
  });
});
