import { describe, expect, it } from 'vitest';

import { buildDashboardStats, type DashboardStatsInput } from './dashboard-stats';
import type { Agent, Task, TaskGitStatusSnapshot } from '../store/types';

function task(overrides: Partial<Task> & { id: string }): Task {
  const { id, ...rest } = overrides;

  return {
    id,
    name: rest.name ?? `Task ${id}`,
    projectId: rest.projectId ?? 'project-1',
    branchName: rest.branchName ?? `branch-${id}`,
    worktreePath: rest.worktreePath ?? `/tmp/${id}`,
    agentIds: rest.agentIds ?? [],
    shellAgentIds: rest.shellAgentIds ?? [],
    notes: rest.notes ?? '',
    lastPrompt: rest.lastPrompt ?? '',
    gitIsolation: rest.gitIsolation ?? ('isolated' as Task['gitIsolation']),
    ...rest,
  };
}

function agent(overrides: Partial<Agent> & { id: string; taskId: string }): Agent {
  const { id, taskId, ...rest } = overrides;

  return {
    id,
    taskId,
    def: rest.def ?? ({} as Agent['def']),
    resumed: rest.resumed ?? false,
    status: rest.status ?? 'exited',
    exitCode: rest.exitCode ?? null,
    signal: rest.signal ?? null,
    lastOutput: rest.lastOutput ?? [],
    generation: rest.generation ?? 1,
    ...rest,
  };
}

function gitStatus(overrides: Partial<TaskGitStatusSnapshot> = {}): TaskGitStatusSnapshot {
  return {
    has_committed_changes: overrides.has_committed_changes ?? false,
    has_uncommitted_changes: overrides.has_uncommitted_changes ?? false,
    current_branch: overrides.current_branch ?? null,
    refreshedAt: overrides.refreshedAt ?? 1,
    error: overrides.error,
    refreshing: overrides.refreshing,
    stale: overrides.stale,
  };
}

function input(overrides: Partial<DashboardStatsInput> = {}): DashboardStatsInput {
  return {
    tasks: overrides.tasks ?? {},
    taskOrder: overrides.taskOrder ?? [],
    agents: overrides.agents ?? {},
    taskGitStatus: overrides.taskGitStatus ?? {},
    completedTaskCount: overrides.completedTaskCount ?? 0,
    mergedLinesAdded: overrides.mergedLinesAdded ?? 0,
    mergedLinesRemoved: overrides.mergedLinesRemoved ?? 0,
    mergedTaskTotal: overrides.mergedTaskTotal ?? 0,
    peakConcurrentTasks: overrides.peakConcurrentTasks ?? 0,
  };
}

describe('buildDashboardStats', () => {
  it('returns zero totals and no rows when there are no tasks', () => {
    const stats = buildDashboardStats(input());

    expect(stats.rows).toEqual([]);
    expect(stats.totals).toEqual({
      runningCount: 0,
      idleCount: 0,
      totalCount: 0,
    });
  });

  it('marks every task idle when no matching agent is running', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
          beta: task({ id: 'beta' }),
        },
        taskOrder: ['alpha', 'beta'],
        agents: {
          a1: agent({ id: 'a1', taskId: 'alpha', status: 'exited' }),
          b1: agent({ id: 'b1', taskId: 'beta', status: 'exited' }),
        },
      }),
    );

    expect(stats.rows.map((row) => row.status)).toEqual(['idle', 'idle']);
    expect(stats.totals).toEqual({
      runningCount: 0,
      idleCount: 2,
      totalCount: 2,
    });
  });

  it('counts running and idle tasks separately when task activity is mixed', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
          beta: task({ id: 'beta' }),
          gamma: task({ id: 'gamma' }),
        },
        taskOrder: ['alpha', 'beta', 'gamma'],
        agents: {
          a1: agent({ id: 'a1', taskId: 'alpha', status: 'running' }),
          a2: agent({ id: 'a2', taskId: 'alpha', status: 'exited' }),
          b1: agent({ id: 'b1', taskId: 'beta', status: 'exited' }),
        },
      }),
    );

    expect(stats.rows.map((row) => [row.id, row.status, row.agentCount])).toEqual([
      ['alpha', 'running', 2],
      ['beta', 'idle', 1],
      ['gamma', 'idle', 0],
    ]);
    expect(stats.totals).toEqual({
      runningCount: 1,
      idleCount: 2,
      totalCount: 3,
    });
  });

  // This covers the race where order can retain a task id after the task record is gone.
  it('skips task ids that remain in taskOrder after the task record disappears', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          beta: task({ id: 'beta' }),
        },
        taskOrder: ['alpha', 'beta'],
      }),
    );

    expect(stats.rows.map((row) => row.id)).toEqual(['beta']);
    expect(stats.totals.totalCount).toBe(1);
  });

  it('uses an unknown git state when a task has no git status snapshot', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
      }),
    );

    expect(stats.rows[0]).toMatchObject({
      gitState: { kind: 'unknown' },
      stale: false,
      currentBranch: null,
    });
  });

  it('surfaces git snapshot errors as a distinct error state', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
        taskGitStatus: {
          alpha: gitStatus({
            error: 'git status failed',
            has_committed_changes: true,
            has_uncommitted_changes: true,
          }),
        },
      }),
    );

    expect(stats.rows[0].gitState).toEqual({
      kind: 'error',
      message: 'git status failed',
    });
  });

  it('marks a task dirty when it has uncommitted changes', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
        taskGitStatus: {
          alpha: gitStatus({ has_uncommitted_changes: true }),
        },
      }),
    );

    expect(stats.rows[0].gitState).toEqual({ kind: 'dirty' });
  });

  it('marks a task as having committed work when only committed changes exist', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
        taskGitStatus: {
          alpha: gitStatus({ has_committed_changes: true }),
        },
      }),
    );

    expect(stats.rows[0].gitState).toEqual({ kind: 'committed' });
  });

  it('marks a task clean when its snapshot shows no committed or uncommitted changes', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
        taskGitStatus: {
          alpha: gitStatus({ current_branch: 'feature/alpha' }),
        },
      }),
    );

    expect(stats.rows[0]).toMatchObject({
      gitState: { kind: 'clean' },
      currentBranch: 'feature/alpha',
    });
  });

  it('passes through zero values for every project overview counter', () => {
    const stats = buildDashboardStats(input());

    expect(stats.projectOverview).toEqual({
      completedTaskCount: 0,
      mergedLinesAdded: 0,
      mergedLinesRemoved: 0,
      mergedTaskTotal: 0,
      peakConcurrentTasks: 0,
    });
  });

  // The task record can lag behind the agent registry, so the registry must win.
  it('derives agent counts from the agents record instead of task.agentIds', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha', agentIds: ['ghost-agent'] }),
        },
        taskOrder: ['alpha'],
        agents: {
          real1: agent({ id: 'real1', taskId: 'alpha', status: 'running' }),
          real2: agent({ id: 'real2', taskId: 'alpha', status: 'exited' }),
        },
      }),
    );

    expect(stats.rows[0]).toMatchObject({
      status: 'running',
      agentCount: 2,
    });
  });

  it('treats a task with zero matching agents as idle', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
        agents: {
          other: agent({ id: 'other', taskId: 'beta', status: 'running' }),
        },
      }),
    );

    expect(stats.rows[0]).toMatchObject({
      status: 'idle',
      agentCount: 0,
    });
  });

  it('follows taskOrder instead of object insertion order when building rows', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          beta: task({ id: 'beta', name: 'Beta' }),
          alpha: task({ id: 'alpha', name: 'Alpha' }),
        },
        taskOrder: ['alpha', 'beta'],
      }),
    );

    expect(stats.rows.map((row) => row.name)).toEqual(['Alpha', 'Beta']);
  });

  it('surfaces stale git snapshots without changing the underlying git state', () => {
    const stats = buildDashboardStats(
      input({
        tasks: {
          alpha: task({ id: 'alpha' }),
        },
        taskOrder: ['alpha'],
        taskGitStatus: {
          alpha: gitStatus({
            has_uncommitted_changes: true,
            stale: true,
            current_branch: 'feature/alpha',
          }),
        },
      }),
    );

    expect(stats.rows[0]).toMatchObject({
      gitState: { kind: 'dirty' },
      stale: true,
      currentBranch: 'feature/alpha',
    });
  });
});
