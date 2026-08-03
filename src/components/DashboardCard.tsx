import { For, Show, createMemo } from 'solid-js';
import { sf } from '../lib/fontScale';
import { theme } from '../lib/theme';
import { tr } from '../store/i18n';
import { store } from '../store/store';
import { tokenUsage } from '../store/tokenUsage';
import { formatTokens, sumTokenTotals } from '../lib/token-usage-format';
import {
  buildDashboardStats,
  type DashboardProjectOverview,
  type DashboardTaskGitState,
  type DashboardTaskRow,
  type DashboardTaskStatus,
} from './dashboard-stats';

interface BadgeTone {
  color: string;
  background: string;
}

interface GitPresentation {
  label: string;
  tone: BadgeTone;
}

interface OverviewMetric {
  label: string;
  value: string | number;
}

const subtleTone: BadgeTone = {
  color: theme.fgSubtle,
  background: theme.bgSelectedSubtle,
};

const successTone: BadgeTone = {
  color: theme.success,
  background: theme.bgSelectedSubtle,
};

const warningTone: BadgeTone = {
  color: theme.warning,
  background: theme.bgSelectedSubtle,
};

const errorTone: BadgeTone = {
  color: theme.error,
  background: theme.bgSelectedSubtle,
};

interface DashboardCardProps {
  /** Inside a dialog the panel already draws the frame — drop ours so the two
   *  do not nest two rounded borders 2px apart. */
  embedded?: boolean;
}

export function DashboardCard(props: DashboardCardProps = {}) {
  const stats = createMemo(() =>
    buildDashboardStats({
      tasks: store.tasks,
      taskOrder: store.taskOrder,
      agents: store.agents,
      taskGitStatus: store.taskGitStatus,
      completedTaskCount: store.completedTaskCount,
      mergedLinesAdded: store.mergedLinesAdded,
      mergedLinesRemoved: store.mergedLinesRemoved,
      mergedTaskTotal: store.mergedTaskTotal,
      peakConcurrentTasks: store.peakConcurrentTasks,
    }),
  );

  const overviewMetrics = createMemo<OverviewMetric[]>(() => {
    const overview = stats().projectOverview;

    return [
      {
        label: tr('Completed tasks'),
        value: overview.completedTaskCount,
      },
      {
        label: tr('Merged lines'),
        value: formatMergedLines(overview),
      },
      {
        label: tr('Merged tasks'),
        value: overview.mergedTaskTotal,
      },
      {
        label: tr('Peak concurrent tasks'),
        value: overview.peakConcurrentTasks,
      },
    ];
  });

  /**
   * Live AI CLI usage, read off the same app-level subscription the token panel
   * uses — no second watcher, no vendor call. Cache reads and writes are summed
   * into one tile: they are the same lever (context reuse) and splitting them
   * buys a fourth number nobody acts on.
   */
  const tokenMetrics = createMemo<OverviewMetric[]>(() => {
    const totals = tokenUsage().totals;

    return [
      { label: tr('Total tokens'), value: formatTokens(sumTokenTotals(totals)) },
      { label: tr('Input tokens'), value: formatTokens(totals.input) },
      { label: tr('Output tokens'), value: formatTokens(totals.output) },
      { label: tr('Cached tokens'), value: formatTokens(totals.cacheRead + totals.cacheWrite) },
    ];
  });

  return (
    <section
      aria-label={tr('Dashboard card')}
      style={{
        width: '100%',
        'max-width': props.embedded ? undefined : '760px',
        display: 'flex',
        'flex-direction': 'column',
        background: props.embedded ? 'transparent' : theme.islandBg,
        border: props.embedded ? 'none' : `1px solid ${theme.border}`,
        'border-radius': props.embedded ? '0' : '12px',
        overflow: 'clip',
      }}
    >
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '14px',
          padding: props.embedded ? '0' : '18px',
        }}
      >
        <div
          style={{
            display: 'flex',
            'flex-direction': 'column',
            gap: '4px',
          }}
        >
          <span
            style={{
              'font-size': sf(11),
              color: theme.fgSubtle,
              'text-transform': 'uppercase',
              'letter-spacing': '0.05em',
            }}
          >
            {tr('Open tasks')}
          </span>
          <span
            style={{
              'font-size': sf(13),
              color: theme.fgMuted,
            }}
          >
            {tr('{running} running · {idle} idle · {tasks} tasks', {
              running: stats().totals.runningCount,
              idle: stats().totals.idleCount,
              tasks: stats().totals.totalCount,
            })}
          </span>
        </div>

        <Show
          when={stats().rows.length > 0}
          fallback={
            <div
              style={{
                padding: '12px 14px',
                'border-radius': '10px',
                background: theme.bg,
                border: `1px solid ${theme.borderSubtle}`,
                color: theme.fgMuted,
                'font-size': sf(13),
                'line-height': '1.5',
              }}
            >
              {tr('No open tasks yet. Create one to start parallel work.')}
            </div>
          }
        >
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
            }}
          >
            <For each={stats().rows}>
              {(row, index) => <DashboardTaskListItem row={row} first={index() === 0} />}
            </For>
          </div>
        </Show>
      </div>

      <div
        style={{
          border: `0 solid ${theme.borderSubtle}`,
          'border-top-width': '1px',
          padding: '18px',
          display: 'flex',
          'flex-direction': 'column',
          gap: '14px',
        }}
      >
        <span
          style={{
            'font-size': sf(11),
            color: theme.fgSubtle,
            'text-transform': 'uppercase',
            'letter-spacing': '0.05em',
          }}
        >
          {tr('Project overview')}
        </span>
        <MetricGrid metrics={overviewMetrics()} />
      </div>

      <div
        style={{
          border: `0 solid ${theme.borderSubtle}`,
          'border-top-width': '1px',
          padding: '18px',
          display: 'flex',
          'flex-direction': 'column',
          gap: '14px',
        }}
      >
        <span
          style={{
            'font-size': sf(11),
            color: theme.fgSubtle,
            'text-transform': 'uppercase',
            'letter-spacing': '0.05em',
          }}
        >
          {tr('Token usage')}
        </span>
        <MetricGrid metrics={tokenMetrics()} />
      </div>
    </section>
  );
}

function MetricGrid(props: { metrics: OverviewMetric[] }) {
  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '12px',
      }}
    >
      <For each={props.metrics}>
        {(metric) => (
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: '6px',
              padding: '12px 14px',
              'border-radius': '10px',
              background: theme.bg,
              border: `1px solid ${theme.borderSubtle}`,
            }}
          >
            <span
              style={{
                'font-size': sf(12),
                color: theme.fgMuted,
              }}
            >
              {metric.label}
            </span>
            <span
              style={{
                'font-size': sf(18),
                'font-weight': '600',
                color: theme.fg,
                'line-height': '1.2',
              }}
            >
              {metric.value}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

function DashboardTaskListItem(props: { row: DashboardTaskRow; first: boolean }) {
  const statusTone = (): BadgeTone => (props.row.status === 'running' ? successTone : subtleTone);
  const gitPresentation = (): GitPresentation => presentGitState(props.row.gitState);
  const detailLines = (): string[] => {
    const details: string[] = [];

    if (props.row.stale) {
      details.push(tr('Git snapshot may be stale'));
    }

    if (props.row.currentBranch && props.row.currentBranch !== props.row.branchName) {
      details.push(
        tr('Current Branch: {branchName}', {
          branchName: props.row.currentBranch,
        }),
      );
    }

    return details;
  };

  return (
    <div
      style={{
        display: 'flex',
        'justify-content': 'space-between',
        'align-items': 'flex-start',
        gap: '16px',
        padding: '14px 0',
        border: `0 solid ${theme.borderSubtle}`,
        'border-top-width': props.first ? '0' : '1px',
      }}
    >
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '6px',
          'min-width': '0',
          flex: '1 1 auto',
        }}
      >
        <span
          style={{
            'font-size': sf(14),
            'font-weight': '600',
            color: theme.fg,
            'line-height': '1.3',
            'word-break': 'break-word',
          }}
        >
          {props.row.name}
        </span>
        <span
          style={{
            'font-size': sf(12),
            color: theme.fgMuted,
            'font-family': "'JetBrains Mono', monospace",
            'word-break': 'break-all',
          }}
        >
          {props.row.branchName}
        </span>
        <For each={detailLines()}>
          {(line) => (
            <span
              style={{
                'font-size': sf(12),
                color: theme.warning,
                'line-height': '1.4',
              }}
            >
              {line}
            </span>
          )}
        </For>
      </div>

      <div
        style={{
          display: 'flex',
          'flex-wrap': 'wrap',
          'justify-content': 'flex-end',
          gap: '8px',
          'max-width': '320px',
          flex: '0 1 auto',
        }}
      >
        <StatusBadge label={presentTaskStatus(props.row.status)} tone={statusTone()} />
        <StatusBadge label={gitPresentation().label} tone={gitPresentation().tone} />
        <StatusBadge
          label={tr('Agent: {count}', { count: props.row.agentCount })}
          tone={subtleTone}
        />
        <Show when={props.row.stale}>
          <StatusBadge label={tr('Stale')} tone={warningTone} />
        </Show>
      </div>
    </div>
  );
}

function StatusBadge(props: { label: string; tone: BadgeTone }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        gap: '6px',
        padding: '5px 9px',
        'border-radius': '999px',
        background: props.tone.background,
        color: props.tone.color,
        border: `1px solid ${theme.borderSubtle}`,
        'font-size': sf(12),
        'line-height': '1.3',
        'white-space': 'normal',
      }}
    >
      {props.label}
    </span>
  );
}

/**
 * Deliberately not routed through `tr()`. The string is a signed pair of
 * numerals — `+128 −34` — with no word in it to translate, and a catalogue
 * entry mapping it to itself is what `i18n.test.ts` rejects as "a term that
 * should have been left out of the catalogue entirely". The `−` is U+2212, the
 * typographic minus that pairs with `+` at the same width.
 */
function formatMergedLines(overview: DashboardProjectOverview): string {
  return `+${overview.mergedLinesAdded} −${overview.mergedLinesRemoved}`;
}

function presentTaskStatus(status: DashboardTaskStatus): string {
  switch (status) {
    case 'running':
      return tr('Running');
    case 'idle':
      return tr('Idle');
  }

  const unreachableStatus: never = status;
  return unreachableStatus;
}

function presentGitState(gitState: DashboardTaskGitState): GitPresentation {
  switch (gitState.kind) {
    case 'unknown':
      return {
        label: tr('Git unknown'),
        tone: subtleTone,
      };
    case 'error':
      return {
        label: tr('Git error: {message}', { message: gitState.message }),
        tone: errorTone,
      };
    case 'dirty':
      return {
        label: tr('Dirty'),
        tone: warningTone,
      };
    case 'committed':
      return {
        label: tr('Committed'),
        tone: successTone,
      };
    case 'clean':
      return {
        label: tr('Clean'),
        tone: subtleTone,
      };
  }

  const unreachableGitState: never = gitState;
  return unreachableGitState;
}
