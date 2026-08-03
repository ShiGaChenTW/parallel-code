import type { Agent, Task, TaskGitStatusSnapshot } from '../store/types';

/**
 * This module stays pure on purpose: vitest runs in a Node environment without a DOM, so
 * keeping dashboard decisions in plain functions is what makes them easy to test completely.
 * The UI layer can render these semantic results later without dragging framework state into
 * the derivation logic.
 */
export interface DashboardStatsInput {
  tasks: Record<string, Task>;
  taskOrder: string[];
  agents: Record<string, Agent>;
  taskGitStatus: Record<string, TaskGitStatusSnapshot>;
  completedTaskCount: number;
  mergedLinesAdded: number;
  mergedLinesRemoved: number;
  mergedTaskTotal: number;
  peakConcurrentTasks: number;
}

export type DashboardTaskStatus = 'running' | 'idle';

export interface DashboardTaskGitUnknownState {
  kind: 'unknown';
}

export interface DashboardTaskGitErrorState {
  kind: 'error';
  message: string;
}

export interface DashboardTaskGitDirtyState {
  kind: 'dirty';
}

export interface DashboardTaskGitCommittedState {
  kind: 'committed';
}

export interface DashboardTaskGitCleanState {
  kind: 'clean';
}

export type DashboardTaskGitState =
  | DashboardTaskGitUnknownState
  | DashboardTaskGitErrorState
  | DashboardTaskGitDirtyState
  | DashboardTaskGitCommittedState
  | DashboardTaskGitCleanState;

export interface DashboardTaskRow {
  id: string;
  name: string;
  branchName: string;
  status: DashboardTaskStatus;
  agentCount: number;
  gitState: DashboardTaskGitState;
  stale: boolean;
  currentBranch: string | null;
}

export interface DashboardTaskTotals {
  runningCount: number;
  idleCount: number;
  totalCount: number;
}

export interface DashboardProjectOverview {
  completedTaskCount: number;
  mergedLinesAdded: number;
  mergedLinesRemoved: number;
  mergedTaskTotal: number;
  peakConcurrentTasks: number;
}

export interface DashboardStats {
  rows: DashboardTaskRow[];
  totals: DashboardTaskTotals;
  projectOverview: DashboardProjectOverview;
}

export function buildDashboardStats(input: DashboardStatsInput): DashboardStats {
  const agentsByTaskId = groupAgentsByTaskId(input.agents);
  const rows = input.taskOrder.flatMap((taskId) => {
    const task = input.tasks[taskId];

    if (!task) {
      return [];
    }

    return [buildTaskRow(task, agentsByTaskId[task.id] ?? [], input.taskGitStatus[task.id])];
  });

  return {
    rows,
    totals: buildTaskTotals(rows),
    projectOverview: {
      completedTaskCount: input.completedTaskCount,
      mergedLinesAdded: input.mergedLinesAdded,
      mergedLinesRemoved: input.mergedLinesRemoved,
      mergedTaskTotal: input.mergedTaskTotal,
      peakConcurrentTasks: input.peakConcurrentTasks,
    },
  };
}

function groupAgentsByTaskId(agents: Record<string, Agent>): Record<string, Agent[]> {
  const agentsByTaskId: Record<string, Agent[]> = {};

  for (const agent of Object.values(agents)) {
    const existingAgents = agentsByTaskId[agent.taskId];

    if (existingAgents) {
      existingAgents.push(agent);
      continue;
    }

    agentsByTaskId[agent.taskId] = [agent];
  }

  return agentsByTaskId;
}

function buildTaskRow(
  task: Task,
  taskAgents: Agent[],
  gitStatus: TaskGitStatusSnapshot | undefined,
): DashboardTaskRow {
  return {
    id: task.id,
    name: task.name,
    branchName: task.branchName,
    status: deriveTaskStatus(taskAgents),
    agentCount: taskAgents.length,
    gitState: deriveGitState(gitStatus),
    stale: gitStatus?.stale ?? false,
    currentBranch: gitStatus?.current_branch ?? null,
  };
}

function deriveTaskStatus(taskAgents: Agent[]): DashboardTaskStatus {
  return taskAgents.some((agent) => agent.status === 'running') ? 'running' : 'idle';
}

function deriveGitState(gitStatus: TaskGitStatusSnapshot | undefined): DashboardTaskGitState {
  if (!gitStatus) {
    return { kind: 'unknown' };
  }

  if (gitStatus.error) {
    return { kind: 'error', message: gitStatus.error };
  }

  if (gitStatus.has_uncommitted_changes) {
    return { kind: 'dirty' };
  }

  if (gitStatus.has_committed_changes) {
    return { kind: 'committed' };
  }

  return { kind: 'clean' };
}

function buildTaskTotals(rows: DashboardTaskRow[]): DashboardTaskTotals {
  const runningCount = rows.filter((row) => row.status === 'running').length;
  const totalCount = rows.length;

  return {
    runningCount,
    idleCount: totalCount - runningCount,
    totalCount,
  };
}
