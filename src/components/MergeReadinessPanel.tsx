import { For } from 'solid-js';
import { tr } from '../store/i18n';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import type { MergeReadiness, MergeReadinessCheckStatus } from './merge-readiness';

/**
 * Catalogue keys for the summary line, kept as source text rather than
 * translated here: this table is module-level and would freeze the locale it
 * was first read in. `tr()` runs inside the component instead, so switching
 * language re-renders the heading with no reload.
 */
const overallCopy: Record<MergeReadiness['overall'], { title: string; detail: string }> = {
  ready: { title: 'Ready to merge', detail: 'Known checks passed.' },
  attention: { title: 'Needs attention', detail: 'Review these items before merging.' },
  blocked: { title: 'Not ready to merge', detail: 'Resolve merge blockers before continuing.' },
  checking: { title: 'Checking merge readiness', detail: 'Waiting for merge status.' },
};

const overallHelp =
  'Ready means every available check passed. Needs attention means a warning; Not ready means a merge-safety blocker; Checking means merge data is loading. This summary is advisory.';

function checkHelp(label: string): string | undefined {
  if (label === 'Merge safety') {
    return 'Checks the task branch for conflicts with its base branch, branch mismatch, committed changes, and local uncommitted changes.';
  }
  if (label === 'Verification') {
    return 'Uses structured verification reported by land_self, such as tests or typechecking. Without a report this needs attention; opening the dialog never runs commands.';
  }
  if (label === 'PR checks') {
    return 'Uses checks reported for a detected GitHub pull request. Pull requests are optional, and unavailable check data is neutral.';
  }
  return undefined;
}

/** `checkHelp` translated, or undefined so no `title` attribute is emitted. */
function checkHelpText(label: string): string | undefined {
  const help = checkHelp(label);
  return help === undefined ? undefined : tr(help);
}

function statusColor(status: MergeReadinessCheckStatus | MergeReadiness['overall']): string {
  if (status === 'pass' || status === 'ready') return theme.success;
  if (status === 'blocked') return theme.error;
  if (status === 'warning' || status === 'attention' || status === 'checking') return theme.warning;
  return theme.fgMuted;
}

function statusSymbol(status: MergeReadinessCheckStatus): string {
  if (status === 'pass') return '✓';
  if (status === 'blocked') return '×';
  if (status === 'warning') return '!';
  if (status === 'checking') return '…';
  return '—';
}

export function MergeReadinessPanel(props: { readiness: MergeReadiness }) {
  const copy = () => overallCopy[props.readiness.overall];
  const color = () => statusColor(props.readiness.overall);

  return (
    <section
      aria-label={tr('Ready to merge summary')}
      style={{
        'margin-bottom': '12px',
        padding: '10px 12px',
        border: `1px solid color-mix(in srgb, ${color()} 45%, ${theme.border})`,
        'border-left': `3px solid ${color()}`,
        'border-radius': '8px',
        background: 'color-mix(in srgb, var(--fg) 3%, transparent)',
      }}
    >
      <div
        aria-live="polite"
        style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', 'margin-bottom': '8px' }}
      >
        <strong title={tr(overallHelp)} style={{ color: color(), 'font-size': sf(13) }}>
          {tr(copy().title)}
        </strong>
        <span style={{ color: theme.fgMuted, 'font-size': sf(12) }}>{tr(copy().detail)}</span>
      </div>
      <div style={{ display: 'grid', gap: '5px' }}>
        <For each={props.readiness.checks}>
          {(check) => (
            <div
              style={{
                display: 'grid',
                'grid-template-columns': '116px minmax(0, 1fr)',
                gap: '8px',
                'align-items': 'baseline',
                'font-size': sf(12),
              }}
            >
              <span
                title={checkHelpText(check.label)}
                style={{ color: statusColor(check.status), 'font-weight': '600' }}
              >
                <span aria-hidden="true" style={{ display: 'inline-block', width: '16px' }}>
                  {statusSymbol(check.status)}
                </span>
                {tr(check.label)}
              </span>
              <span style={{ color: theme.fgMuted }}>
                {tr(check.detail.text, check.detail.params)}
              </span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
