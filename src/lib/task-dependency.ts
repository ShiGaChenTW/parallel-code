/**
 * Single-dependency edges between tasks.
 *
 * A task may declare exactly one `dependsOnTaskId`. That single edge does two
 * things, and the two must not be conflated:
 *
 *   - **git ancestry** — the dependent's worktree branches from the
 *     dependency's branch instead of from the project base branch. This is the
 *     MVP meaning of the edge, and it needs no git code at all: `baseBranch` is
 *     already a plain string threaded through `createWorktree`, so handing it
 *     the dependency's `branchName` produces the ancestry today.
 *   - **scheduling** — the dependent's agent does not auto-start until the
 *     dependency has landed.
 *
 * Single parent, deliberately not an array and not a DAG. That mirrors the
 * shape `coordinatedBy` already has, so the traversal stays O(depth) with one
 * visited set rather than a topological sort with cycle rejection.
 *
 * Everything here is a pure function over an explicit task map — no store
 * import, no reactive read. The gating decisions are exercised under vitest's
 * `environment: 'node'` with no DOM harness, and the components that consume
 * them stay dumb renderers.
 */

import { isLandedTaskState } from '../store/landing';
import type { GitIsolationMode, LandingState } from '../store/types';

/**
 * The fields this module reads off a task. Deliberately narrower than `Task`:
 * a structural subset keeps the tests free of two dozen irrelevant properties
 * while `Task` itself stays assignable.
 */
export interface DependencyTask {
  name?: string;
  projectId?: string;
  branchName?: string;
  gitIsolation?: GitIsolationMode;
  landingState?: LandingState;
  closingStatus?: 'closing' | 'removing' | 'error';
  dependsOnTaskId?: string;
}

export type DependencyTaskMap = Readonly<Record<string, DependencyTask | undefined>>;

/**
 * Why a task will not start.
 *
 * - `missing`  — the dependency was closed. Per 決議 3 the dependent stays
 *   blocked rather than silently detaching to the base branch: a task that
 *   never starts and never says why is worse than one the user has to
 *   un-block by hand.
 * - `unlanded` — the dependency exists but has not reached a landed state.
 * - `cycle`    — the chain loops. Structurally unreachable through the UI,
 *   which only points new tasks at existing ones, but reachable through a
 *   hand-edited or corrupt persisted state. Surfacing it as a readable reason
 *   beats a traversal that never terminates.
 */
export type DependencyBlockReason = 'missing' | 'unlanded' | 'cycle';

export interface DependencyBlock {
  readonly dependencyId: string;
  readonly dependencyName?: string;
  readonly reason: DependencyBlockReason;
}

/** A translatable sentence: English source text (the catalogue key) + values. */
export interface DependencyBlockMessage {
  readonly text: string;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Walk `dependsOnTaskId` pointers upwards from `startId`, nearest ancestor
 * first. `startId` itself is not in the result unless the chain loops back to
 * it.
 *
 * Iterative rather than recursive, with a visited set: the loop cannot blow the
 * call stack however long the chain is, and the visited set bounds it at the
 * number of tasks however badly the pointers are tangled. Deliberately no depth
 * cap — a cap would misreport a legitimately long chain as truncated, and the
 * visited set already gives a hard O(n) bound.
 *
 * `computeSidebarTaskOrder()` gets away without a guard only because
 * `coordinatedBy` is capped at one level. Dependency chains are not.
 */
export function collectDependencyChain(
  startId: string,
  tasks: DependencyTaskMap,
): { chain: string[]; cyclic: boolean } {
  const chain: string[] = [];
  const visited = new Set<string>([startId]);
  let currentId = tasks[startId]?.dependsOnTaskId;

  while (currentId) {
    chain.push(currentId);
    if (visited.has(currentId)) return { chain, cyclic: true };
    visited.add(currentId);
    currentId = tasks[currentId]?.dependsOnTaskId;
  }

  return { chain, cyclic: false };
}

/**
 * The reason `taskId` will not start, or `null` when nothing holds it.
 *
 * Derived on every read rather than stored on the task: blocked-ness is a pure
 * function of `dependsOnTaskId` plus the dependency's `landingState`, both of
 * which already live in the store. A second copy would need someone to rewrite
 * it at the moment the dependency lands, which is a failure mode rather than a
 * feature.
 *
 * Only the direct dependency is consulted (決議 4). A landed dependency has the
 * dependent's code on its branch, so whatever the dependency itself was waiting
 * for is already water under the bridge.
 */
export function getDependencyBlock(
  taskId: string,
  tasks: DependencyTaskMap,
): DependencyBlock | null {
  const task = tasks[taskId];
  const dependencyId = task?.dependsOnTaskId;
  if (!dependencyId) return null;

  if (collectDependencyChain(taskId, tasks).cyclic) {
    return { dependencyId, reason: 'cycle' };
  }

  const dependency = tasks[dependencyId];
  if (!dependency) {
    return { dependencyId, dependencyName: undefined, reason: 'missing' };
  }
  if (isLandedTaskState(dependency.landingState)) return null;

  return { dependencyId, dependencyName: dependency.name, reason: 'unlanded' };
}

/**
 * The sentence the user reads.
 *
 * Returns source text plus values rather than a finished string because `tr()`
 * reads `store.locale` and so is not pure. The caller interpolates; this module
 * stays testable without a store mock and the catalogue still owns word order.
 */
export function dependencyBlockMessage(block: DependencyBlock): DependencyBlockMessage {
  switch (block.reason) {
    case 'missing':
      return { text: 'Blocked — the task this one depends on was removed.', params: {} };
    case 'cycle':
      return { text: "Blocked — this task's dependency chain loops back on itself.", params: {} };
    case 'unlanded':
      return {
        text: 'Blocked — waiting for {task} to land.',
        params: { task: block.dependencyName?.trim() || block.dependencyId },
      };
  }
}

/**
 * Should this terminal hold its spawn?
 *
 * Shell terminals are never held. The worktree exists whether or not the
 * dependency has landed, and a user staring at a blocked task needs to be able
 * to open a shell and look around. What is gated is the agent starting work on
 * a branch whose ancestor is not ready — not access to the task.
 */
export function shouldHoldAgentSpawn(opts: {
  isShell?: boolean;
  block: DependencyBlock | null;
}): boolean {
  if (opts.isShell) return false;
  return opts.block !== null;
}

/**
 * The base branch a new task should fork from: the dependency's branch when it
 * has one, otherwise whatever the caller picked.
 *
 * Same shape as `coordinator.ts`'s `opts.baseBranch ?? coordinatorBranch`, and
 * for the same reason — the whole git-ancestry half of a dependency edge is
 * this one substitution. A dependency created with git isolation `none` has no
 * branch to fork from, so it falls through to the caller's choice.
 */
export function resolveDependencyBaseBranch(
  dependency: DependencyTask | undefined,
  fallback: string,
): string {
  const branch = dependency?.branchName?.trim();
  return branch ? branch : fallback;
}

/**
 * Tasks that can be depended on: same project, on a branch of their own, not
 * being torn down. Returned in `taskOrder` so the picker matches the sidebar.
 */
export function listDependencyCandidates(opts: {
  projectId: string;
  taskOrder: readonly string[];
  tasks: DependencyTaskMap;
  excludeTaskId?: string;
}): string[] {
  const candidates: string[] = [];
  for (const taskId of opts.taskOrder) {
    if (taskId === opts.excludeTaskId) continue;
    const task = opts.tasks[taskId];
    if (!task) continue;
    if (task.projectId !== opts.projectId) continue;
    if (task.closingStatus) continue;
    if (!task.branchName?.trim()) continue;
    candidates.push(taskId);
  }
  return candidates;
}
