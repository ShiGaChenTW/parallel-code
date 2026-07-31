import { Show, createSignal, createEffect, onMount, onCleanup, batch, lazy } from 'solid-js';
import { tr } from '../store/i18n';
import {
  store,
  retryCloseTask,
  setActiveTask,
  setActiveAgent,
  clearInitialPrompt,
  clearPrefillPrompt,
  getProject,
  setTaskFocusedPanel,
  triggerFocus,
  clearPendingAction,
  showNotification,
  setTaskSplitMode,
} from '../store/store';
import { useFocusRegistration } from '../lib/focus-registration';
import { ResizablePanel, type PanelChild } from './ResizablePanel';
import type { EditableTextHandle } from './EditableText';
import { PromptInput, type PromptInputHandle } from './PromptInput';
import { CloseTaskDialog } from './CloseTaskDialog';
import { MergeDialog } from './MergeDialog';
import { PushDialog } from './PushDialog';
import { PlanViewerDialog } from './PlanViewerDialog';
import { EditProjectDialog } from './EditProjectDialog';
import { TaskTitleBar } from './TaskTitleBar';
import { TaskBranchInfoBar } from './TaskBranchInfoBar';
import { TaskNotesBody } from './TaskNotesBody';
import { TaskTokenUsagePanel } from './TaskTokenUsagePanel';
import { TaskPromptHistoryPanel, type PromptNavApi } from './TaskPromptHistoryPanel';
import { TaskChangedFilesSection } from './TaskChangedFilesSection';
import { isCommitHashSelection, type CommitSelection } from './CommitNavBar';
import { TaskShellSection } from './TaskShellSection';
import { TaskStepsSection } from './TaskStepsSection';
import { TaskCurrentStateLine } from './TaskCurrentStateLine';
import { TaskAITerminal } from './TaskAITerminal';
import { TaskClosingOverlay } from './TaskClosingOverlay';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { SubTaskStrip } from './SubTaskStrip';
import { theme } from '../lib/theme';
import { isMac } from '../lib/platform';
import type { Task } from '../store/types';
import type { CommitInfo } from '../ipc/types';
import { isLandedTaskState } from '../store/landing';
import { shouldPollTaskCommits } from './task-commit-polling';
import { recordTranscriptEvent } from '../store/transcript';
import { newCommitEvents } from '../lib/transcript-events';

// The diff viewer drags in ScrollingDiffView, which nothing else uses, plus the
// review sidebar and the unified-diff renderer. Every one of those is dead
// weight until the user actually opens a diff, and the dialog already rendered
// its whole body inside `<Show when={scrollToFile !== null}>` — so gating the
// component on the same predicate keeps the mount/unmount timing it already
// had, and only defers the download. Cost is paid on the first diff opened.
const DiffViewerDialog = lazy(async () => ({
  default: (await import('./DiffViewerDialog')).DiffViewerDialog,
}));

interface TaskPanelProps {
  task: Task;
  isActive: boolean;
}

// Panels that auto-grow to their content share one ceiling so a long body
// can't take over the column: never taller than the panel's own px cap, and
// never taller than 33vh. User drag pins intentionally bypass this.
const STEPS_PANEL_AUTO_MAX = 'min(240px, 33vh)';
const CHANGED_FILES_PANEL_AUTO_MAX = 'min(300px, 33vh)';
const NOTES_PANEL_AUTO_MAX = 'min(400px, 33vh)';
// Lowest ceiling in the family, because the card holds the least: one bar, one
// legend, four numbers and a footnote — ~145 px at the narrowest column this
// layout allows (the 360 px split-right minimum), so 200 px is headroom rather
// than a clip. The ordering across the four caps tracks how much reading each
// card holds, and is the only thing that makes the numbers mean anything.
const TOKEN_USAGE_PANEL_AUTO_MAX = 'min(200px, 33vh)';

export function TaskPanel(props: TaskPanelProps) {
  const [showCloseConfirm, setShowCloseConfirm] = createSignal(false);
  const [planFullscreen, setPlanFullscreen] = createSignal(false);
  // Deliberately not persisted. The panel is a glance at a running cost, not a
  // working surface, and it takes vertical space from the notes in a column
  // that is already dense — a state restored on every launch would be a layout
  // change nobody asked for on a window they opened to read notes. It survives
  // as long as the panel is mounted, which covers the case that matters:
  // opening it, working, and looking again.
  const [showTokenUsage, setShowTokenUsage] = createSignal(false);

  // Not persisted either, and for a sharper reason than the token card's: the
  // list is only fully useful while the terminal still holds the lines its
  // entries point at, and that is exactly what a relaunch destroys.
  const [showPromptHistory, setShowPromptHistory] = createSignal(false);
  const [promptNav, setPromptNav] = createSignal<PromptNavApi | undefined>();

  // Countdown clock for staged coordinator notifications shown while auto mode is active.
  const [nowMs, setNowMs] = createSignal(Date.now());
  createEffect(() => {
    const n = props.task.stagedNotification;
    const hasActiveCountdown = Boolean(n && !n.userEdited);
    if (!props.task.stepsEnabled && !hasActiveCountdown) return;
    const id = window.setInterval(() => setNowMs(Date.now()), hasActiveCountdown ? 1_000 : 30_000);
    onCleanup(() => clearInterval(id));
  });
  const stagedCountdown = () => {
    const n = props.task.stagedNotification;
    if (!n || n.userEdited) return null;
    if (props.task.promptDraftActive) return 'Waiting for your draft';
    if (props.task.terminalInputPending) return 'Waiting for terminal input';
    if ((props.task.userActivityHoldUntil ?? 0) > nowMs()) return 'Waiting for idle';
    const remaining = Math.ceil((n.autoFireAt - nowMs()) / 1_000);
    return remaining > 0 ? `Auto-sending in ${remaining}s` : 'Sending when ready…';
  };

  const [showMergeConfirm, setShowMergeConfirm] = createSignal(false);
  const [showPushConfirm, setShowPushConfirm] = createSignal(false);
  const [pushSuccess, setPushSuccess] = createSignal(false);
  const [pushing, setPushing] = createSignal(false);
  const isLandedTask = () => isLandedTaskState(props.task.landingState);
  let pushSuccessTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(pushSuccessTimer));
  const [diffScrollTarget, setDiffScrollTarget] = createSignal<string | null>(null);
  const [commitList, setCommitList] = createSignal<CommitInfo[]>([]);
  const [selectedCommit, setSelectedCommit] = createSignal<CommitSelection>(null);
  const [editingProjectId, setEditingProjectId] = createSignal<string | null>(null);
  // Jump-to-step state is a single signal so ↗ can be hidden entirely before
  // TerminalView is ready (otherwise firstIndex would default to 0, showing ↗
  // on every step while `jump` is still undefined and every click no-ops).
  const [stepNav, setStepNav] = createSignal<
    { jump: (stepIndex: number) => boolean; firstIndex: number } | undefined
  >();
  let panelRef!: HTMLDivElement;
  let promptRef: HTMLTextAreaElement | undefined;
  let titleEditHandle: EditableTextHandle | undefined;
  let promptHandle: PromptInputHandle | undefined;

  // Two-column focus-mode layout kicks in once the task panel is wide enough.
  // Hysteresis: enter at >=1200, leave at <1150. A single threshold flickers
  // when the user drags the window edge across it, and every flip remounts the
  // xterm terminal inside the left column.
  const SPLIT_ENTER_WIDTH = 1080;
  const SPLIT_EXIT_WIDTH = 1030;
  const [panelWidth, setPanelWidth] = createSignal(0);
  const [useSplit, setUseSplit] = createSignal(false);
  createEffect(() => {
    if (!store.focusMode) {
      setUseSplit(false);
      return;
    }
    const w = panelWidth();
    setUseSplit((prev) => (prev ? w >= SPLIT_EXIT_WIDTH : w >= SPLIT_ENTER_WIDTH));
  });

  // Mirror split state into the store so keyboard navigation (focus.ts)
  // can build the correct grid for this task.
  createEffect(() => {
    setTaskSplitMode(props.task.id, useSplit());
  });
  onCleanup(() => setTaskSplitMode(props.task.id, false));

  const editingProject = () => {
    const id = editingProjectId();
    return id ? (getProject(id) ?? null) : null;
  };

  // Focus registration for this task's panels
  onMount(() => {
    const id = props.task.id;
    useFocusRegistration(`${id}:title`, () => titleEditHandle?.startEdit());
    useFocusRegistration(`${id}:prompt`, () => promptRef?.focus());

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setPanelWidth(w);
    });
    ro.observe(panelRef);
    setPanelWidth(panelRef.clientWidth);
    onCleanup(() => ro.disconnect());
  });

  // Respond to focus panel changes from store
  createEffect(() => {
    if (!props.isActive) return;
    const panel = store.focusedPanel[props.task.id];
    if (panel) {
      triggerFocus(`${props.task.id}:${panel}`);
    }
  });

  // Auto-focus prompt when task first becomes active
  let autoFocusTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (autoFocusTimer !== undefined) clearTimeout(autoFocusTimer);
  });
  createEffect(() => {
    if (props.isActive && !store.focusedPanel[props.task.id]) {
      const id = props.task.id;
      if (autoFocusTimer !== undefined) clearTimeout(autoFocusTimer);
      autoFocusTimer = setTimeout(() => {
        autoFocusTimer = undefined;
        if (!store.focusedPanel[id] && !panelRef.contains(document.activeElement)) {
          if (store.showPromptInput) {
            promptRef?.focus();
          } else {
            setTaskFocusedPanel(id, 'ai-terminal');
            triggerFocus(`${id}:ai-terminal`);
          }
        }
      }, 0);
    }
  });

  // React to pendingAction from keyboard shortcuts
  createEffect(() => {
    const action = store.pendingAction;
    if (!action || action.taskId !== props.task.id) return;
    clearPendingAction();
    switch (action.type) {
      case 'close':
        setShowCloseConfirm(true);
        break;
      case 'merge':
        if (props.task.gitIsolation === 'worktree' && !isLandedTask()) setShowMergeConfirm(true);
        break;
      case 'push':
        if (props.task.gitIsolation === 'worktree' && !isLandedTask()) setShowPushConfirm(true);
        break;
    }
  });

  // Poll for branch commits for visible worktree-isolated and direct-mode tasks.
  // This includes inactive columns in the tiled layout, while hidden and offscreen
  // panels restart with an immediate refresh when they become visible again. For
  // direct mode, request recent commits since there are no branch-specific commits
  // when working on main.
  createEffect(() => {
    const worktreePath = props.task.worktreePath;
    const baseBranch = props.task.baseBranch;
    const isolation = props.task.gitIsolation;
    if (isLandedTask()) return;
    if (isolation !== 'worktree' && isolation !== 'direct') return;
    const focusMode = store.focusMode;
    if (
      !shouldPollTaskCommits(
        focusMode,
        focusMode ? props.isActive : false,
        focusMode ? undefined : store.taskViewportVisibility[props.task.id],
      )
    ) {
      return;
    }
    let cancelled = false;
    // Baseline for the transcript's commit events. `undefined` means "not
    // observed yet": the first poll seeds it and emits nothing, so scrolling a
    // panel into view does not replay the branch's whole history.
    let transcribedCommitHashes: string[] | undefined;

    async function fetchCommits() {
      try {
        const result = await invoke<CommitInfo[]>(IPC.GetBranchCommits, {
          worktreePath,
          baseBranch,
          ...(isolation === 'direct' ? { recentFallback: 50 } : {}),
        });
        if (cancelled) return;
        const commitDelta = newCommitEvents(props.task.id, transcribedCommitHashes, result);
        transcribedCommitHashes = commitDelta.hashes;
        for (const event of commitDelta.events) recordTranscriptEvent(event);
        batch(() => {
          setCommitList(result);
          // Reset selection if the selected commit no longer exists. The
          // sentinel "uncommitted" selection is not a hash, so it is preserved.
          const sel = selectedCommit();
          if (isCommitHashSelection(sel) && !result.some((c) => c.hash === sel)) {
            setSelectedCommit(null);
          }
        });
      } catch {
        /* worktree may not exist yet */
      }
    }

    void fetchCommits();
    const timer = setInterval(() => void fetchCommits(), 5000);
    onCleanup(() => {
      cancelled = true;
      clearInterval(timer);
    });
  });

  const firstAgentId = () => props.task.agentIds[0] ?? '';

  const selectedAgentId = () => {
    const active = store.activeAgentId;
    if (props.isActive && active && props.task.agentIds.includes(active)) return active;
    if (props.task.selectedAgentId && props.task.agentIds.includes(props.task.selectedAgentId)) {
      return props.task.selectedAgentId;
    }
    return props.task.agentIds[0] ?? '';
  };

  // Heavy components are created once and reused in both stack and split
  // layouts. Solid owns their reactive scope under TaskPanel (not under the
  // <Show> branch), so when the user crosses the split threshold the DOM is
  // reparented instead of destroyed+recreated. That avoids the expensive
  // xterm.js teardown/reinit and scrollback replay on every layout flip.
  const aiTerminalEl = (
    <div style={{ position: 'relative', height: '100%' }}>
      <TaskAITerminal
        task={props.task}
        isActive={props.isActive}
        selectedAgentId={selectedAgentId()}
        onSelectAgent={setActiveAgent}
        promptHandle={promptHandle}
        onStepJumpReady={(fn, fromIdx) => {
          setStepNav(fn ? { jump: fn, firstIndex: fromIdx } : undefined);
        }}
        // The nav object is stable and holds signals, so it is stored with a
        // thunk — `setPromptNav(api)` would call it as a signal updater.
        onPromptNavReady={(api) => setPromptNav(() => api)}
      />
    </div>
  );
  const shellSectionEl = <TaskShellSection task={props.task} isActive={props.isActive} />;
  const notesBodyEl = (
    <TaskNotesBody
      task={props.task}
      agentId={firstAgentId()}
      onPlanFullscreen={() => setPlanFullscreen(true)}
    />
  );
  // Created eagerly like its siblings, which means it stays mounted (detached)
  // while the card is toggled off, where it used to be built on demand by a
  // `<Show>` in the notes body. That is the price of appearing in both layout
  // trees: built inside `content()` it would be rebuilt on every split-mode
  // flip. `stepsSectionEl` and `changedFilesEl` already pay it while sitting
  // out of a tree, and both are heavier — they poll.
  const tokenUsageEl = <TaskTokenUsagePanel worktreePath={props.task.worktreePath} />;
  const promptHistoryEl = (
    <TaskPromptHistoryPanel
      task={props.task}
      open={showPromptHistory()}
      nav={promptNav()}
      onJumped={() => setTaskFocusedPanel(props.task.id, 'ai-terminal')}
    />
  );
  const changedFilesEl = (
    <TaskChangedFilesSection
      task={props.task}
      isActive={props.isActive}
      commitList={commitList()}
      selectedCommit={selectedCommit()}
      onCommitNavigate={setSelectedCommit}
      onDiffFileClick={(path) => setDiffScrollTarget(path)}
    />
  );
  const stepsSectionEl = (
    <TaskStepsSection
      task={props.task}
      isActive={props.isActive}
      onFileClick={(file) => setDiffScrollTarget(file)}
      firstJumpableIndex={stepNav()?.firstIndex}
      onJumpToStep={
        stepNav()
          ? (idx) => {
              const ok = stepNav()?.jump(idx) ?? false;
              if (ok) setTaskFocusedPanel(props.task.id, 'ai-terminal');
              return ok;
            }
          : undefined
      }
    />
  );
  // Prompt wrapper carries its own intrinsic height so the flex-first panel
  // tree sizes it to 72 px by default and lets a user-drag pin override.
  const promptInputEl = (
    <div
      onClick={() => setTaskFocusedPanel(props.task.id, 'prompt')}
      style={{
        height: '100%',
        'min-height': '72px',
      }}
    >
      <PromptInput
        taskId={props.task.id}
        taskName={props.task.name}
        agentId={firstAgentId()}
        coordinatedBy={props.task.coordinatedBy}
        coordinatorMode={props.task.coordinatorMode}
        controlledBy={props.task.controlledBy}
        stagedNotification={props.task.stagedNotification}
        nowMs={nowMs}
        initialPrompt={props.task.initialPrompt}
        prefillPrompt={props.task.prefillPrompt}
        onSend={() => {
          if (props.task.initialPrompt) clearInitialPrompt(props.task.id);
        }}
        onPrefillConsumed={() => clearPrefillPrompt(props.task.id)}
        ref={(el) => (promptRef = el)}
        handle={(h) => (promptHandle = h)}
      />
    </div>
  );

  // PanelChild wrappers. Flex-first layout means each child declares only
  // what it needs (id, minSize for drag floor); the tree picks one child per
  // ResizablePanel to be the flex absorber via `absorberIds`.

  const stepsSectionChild: PanelChild = {
    id: 'steps-section',
    minSize: 28,
    maxAutoSize: STEPS_PANEL_AUTO_MAX,
    content: () => stepsSectionEl,
  };

  // With no terminals open the shell section collapses to its 28 px toolbar.
  // Mark it noPin so dragging an adjacent handle can't pin it past content
  // size and leave a visible band of empty space above the AI terminal.
  const shellSectionChild: PanelChild = {
    id: 'shell-section',
    minSize: 28,
    noPin: () => props.task.shellAgentIds.length === 0,
    content: () => shellSectionEl,
  };

  const aiTerminalChild: PanelChild = {
    id: 'ai-terminal',
    minSize: 80,
    content: () => aiTerminalEl,
  };

  const promptInputChild: PanelChild = {
    id: 'prompt',
    minSize: 54,
    content: () => promptInputEl,
  };

  const isGitUnavailable = () => props.task.gitIsolation === 'none' || isLandedTask();

  // Notes and changed-files children reused across stack and split trees.
  // In the stack-mode inner horizontal split, both children absorb (50/50 default).
  // In the split-right vertical tree, both are content-sized and shell absorbs.
  const notesChild: PanelChild = {
    id: 'notes',
    minSize: 100,
    maxAutoSize: NOTES_PANEL_AUTO_MAX,
    content: () => notesBodyEl,
  };

  const changedFilesChild: PanelChild = {
    id: 'changed-files',
    minSize: 100,
    maxAutoSize: CHANGED_FILES_PANEL_AUTO_MAX,
    content: () => changedFilesEl,
  };

  // Deliberately NOT gated on `isGitUnavailable()`. Usage is attributed by
  // worktree path out of the CLIs' own logs and has nothing to do with git
  // isolation — a landed task still spent what it spent, and "what did this
  // line of work cost" is a question you ask after landing more often than
  // during. The one condition it does share with the title-bar toggle is
  // `worktreePath`: without a path there is nothing to attribute, the button
  // hides, and a card left behind by a task that lost its worktree mid-session
  // would have no control able to close it.
  const showTokenUsageCard = () => showTokenUsage() && !!props.task.worktreePath;

  const tokenUsageChild: PanelChild = {
    id: 'token-usage',
    minSize: 60,
    maxAutoSize: TOKEN_USAGE_PANEL_AUTO_MAX,
    content: () => tokenUsageEl,
  };

  // Sits in the same slot as the token card in both layout trees, for the same
  // reason: crossing the split threshold must not shuffle the column.
  const promptHistoryChild: PanelChild = {
    id: 'prompt-history',
    minSize: 60,
    maxAutoSize: TOKEN_USAGE_PANEL_AUTO_MAX,
    content: () => promptHistoryEl,
  };

  // Stack-mode row containing notes (absorbs horizontally) and changed files.
  // The inline 200 px floor prevents the nested horizontal panel from collapsing
  // when the outer flex-first tree asks for content-size.
  const notesAndFilesChild: PanelChild = {
    id: 'notes-files',
    minSize: 60,
    absorberWeight: 0.5,
    content: () => (
      <div style={{ height: '100%', 'min-height': '200px' }}>
        {isGitUnavailable() ? (
          notesBodyEl
        ) : (
          <ResizablePanel
            direction="horizontal"
            persistKey={`task:${props.task.id}:notes-split`}
            absorberIds={['notes', 'changed-files']}
            children={[notesChild, changedFilesChild]}
          />
        )}
      </div>
    ),
  };

  return (
    <div
      ref={panelRef}
      class={`task-column ${props.isActive ? 'active' : ''}${store.focusMode ? ' focus-mode' : ''}`}
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        background: theme.taskContainerBg,
        'border-radius': '12px',
        border: `1px solid ${theme.border}`,
        overflow: 'clip',
        position: 'relative',
      }}
      onClick={() => {
        setActiveTask(props.task.id);
      }}
    >
      <TaskClosingOverlay
        closingStatus={props.task.closingStatus}
        closingError={props.task.closingError}
        onRetry={() => retryCloseTask(props.task.id)}
      />
      <Show when={!!props.task.coordinatedBy || !!props.task.coordinatorMode}>
        <div
          style={{
            background: theme.bgElevated,
            'border-bottom': `1px solid ${theme.border}`,
            'font-size': '12px',
            color: theme.fgMuted,
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-between',
              gap: '12px',
            }}
          >
            <span>
              {props.task.coordinatorMode ? 'Auto delivery enabled' : 'Coordinated sub-task'}
            </span>
            <Show
              when={!!props.task.stagedNotification && !props.task.stagedNotification.userEdited}
            >
              <span style={{ color: theme.accent, 'font-size': '11px' }}>{stagedCountdown()}</span>
            </Show>
          </div>
          <Show when={!!props.task.stagedNotification && !props.task.stagedNotification.userEdited}>
            <div
              style={{
                'border-top': `1px solid ${theme.border}`,
                padding: '6px 12px',
                background: `${theme.accent}11`,
              }}
            >
              <div
                style={{
                  'white-space': 'pre-wrap',
                  'word-break': 'break-word',
                  'max-height': '80px',
                  overflow: 'hidden',
                  color: theme.fg,
                  'font-size': '11px',
                  opacity: '0.85',
                }}
              >
                {props.task.stagedNotification?.text}
              </div>
            </div>
          </Show>
        </div>
        <Show when={props.task.coordinatorMode && props.task.dockerMode && isMac}>
          <div
            style={{
              'border-bottom': `1px solid ${theme.border}`,
              background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
              padding: '4px 12px',
              'font-size': '11px',
              color: theme.warning,
            }}
          >
            {tr(
              'MCP server bound to all interfaces (macOS + Docker) — port reachable on local network',
            )}
          </div>
        </Show>
      </Show>
      <Show when={props.task.coordinatorMode}>
        <SubTaskStrip coordinatorTaskId={props.task.id} />
      </Show>
      <div
        class="task-header-stack"
        style={{
          flex: `0 0 ${props.task.stepsEnabled ? 102 : 78}px`,
          display: 'flex',
          'flex-direction': 'column',
          overflow: 'hidden',
        }}
      >
        {/* Title + branch bars live outside <Show> so they don't remount on layout flips. */}
        <div style={{ flex: '0 0 50px', overflow: 'hidden' }}>
          <TaskTitleBar
            task={props.task}
            isActive={props.isActive}
            onClose={() => setShowCloseConfirm(true)}
            onMerge={() => setShowMergeConfirm(true)}
            onPush={() => setShowPushConfirm(true)}
            pushing={pushing()}
            pushSuccess={pushSuccess()}
            tokenUsageOpen={showTokenUsage()}
            onToggleTokenUsage={() => setShowTokenUsage((open) => !open)}
            promptHistoryOpen={showPromptHistory()}
            promptHistoryCount={props.task.promptHistory?.length ?? 0}
            onTogglePromptHistory={() => setShowPromptHistory((open) => !open)}
            onTitleEditRef={(h) => (titleEditHandle = h)}
          />
        </div>
        <Show when={props.task.stepsEnabled}>
          <TaskCurrentStateLine task={props.task} nowMs={nowMs()} variant="card" />
        </Show>
        <div style={{ flex: '0 0 28px', overflow: 'hidden' }}>
          <TaskBranchInfoBar task={props.task} onEditProject={(id) => setEditingProjectId(id)} />
        </div>
      </div>
      <div style={{ flex: '1', 'min-height': '0' }}>
        <Show
          when={useSplit()}
          fallback={
            <ResizablePanel
              direction="vertical"
              persistKey={`task:${props.task.id}`}
              absorberIds={['notes-files', 'ai-terminal']}
              children={[
                // Topmost, so the card sits in the same slot in both trees and
                // crossing the split threshold does not shuffle the column. In
                // this tree it is above the notes/changed-files row, because
                // that row is one child: there is no position "above notes"
                // that is not also above changed files.
                ...(showTokenUsageCard() ? [tokenUsageChild] : []),
                ...(showPromptHistory() ? [promptHistoryChild] : []),
                notesAndFilesChild,
                shellSectionChild,
                aiTerminalChild,
                ...(props.task.stepsEnabled ? [stepsSectionChild] : []),
                ...(store.showPromptInput || props.task.coordinatorMode ? [promptInputChild] : []),
              ]}
            />
          }
        >
          <ResizablePanel
            direction="horizontal"
            persistKey={`task:${props.task.id}:split-cols`}
            absorberIds={['left-col']}
            children={[
              {
                id: 'left-col',
                minSize: 420,
                content: () => (
                  <ResizablePanel
                    direction="vertical"
                    persistKey={`task:${props.task.id}:split-left`}
                    absorberIds={['ai-terminal']}
                    children={[
                      aiTerminalChild,
                      ...(store.showPromptInput || props.task.coordinatorMode
                        ? [promptInputChild]
                        : []),
                    ]}
                  />
                ),
              },
              {
                id: 'right-col',
                minSize: 360,
                defaultSize: 420,
                content: () => (
                  <ResizablePanel
                    direction="vertical"
                    persistKey={`task:${props.task.id}:split-right`}
                    absorberIds={['shell-section']}
                    children={[
                      ...(showTokenUsageCard() ? [tokenUsageChild] : []),
                      ...(showPromptHistory() ? [promptHistoryChild] : []),
                      ...(isGitUnavailable() ? [] : [changedFilesChild]),
                      notesChild,
                      ...(props.task.stepsEnabled ? [stepsSectionChild] : []),
                      shellSectionChild,
                    ]}
                  />
                ),
              },
            ]}
          />
        </Show>
      </div>
      <CloseTaskDialog
        open={showCloseConfirm()}
        task={props.task}
        onDone={() => setShowCloseConfirm(false)}
      />
      <Show when={props.task.gitIsolation !== 'none' && !isLandedTask()}>
        <MergeDialog
          open={showMergeConfirm()}
          task={props.task}
          initialCleanup={
            props.task.externalWorktree
              ? false
              : (getProject(props.task.projectId)?.deleteBranchOnClose ?? true)
          }
          onDone={() => setShowMergeConfirm(false)}
          onDiffFileClick={(file) => setDiffScrollTarget(file.path)}
        />
        <PushDialog
          open={showPushConfirm()}
          task={props.task}
          onStart={() => {
            setPushing(true);
            setPushSuccess(false);
            clearTimeout(pushSuccessTimer);
          }}
          onClose={() => {
            setShowPushConfirm(false);
          }}
          onDone={(success) => {
            const wasHidden = !showPushConfirm();
            setShowPushConfirm(false);
            setPushing(false);
            if (success) {
              setPushSuccess(true);
              pushSuccessTimer = setTimeout(() => setPushSuccess(false), 3000);
            }
            if (wasHidden) {
              showNotification(success ? 'Push completed' : 'Push failed');
            }
          }}
        />
        <Show when={diffScrollTarget() !== null}>
          <DiffViewerDialog
            scrollToFile={diffScrollTarget()}
            taskName={props.task.name}
            worktreePath={props.task.worktreePath}
            coverageReportPath={getProject(props.task.projectId)?.coverageReportPath}
            projectRoot={getProject(props.task.projectId)?.path}
            branchName={props.task.branchName}
            baseBranch={props.task.baseBranch}
            onClose={() => setDiffScrollTarget(null)}
            taskId={props.task.id}
            agentId={props.task.agentIds[0]}
            commitList={commitList()}
            selectedCommit={selectedCommit()}
            onCommitNavigate={setSelectedCommit}
            gitIsolation={props.task.gitIsolation}
          />
        </Show>
      </Show>
      <EditProjectDialog project={editingProject()} onClose={() => setEditingProjectId(null)} />
      <PlanViewerDialog
        open={planFullscreen()}
        onClose={() => setPlanFullscreen(false)}
        planContent={props.task.planContent ?? ''}
        planFileName={props.task.planFileName ?? 'plan.md'}
        taskId={props.task.id}
        agentId={props.task.agentIds[0]}
        worktreePath={props.task.worktreePath}
      />
    </div>
  );
}
