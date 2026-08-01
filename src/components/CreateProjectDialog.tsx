import { Show, createEffect, createMemo, createSignal } from 'solid-js';

import { Dialog } from './Dialog';
import { theme, bannerStyle } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { tr } from '../store/i18n';
import { store } from '../store/core';
import { showNotification } from '../store/notification';
import {
  cancelActiveClone,
  closeCreateProject,
  cloneDestination,
  pickCloneDestination,
  runClone,
  runNewProject,
} from '../store/create-project';
// The renderer's own copy of the clone-URL rules — deliberately a copy, not a
// shared module. See the header of `src/lib/clone-url.ts` for why, and
// `parity with the renderer copy` in `electron/ipc/clone-url.test.ts` for what
// stops the two drifting.
import { normalizeCloneUrl, suggestedFolderName } from '../lib/clone-url';

/**
 * One dialog for both new ways to get a project.
 *
 * Cloning and creating differ in exactly two places — the first field, and what
 * the confirm button calls — while sharing the destination row, the busy state,
 * the error banner and the "hand the result to the existing project settings
 * dialog" ending. Two components would have been two copies of the shared
 * five-sixths, and the renderer entry chunk is on a size budget that a second
 * modal shell would eat into for no behavioural gain.
 */
export function CreateProjectDialog() {
  const [url, setUrl] = createSignal('');
  const [folderName, setFolderName] = createSignal('');
  const [projectName, setProjectName] = createSignal('');
  const [initSpecgate, setInitSpecgate] = createSignal(true);
  /** True once the user has edited the folder name, which stops it tracking the URL. */
  const [folderNameTouched, setFolderNameTouched] = createSignal(false);

  const mode = () => store.createProjectMode;
  const busy = () => store.createProjectBusy;
  const isClone = () => mode() === 'clone';

  // Fresh fields each time the dialog opens. Reopening onto the previous
  // attempt's URL after a failure reads as the failure not having cleared.
  createEffect(() => {
    if (!mode()) return;
    setUrl('');
    setFolderName('');
    setProjectName('');
    setFolderNameTouched(false);
    setInitSpecgate(true);
  });

  /** The folder name in force: what the user typed, else what the URL implies. */
  const effectiveFolderName = createMemo(() =>
    folderNameTouched() ? folderName() : suggestedFolderName(url()),
  );

  const canConfirm = createMemo(() => {
    if (busy() || !cloneDestination()) return false;
    return isClone()
      ? normalizeCloneUrl(url()) !== null && effectiveFolderName().length > 0
      : projectName().trim().length > 0;
  });

  async function confirm() {
    if (!canConfirm()) return;
    const done = isClone()
      ? await runClone(url().trim(), effectiveFolderName())
      : await runNewProject(projectName().trim(), initSpecgate(), showNotification);
    // On success the draft is parked and `AddProjectFlow` takes over with the
    // project settings dialog; leaving this one open would stack two modals.
    if (done) closeCreateProject();
  }

  const labelStyle = {
    display: 'block',
    'font-size': sf(12),
    color: theme.fgMuted,
    'margin-bottom': '4px',
  } as const;

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    background: theme.bgInput,
    border: `1px solid ${theme.border}`,
    'border-radius': '6px',
    color: theme.fg,
    'font-size': sf(13),
  } as const;

  return (
    <Dialog
      open={mode() !== null}
      // `closeCreateProject` refuses while a clone is running; Cancel is the
      // only way out then, and it stops the clone rather than orphaning it.
      onClose={closeCreateProject}
      width="520px"
    >
      <h2 style={{ margin: '0', 'font-size': sf(17), color: theme.fg, 'font-weight': '600' }}>
        {isClone() ? tr('Clone from a URL') : tr('New project')}
      </h2>

      <Show when={isClone()}>
        <div>
          <label style={labelStyle} for="clone-url">
            {tr('Repository URL')}
          </label>
          <input
            id="clone-url"
            type="text"
            value={url()}
            disabled={busy()}
            placeholder="https://github.com/owner/repo.git"
            onInput={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm();
            }}
            style={inputStyle}
          />
          <p style={{ margin: '4px 0 0', 'font-size': sf(11), color: theme.fgSubtle }}>
            {tr('An https:// or SSH address, or the owner/repo shorthand for GitHub.')}
          </p>
        </div>

        <div>
          <label style={labelStyle} for="clone-folder">
            {tr('Folder name')}
          </label>
          <input
            id="clone-folder"
            type="text"
            value={effectiveFolderName()}
            disabled={busy()}
            onInput={(e) => {
              setFolderNameTouched(true);
              setFolderName(e.currentTarget.value);
            }}
            style={inputStyle}
          />
        </div>
      </Show>

      <Show when={!isClone()}>
        <div>
          <label style={labelStyle} for="new-project-name">
            {tr('Folder name')}
          </label>
          <input
            id="new-project-name"
            type="text"
            value={projectName()}
            disabled={busy()}
            onInput={(e) => setProjectName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm();
            }}
            style={inputStyle}
          />
        </div>

        <label
          style={{
            display: 'flex',
            'align-items': 'flex-start',
            gap: '8px',
            'font-size': sf(12),
            color: theme.fgMuted,
          }}
        >
          <input
            type="checkbox"
            checked={initSpecgate()}
            disabled={busy()}
            onChange={(e) => setInitSpecgate(e.currentTarget.checked)}
          />
          <span>
            {tr('Start S.CodingFlow in the new folder')}
            <span style={{ display: 'block', color: theme.fgSubtle, 'font-size': sf(11) }}>
              {tr(
                'Runs `scvb-specgate init`, which adds openspec/, PRD.md and facet-brief.md. Nothing is overwritten. Skipped with a note if the CLI is not installed.',
              )}
            </span>
          </span>
        </label>
      </Show>

      {/* Destination. Remembered between launches, and shown rather than
          silently reused — the whole point of remembering it is to save a
          folder picker, not to hide where things land. */}
      <div>
        <label style={labelStyle}>{tr('Destination')}</label>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <span
            style={{
              flex: '1',
              'min-width': '0',
              'font-size': sf(12),
              color: cloneDestination() ? theme.fg : theme.fgSubtle,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
              direction: 'rtl',
              'text-align': 'left',
            }}
            title={cloneDestination() ?? undefined}
          >
            {cloneDestination() ?? tr('No destination chosen yet.')}
          </span>
          <button
            type="button"
            class="icon-btn"
            disabled={busy()}
            onClick={() => void pickCloneDestination()}
            style={{
              padding: '6px 10px',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              'border-radius': '6px',
              color: theme.fgMuted,
              'font-size': sf(12),
              cursor: busy() ? 'default' : 'pointer',
              'flex-shrink': '0',
            }}
          >
            {cloneDestination() ? tr('Change…') : tr('Choose…')}
          </button>
        </div>
      </div>

      {/* Progress. A clone of a large repository runs for minutes, so the
          alternative to this is a dialog that looks frozen. */}
      <Show when={isClone() && busy()}>
        <div>
          <div
            role="progressbar"
            aria-label={tr('Clone progress')}
            aria-valuenow={store.cloneProgress ?? undefined}
            style={{
              height: '4px',
              'border-radius': '2px',
              background: theme.bgInput,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                // Falls back to a full-width bar between phases rather than
                // snapping to zero, which reads as the clone restarting.
                width: `${store.cloneProgress ?? 100}%`,
                background: theme.accent,
                transition: 'width 120ms linear',
              }}
            />
          </div>
          <pre
            style={{
              margin: '8px 0 0',
              'font-family': "'JetBrains Mono', monospace",
              'font-size': sf(11),
              'white-space': 'pre-wrap',
              'word-break': 'break-all',
              padding: '8px 10px',
              'max-height': '120px',
              'overflow-y': 'auto',
              background: theme.bgInput,
              'border-radius': '6px',
              border: `1px solid ${theme.border}`,
              color: theme.fgMuted,
            }}
          >
            {store.cloneOutput.slice(-1200)}
          </pre>
        </div>
      </Show>

      {/* Already a finished, actionable sentence — the main process owns the
          wording because only it saw git's stderr. */}
      <Show when={store.createProjectError}>
        <div style={{ ...bannerStyle(theme.error), 'font-size': sf(12), 'line-height': '1.5' }}>
          {store.createProjectError}
        </div>
      </Show>

      <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '8px' }}>
        <button
          type="button"
          class="icon-btn"
          onClick={() => (busy() ? cancelActiveClone() : closeCreateProject())}
          style={{
            padding: '8px 14px',
            background: 'transparent',
            border: `1px solid ${theme.border}`,
            'border-radius': '6px',
            color: theme.fgMuted,
            'font-size': sf(13),
            cursor: 'pointer',
          }}
        >
          {busy() ? tr('Cancel clone') : tr('Cancel')}
        </button>
        <button
          type="button"
          class="icon-btn"
          disabled={!canConfirm()}
          onClick={() => void confirm()}
          style={{
            padding: '8px 14px',
            background: canConfirm() ? theme.accent : 'transparent',
            border: `1px solid ${canConfirm() ? theme.accent : theme.border}`,
            'border-radius': '6px',
            color: canConfirm() ? theme.bg : theme.fgSubtle,
            'font-size': sf(13),
            'font-weight': '500',
            cursor: canConfirm() ? 'pointer' : 'default',
          }}
        >
          {isClone() ? tr('Clone') : tr('Create')}
        </button>
      </div>
    </Dialog>
  );
}
