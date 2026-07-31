import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { tr } from '../store/i18n';
import { store } from '../store/store';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { promptPreview, promptTimeLabel, type PromptHistoryEntry } from '../lib/prompt-history';
import type { Task } from '../store/types';

/**
 * What the panel needs from the terminals underneath it, supplied by
 * `TaskAITerminal`, which is the only thing that knows which agent's xterm holds
 * which prompt's marker.
 */
export interface PromptNavApi {
  /** Scroll that prompt's agent terminal back to where it was submitted.
   *  False when the anchor is gone — the caller must say so, not no-op. */
  jump(promptId: number): boolean;
  /** Reactive: the prompt ids whose anchors are still in a terminal buffer. */
  anchored(): ReadonlySet<number>;
  /** Recheck every anchor now. Anchors expire silently as scrollback rolls. */
  refresh(): void;
}

interface TaskPromptHistoryPanelProps {
  task: Task;
  /** Reactive. The card is built eagerly and only inserted in the layout tree
   *  when open, so this is how the panel learns it has become visible. */
  open: boolean;
  nav: PromptNavApi | undefined;
  onJumped?: () => void;
}

/**
 * Every prompt submitted in this task, and a way back to where each one landed.
 *
 * A card beside the terminal rather than a dropdown over it. The list exists to
 * drive the terminal — click a prompt, the terminal scrolls to it — and a
 * popover would cover the thing it is scrolling. It is the same `PanelChild`
 * shape as Token Usage and Changed Files, toggled by the same kind of title-bar
 * button, so it costs the layout nothing new.
 *
 * **Newest first.** The rest of the app puts the newest agent output at the
 * bottom, but this list is read to answer "what did I ask a moment ago", and a
 * chronological list makes that answer the one furthest from the eye and behind
 * a scroll on a long task. The `#n` badge carries the true order.
 *
 * **Session-only, and never written to disk.** The value of a row is that it
 * scrolls the terminal to the moment the prompt was sent; that anchor is an
 * xterm marker, and xterm's buffer does not survive a restart. Persisting would
 * therefore restore a list where nothing is clickable — the feature with its
 * point removed. It would also put user prompt text on disk, which is exactly
 * the content `electron/ipc/transcript.ts` already governs with a considered
 * retention policy (5000 events / 30 days, off by default) and
 * `electron/ipc/redact.ts` already masks. A second store of the same content
 * under different rules is a privacy regression, not a feature. Nothing here
 * leaves memory, so there is nothing to redact.
 *
 * **Agents.** The agent chip only appears on tasks that have more than one
 * agent. On the single-agent task — the common one — "which agent" has one
 * answer and printing it on every row is noise.
 */
export function TaskPromptHistoryPanel(props: TaskPromptHistoryPanelProps) {
  // Set by a click that came back false: the anchor died between the last
  // refresh and the click. Cleared on refresh so a re-marked id can recover.
  const [failedIds, setFailedIds] = createSignal<ReadonlySet<number>>(new Set());

  // Anchors expire on their own as scrollback rolls, with no event to hang a
  // recompute on. Rechecking when the card is opened is when accuracy matters,
  // and a click on a row that went stale while the card sat open still reports
  // it — so no click is ever a silent no-op.
  createEffect(() => {
    if (!props.open) return;
    setFailedIds(new Set<number>());
    props.nav?.refresh();
  });

  const entries = createMemo<PromptHistoryEntry[]>(() =>
    [...(props.task.promptHistory ?? [])].reverse(),
  );
  const showAgent = () => props.task.agentIds.length > 1;
  // An agent closed mid-task keeps its prompts in the list — they happened —
  // but its record is gone from the store, so the row says so rather than
  // rendering a blank chip.
  const agentLabel = (agentId: string) => store.agents[agentId]?.def.name ?? tr('closed agent');

  const canJump = (entry: PromptHistoryEntry) =>
    props.nav !== undefined && props.nav.anchored().has(entry.id) && !failedIds().has(entry.id);

  function jump(entry: PromptHistoryEntry) {
    if (props.nav?.jump(entry.id)) {
      props.onJumped?.();
      return;
    }
    setFailedIds((ids) => new Set(ids).add(entry.id));
  }

  return (
    <div
      class="focusable-panel"
      style={{
        height: '100%',
        'max-height': '40vh',
        display: 'flex',
        'flex-direction': 'column',
        background: theme.taskPanelBg,
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          'font-size': sf(11),
          'font-weight': '600',
          color: theme.fgMuted,
          'text-transform': 'uppercase',
          'letter-spacing': '0.05em',
          'border-bottom': `1px solid ${theme.border}`,
          'flex-shrink': '0',
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
        }}
      >
        <span style={{ 'flex-shrink': '0' }}>{tr('Prompt History')}</span>
        <span style={{ flex: '1' }} />
        <Show when={entries().length > 0}>
          <span
            style={{
              color: theme.fg,
              'font-variant-numeric': 'tabular-nums',
              'letter-spacing': 'normal',
              'flex-shrink': '0',
            }}
          >
            {entries().length}
          </span>
        </Show>
      </div>

      <div
        style={{
          flex: '1',
          'min-height': '0',
          overflow: 'auto',
          display: 'flex',
          'flex-direction': 'column',
          padding: '4px',
          gap: '2px',
        }}
      >
        <Show
          when={entries().length > 0}
          fallback={
            <div
              style={{
                color: theme.fgMuted,
                'font-size': sf(11),
                'line-height': '1.5',
                padding: '4px',
              }}
            >
              {tr(
                'Nothing sent in this task yet. Every prompt you submit shows up here, newest first, and clicking one scrolls the terminal back to it.',
              )}
            </div>
          }
        >
          <For each={entries()}>
            {(entry) => {
              const jumpable = () => canJump(entry);
              const preview = () => promptPreview(entry.text);
              return (
                <div
                  role="button"
                  tabindex="0"
                  title={
                    jumpable()
                      ? `${entry.text}\n\n${tr('Click to scroll the terminal to this prompt')}`
                      : `${entry.text}\n\n${tr('This spot is no longer in the terminal buffer')}`
                  }
                  onClick={() => jump(entry)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    jump(entry);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.bgHover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  style={{
                    display: 'flex',
                    'align-items': 'baseline',
                    gap: '6px',
                    padding: '4px 6px',
                    'border-radius': '4px',
                    background: 'transparent',
                    cursor: 'pointer',
                    'text-align': 'left',
                  }}
                >
                  <span
                    style={{
                      'font-size': sf(9),
                      color: theme.fgSubtle,
                      'font-variant-numeric': 'tabular-nums',
                      'flex-shrink': '0',
                    }}
                  >
                    #{entry.id}
                  </span>
                  <span
                    style={{
                      'font-size': sf(9),
                      color: theme.fgSubtle,
                      'font-variant-numeric': 'tabular-nums',
                      'flex-shrink': '0',
                    }}
                  >
                    {promptTimeLabel(entry.at)}
                  </span>
                  <Show when={showAgent()}>
                    <span
                      style={{
                        'font-size': sf(9),
                        color: theme.fgMuted,
                        padding: '0 4px',
                        'border-radius': '3px',
                        border: `1px solid ${theme.border}`,
                        'flex-shrink': '0',
                        'max-width': '90px',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {agentLabel(entry.agentId)}
                    </span>
                  </Show>
                  <span
                    style={{
                      flex: '1',
                      'min-width': '0',
                      'font-size': sf(11),
                      'line-height': '1.45',
                      color: jumpable() ? theme.fg : theme.fgSubtle,
                      display: '-webkit-box',
                      '-webkit-line-clamp': '2',
                      '-webkit-box-orient': 'vertical',
                      overflow: 'hidden',
                      'overflow-wrap': 'anywhere',
                    }}
                  >
                    {preview() || tr('(no readable text)')}
                  </span>
                  {/* The state is spelled out, not implied by a greyed arrow:
                      "why can I not click this" has an answer and the row is
                      where it belongs. */}
                  <Show
                    when={jumpable()}
                    fallback={
                      <span
                        style={{
                          'font-size': sf(9),
                          color: theme.fgSubtle,
                          'flex-shrink': '0',
                          'white-space': 'nowrap',
                        }}
                      >
                        {tr('scrolled out')}
                      </span>
                    }
                  >
                    <span
                      style={{ 'font-size': sf(11), color: theme.accent, 'flex-shrink': '0' }}
                      aria-hidden="true"
                    >
                      ↗
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
