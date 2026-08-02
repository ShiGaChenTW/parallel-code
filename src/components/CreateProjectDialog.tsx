import { Show, createEffect, createMemo, createSignal, createUniqueId, type JSX } from 'solid-js';

import { Dialog } from './Dialog';
import { SettingsCard } from './SettingsCard';
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
 * One titled paragraph inside the S.CodingFlow explainer.
 *
 * The sentence it wraps is a whole `tr()` key, never a concatenation: word
 * order is the translator's to decide, and a sentence assembled from a heading
 * plus a fragment cannot be reordered in Traditional Chinese.
 */
function SpecgateInfoSection(props: { title: string; children: JSX.Element }) {
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '3px' }}>
      <h3
        style={{
          margin: '0',
          'font-size': sf(12),
          color: theme.fg,
          'font-weight': '600',
        }}
      >
        {props.title}
      </h3>
      <p
        style={{
          margin: '0',
          'font-size': sf(12),
          color: theme.fgMuted,
          'line-height': '1.6',
        }}
      >
        {props.children}
      </p>
    </div>
  );
}

/**
 * The S.CodingFlow checkbox and the button that explains it.
 *
 * THE POINT OF THIS SHAPE
 *
 * The row is a flex parent with two *independent* children. The checkbox and
 * its text sit inside the `<label>`; the button is the label's sibling, not its
 * descendant. A label only activates its control for clicks that land inside
 * it, so a click on the button cannot reach the checkbox — there is no event to
 * stop, and therefore no `stopPropagation` here for a later edit to quietly
 * drop.
 *
 * The whole block used to be one `<label>`, which is what made this a hazard:
 * adding a button anywhere inside it would have made "read the explanation"
 * also mean "silently change what the button does". Suppressing the event would
 * have worked too, right up until someone moved the handler or wrapped the row.
 * Structure holds without anyone having to remember why.
 *
 * Exported so `create-project-card.test.ts` can render it and assert the
 * ordering that makes the claim true — the label closes before the button
 * opens. A refactor that pulls the button under the label fails there rather
 * than silently re-arming the toggle.
 */
export function SpecgateOption(props: {
  checked: boolean;
  disabled: boolean;
  infoOpen: boolean;
  onChange: (checked: boolean) => void;
  onShowInfo: () => void;
}) {
  return (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
      <label
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          flex: '1',
          'min-width': '0',
          'font-size': sf(12),
          color: theme.fgMuted,
          cursor: props.disabled ? 'default' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <span>{tr('Start S.CodingFlow in the new folder')}</span>
      </label>
      <button
        type="button"
        class="icon-btn"
        aria-haspopup="dialog"
        aria-expanded={props.infoOpen}
        onClick={() => props.onShowInfo()}
        style={{
          padding: '4px 10px',
          background: 'transparent',
          border: `1px solid ${theme.border}`,
          'border-radius': '6px',
          color: theme.fgMuted,
          'font-size': sf(11),
          cursor: 'pointer',
          'flex-shrink': '0',
        }}
      >
        {tr('What this does')}
      </button>
    </div>
  );
}

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
  const [showSpecgateInfo, setShowSpecgateInfo] = createSignal(false);
  const specgateInfoTitleId = createUniqueId();

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
    // The explainer is reset for the same reason as the fields: this component
    // mounts once and lives for the app's lifetime, so a panel left open when
    // the dialog was dismissed would still be open the next time it is reached.
    setShowSpecgateInfo(false);
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

        <SettingsCard
          title="S.CodingFlow"
          description={tr('Sets the new folder up as a spec-driven project before you start work.')}
        >
          <SpecgateOption
            checked={initSpecgate()}
            disabled={busy()}
            infoOpen={showSpecgateInfo()}
            onChange={setInitSpecgate}
            onShowInfo={() => setShowSpecgateInfo(true)}
          />
        </SettingsCard>

        {/* Reuses `Dialog` rather than `ConfirmDialog`: this asks nothing, so a
            confirm/cancel pair would be two buttons for a panel with no
            decision in it. Going straight to `Dialog` also gets the three
            behaviours this needs for free and identically to every other modal
            — the focus trap, Escape, and handing focus back.

            Escape closes this and leaves the create dialog open, because
            `Dialog`'s handler returns early unless `isTopmost(dialogId)`, and
            this panel pushed onto `dialog-stack` after its parent.

            Focus returns to the button that opened it via `createFocusRestore`:
            it saves `document.activeElement` — the button, which Chromium
            focuses on click — and restores it once the panel unmounts and
            focus has fallen back to `<body>`. All three exits (Escape, the
            Close button, an overlay click) end that way. */}
        <Dialog
          open={showSpecgateInfo()}
          onClose={() => setShowSpecgateInfo(false)}
          width="480px"
          // Above the create dialog's default 1000, matching how
          // `CustomThemeDialog` (1200) sits over `SettingsDialog` (1100).
          zIndex={1100}
          labelledBy={specgateInfoTitleId}
        >
          <h2
            id={specgateInfoTitleId}
            style={{ margin: '0', 'font-size': sf(16), color: theme.fg, 'font-weight': '600' }}
          >
            {tr('About S.CodingFlow')}
          </h2>

          <SpecgateInfoSection title={tr('What it runs')}>
            {tr(
              'Runs `scvb-specgate init` once, with the new folder as its working directory. Nothing else is run.',
            )}
          </SpecgateInfoSection>

          <SpecgateInfoSection title={tr('What it adds')}>
            {tr(
              'Seven template items: an `openspec/` folder holding its config, the gate profiles, and empty `specs/` and `changes/` directories — plus `PRD.md` and `facet-brief.md` in the new folder itself.',
            )}
          </SpecgateInfoSection>

          <SpecgateInfoSection title={tr('What it leaves alone')}>
            {tr(
              'The command is idempotent: anything already there is skipped, never overwritten or merged. `setup` and `doctor` are deliberately not run, so your agent hooks and `.claude/settings.json` are untouched.',
            )}
          </SpecgateInfoSection>

          <SpecgateInfoSection title={tr('What is still yours to do')}>
            {tr(
              'The PRD template ships with its Non-Goals left blank on purpose, so S.CodingFlow keeps blocking until you fill them in. That is the scaffold working, not a fault.',
            )}
          </SpecgateInfoSection>

          <SpecgateInfoSection title={tr('If the CLI is missing')}>
            {tr(
              'Nothing fails. The folder is still created and the project is still added — you get a note saying the step was skipped. Install `scvb-specgate`, or relaunch Parallel Code from a terminal so it inherits your shell PATH.',
            )}
          </SpecgateInfoSection>

          <div style={{ display: 'flex', 'justify-content': 'flex-end' }}>
            <button
              type="button"
              class="icon-btn"
              onClick={() => setShowSpecgateInfo(false)}
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
              {tr('Close')}
            </button>
          </div>
        </Dialog>
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
