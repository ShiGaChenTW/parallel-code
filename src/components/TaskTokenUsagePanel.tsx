import { For, Show } from 'solid-js';
import { tr } from '../store/i18n';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { tokenUsage } from '../store/tokenUsage';
import { formatShare, formatTokens, worktreeUsage } from '../lib/token-usage-format';

/**
 * Token spend for one task's worktree, expanded above its notes.
 *
 * The settings table answers "what has this machine spent"; this answers "what
 * has this line of work spent", which is the question you have while the line is
 * still running. Same snapshot, filtered to one path — `startTokenUsageSubscription`
 * already seeds the watcher with every task's `worktreePath`, so the row is in
 * the snapshot the moment the task exists and no extra IPC is needed.
 *
 * The picture is a stacked share bar rather than a chart. Three reasons, in
 * order of weight. It answers the only visual question worth asking here —
 * which vendor ate this task — in one glance and with no axis to read. It is
 * CSS, so it costs nothing against a renderer startup budget already at 83%,
 * where any charting library would fail the bundle gate outright. And it is the
 * one shape that cannot look broken with a single provider: a proportion bar
 * with one segment is simply full, whereas a one-bar bar chart looks like a
 * rendering fault.
 *
 * No cost column, for the reason `TokenUsageSection` gives: vendor pricing
 * differs and moves, and a wrong currency figure is worse than none.
 */
export function TaskTokenUsagePanel(props: { worktreePath: string }) {
  const usage = () => worktreeUsage(tokenUsage().paths, props.worktreePath);

  const labelStyle = {
    color: theme.fgSubtle,
    'font-size': sf(10),
    'letter-spacing': '0.04em',
    'text-transform': 'uppercase',
  } as const;

  const valueStyle = {
    color: theme.fg,
    'font-size': sf(11),
    'font-variant-numeric': 'tabular-nums',
  } as const;

  const KindCell = (cellProps: { label: string; value: number }) => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1px', 'min-width': '0' }}>
      <span style={labelStyle}>{cellProps.label}</span>
      <span style={valueStyle}>{formatTokens(cellProps.value)}</span>
    </div>
  );

  return (
    <div
      style={{
        'flex-shrink': '0',
        display: 'flex',
        'flex-direction': 'column',
        gap: '6px',
        padding: '6px 8px',
        background: theme.taskPanelBg,
        'border-bottom': `1px solid ${theme.border}`,
        'font-family': "'JetBrains Mono', monospace",
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'baseline',
          'justify-content': 'space-between',
          gap: '8px',
        }}
      >
        <span style={labelStyle}>{tr('Tokens in this worktree')}</span>
        <span
          style={{
            color: theme.fg,
            'font-size': sf(13),
            'font-weight': '600',
            'font-variant-numeric': 'tabular-nums',
          }}
        >
          {formatTokens(usage().total)}
        </span>
      </div>

      <Show when={usage().state === 'no-worktree'}>
        <div style={{ color: theme.fgMuted, 'font-size': sf(11), 'line-height': '1.5' }}>
          {tr('This task has no worktree yet, so no usage can be attributed to it.')}
        </div>
      </Show>

      <Show when={usage().state === 'no-usage'}>
        <div style={{ color: theme.fgMuted, 'font-size': sf(11), 'line-height': '1.5' }}>
          {tr('No AI CLI usage has been recorded for this worktree yet.')}
        </div>
      </Show>

      <Show when={usage().shares.length > 0}>
        {/* Segments are flex-grown by their token count rather than given a
            width percentage, so the bar fills exactly and a provider worth a
            fraction of a percent still gets a visible sliver instead of
            rounding away to nothing. */}
        <div
          style={{
            display: 'flex',
            height: '8px',
            'border-radius': '4px',
            overflow: 'hidden',
            background: theme.bgInput,
          }}
        >
          <For each={usage().shares}>
            {(share) => (
              <div
                title={`${share.label} — ${formatTokens(share.tokens)} (${formatShare(share.share)})`}
                style={{
                  flex: `${share.tokens} 1 0`,
                  'min-width': '2px',
                  background: share.color,
                }}
              />
            )}
          </For>
        </div>

        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px 12px' }}>
          <For each={usage().shares}>
            {(share) => (
              <span
                style={{
                  display: 'inline-flex',
                  'align-items': 'center',
                  gap: '5px',
                  'font-size': sf(11),
                  color: theme.fgMuted,
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    'border-radius': '2px',
                    background: share.color,
                    'flex-shrink': '0',
                  }}
                />
                {/* Vendor names, deliberately not translated — same rule the
                    settings table follows for its column headers. */}
                <span style={{ color: theme.fg }}>{share.label}</span>
                <span style={{ 'font-variant-numeric': 'tabular-nums' }}>
                  {formatTokens(share.tokens)}
                </span>
                <span style={{ color: theme.fgSubtle }}>{formatShare(share.share)}</span>
              </span>
            )}
          </For>
        </div>
      </Show>

      <Show when={usage().state === 'ok'}>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'repeat(auto-fit, minmax(64px, 1fr))',
            gap: '4px 10px',
          }}
        >
          <KindCell label={tr('Input')} value={usage().totals.input} />
          <KindCell label={tr('Output')} value={usage().totals.output} />
          <KindCell label={tr('Cache read')} value={usage().totals.cacheRead} />
          <KindCell label={tr('Cache write')} value={usage().totals.cacheWrite} />
        </div>
      </Show>

      <div style={{ color: theme.fgSubtle, 'font-size': sf(10), 'line-height': '1.4' }}>
        {tr('Counts only this task. The Settings table covers every worktree.')}
      </div>
    </div>
  );
}
