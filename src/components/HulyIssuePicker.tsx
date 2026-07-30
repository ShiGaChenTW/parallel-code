import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { store } from '../store/store';
import { hulyConfigured, refreshHulyIssues } from '../store/huly';
import { tr } from '../store/i18n';
import { theme, sectionLabelStyle } from '../lib/theme';
import {
  filterIssues,
  linkedIssueIds,
  partitionIssues,
  taskNameForIssue,
} from '../lib/huly-issues';
import type { HulyIssue } from '../ipc/types';
import { errMessage } from '../lib/log';

/**
 * Pick a Huly issue to start work on.
 *
 * A filtered list and a button, deliberately — not a board. The value is
 * turning an issue into a worktree plus a running agent; a drag surface adds
 * cost in the one layer this project cannot test, and the sidebar already shows
 * task state.
 *
 * Renders from the cached list first so it appears instantly and still works
 * with Huly unreachable, then refreshes in the background.
 */
export function HulyIssuePicker(props: { onSelect: (issue: HulyIssue) => void }) {
  const [query, setQuery] = createSignal('');
  const [error, setError] = createSignal('');
  const [refreshing, setRefreshing] = createSignal(false);

  const refresh = (force: boolean) => {
    if (!hulyConfigured()) return;
    setRefreshing(true);
    setError('');
    refreshHulyIssues(force)
      .catch((err) => setError(errMessage(err)))
      .finally(() => setRefreshing(false));
  };

  onMount(() => refresh(false));

  // Issues with no task yet come first: offering one that already has a
  // worktree invites a duplicate.
  const unstarted = createMemo(() => {
    const linked = linkedIssueIds(Object.values(store.tasks));
    return filterIssues(partitionIssues(store.hulyIssues, linked).unstarted, query());
  });

  const stale = createMemo(() => store.hulyIssuesFetchedAt > 0 && error() !== '');

  return (
    <Show when={hulyConfigured()}>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
        <label style={sectionLabelStyle}>
          {tr('Start from a Huly issue')}{' '}
          <span style={{ opacity: '0.5', 'text-transform': 'none' }}>
            {store.hulyProjectIdentifier}
          </span>
        </label>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            class="input-field"
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={tr('Search...')}
            style={{
              flex: '1',
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              padding: '8px 12px',
              color: theme.fg,
              'font-size': '13px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={refreshing()}
            title={tr('Refresh')}
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              color: theme.fgMuted,
              cursor: refreshing() ? 'default' : 'pointer',
              padding: '8px 12px',
              'font-size': '13px',
            }}
          >
            {refreshing() ? '…' : '↻'}
          </button>
        </div>

        <Show when={error()}>
          <div style={{ 'font-size': '12px', color: theme.fgSubtle }}>
            {/* Say which list is on screen rather than only that something failed. */}
            {stale() ? `${tr('Showing cached issues — Huly unreachable.')} ${error()}` : error()}
          </div>
        </Show>

        <Show
          when={unstarted().length > 0}
          fallback={
            <div style={{ 'font-size': '12px', color: theme.fgSubtle, padding: '4px 2px' }}>
              {store.hulyIssues.length === 0
                ? tr('No issues loaded yet.')
                : tr('Every issue already has a task.')}
            </div>
          }
        >
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: '2px',
              'max-height': '180px',
              'overflow-y': 'auto',
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              padding: '4px',
              background: theme.bgInput,
            }}
          >
            <For each={unstarted()}>
              {(issue) => (
                <button
                  type="button"
                  onClick={() => props.onSelect(issue)}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    'align-items': 'baseline',
                    background: 'transparent',
                    border: 'none',
                    'border-radius': '6px',
                    color: theme.fg,
                    cursor: 'pointer',
                    padding: '6px 8px',
                    'text-align': 'left',
                    'font-size': '13px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = theme.bgElevated)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span
                    style={{
                      color: theme.fgMuted,
                      'font-family': 'var(--font-mono)',
                      'font-size': '12px',
                      'white-space': 'nowrap',
                    }}
                  >
                    {issue.identifier}
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    {taskNameForIssue(issue).slice(issue.identifier.length).trim()}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
