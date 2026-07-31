import { produce } from 'solid-js/store';
import { openDialog } from '../lib/dialog';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { store, setStore } from './core';
import type { Project, ProjectDraft, ProjectSettings } from './types';
import { sanitizeBranchPrefix } from '../lib/branch-name';

export const PASTEL_HUES = [0, 30, 60, 120, 180, 210, 260, 300, 330];

export function randomPastelColor(): string {
  const hue = PASTEL_HUES[Math.floor(Math.random() * PASTEL_HUES.length)];
  return `hsl(${hue}, 70%, 75%)`;
}

export function getProject(projectId: string): Project | undefined {
  return store.projects.find((p) => p.id === projectId);
}

export function addProject(name: string, path: string, isGitRepo?: boolean): string {
  const id = crypto.randomUUID();
  const color = randomPastelColor();
  const project: Project = { id, name, path, color, isGitRepo };
  setStore(
    produce((s) => {
      s.projects.push(project);
      s.lastProjectId = id;
    }),
  );
  return id;
}

export function removeProject(projectId: string): void {
  // Guard: skip removal if any tasks still reference this project
  const allTaskIds = [...store.taskOrder, ...store.collapsedTaskOrder];
  const hasLinkedTasks = allTaskIds.some((tid) => store.tasks[tid]?.projectId === projectId);
  if (hasLinkedTasks) {
    console.warn(
      'removeProject: skipped — tasks still reference this project. Use removeProjectWithTasks.',
    );
    return;
  }

  setStore(
    produce((s) => {
      s.projects = s.projects.filter((p) => p.id !== projectId);
      if (s.lastProjectId === projectId) {
        s.lastProjectId = s.projects[0]?.id ?? null;
      }
      delete s.missingProjectIds[projectId];
    }),
  );
}

export function updateProject(
  projectId: string,
  updates: Partial<
    Pick<
      Project,
      | 'name'
      | 'color'
      | 'branchPrefix'
      | 'deleteBranchOnClose'
      | 'defaultGitIsolation'
      | 'defaultBaseBranch'
      | 'coverageReportPath'
      | 'terminalBookmarks'
      | 'isGitRepo'
    >
  >,
): void {
  setStore(
    produce((s) => {
      const idx = s.projects.findIndex((p) => p.id === projectId);
      if (idx === -1) return;
      if (updates.name !== undefined) s.projects[idx].name = updates.name;
      if (updates.color !== undefined) s.projects[idx].color = updates.color;
      if (updates.branchPrefix !== undefined)
        s.projects[idx].branchPrefix = sanitizeBranchPrefix(updates.branchPrefix);
      if (updates.deleteBranchOnClose !== undefined)
        s.projects[idx].deleteBranchOnClose = updates.deleteBranchOnClose;
      if (updates.defaultGitIsolation !== undefined)
        s.projects[idx].defaultGitIsolation = updates.defaultGitIsolation;
      if (Object.prototype.hasOwnProperty.call(updates, 'defaultBaseBranch'))
        s.projects[idx].defaultBaseBranch = updates.defaultBaseBranch;
      if (Object.prototype.hasOwnProperty.call(updates, 'coverageReportPath'))
        s.projects[idx].coverageReportPath = updates.coverageReportPath;
      if (updates.terminalBookmarks !== undefined)
        s.projects[idx].terminalBookmarks = updates.terminalBookmarks;
      if (updates.isGitRepo !== undefined) s.projects[idx].isGitRepo = updates.isGitRepo;
    }),
  );
}

export function getProjectBranchPrefix(projectId: string): string {
  const raw = store.projects.find((p) => p.id === projectId)?.branchPrefix ?? 'task';
  return sanitizeBranchPrefix(raw);
}

export function getProjectPath(projectId: string): string | undefined {
  return store.projects.find((p) => p.id === projectId)?.path;
}

export function projectIsGitRepo(projectId: string): boolean {
  return getProject(projectId)?.isGitRepo !== false;
}

/** The name a freshly picked folder suggests: its last path segment. */
export function projectNameFromPath(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] || path;
}

/**
 * Ask for a folder and describe it, writing nothing.
 *
 * This is the half of the old `pickAndAddProject` that reads. Everything that
 * writes now lives in `commitPendingProject`, which only the dialog's Save
 * button reaches — that split is what makes cancelling a no-op rather than a
 * create-then-undo. An undo was never available anyway: `removeProject` refuses
 * to drop a project any task still references.
 */
export async function pickProjectDraft(): Promise<ProjectDraft | null> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (!selected) return null;
  const path = selected as string;

  const isGitRepo = await invoke<boolean>(IPC.CheckIsGitRepo, { path });

  return { name: projectNameFromPath(path), path, color: randomPastelColor(), isGitRepo };
}

/**
 * Entry point for every "add a project" affordance.
 *
 * Opens the folder picker and parks the result in `pendingProjectDraft`, which
 * is what makes the dialog appear. No project exists yet at this point.
 */
export async function startAddProject(): Promise<void> {
  const draft = await pickProjectDraft();
  if (!draft) return;
  setStore('pendingProjectDraft', draft);
}

/** Discard the draft. Nothing was created, so there is nothing to clean up. */
export function cancelAddProject(): void {
  setStore('pendingProjectDraft', null);
}

/**
 * Re-pick the folder for the pending draft.
 *
 * The create-mode counterpart to `relinkProject`, which cannot be used here
 * because it edits a project by id and the draft has none. `isGitRepo` is
 * re-detected so the git-only fields stay honest, and the colour is kept so
 * re-picking does not silently reshuffle a swatch the user may have chosen.
 */
export async function changePendingProjectPath(): Promise<void> {
  if (!store.pendingProjectDraft) return;
  const picked = await pickProjectDraft();
  if (!picked) return;
  setStore('pendingProjectDraft', (prev) =>
    prev ? { ...picked, color: prev.color } : { ...picked },
  );
}

/**
 * Turn the pending draft into a real project. The only write in this flow.
 *
 * Goes through `addProject` rather than pushing a project itself, so the
 * `lastProjectId` side effect that selects the new project is the same one the
 * old flow relied on. `updateProject` then applies the dialog's fields; every
 * consumer reads these through `?? default`, so a draft saved untouched
 * behaves exactly like a project added by the old one-step flow.
 */
export function commitPendingProject(settings: ProjectSettings): string | null {
  const draft = store.pendingProjectDraft;
  if (!draft) return null;

  const id = addProject(settings.name, draft.path, draft.isGitRepo);
  updateProject(id, settings);
  setStore('pendingProjectDraft', null);
  return id;
}

/** Check each project path and record which ones are missing. */
export async function validateProjectPaths(): Promise<void> {
  const missing: Record<string, true> = {};
  for (const project of store.projects) {
    try {
      const exists = await invoke<boolean>(IPC.CheckPathExists, { path: project.path });
      if (!exists) missing[project.id] = true;
    } catch {
      missing[project.id] = true;
    }
  }
  setStore('missingProjectIds', missing);
}

/** Let the user pick a new folder for a project whose path is missing. */
export async function relinkProject(projectId: string): Promise<boolean> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (!selected) return false;
  const newPath = selected as string;

  const isGitRepo = await invoke<boolean>(IPC.CheckIsGitRepo, { path: newPath });

  setStore(
    produce((s) => {
      const idx = s.projects.findIndex((p) => p.id === projectId);
      if (idx === -1) return;
      s.projects[idx].path = newPath;
      s.projects[idx].isGitRepo = isGitRepo;
    }),
  );

  const exists = await invoke<boolean>(IPC.CheckPathExists, { path: newPath });
  if (exists) {
    setStore('missingProjectIds', (prev: Record<string, true>) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }
  return exists;
}

export function isProjectMissing(projectId: string): boolean {
  return projectId in store.missingProjectIds;
}
