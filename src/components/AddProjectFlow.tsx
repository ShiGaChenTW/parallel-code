import { createSignal, Show } from 'solid-js';
import {
  store,
  cancelAddProject,
  changePendingProjectPath,
  commitPendingProject,
  showNotification,
} from '../store/store';
import { errMessage } from '../lib/log';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import type { ImportableWorktree } from '../ipc/types';
import type { Project, ProjectSettings } from '../store/types';
import { EditProjectDialog } from './EditProjectDialog';
import { ImportWorktreesDialog } from './ImportWorktreesDialog';
import { CreateProjectDialog } from './CreateProjectDialog';

/**
 * The whole "add a project" flow, mounted once.
 *
 * It lives at the app root rather than in `Sidebar`, because the sidebar is
 * behind `<Show when={store.sidebarVisible}>` and two of the four entry points
 * — the `TilingLayout` empty state and `toggleNewTaskDialog`'s "add a project
 * first" — can fire while it is collapsed. Driving it from
 * `store.pendingProjectDraft` is also what lets a store function open the
 * dialog at all; a component-local signal is not reachable from `navigation.ts`.
 *
 * The order is the point: the folder picker fills the draft, the dialog edits a
 * copy of it, and `commitPendingProject` runs only from `onCreate`. Cancel
 * clears the draft and nothing else, because nothing else was ever written.
 */
export function AddProjectFlow() {
  const [importProject, setImportProject] = createSignal<Project | null>(null);
  const [initialImportCandidates, setInitialImportCandidates] = createSignal<
    ImportableWorktree[] | null
  >(null);

  /**
   * Offer to import worktrees that already exist under a newly added project.
   *
   * Moved here from `Sidebar.handleAddProject` unchanged. It used to run only
   * for the sidebar's own button; now every entry point reaches it, which is
   * the behaviour the sidebar always described.
   */
  async function offerWorktreeImport(projectId: string) {
    const project = store.projects.find((entry) => entry.id === projectId) ?? null;
    if (!project) return;
    if (project.isGitRepo === false) return;

    try {
      const candidates = await invoke<ImportableWorktree[]>(IPC.ListImportableWorktrees, {
        projectRoot: project.path,
      });
      if (candidates.length > 0) {
        setInitialImportCandidates(candidates);
        setImportProject(project);
      }
    } catch (err) {
      console.error('Failed to scan importable worktrees:', err);
      showNotification(`Couldn't scan existing worktrees: ${errMessage(err)}`);
    }
  }

  function handleCreate(settings: ProjectSettings) {
    const projectId = commitPendingProject(settings);
    if (!projectId) return;
    void offerWorktreeImport(projectId);
  }

  return (
    <>
      {/* Clone and New Project both end by parking a `pendingProjectDraft`,
          which is what the EditProjectDialog below already opens on. They are
          mounted here rather than in the sidebar for the same reason that
          dialog is: the sidebar can be collapsed while the flow is running. */}
      <CreateProjectDialog />
      <EditProjectDialog
        project={null}
        draft={store.pendingProjectDraft}
        onCreate={handleCreate}
        onChangePath={() => void changePendingProjectPath()}
        onClose={cancelAddProject}
      />
      <Show when={importProject()}>
        <ImportWorktreesDialog
          open={importProject() !== null}
          project={importProject()}
          initialCandidates={initialImportCandidates()}
          onClose={() => {
            setImportProject(null);
            setInitialImportCandidates(null);
          }}
        />
      </Show>
    </>
  );
}
