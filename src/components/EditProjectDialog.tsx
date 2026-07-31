import { createSignal, createEffect, For, Show, type JSX } from 'solid-js';
import { tr, trParts } from '../store/i18n';
import { Dialog } from './Dialog';
import { updateProject, PASTEL_HUES, isProjectMissing, relinkProject } from '../store/store';
import { sanitizeBranchPrefix, toBranchName } from '../lib/branch-name';
import { theme, sectionLabelStyle } from '../lib/theme';
import type {
  Project,
  ProjectDraft,
  ProjectSettings,
  TerminalBookmark,
  GitIsolationMode,
} from '../store/types';
import { SegmentedButtons } from './SegmentedButtons';
import { ImportWorktreesDialog } from './ImportWorktreesDialog';
import { CloseIcon } from './icons';
import { RemoveProjectConfirm } from './RemoveProjectConfirm';

/**
 * One dialog, two modes.
 *
 * Edit mode is the original: a `project` that already exists, saved straight to
 * the store through `updateProject`. Create mode is driven by `draft` — a
 * folder the user picked for a project that does not exist yet — and the
 * dialog never writes it. It hands the collected settings back through
 * `onCreate` and lets the caller decide, which is the whole reason Cancel can
 * be a genuine no-op: there is no store write on this component's create path
 * to undo.
 *
 * `draft` and `project` are never both meaningful; `draft` wins, and edit-only
 * affordances read `editing()` rather than `props.project` so a stray both-set
 * caller degrades to create mode instead of pointing Remove or Import at a
 * project the user is not looking at.
 */
interface EditProjectDialogProps {
  project: Project | null;
  /** Set for create mode: a project that has not been created yet. */
  draft?: ProjectDraft | null;
  /** Create mode only. Called with the collected settings when Save is pressed. */
  onCreate?: (settings: ProjectSettings) => void;
  /** Create mode only. Called when the user wants to re-pick the folder. */
  onChangePath?: () => void;
  onClose: () => void;
}

function hueFromColor(color: string): number {
  const match = color.match(/hsl\((\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * The `?` that carries a field's explanation.
 *
 * A native `title`, because that is what every other hover explanation in this
 * app already is (`CommitNavBar.tsx`, `ChangedFilesList.tsx`,
 * `MergeReadinessPanel.tsx`). A custom tooltip would be the only one in the
 * codebase, would need positioning, portalling and dismissal, and would spend
 * renderer entry bytes the bundle gate is already 84% through — for text the OS
 * tooltip renders correctly, CJK included.
 *
 * `text` arrives already translated, so the English key stays a literal at the
 * call site where `i18n-coverage.test.ts` can see it.
 */
function HelpHint(props: { text: string }): JSX.Element {
  return (
    <span
      // role + aria-label rather than title alone: a bare title on a span is
      // not reliably announced, and the glyph itself carries no information.
      role="img"
      aria-label={props.text}
      title={props.text}
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        width: '13px',
        height: '13px',
        'margin-left': '5px',
        'vertical-align': 'middle',
        'border-radius': '50%',
        border: `1px solid ${theme.border}`,
        color: theme.fgSubtle,
        'font-size': '9px',
        'font-weight': '600',
        'line-height': '1',
        'text-transform': 'none',
        cursor: 'help',
      }}
    >
      ?
    </span>
  );
}

export function EditProjectDialog(props: EditProjectDialogProps) {
  const [name, setName] = createSignal('');
  const [selectedHue, setSelectedHue] = createSignal(0);
  const [branchPrefix, setBranchPrefix] = createSignal('task');
  const [deleteBranchOnClose, setDeleteBranchOnClose] = createSignal(true);
  const [defaultGitIsolation, setDefaultGitIsolation] = createSignal<GitIsolationMode>('worktree');
  const [defaultBaseBranch, setDefaultBaseBranch] = createSignal('');
  const [coverageReportPath, setCoverageReportPath] = createSignal('');
  const [bookmarks, setBookmarks] = createSignal<TerminalBookmark[]>([]);
  const [newCommand, setNewCommand] = createSignal('');
  const [showImportDialog, setShowImportDialog] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal(false);
  let nameRef!: HTMLInputElement;

  /** The project being edited, or null in create mode. Everything keyed on a
   *  project id reads this rather than `props.project`. */
  const editing = (): Project | null => (props.draft ? null : props.project);
  /** What the form is showing — a real project or an uncreated draft. Both
   *  carry the four fields the shared parts of the form read. */
  const subject = (): Project | ProjectDraft | null => props.draft ?? props.project;
  const isCreate = () => Boolean(props.draft);

  // Sync signals when the subject changes — a different project to edit, or a
  // draft whose folder was just re-picked.
  createEffect(() => {
    const p = subject();
    if (!p) return;
    // A draft carries only name/path/colour/isGitRepo, so the rest fall back to
    // the same defaults the `?? …` reads elsewhere in the app already assume.
    const existing = editing();
    setName(p.name);
    setSelectedHue(hueFromColor(p.color));
    setBranchPrefix(sanitizeBranchPrefix(existing?.branchPrefix ?? 'task'));
    setDeleteBranchOnClose(existing?.deleteBranchOnClose ?? true);
    setDefaultGitIsolation(existing?.defaultGitIsolation ?? 'worktree');
    setDefaultBaseBranch(existing?.defaultBaseBranch ?? '');
    setCoverageReportPath(existing?.coverageReportPath ?? '');
    setBookmarks(existing?.terminalBookmarks ? [...existing.terminalBookmarks] : []);
    setNewCommand('');
    setConfirmRemove(false);
    setShowImportDialog(false);
    requestAnimationFrame(() => nameRef?.focus());
  });

  function addBookmark() {
    const cmd = newCommand().trim();
    if (!cmd) return;
    const existing = bookmarks();
    const bookmark: TerminalBookmark = {
      id: crypto.randomUUID(),
      command: cmd,
    };
    setBookmarks([...existing, bookmark]);
    setNewCommand('');
  }

  function removeBookmark(id: string) {
    setBookmarks(bookmarks().filter((b) => b.id !== id));
  }

  const canSave = () => name().trim().length > 0;

  /** The one place the form's fields become a value, so create and edit cannot
   *  collect different things. */
  function collectSettings(): ProjectSettings {
    return {
      name: name().trim(),
      color: `hsl(${selectedHue()}, 70%, 75%)`,
      branchPrefix: sanitizeBranchPrefix(branchPrefix()),
      deleteBranchOnClose: deleteBranchOnClose(),
      defaultGitIsolation: defaultGitIsolation(),
      defaultBaseBranch: defaultBaseBranch() || undefined,
      coverageReportPath: coverageReportPath().trim() || undefined,
      terminalBookmarks: bookmarks(),
    };
  }

  function handleSave() {
    if (!canSave()) return;
    if (isCreate()) {
      props.onCreate?.(collectSettings());
      props.onClose();
      return;
    }
    const project = props.project;
    if (!project) return;
    updateProject(project.id, collectSettings());
    props.onClose();
  }

  return (
    <Dialog
      open={subject() !== null}
      onClose={props.onClose}
      width="480px"
      panelStyle={{ gap: '20px' }}
    >
      <Show when={subject()}>
        {(project) => (
          <>
            <h2
              style={{
                margin: '0',
                'font-size': '17px',
                color: theme.fg,
                'font-weight': '600',
              }}
            >
              {isCreate() ? tr('Add Project') : tr('Edit Project')}
            </h2>

            {/* Path */}
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  'font-size': '13px',
                  color: theme.fgSubtle,
                  'font-family': "'JetBrains Mono', monospace",
                  flex: '1',
                  'min-width': '0',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {project().path}
              </div>
              {/* Import Worktrees — edit only. Importing attaches each worktree
                  to the project as a task, so it needs a project that exists;
                  in create mode there is no id to attach to. Nothing is lost:
                  `AddProjectFlow` runs the same scan right after Save, and the
                  button is still here next time the project is opened. */}
              <Show when={editing()}>
                <button
                  type="button"
                  onClick={() => setShowImportDialog(true)}
                  style={{
                    padding: '3px 10px',
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '6px',
                    color: theme.fgMuted,
                    cursor: 'pointer',
                    'font-size': '11px',
                    'flex-shrink': '0',
                  }}
                >
                  {tr('Import Worktrees')}
                </button>
              </Show>
              {/* Change — works in both modes. The folder is the one field that
                  cannot be typed, and re-picking it re-detects `isGitRepo`,
                  which decides whether the git-only fields below are shown. */}
              <button
                type="button"
                onClick={() => {
                  const project = editing();
                  if (project) void relinkProject(project.id);
                  else props.onChangePath?.();
                }}
                style={{
                  padding: '3px 10px',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  'border-radius': '6px',
                  color: theme.fgMuted,
                  cursor: 'pointer',
                  'font-size': '12px',
                  'flex-shrink': '0',
                }}
              >
                {tr('Change')}
              </button>
            </div>

            {/* Missing-folder banner — edit only. Both of its actions are keyed
                on a project id, and a draft's folder was picked seconds ago. */}
            <Show when={editing()}>
              {(existing) => (
                <Show when={isProjectMissing(existing().id)}>
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '10px',
                      padding: '10px 14px',
                      'border-radius': '8px',
                      background: `color-mix(in srgb, ${theme.warning} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${theme.warning} 30%, transparent)`,
                      color: theme.warning,
                      'font-size': '13px',
                    }}
                  >
                    <span style={{ flex: '1' }}>{tr('This folder no longer exists.')}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await relinkProject(existing().id);
                        if (ok) props.onClose();
                      }}
                      style={{
                        padding: '5px 12px',
                        background: theme.bgInput,
                        border: `1px solid ${theme.border}`,
                        'border-radius': '6px',
                        color: theme.fg,
                        cursor: 'pointer',
                        'font-size': '13px',
                        'flex-shrink': '0',
                      }}
                    >
                      {tr('Re-link')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(true)}
                      style={{
                        padding: '5px 12px',
                        background: 'transparent',
                        border: `1px solid color-mix(in srgb, ${theme.error} 40%, transparent)`,
                        'border-radius': '6px',
                        color: theme.error,
                        cursor: 'pointer',
                        'font-size': '13px',
                        'flex-shrink': '0',
                      }}
                    >
                      {tr('Remove')}
                    </button>
                  </div>
                </Show>
              )}
            </Show>

            {/* Name */}
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
              <label style={sectionLabelStyle}>{tr('Name')}</label>
              <input
                ref={nameRef}
                class="input-field"
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave()) handleSave();
                }}
                style={{
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  'border-radius': '8px',
                  padding: '10px 14px',
                  color: theme.fg,
                  'font-size': '14px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Branch prefix — git projects only */}
            <Show when={project().isGitRepo !== false}>
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                <label style={sectionLabelStyle}>
                  {tr('Branch prefix')}
                  <HelpHint
                    text={tr(
                      'Prefix for the branch created in Worktree mode. The branch name is prefix/task-name-6-random-characters; the prefix is lowercased, split on /, and falls back to task when blank.',
                    )}
                  />
                </label>
                <input
                  class="input-field"
                  type="text"
                  value={branchPrefix()}
                  onInput={(e) => setBranchPrefix(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSave()) handleSave();
                  }}
                  placeholder="task"
                  style={{
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '8px',
                    padding: '10px 14px',
                    color: theme.fg,
                    'font-size': '14px',
                    'font-family': "'JetBrains Mono', monospace",
                    outline: 'none',
                  }}
                />
                <Show when={branchPrefix().trim()}>
                  <div
                    style={{
                      'font-size': '12px',
                      'font-family': "'JetBrains Mono', monospace",
                      color: theme.fgSubtle,
                      padding: '2px 2px 0',
                      display: 'flex',
                      'align-items': 'center',
                      gap: '6px',
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      style={{ 'flex-shrink': '0' }}
                    >
                      <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6.25 7.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 7.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 0h5.5a2.5 2.5 0 0 0 2.5-2.5v-.5a.75.75 0 0 0-1.5 0v.5a1 1 0 0 1-1 1H5a3.25 3.25 0 1 0 0 6.5h6.25a.75.75 0 0 0 0-1.5H5a1.75 1.75 0 1 1 0-3.5Z" />
                    </svg>
                    {sanitizeBranchPrefix(branchPrefix())}/{toBranchName('example-branch-name')}
                  </div>
                </Show>
              </div>
            </Show>

            {/* Color palette */}
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
              <label style={sectionLabelStyle}>{tr('Color')}</label>
              <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
                <For each={PASTEL_HUES}>
                  {(hue) => {
                    const color = `hsl(${hue}, 70%, 75%)`;
                    const isSelected = () => selectedHue() === hue;
                    return (
                      <button
                        type="button"
                        onClick={() => setSelectedHue(hue)}
                        style={{
                          width: '28px',
                          height: '28px',
                          'border-radius': '50%',
                          background: color,
                          border: isSelected() ? `2px solid ${theme.fg}` : '2px solid transparent',
                          outline: isSelected() ? `2px solid ${theme.accent}` : 'none',
                          'outline-offset': '1px',
                          cursor: 'pointer',
                          padding: '0',
                          'flex-shrink': '0',
                        }}
                        title={tr('Hue {hue}', { hue })}
                      />
                    );
                  }}
                </For>
              </div>
            </div>

            {/* Git-specific settings — hidden for non-git projects */}
            <Show when={project().isGitRepo !== false}>
              {/* Close cleanup preference */}
              <label
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  'font-size': '14px',
                  color: theme.fg,
                }}
              >
                <input
                  type="checkbox"
                  checked={deleteBranchOnClose()}
                  onChange={(e) => setDeleteBranchOnClose(e.currentTarget.checked)}
                  style={{ cursor: 'pointer' }}
                />
                {tr('Always delete branch and worktree on close')}
              </label>

              {/* Default isolation mode */}
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                <label style={sectionLabelStyle}>
                  {tr('Default Git Isolation')}
                  <HelpHint
                    text={tr(
                      'Default isolation for new tasks. Worktree creates a separate worktree and branch; Current Branch works directly in the project folder on the base branch, and only one such task is allowed per project. The New Task dialog can still override it.',
                    )}
                  />
                </label>
                <SegmentedButtons
                  options={[
                    { value: 'worktree', label: tr('Worktree') },
                    { value: 'direct', label: tr('Current Branch') },
                  ]}
                  value={defaultGitIsolation()}
                  onChange={setDefaultGitIsolation}
                />
              </div>

              {/* Default base branch */}
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                {/* One template rather than the label concatenated with its
                    parenthetical, so zh-TW decides where the hint lands
                    instead of inheriting English order. */}
                <label style={sectionLabelStyle}>
                  <For each={trParts('Default base branch {hint}')}>
                    {(segment) =>
                      segment.kind === 'text' ? (
                        segment.value
                      ) : (
                        <span style={{ opacity: '0.5', 'text-transform': 'none' }}>
                          {tr('(blank = auto-detect main)')}
                        </span>
                      )
                    }
                  </For>
                  <HelpHint
                    text={tr(
                      'Base branch new tasks start from. When blank it is detected in order: origin/HEAD, then origin/main or origin/master, then local main or master, then git config init.defaultBranch, falling back to main.',
                    )}
                  />
                </label>
                <input
                  class="input-field"
                  type="text"
                  value={defaultBaseBranch()}
                  onInput={(e) => setDefaultBaseBranch(e.currentTarget.value)}
                  placeholder="main"
                  style={{
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '8px',
                    padding: '10px 14px',
                    color: theme.fg,
                    'font-size': '14px',
                    outline: 'none',
                  }}
                />
              </div>
            </Show>

            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
              <label style={sectionLabelStyle}>
                <For each={trParts('Coverage report path {hint}')}>
                  {(segment) =>
                    segment.kind === 'text' ? (
                      segment.value
                    ) : (
                      <span style={{ opacity: '0.5', 'text-transform': 'none' }}>
                        {tr('(relative to repo root)')}
                      </span>
                    )
                  }
                </For>
                <HelpHint
                  text={tr(
                    'Where the Changed Files coverage radar reads its report from, relative to the repo root and never outside it. Setting it reads that one file only — the blank-value candidate list, including the scan of subdirectories under coverage/, no longer applies.',
                  )}
                />
              </label>
              <input
                class="input-field"
                type="text"
                value={coverageReportPath()}
                onInput={(e) => setCoverageReportPath(e.currentTarget.value)}
                placeholder={tr('coverage/coverage-summary.json or coverage/lcov.info')}
                style={{
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  'border-radius': '8px',
                  padding: '10px 14px',
                  color: theme.fg,
                  'font-size': '14px',
                  'font-family': "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
              />
              <div
                style={{
                  'font-size': '12px',
                  color: theme.fgSubtle,
                  padding: '2px 2px 0',
                }}
              >
                {/* Was a translated "Leave blank to try" concatenated with two
                    <code> paths and an English ", then" between them, which
                    pinned the sentence to English order and left the connector
                    untranslated. One template now; the paths are the slots. */}
                <For each={trParts('Leave blank to try {first}, then {second}.')}>
                  {(segment) =>
                    segment.kind === 'text' ? (
                      segment.value
                    ) : (
                      <code>
                        {segment.name === 'first'
                          ? 'coverage/coverage-summary.json'
                          : 'coverage/lcov.info'}
                      </code>
                    )
                  }
                </For>
              </div>
            </div>

            {/* Command Bookmarks */}
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
              <label style={sectionLabelStyle}>
                {tr('Command Bookmarks')}
                <HelpHint
                  text={tr(
                    'Each bookmark becomes a button on the task shell toolbar. Clicking it sends the command to the most recent idle shell, or opens a new one if none is idle; the button label is derived from the command by taking its last non-flag word.',
                  )}
                />
              </label>
              <Show when={bookmarks().length > 0}>
                <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
                  <For each={bookmarks()}>
                    {(bookmark) => (
                      <div
                        style={{
                          display: 'flex',
                          'align-items': 'center',
                          gap: '8px',
                          padding: '4px 8px',
                          background: theme.bgInput,
                          'border-radius': '6px',
                          border: `1px solid ${theme.border}`,
                        }}
                      >
                        <span
                          style={{
                            flex: '1',
                            'font-size': '12px',
                            'font-family': "'JetBrains Mono', monospace",
                            color: theme.fgSubtle,
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                          }}
                        >
                          {bookmark.command}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBookmark(bookmark.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: theme.fgSubtle,
                            cursor: 'pointer',
                            padding: '2px',
                            'line-height': '1',
                            'flex-shrink': '0',
                          }}
                          title={tr('Remove bookmark')}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  class="input-field"
                  type="text"
                  value={newCommand()}
                  onInput={(e) => setNewCommand(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addBookmark();
                    }
                  }}
                  placeholder={tr('e.g. {command}', { command: 'npm run dev' })}
                  style={{
                    flex: '1',
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '8px',
                    padding: '8px 12px',
                    color: theme.fg,
                    'font-size': '13px',
                    'font-family': "'JetBrains Mono', monospace",
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={addBookmark}
                  disabled={!newCommand().trim()}
                  style={{
                    padding: '8px 14px',
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '8px',
                    color: newCommand().trim() ? theme.fg : theme.fgSubtle,
                    cursor: newCommand().trim() ? 'pointer' : 'not-allowed',
                    'font-size': '13px',
                    'flex-shrink': '0',
                  }}
                >
                  {tr('Add')}
                </button>
              </div>
            </div>

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                'justify-content': 'flex-end',
                'padding-top': '4px',
              }}
            >
              <button
                type="button"
                class="btn-secondary"
                onClick={() => props.onClose()}
                style={{
                  padding: '9px 18px',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  'border-radius': '8px',
                  color: theme.fgMuted,
                  cursor: 'pointer',
                  'font-size': '14px',
                }}
              >
                {tr('Cancel')}
              </button>
              <button
                type="button"
                class="btn-primary"
                disabled={!canSave()}
                onClick={handleSave}
                style={{
                  padding: '9px 20px',
                  background: theme.accent,
                  border: 'none',
                  'border-radius': '8px',
                  color: theme.accentText,
                  cursor: canSave() ? 'pointer' : 'not-allowed',
                  'font-size': '14px',
                  'font-weight': '500',
                  opacity: canSave() ? '1' : '0.4',
                }}
              >
                {isCreate() ? tr('Create') : tr('Save')}
              </button>
            </div>
            {/* Both are keyed on a project id, so neither is reachable in
                create mode — the buttons that open them are edit-only too. */}
            <Show when={editing()}>
              {(existing) => (
                <>
                  <ImportWorktreesDialog
                    open={showImportDialog()}
                    project={existing()}
                    onClose={() => setShowImportDialog(false)}
                  />
                  <RemoveProjectConfirm
                    projectId={confirmRemove() ? existing().id : null}
                    onDone={() => setConfirmRemove(false)}
                    onRemoved={() => props.onClose()}
                  />
                </>
              )}
            </Show>
          </>
        )}
      </Show>
    </Dialog>
  );
}
