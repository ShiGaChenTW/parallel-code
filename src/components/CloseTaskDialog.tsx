import { For, Show, createResource } from 'solid-js';
import type { JSX } from 'solid-js';
import { tr, trParts } from '../store/i18n';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { closeTask, getProject, getCoordinatorCloseWarning } from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import { theme, bannerStyle } from '../lib/theme';
import type { Task } from '../store/types';
import type { WorktreeStatus } from '../ipc/types';

interface CloseTaskDialogProps {
  open: boolean;
  task: Task;
  onDone: () => void;
}

/**
 * Renders a one-slot translated sentence with its value in `<strong>`.
 *
 * A dumb renderer: `trParts` does the translating and the splitting, this only
 * decides what a slot looks like. That keeps the sentence a single catalogue
 * entry, so the translation controls whether the value comes first or last.
 */
function Emphasised(props: { template: string; value: string | undefined }): JSX.Element {
  return (
    <For each={trParts(props.template)}>
      {(segment) => (segment.kind === 'text' ? segment.value : <strong>{props.value}</strong>)}
    </For>
  );
}

export function shouldDisableCloseTaskConfirm(
  task: Pick<Task, 'gitIsolation' | 'externalWorktree'>,
  worktreeStatusLoading: boolean,
): boolean {
  return worktreeStatusLoading && task.gitIsolation === 'worktree' && !task.externalWorktree;
}

export function CloseTaskDialog(props: CloseTaskDialogProps) {
  const [worktreeStatus] = createResource(
    () =>
      props.open && props.task.gitIsolation === 'worktree' && !props.task.externalWorktree
        ? props.task.worktreePath
        : null,
    (path) => invoke<WorktreeStatus>(IPC.GetWorktreeStatus, { worktreePath: path }),
  );
  const confirmWaitingForStatus = () =>
    shouldDisableCloseTaskConfirm(props.task, worktreeStatus.loading);

  return (
    <ConfirmDialog
      open={props.open}
      title={tr('Close Task')}
      message={
        <div>
          <Show when={getCoordinatorCloseWarning(props.task.id)}>
            {(warning) => (
              <div
                style={{
                  'margin-bottom': '12px',
                  'font-size': '12px',
                  color: theme.warning,
                  background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                  padding: '8px 12px',
                  'border-radius': '8px',
                  border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                  'font-weight': '600',
                }}
              >
                {warning()}
              </div>
            )}
          </Show>
          <Show when={props.task.gitIsolation !== 'worktree'}>
            <p style={{ margin: '0' }}>
              This will stop all running agents and shells for this task. No git operations will be
              performed.
            </p>
          </Show>
          <Show when={props.task.gitIsolation === 'worktree'}>
            <Show
              when={
                !props.task.externalWorktree &&
                (worktreeStatus()?.has_uncommitted_changes ||
                  worktreeStatus()?.has_committed_changes)
              }
            >
              <div
                style={{
                  'margin-bottom': '12px',
                  display: 'flex',
                  'flex-direction': 'column',
                  gap: '8px',
                }}
              >
                <Show when={worktreeStatus()?.has_uncommitted_changes}>
                  <div
                    style={{
                      ...bannerStyle(theme.warning),
                      'font-size': '13px',
                      'font-weight': '600',
                    }}
                  >
                    {tr('Warning: There are uncommitted changes that will be permanently lost.')}
                  </div>
                </Show>
                <Show when={worktreeStatus()?.has_committed_changes}>
                  <div
                    style={{
                      ...bannerStyle(theme.warning),
                      'font-size': '13px',
                      'font-weight': '600',
                    }}
                  >
                    {tr('Warning: This branch has commits that have not been merged into main.')}
                  </div>
                </Show>
              </div>
            </Show>
            {(() => {
              const project = getProject(props.task.projectId);
              const willDeleteBranch = props.task.externalWorktree
                ? false
                : (project?.deleteBranchOnClose ?? true);
              return (
                <>
                  <p style={{ margin: '0 0 8px' }}>
                    {tr(
                      props.task.externalWorktree
                        ? 'This will stop all running agents and shells and remove the imported task from Parallel Code. The existing git worktree will be left untouched.'
                        : willDeleteBranch
                          ? 'This action cannot be undone. The following will be permanently deleted:'
                          : 'The worktree will be removed but the branch will be kept:',
                    )}
                  </p>
                  <Show when={!props.task.externalWorktree}>
                    <ul
                      style={{
                        margin: '0',
                        'padding-left': '20px',
                        display: 'flex',
                        'flex-direction': 'column',
                        gap: '4px',
                      }}
                    >
                      {/* Each value is a <strong>, not a string, so these render
                          from segments — zh-TW is free to put the branch name
                          first, which label-plus-concatenation prevented. */}
                      <Show when={willDeleteBranch}>
                        <li>
                          <Emphasised
                            template="Local feature branch {branch}"
                            value={props.task.branchName}
                          />
                        </li>
                      </Show>
                      <li>
                        <Emphasised template="Worktree at {path}" value={props.task.worktreePath} />
                      </li>
                      <Show when={!willDeleteBranch}>
                        <li style={{ color: theme.fgMuted }}>
                          <Emphasised
                            template="Branch {branch} will be kept"
                            value={props.task.branchName}
                          />
                        </li>
                      </Show>
                    </ul>
                  </Show>
                </>
              );
            })()}
          </Show>
        </div>
      }
      confirmLabel={
        props.task.gitIsolation !== 'worktree' || props.task.externalWorktree
          ? tr('Close')
          : tr('Delete')
      }
      // Don't allow deleting before the dirty-worktree check resolves — the
      // uncommitted/unmerged warnings above only render once it has.
      confirmDisabled={confirmWaitingForStatus()}
      confirmLoading={confirmWaitingForStatus()}
      danger={props.task.gitIsolation === 'worktree' && !props.task.externalWorktree}
      onConfirm={() => {
        props.onDone();
        closeTask(props.task.id);
      }}
      onCancel={() => props.onDone()}
    />
  );
}
