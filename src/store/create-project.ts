/**
 * The two new ways to get a project: clone one, or make an empty one.
 *
 * Both land in the same place as the folder picker does — `pendingProjectDraft`
 * — so the New Project settings dialog, the colour swatch, the git detection
 * and the "import existing worktrees" offer are all inherited rather than
 * reimplemented. The only thing this module adds is how the folder comes to
 * exist; everything after that is the flow that already shipped.
 *
 * It is a store module rather than component state because the destination has
 * to be remembered across launches, and because `AddProjectFlow` mounts at the
 * app root while the trigger lives in the sidebar, which may be collapsed.
 */

import { produce } from 'solid-js/store';

import { IPC } from '../../electron/ipc/channels';
import { Channel, invoke } from '../lib/ipc';
import { openDialog } from '../lib/dialog';
import { errMessage } from '../lib/log';
import { store, setStore } from './core';
import { projectNameFromPath, randomPastelColor } from './projects';
import { tr } from './i18n';

/** Which of the two flows the dialog is showing, or `null` for closed. */
export type CreateProjectMode = 'clone' | 'new';

/**
 * Where a clone or a new folder is created.
 *
 * Scott's rule: ask the first time, then reuse silently-but-visibly. The dialog
 * shows the remembered destination with a "Change…" button next to it, so the
 * second clone needs no folder picker but never lands somewhere unannounced.
 * Falls back to `null`, which makes the dialog demand a choice before enabling
 * its confirm button — an unset destination is never guessed at.
 */
export function cloneDestination(): string | null {
  return store.cloneParentDir || null;
}

export function setCloneDestination(dir: string): void {
  setStore('cloneParentDir', dir);
}

/** Ask for a destination folder. Returns false when the user cancels. */
export async function pickCloneDestination(): Promise<boolean> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (!selected) return false;
  setCloneDestination(selected as string);
  return true;
}

export function openCreateProject(mode: CreateProjectMode): void {
  setStore(
    produce((s) => {
      s.createProjectMode = mode;
      s.createProjectError = '';
      s.createProjectBusy = false;
      s.cloneProgress = null;
      s.cloneOutput = '';
    }),
  );
}

/**
 * Close the dialog.
 *
 * Refuses while a clone is running: the process is cancellable, and closing
 * the only window that can cancel it would strand a `git clone` writing into a
 * folder with no way to stop it or find out how it ended.
 */
export function closeCreateProject(): void {
  if (store.createProjectBusy) return;
  setStore(
    produce((s) => {
      s.createProjectMode = null;
      s.createProjectError = '';
      s.cloneProgress = null;
      s.cloneOutput = '';
    }),
  );
}

/** The handle `cancelClone` needs. Held here so Cancel works from anywhere. */
let activeCloneId: string | null = null;

/**
 * Cancel a running clone.
 *
 * Fire-and-forget on purpose: the reply is not what ends the operation. The
 * `cloneRepo` promise still settles — as a rejection classified `cancelled` —
 * and that is what clears the busy state and removes the partial directory.
 */
export function cancelActiveClone(): void {
  if (!activeCloneId) return;
  void invoke<boolean>(IPC.CancelClone, { cloneId: activeCloneId }).catch(() => {
    /* the clone's own rejection is what reports the outcome */
  });
}

function setBusy(busy: boolean): void {
  setStore('createProjectBusy', busy);
}

/**
 * Clone a repository, then hand the result to the existing add-project dialog.
 *
 * Returns true when the draft was parked, which is the caller's cue to close.
 */
export async function runClone(url: string, folderName: string): Promise<boolean> {
  const parentDir = cloneDestination();
  if (!parentDir) {
    setStore('createProjectError', tr('Choose a destination folder first.'));
    return false;
  }

  const cloneId = crypto.randomUUID();
  activeCloneId = cloneId;

  const channel = new Channel<string>();
  channel.onmessage = (text) => {
    setStore(
      produce((s) => {
        // Only the tail is kept. The full transcript of a large clone is
        // megabytes of progress rewrites, and the panel shows a few lines.
        s.cloneOutput = (s.cloneOutput + text).slice(-4000);
        const pct = lastPercent(text);
        if (pct !== null) s.cloneProgress = pct;
      }),
    );
  };

  setStore(
    produce((s) => {
      s.createProjectError = '';
      s.createProjectBusy = true;
      s.cloneProgress = null;
      s.cloneOutput = '';
    }),
  );

  try {
    const path = await invoke<string>(IPC.CloneRepo, {
      url,
      parentDir,
      folderName,
      cloneId,
      onOutput: channel,
    });

    // A cloned repository is a git repository by construction, so the
    // detection round-trip the folder picker makes is skipped here.
    setStore('pendingProjectDraft', {
      name: projectNameFromPath(path),
      path,
      color: randomPastelColor(),
      isGitRepo: true,
    });
    return true;
  } catch (err) {
    // Already a finished sentence — `classifyCloneFailure` in the main process
    // owns the wording, because only it has seen git's stderr.
    setStore('createProjectError', errMessage(err));
    return false;
  } finally {
    activeCloneId = null;
    channel.dispose();
    setBusy(false);
    setStore('cloneProgress', null);
  }
}

/** Result of `scaffold_new_project`, mirrored from the main process. */
interface ScaffoldResult {
  path: string;
  specgate: { ran: boolean; reason?: string };
}

/**
 * Create an empty project folder and start S.CodingFlow in it.
 *
 * A failed S.CodingFlow init is reported but does not fail the operation: the
 * folder exists by then, and refusing to add it would leave the user with an
 * orphaned directory and an error. The reason is surfaced as a notification so
 * it is readable after the dialog has closed.
 */
export async function runNewProject(
  name: string,
  initSpecgate: boolean,
  notify: (message: string) => void,
): Promise<boolean> {
  const parentDir = cloneDestination();
  if (!parentDir) {
    setStore('createProjectError', tr('Choose a destination folder first.'));
    return false;
  }

  setStore(
    produce((s) => {
      s.createProjectError = '';
      s.createProjectBusy = true;
    }),
  );

  try {
    const result = await invoke<ScaffoldResult>(IPC.ScaffoldNewProject, {
      parentDir,
      name,
      initSpecgate,
    });

    if (initSpecgate && !result.specgate.ran && result.specgate.reason) {
      notify(result.specgate.reason);
    }

    setStore('pendingProjectDraft', {
      name: projectNameFromPath(result.path),
      path: result.path,
      color: randomPastelColor(),
      // An empty folder is not a git repository, and `git init` is not this
      // feature's job — the project settings dialog reads this to decide
      // whether to offer the git-only fields.
      isGitRepo: false,
    });
    return true;
  } catch (err) {
    setStore('createProjectError', errMessage(err));
    return false;
  } finally {
    setBusy(false);
  }
}

/**
 * Last percentage in a chunk of git progress, or null.
 *
 * Duplicated from `parseCloneProgress` in the main process rather than
 * imported: `electron/ipc/git-clone.ts` pulls in `child_process` and `electron`
 * at module load, and importing it from the renderer would drag both into the
 * browser bundle to reuse six lines of regex.
 */
function lastPercent(chunk: string): number | null {
  const matches = chunk.match(/(\d{1,3})%/g);
  if (!matches || matches.length === 0) return null;
  const value = Number.parseInt(matches[matches.length - 1], 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}
