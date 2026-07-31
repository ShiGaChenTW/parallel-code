import { For, Show, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { tr } from '../store/i18n';
import {
  store,
  updateTaskNotes,
  setTaskFocusedPanel,
  sendPrompt,
  isAgentAskingQuestion,
  isPanelFocused,
  readTranscript,
} from '../store/store';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { createHighlightedMarkdown } from '../lib/marked-shiki';
import { useFocusRegistration } from '../lib/focus-registration';
import {
  nextNotesTab,
  visibleNotesTabs,
  type NotesTab,
  type NotesTabAvailability,
} from './task-notes-tabs';
import {
  toTimelineRows,
  transcriptEmptyMessage,
  transcriptSummaryLine,
} from '../lib/transcript-timeline';
import type { TranscriptEvent } from '../ipc/types';
import type { Task } from '../store/types';

interface TaskNotesBodyProps {
  task: Task;
  agentId: string;
  onPlanFullscreen: () => void;
}

/** Untranslated on purpose: the sibling tabs are too. See the plan doc, D6. */
const TAB_LABELS: Record<NotesTab, string> = {
  notes: 'Notes',
  plan: 'Plan',
  handoff: 'Handoff',
  timeline: 'Timeline',
};

/** How often the visible Timeline pane re-reads the task's transcript file. */
const TIMELINE_REFRESH_MS = 4_000;

/** Keyboard scrolling shared by the read-only markdown panes (plan, handoff). */
function scrollByKey(el: HTMLDivElement | undefined, e: KeyboardEvent): void {
  if (!el) return;
  const step = 40;
  const page = Math.max(100, el.clientHeight - 40);
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      el.scrollTop += step;
      break;
    case 'ArrowUp':
      e.preventDefault();
      el.scrollTop -= step;
      break;
    case 'PageDown':
      e.preventDefault();
      el.scrollTop += page;
      break;
    case 'PageUp':
      e.preventDefault();
      el.scrollTop -= page;
      break;
    case 'Home':
      e.preventDefault();
      el.scrollTop = 0;
      break;
    case 'End':
      e.preventDefault();
      el.scrollTop = el.scrollHeight;
      break;
  }
}

export function TaskNotesBody(props: TaskNotesBodyProps) {
  const [notesTab, setNotesTab] = createSignal<NotesTab>('notes');
  const [sendingNotes, setSendingNotes] = createSignal(false);

  async function handleSendNotes() {
    if (sendingNotes()) return;
    const val = props.task.notes?.trim();
    if (!val) return;
    if (!props.agentId) return;
    if (isAgentAskingQuestion(props.agentId)) return;
    setSendingNotes(true);
    try {
      await sendPrompt(props.task.id, props.agentId, val);
    } catch (e) {
      console.error('Failed to send notes to prompt:', e);
    } finally {
      setSendingNotes(false);
    }
  }

  const canSendNotes = () =>
    !sendingNotes() &&
    !!props.task.notes?.trim() &&
    !!props.agentId &&
    !isAgentAskingQuestion(props.agentId);
  // Both panes go through createHighlightedMarkdown, which runs the rendered
  // HTML through DOMPurify before it reaches innerHTML (FR-CONTEXT-03).
  const planHtml = createHighlightedMarkdown(() => props.task.planContent);
  const handoffHtml = createHighlightedMarkdown(() => props.task.handoffContent);

  const availability = (): NotesTabAvailability => ({
    plan: store.showPlans && !!props.task.planContent,
    handoff: !!props.task.handoffContent,
    timeline: store.transcriptEnabled,
  });

  const tabs = () => visibleNotesTabs(availability());

  /** The tab actually rendered — clamped so a tab can never outlive its content. */
  const activeTab = (): NotesTab => {
    const current = notesTab();
    return tabs().includes(current) ? current : 'notes';
  };

  // Auto-switch when content appears or disappears. All of the decision-making
  // lives in nextNotesTab so it can be unit tested; this effect only feeds it.
  let previousAvailability: NotesTabAvailability = { plan: false, handoff: false, timeline: false };
  createEffect(() => {
    const next = availability();
    setNotesTab((current) => nextNotesTab({ current, previous: previousAvailability, next }));
    previousAvailability = next;
  });

  // The transcript lives on disk in the main process, so the pane polls rather
  // than subscribes. Only while it is the visible tab: a background poll of
  // every open task's file would be a filesystem read per task per tick, to
  // render something nobody is looking at.
  const [transcript, setTranscript] = createSignal<TranscriptEvent[]>([]);
  createEffect(() => {
    if (activeTab() !== 'timeline' || !store.transcriptEnabled) return;
    const taskId = props.task.id;
    let cancelled = false;
    const load = async () => {
      try {
        const events = await readTranscript(taskId);
        if (!cancelled) setTranscript(events);
      } catch {
        /* a transcript that cannot be read is an empty one, not an error dialog */
      }
    };
    void load();
    const timer = setInterval(() => void load(), TIMELINE_REFRESH_MS);
    onCleanup(() => {
      cancelled = true;
      clearInterval(timer);
    });
  });

  let notesRef: HTMLTextAreaElement | undefined;
  let planScrollRef: HTMLDivElement | undefined;
  let handoffScrollRef: HTMLDivElement | undefined;
  let timelineScrollRef: HTMLDivElement | undefined;

  onMount(() => {
    const id = props.task.id;
    useFocusRegistration(`${id}:notes`, () => {
      const tab = activeTab();
      if (tab === 'plan') {
        planScrollRef?.focus();
      } else if (tab === 'handoff') {
        handoffScrollRef?.focus();
      } else if (tab === 'timeline') {
        timelineScrollRef?.focus();
      } else {
        notesRef?.focus();
      }
    });
  });

  const intrinsicHeight = () => (store.focusMode ? '240px' : '140px');

  return (
    <div
      class="focusable-panel"
      data-panel-focused={isPanelFocused(props.task.id, 'notes') ? 'true' : 'false'}
      style={{
        width: '100%',
        height: '100%',
        'min-height': intrinsicHeight(),
        display: 'flex',
        'flex-direction': 'column',
      }}
      onClick={() => setTaskFocusedPanel(props.task.id, 'notes')}
    >
      {/* A lone Notes tab is noise, so the strip only appears once there is
          something to switch to. */}
      <Show when={tabs().length > 1}>
        <div
          style={{
            display: 'flex',
            'border-bottom': `1px solid ${theme.border}`,
            'flex-shrink': '0',
          }}
        >
          <For each={tabs()}>
            {(tab) => (
              <button
                style={{
                  padding: '2px 8px',
                  'font-size': sf(11),
                  background: activeTab() === tab ? theme.taskPanelBg : 'transparent',
                  color: activeTab() === tab ? theme.fg : theme.fgMuted,
                  border: 'none',
                  'border-bottom':
                    activeTab() === tab ? `2px solid ${theme.accent}` : '2px solid transparent',
                  cursor: 'pointer',
                  'font-family': "'JetBrains Mono', monospace",
                }}
                onClick={() => setNotesTab(tab)}
              >
                {tr(TAB_LABELS[tab])}
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={activeTab() === 'notes'}>
        <div
          style={{
            flex: '1',
            display: 'flex',
            'flex-direction': 'column',
            position: 'relative',
            'min-height': '0',
          }}
        >
          <textarea
            ref={(el) => (notesRef = el)}
            value={props.task.notes}
            onInput={(e) => updateTaskNotes(props.task.id, e.currentTarget.value)}
            placeholder={tr('Notes...')}
            style={{
              width: '100%',
              flex: '1',
              background: theme.taskPanelBg,
              border: 'none',
              padding: '6px 8px',
              color: theme.fg,
              'font-size': sf(12),
              'font-family': "'JetBrains Mono', monospace",
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            class="send-notes-btn"
            type="button"
            disabled={!canSendNotes()}
            onClick={() => void handleSendNotes()}
            title={tr('Send notes as a prompt to the agent')}
            aria-label={tr('Send notes as a prompt to the agent')}
            style={{
              position: 'absolute',
              bottom: '6px',
              right: '6px',
              width: '22px',
              height: '22px',
              padding: '0',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: `color-mix(in srgb, ${theme.accent} 12%, ${theme.bgInput})`,
              color: theme.fg,
              border: `1px solid color-mix(in srgb, ${theme.accent} 25%, ${theme.border})`,
              'border-radius': '50%',
              cursor: canSendNotes() ? 'pointer' : 'default',
              opacity: canSendNotes() ? '1' : '0.4',
              'z-index': '1',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 2V12M7 12L3 8M7 12l4 -4"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </Show>

      <Show when={activeTab() === 'plan'}>
        <div
          style={{
            flex: '1',
            overflow: 'hidden',
            display: 'flex',
            'flex-direction': 'column',
            position: 'relative',
          }}
        >
          <div
            ref={(el) => (planScrollRef = el)}
            tabIndex={0}
            class="plan-markdown"
            style={{
              flex: '1',
              overflow: 'auto',
              padding: '6px 8px',
              background: theme.taskPanelBg,
              color: theme.fg,
              'font-size': sf(12),
              'font-family': "'JetBrains Mono', monospace",
              outline: 'none',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                props.onPlanFullscreen();
                return;
              }
              scrollByKey(planScrollRef, e);
            }}
            // eslint-disable-next-line solid/no-innerhtml -- plan files are local, written by Claude Code in the worktree
            innerHTML={planHtml()}
          />
          <button
            class="btn-secondary review-plan-btn"
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              padding: '4px 16px',
              'font-size': sf(12),
              'font-family': "'JetBrains Mono', monospace",
              background: `color-mix(in srgb, ${theme.accent} 12%, ${theme.bgInput})`,
              color: theme.fg,
              border: `1px solid color-mix(in srgb, ${theme.accent} 25%, ${theme.border})`,
              'border-radius': '6px',
              cursor: 'pointer',
              'z-index': '1',
            }}
            onClick={() => props.onPlanFullscreen()}
          >
            {tr('Review Plan')}
          </button>
        </div>
      </Show>

      {/* Handoff — `.claude/handoff.md`, written by the agent handing over.
          Read-only by design: the file is the agent's output, and the app
          editing it would fight whichever agent is writing. Reuses the
          `plan-markdown` class so no stylesheet changes are needed. */}
      <Show when={activeTab() === 'handoff'}>
        <div
          ref={(el) => (handoffScrollRef = el)}
          tabIndex={0}
          class="plan-markdown"
          style={{
            flex: '1',
            overflow: 'auto',
            padding: '6px 8px',
            background: theme.taskPanelBg,
            color: theme.fg,
            'font-size': sf(12),
            'font-family': "'JetBrains Mono', monospace",
            outline: 'none',
          }}
          onKeyDown={(e) => scrollByKey(handoffScrollRef, e)}
          // eslint-disable-next-line solid/no-innerhtml -- sanitised by DOMPurify in createHighlightedMarkdown (FR-CONTEXT-03)
          innerHTML={handoffHtml()}
        />
      </Show>

      {/* Timeline — the persisted lifecycle sequence for this task, read back
          from `transcripts/<taskId>.jsonl`. Read-only by definition: it is a
          record, and the row list is produced entirely by toTimelineRows so
          this stays a renderer. */}
      <Show when={activeTab() === 'timeline'}>
        <div
          ref={(el) => (timelineScrollRef = el)}
          tabIndex={0}
          style={{
            flex: '1',
            overflow: 'auto',
            padding: '6px 8px',
            background: theme.taskPanelBg,
            color: theme.fg,
            'font-size': sf(12),
            'font-family': "'JetBrains Mono', monospace",
            outline: 'none',
          }}
          onKeyDown={(e) => scrollByKey(timelineScrollRef, e)}
        >
          <Show
            when={transcript().length > 0}
            fallback={
              <div style={{ color: theme.fgSubtle, padding: '4px 0' }}>
                {tr(transcriptEmptyMessage(store.transcriptEnabled))}
              </div>
            }
          >
            <div style={{ color: theme.fgSubtle, 'padding-bottom': '4px' }}>
              <Show when={transcriptSummaryLine(transcript())}>
                {(summary) => tr(summary().text, summary().params)}
              </Show>
            </div>
            <For each={toTimelineRows(transcript())}>
              {(row) => (
                <>
                  <Show when={row.dateHeading}>
                    <div
                      style={{
                        color: theme.fgSubtle,
                        'border-bottom': `1px solid ${theme.border}`,
                        margin: '6px 0 2px',
                      }}
                    >
                      {row.dateHeading}
                    </div>
                  </Show>
                  <div style={{ display: 'flex', gap: '8px', padding: '1px 0' }}>
                    <span style={{ color: theme.fgSubtle, 'flex-shrink': '0' }}>{row.time}</span>
                    <span style={{ color: theme.accent, 'flex-shrink': '0' }}>{row.label}</span>
                    <span style={{ 'min-width': '0', 'word-break': 'break-word' }}>
                      {row.summary}
                      <Show when={row.detail}>
                        <span style={{ color: theme.fgSubtle }}> — {row.detail}</span>
                      </Show>
                      <Show when={row.redacted}>
                        <span
                          title={tr(
                            'Content matching a known secret shape was masked before this was written',
                          )}
                          style={{ color: theme.fgMuted }}
                        >
                          {' '}
                          [redacted]
                        </span>
                      </Show>
                    </span>
                  </div>
                </>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
