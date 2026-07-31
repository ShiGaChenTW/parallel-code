import { For, Show } from 'solid-js';
import { tr } from '../store/i18n';
import { theme } from '../lib/theme';
import { tokenUsage } from '../store/tokenUsage';
import {
  describeProviders,
  formatTokens,
  shortenPath,
  sumTokenTotals,
  visibleProviderColumns,
} from '../lib/token-usage-format';

/**
 * Live AI CLI token usage, broken down per worktree.
 *
 * Every number here comes from files the CLIs wrote on this machine —
 * `~/.claude/projects`, `~/.codex/sessions`, `~/.grok/logs`. Nothing is
 * requested from a vendor, which is why the feature works with offline mode on
 * and why it added no entry to `OUTBOUND_SURFACES`.
 *
 * No cost column: pricing differs per vendor, changes without notice, and a
 * wrong currency figure is worse than none. The counts are the honest part.
 */
export function TokenUsageSection() {
  const rows = () => tokenUsage().paths;
  const columns = () => visibleProviderColumns(rows());
  // `describeProviders` is pure and cannot read the locale, so it hands back
  // one descriptor per sentence and the translating happens here.
  const providerSummary = () =>
    describeProviders(tokenUsage().providers)
      .map((sentence) => tr(sentence.text, sentence.params))
      .join(' ');

  const cellStyle = {
    padding: '5px 8px',
    'font-variant-numeric': 'tabular-nums',
    'white-space': 'nowrap',
  } as const;

  const headStyle = {
    ...cellStyle,
    color: theme.fgMuted,
    'font-weight': '500',
    'text-align': 'right',
    'border-bottom': `1px solid ${theme.border}`,
  } as const;

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
      <div style={{ color: theme.fgMuted, 'font-size': '12px', 'line-height': '1.5' }}>
        {tr(
          'Token counts read from the log files the AI CLIs already write on this machine. No network request is made, so this works with offline mode on.',
        )}
      </div>

      <Show
        when={rows().length > 0}
        fallback={
          <div style={{ color: theme.fgMuted, 'font-size': '12px' }}>{providerSummary()}</div>
        }
      >
        <div style={{ 'overflow-x': 'auto' }}>
          <table
            style={{
              'border-collapse': 'collapse',
              'font-size': '12px',
              width: '100%',
              color: theme.fg,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...headStyle, 'text-align': 'left' }}>{tr('Worktree')}</th>
                <For each={columns()}>{(column) => <th style={headStyle}>{column.label}</th>}</For>
                <th style={headStyle}>{tr('Total')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <tr>
                    <td style={{ ...cellStyle, 'text-align': 'left' }} title={row.path}>
                      {shortenPath(row.path)}
                    </td>
                    <For each={columns()}>
                      {(column) => (
                        <td style={{ ...cellStyle, 'text-align': 'right' }}>
                          {formatTokens(
                            sumTokenTotals(
                              row.byProvider[column.provider] ?? {
                                input: 0,
                                output: 0,
                                cacheRead: 0,
                                cacheWrite: 0,
                              },
                            ),
                          )}
                        </td>
                      )}
                    </For>
                    <td style={{ ...cellStyle, 'text-align': 'right', 'font-weight': '600' }}>
                      {formatTokens(sumTokenTotals(row.totals))}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
            <tfoot>
              <tr>
                <td
                  style={{
                    ...cellStyle,
                    'text-align': 'left',
                    color: theme.fgMuted,
                    'border-top': `1px solid ${theme.border}`,
                  }}
                >
                  {tr('All worktrees')}
                </td>
                <For each={columns()}>
                  {(column) => (
                    <td
                      style={{
                        ...cellStyle,
                        'text-align': 'right',
                        color: theme.fgMuted,
                        'border-top': `1px solid ${theme.border}`,
                      }}
                    >
                      {formatTokens(
                        sumTokenTotals(
                          tokenUsage().byProvider[column.provider] ?? {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                          },
                        ),
                      )}
                    </td>
                  )}
                </For>
                <td
                  style={{
                    ...cellStyle,
                    'text-align': 'right',
                    'font-weight': '600',
                    'border-top': `1px solid ${theme.border}`,
                  }}
                >
                  {formatTokens(sumTokenTotals(tokenUsage().totals))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ color: theme.fgMuted, 'font-size': '11px' }}>{providerSummary()}</div>
      </Show>
    </div>
  );
}
