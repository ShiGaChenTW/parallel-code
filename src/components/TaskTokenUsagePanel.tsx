import { For, Show } from 'solid-js';
import { tr } from '../store/i18n';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { tokenUsage } from '../store/tokenUsage';
import { formatShare, formatTokens, worktreeUsage } from '../lib/token-usage-format';

/**
 * Token spend for one task's worktree, as a card of its own.
 *
 * The settings table answers "what has this machine spent"; this answers "what
 * has this line of work spent", which is the question you have while the line is
 * still running. Same snapshot, filtered to one path — `startTokenUsageSubscription`
 * already seeds the watcher with every task's `worktreePath`, so the row is in
 * the snapshot the moment the task exists and no extra IPC is needed.
 *
 * It is a sibling of Changed Files and Notes rather than a strip inside one of
 * them. The first attempt hung it above the notes tab strip, which borrowed the
 * notes card's frame and so read as the notes card cut in half. Cost of the fix
 * is that the panel now owns card chrome — the header row, the scroll
 * container, the `focusable-panel` class the islands look draws its border and
 * radius from — and that the ResizablePanel child wrapping it has to be added
 * to both layout trees. Structure is copied from `TaskChangedFilesSection`
 * rather than invented, so the three cards stay visually identical.
 *
 * The headline number moved into the header row. It used to sit under a
 * `TOKENS IN THIS WORKTREE` label, which under a card header saying the same
 * thing would have been the label twice; Changed Files puts its commit nav in
 * the same slot, so a number there is the established shape.
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
      class="focusable-panel"
      style={{
        // `height: 100%` lets the card fill when a user drag pins its cell to a
        // definite height. Unpinned it is content-sized and the ResizablePanel
        // child's `maxAutoSize` caps the growth; `max-height` here is the same
        // secondary guard `TaskStepsSection` keeps for narrow viewports.
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
        <span style={{ 'flex-shrink': '0' }}>{tr('Token Usage')}</span>
        <span style={{ flex: '1' }} />
        {/* Case and tracking are reset: the header's uppercase would turn the
            `k` of `842k` into `K`, which reads as Kelvin, and letter-spacing
            pulls tabular digits apart. */}
        <span
          style={{
            color: theme.fg,
            'font-family': "'JetBrains Mono', monospace",
            'font-variant-numeric': 'tabular-nums',
            'text-transform': 'none',
            'letter-spacing': 'normal',
            'flex-shrink': '0',
          }}
        >
          {formatTokens(usage().total)}
        </span>
      </div>

      <div
        style={{
          flex: '1',
          'min-height': '0',
          overflow: 'auto',
          display: 'flex',
          'flex-direction': 'column',
          gap: '6px',
          padding: '6px 8px',
          'font-family': "'JetBrains Mono', monospace",
        }}
      >
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
              'flex-shrink': '0',
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
    </div>
  );
}
