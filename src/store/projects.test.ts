import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/dialog', () => ({
  confirm: vi.fn(),
  openDialog: vi.fn(),
}));

vi.mock('../lib/ipc', () => ({
  invoke: vi.fn(),
}));

vi.mock('./tasks', () => ({
  closeTask: vi.fn(),
}));

import { openDialog } from '../lib/dialog';
import { invoke } from '../lib/ipc';
import { setStore, store } from './core';
import {
  cancelAddProject,
  changePendingProjectPath,
  commitPendingProject,
  pickProjectDraft,
  projectNameFromPath,
  startAddProject,
  updateProject,
} from './projects';
import type { ProjectSettings } from './types';

describe('updateProject', () => {
  afterEach(() => {
    setStore('projects', []);
  });

  it('clears the configured coverage report path when undefined is provided', () => {
    setStore('projects', [
      {
        id: 'p1',
        name: 'Project',
        path: '/repo',
        color: 'hsl(0, 70%, 75%)',
        coverageReportPath: 'coverage/lcov.info',
      },
    ]);

    updateProject('p1', { coverageReportPath: undefined });

    expect(store.projects[0]?.coverageReportPath).toBeUndefined();
  });

  it('clears the default base branch when undefined is provided', () => {
    setStore('projects', [
      {
        id: 'p1',
        name: 'Project',
        path: '/repo',
        color: 'hsl(0, 70%, 75%)',
        defaultBaseBranch: 'main',
      },
    ]);

    updateProject('p1', { defaultBaseBranch: undefined });

    expect(store.projects[0]?.defaultBaseBranch).toBeUndefined();
  });
});

/**
 * The add-project flow, and specifically the guarantee that gives it its shape:
 * cancelling creates nothing.
 *
 * The old `pickAndAddProject` called `addProject` the moment a folder came
 * back, so "cancel" could only ever have meant create-then-delete — and
 * `removeProject` refuses to drop a project any task references, so even that
 * was not reliable. The flow is now split at the write: `pickProjectDraft` and
 * `startAddProject` read and park a draft, and `commitPendingProject` is the
 * only function in the module that adds a project. These tests pin both halves
 * of that split, because the split is the feature.
 */
describe('add-project flow', () => {
  const pickFolder = vi.mocked(openDialog);
  const checkIsGitRepo = vi.mocked(invoke);

  /** What the dialog collects when the user changes nothing. */
  const untouchedSettings = (name: string, color: string): ProjectSettings => ({
    name,
    color,
    branchPrefix: 'task',
    deleteBranchOnClose: true,
    defaultGitIsolation: 'worktree',
    defaultBaseBranch: undefined,
    coverageReportPath: undefined,
    terminalBookmarks: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setStore('projects', []);
    setStore('lastProjectId', null);
    setStore('pendingProjectDraft', null);
    setStore('taskOrder', []);
    setStore('collapsedTaskOrder', []);
    setStore('tasks', {});
  });

  afterEach(() => {
    setStore('projects', []);
    setStore('lastProjectId', null);
    setStore('pendingProjectDraft', null);
  });

  function pickReturns(path: string, isGitRepo: boolean): void {
    pickFolder.mockResolvedValue(path);
    checkIsGitRepo.mockResolvedValue(isGitRepo);
  }

  describe('projectNameFromPath', () => {
    it('suggests the last path segment', () => {
      expect(projectNameFromPath('/Users/me/code/my-app')).toBe('my-app');
    });

    it('falls back to the whole path when there is no last segment', () => {
      // A trailing slash leaves an empty final segment; the old flow fell back
      // to the full path rather than naming the project ''.
      expect(projectNameFromPath('/')).toBe('/');
    });
  });

  describe('pickProjectDraft', () => {
    it('describes the picked folder without touching the store', async () => {
      pickReturns('/Users/me/code/my-app', true);

      const draft = await pickProjectDraft();

      expect(draft).toMatchObject({
        name: 'my-app',
        path: '/Users/me/code/my-app',
        isGitRepo: true,
      });
      expect(draft?.color).toMatch(/^hsl\(\d+, 70%, 75%\)$/);
      expect(store.projects).toEqual([]);
      expect(store.lastProjectId).toBeNull();
      expect(store.pendingProjectDraft).toBeNull();
    });

    it('carries a non-git folder through as detected', async () => {
      // The dialog hides branch prefix and the git isolation block on this
      // flag, so it has to survive the pick rather than be assumed.
      pickReturns('/Users/me/notes', false);

      expect(await pickProjectDraft()).toMatchObject({ isGitRepo: false });
    });

    it('returns null when the folder picker is dismissed', async () => {
      pickFolder.mockResolvedValue(null);

      expect(await pickProjectDraft()).toBeNull();
      expect(checkIsGitRepo).not.toHaveBeenCalled();
      expect(store.projects).toEqual([]);
    });
  });

  describe('startAddProject', () => {
    it('parks a draft and creates nothing', async () => {
      pickReturns('/Users/me/code/my-app', true);

      await startAddProject();

      expect(store.pendingProjectDraft).toMatchObject({ name: 'my-app' });
      expect(store.projects).toEqual([]);
      expect(store.lastProjectId).toBeNull();
    });

    it('parks nothing when the folder picker is dismissed', async () => {
      pickFolder.mockResolvedValue(null);

      await startAddProject();

      expect(store.pendingProjectDraft).toBeNull();
      expect(store.projects).toEqual([]);
    });
  });

  describe('cancelling', () => {
    it('leaves no project behind — the whole point of the split', async () => {
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();
      expect(store.pendingProjectDraft).not.toBeNull();

      cancelAddProject();

      expect(store.projects).toEqual([]);
      expect(store.lastProjectId).toBeNull();
      expect(store.pendingProjectDraft).toBeNull();
    });

    it('leaves an existing project list untouched', async () => {
      // The sidebar residue this flow was written to prevent would show up
      // here as a fourth entry, or as `lastProjectId` moved off 'p1'.
      setStore('projects', [
        { id: 'p1', name: 'Existing', path: '/repo', color: 'hsl(0, 70%, 75%)' },
      ]);
      setStore('lastProjectId', 'p1');
      pickReturns('/Users/me/code/my-app', true);

      await startAddProject();
      cancelAddProject();

      expect(store.projects).toHaveLength(1);
      expect(store.projects[0]?.id).toBe('p1');
      expect(store.lastProjectId).toBe('p1');
    });

    it('is repeatable — picking and cancelling twice still creates nothing', async () => {
      pickReturns('/Users/me/code/one', true);
      await startAddProject();
      cancelAddProject();
      pickReturns('/Users/me/code/two', true);
      await startAddProject();
      cancelAddProject();

      expect(store.projects).toEqual([]);
    });
  });

  describe('commitPendingProject', () => {
    it('creates the project the draft described, with the dialog settings', async () => {
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();

      const id = commitPendingProject({
        ...untouchedSettings('Renamed', 'hsl(210, 70%, 75%)'),
        branchPrefix: 'feat',
        defaultBaseBranch: 'develop',
      });

      expect(id).not.toBeNull();
      expect(store.projects).toHaveLength(1);
      expect(store.projects[0]).toMatchObject({
        id,
        name: 'Renamed',
        path: '/Users/me/code/my-app',
        color: 'hsl(210, 70%, 75%)',
        branchPrefix: 'feat',
        defaultBaseBranch: 'develop',
        isGitRepo: true,
      });
    });

    it('selects the new project, as the one-step flow did', async () => {
      // `addProject` sets `lastProjectId`; routing the create through it rather
      // than pushing a project directly is what keeps that side effect.
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();

      const id = commitPendingProject(untouchedSettings('my-app', 'hsl(0, 70%, 75%)'));

      expect(store.lastProjectId).toBe(id);
    });

    it('matches the old one-step result when the user changes nothing', async () => {
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();
      const draft = store.pendingProjectDraft;

      commitPendingProject(untouchedSettings(draft?.name ?? '', draft?.color ?? ''));

      // Name from the last path segment, the draft's random pastel, and the
      // detected git flag — exactly what `pickAndAddProject` produced.
      expect(store.projects[0]).toMatchObject({
        name: 'my-app',
        path: '/Users/me/code/my-app',
        color: draft?.color,
        isGitRepo: true,
      });
    });

    it('preserves a non-git detection through the create', async () => {
      pickReturns('/Users/me/notes', false);
      await startAddProject();

      commitPendingProject(untouchedSettings('notes', 'hsl(0, 70%, 75%)'));

      expect(store.projects[0]?.isGitRepo).toBe(false);
    });

    it('clears the draft so the dialog closes exactly once', async () => {
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();

      commitPendingProject(untouchedSettings('my-app', 'hsl(0, 70%, 75%)'));

      expect(store.pendingProjectDraft).toBeNull();
    });

    it('creates nothing when there is no draft', () => {
      // Cancel clears the draft before anything else runs, so a late or
      // duplicated save cannot resurrect a project the user declined.
      expect(commitPendingProject(untouchedSettings('Ghost', 'hsl(0, 70%, 75%)'))).toBeNull();
      expect(store.projects).toEqual([]);
    });
  });

  describe('changePendingProjectPath', () => {
    it('re-detects isGitRepo and keeps the chosen colour, creating nothing', async () => {
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();
      const firstColor = store.pendingProjectDraft?.color;

      pickReturns('/Users/me/notes', false);
      await changePendingProjectPath();

      expect(store.pendingProjectDraft).toMatchObject({
        name: 'notes',
        path: '/Users/me/notes',
        isGitRepo: false,
        color: firstColor,
      });
      expect(store.projects).toEqual([]);
    });

    it('keeps the current draft when the picker is dismissed', async () => {
      pickReturns('/Users/me/code/my-app', true);
      await startAddProject();

      pickFolder.mockResolvedValue(null);
      await changePendingProjectPath();

      expect(store.pendingProjectDraft).toMatchObject({ path: '/Users/me/code/my-app' });
    });

    it('does nothing when there is no draft to re-point', async () => {
      await changePendingProjectPath();

      expect(pickFolder).not.toHaveBeenCalled();
      expect(store.pendingProjectDraft).toBeNull();
    });
  });
});
