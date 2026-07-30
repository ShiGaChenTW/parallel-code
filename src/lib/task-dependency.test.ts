import { describe, expect, it } from 'vitest';
import {
  collectDependencyChain,
  dependencyBlockMessage,
  getDependencyBlock,
  listDependencyCandidates,
  resolveDependencyBaseBranch,
  shouldHoldAgentSpawn,
  type DependencyTask,
} from './task-dependency';

/** `getDependencyBlock` narrowed to non-null, so the assertions below read as
 *  claims about the block rather than as non-null assertions. */
function blockOf(taskId: string, tasks: Record<string, DependencyTask>) {
  const block = getDependencyBlock(taskId, tasks);
  if (!block) throw new Error(`expected ${taskId} to be blocked, but it was not`);
  return block;
}

function task(over: Partial<DependencyTask> = {}): DependencyTask {
  return {
    name: 'Task',
    projectId: 'proj-1',
    branchName: 'task/whatever',
    gitIsolation: 'worktree',
    ...over,
  };
}

describe('a task with no dependsOnTaskId', () => {
  const tasks = { a: task({ name: 'A' }), b: task({ name: 'B' }) };

  it('is never blocked', () => {
    expect(getDependencyBlock('a', tasks)).toBeNull();
  });

  it('never holds its agent spawn', () => {
    expect(shouldHoldAgentSpawn({ block: getDependencyBlock('a', tasks) })).toBe(false);
  });

  it('has an empty dependency chain that is not cyclic', () => {
    expect(collectDependencyChain('a', tasks)).toEqual({ chain: [], cyclic: false });
  });

  it('keeps the caller-supplied base branch', () => {
    expect(resolveDependencyBaseBranch(undefined, 'main')).toBe('main');
  });

  it('is not blocked even when an unrelated task in the map is unlanded', () => {
    expect(getDependencyBlock('b', { ...tasks, c: task({ landingState: undefined }) })).toBeNull();
  });

  it('reports no block for a task id that is not in the map at all', () => {
    expect(getDependencyBlock('nope', tasks)).toBeNull();
  });
});

describe('gating on landingState (決議 4)', () => {
  it('blocks while the dependency has not landed', () => {
    const tasks = {
      a: task({ name: 'Schema' }),
      b: task({ name: 'API', dependsOnTaskId: 'a' }),
    };
    expect(getDependencyBlock('b', tasks)).toEqual({
      dependencyId: 'a',
      dependencyName: 'Schema',
      reason: 'unlanded',
    });
  });

  it.each(['landed_pending_review', 'landed_cleanup_failed', 'reviewed'] as const)(
    'clears the block once the dependency reaches %s',
    (landingState) => {
      const tasks = {
        a: task({ name: 'Schema', landingState }),
        b: task({ name: 'API', dependsOnTaskId: 'a' }),
      };
      expect(getDependencyBlock('b', tasks)).toBeNull();
    },
  );

  it.each(['landing_failed', 'landing_escalated'] as const)(
    'keeps the block while the dependency is at %s',
    (landingState) => {
      const tasks = {
        a: task({ name: 'Schema', landingState }),
        b: task({ name: 'API', dependsOnTaskId: 'a' }),
      };
      expect(getDependencyBlock('b', tasks)?.reason).toBe('unlanded');
    },
  );

  it('does not wait for the dependency to be merged into base — landed is enough', () => {
    // The whole point of 決議 4: B's code sits on A's branch, so a PR stuck in
    // review must not hold B back.
    const tasks = {
      a: task({ name: 'Schema', landingState: 'landed_pending_review' }),
      b: task({ name: 'API', dependsOnTaskId: 'a' }),
    };
    expect(shouldHoldAgentSpawn({ block: getDependencyBlock('b', tasks) })).toBe(false);
  });

  it('only looks at the direct dependency, not the whole chain', () => {
    // A is landed, so B runs — even though A itself still points at an unlanded Z.
    const tasks = {
      z: task({ name: 'Z' }),
      a: task({ name: 'A', dependsOnTaskId: 'z', landingState: 'reviewed' }),
      b: task({ name: 'B', dependsOnTaskId: 'a' }),
    };
    expect(getDependencyBlock('b', tasks)).toBeNull();
    expect(getDependencyBlock('a', tasks)?.reason).toBe('unlanded');
  });
});

describe('a deleted dependency stays blocked, it does not detach (決議 3)', () => {
  const tasks = { b: task({ name: 'API', dependsOnTaskId: 'gone' }) };

  it('reports a block rather than treating the edge as absent', () => {
    expect(getDependencyBlock('b', tasks)).toEqual({
      dependencyId: 'gone',
      dependencyName: undefined,
      reason: 'missing',
    });
  });

  it('still holds the agent spawn', () => {
    expect(shouldHoldAgentSpawn({ block: getDependencyBlock('b', tasks) })).toBe(true);
  });

  it('carries a readable reason naming what happened', () => {
    const message = dependencyBlockMessage(blockOf('b', tasks));
    expect(message.text).toBe('Blocked — the task this one depends on was removed.');
    expect(message.params).toEqual({});
  });

  it('does not fall back to the base branch of a dependency that is gone', () => {
    expect(resolveDependencyBaseBranch(undefined, 'main')).toBe('main');
  });
});

describe('readable reasons', () => {
  it('names the dependency in the waiting message', () => {
    const tasks = {
      a: task({ name: 'Schema migration' }),
      b: task({ name: 'API', dependsOnTaskId: 'a' }),
    };
    const message = dependencyBlockMessage(blockOf('b', tasks));
    expect(message).toEqual({
      text: 'Blocked — waiting for {task} to land.',
      params: { task: 'Schema migration' },
    });
  });

  it('falls back to the dependency id when the name is empty', () => {
    const tasks = {
      a: task({ name: '' }),
      b: task({ name: 'API', dependsOnTaskId: 'a' }),
    };
    expect(dependencyBlockMessage(blockOf('b', tasks)).params).toEqual({ task: 'a' });
  });

  it('produces a non-empty sentence for every reason', () => {
    for (const reason of ['missing', 'unlanded', 'cycle'] as const) {
      const message = dependencyBlockMessage({ dependencyId: 'a', reason });
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.text).not.toMatch(/undefined/);
    }
  });
});

describe('traversal guard', () => {
  it('walks a 5000-link chain iteratively without blowing the stack', () => {
    const tasks: Record<string, DependencyTask> = {};
    for (let i = 0; i < 5000; i++) {
      tasks[`t${i}`] = task({ name: `T${i}`, dependsOnTaskId: i > 0 ? `t${i - 1}` : undefined });
    }
    const walked = collectDependencyChain('t4999', tasks);
    expect(walked.cyclic).toBe(false);
    expect(walked.chain).toHaveLength(4999);
    expect(walked.chain[0]).toBe('t4998');
    expect(walked.chain.at(-1)).toBe('t0');
  });

  it('terminates on a two-node cycle instead of looping forever', () => {
    const tasks = {
      a: task({ name: 'A', dependsOnTaskId: 'b' }),
      b: task({ name: 'B', dependsOnTaskId: 'a' }),
    };
    expect(collectDependencyChain('a', tasks)).toEqual({ chain: ['b', 'a'], cyclic: true });
  });

  it('terminates on a self-edge', () => {
    const tasks = { a: task({ name: 'A', dependsOnTaskId: 'a' }) };
    expect(collectDependencyChain('a', tasks)).toEqual({ chain: ['a'], cyclic: true });
  });

  it('terminates on a long cycle', () => {
    const tasks: Record<string, DependencyTask> = {};
    for (let i = 0; i < 1000; i++) {
      tasks[`t${i}`] = task({ dependsOnTaskId: `t${(i + 1) % 1000}` });
    }
    const walked = collectDependencyChain('t0', tasks);
    expect(walked.cyclic).toBe(true);
    expect(walked.chain).toHaveLength(1000);
  });

  it('stops at a dangling pointer without marking the chain cyclic', () => {
    const tasks = { a: task({ dependsOnTaskId: 'gone' }) };
    expect(collectDependencyChain('a', tasks)).toEqual({ chain: ['gone'], cyclic: false });
  });

  it('surfaces a cyclic chain as a blocked reason rather than hanging', () => {
    const tasks = {
      a: task({ name: 'A', dependsOnTaskId: 'b', landingState: 'reviewed' }),
      b: task({ name: 'B', dependsOnTaskId: 'a', landingState: 'reviewed' }),
    };
    expect(getDependencyBlock('a', tasks)).toEqual({ dependencyId: 'b', reason: 'cycle' });
    expect(shouldHoldAgentSpawn({ block: getDependencyBlock('a', tasks) })).toBe(true);
  });
});

describe('resolveDependencyBaseBranch', () => {
  it("uses the dependency's branch when it has one", () => {
    expect(resolveDependencyBaseBranch(task({ branchName: 'task/schema' }), 'main')).toBe(
      'task/schema',
    );
  });

  it('falls back when the dependency has no branch (git isolation "none")', () => {
    expect(resolveDependencyBaseBranch(task({ branchName: '' }), 'main')).toBe('main');
  });

  it('falls back when the dependency branch is whitespace only', () => {
    expect(resolveDependencyBaseBranch(task({ branchName: '   ' }), 'main')).toBe('main');
  });
});

describe('listDependencyCandidates', () => {
  const tasks = {
    a: task({ name: 'A', projectId: 'p1' }),
    b: task({ name: 'B', projectId: 'p1' }),
    other: task({ name: 'Other project', projectId: 'p2' }),
    nogit: task({ name: 'No git', projectId: 'p1', gitIsolation: 'none', branchName: '' }),
    closing: task({ name: 'Closing', projectId: 'p1', closingStatus: 'closing' }),
  };
  const taskOrder = ['a', 'b', 'other', 'nogit', 'closing'];

  it('offers only branch-bearing tasks in the same project, in sidebar order', () => {
    expect(listDependencyCandidates({ projectId: 'p1', taskOrder, tasks })).toEqual(['a', 'b']);
  });

  it('excludes the task doing the depending', () => {
    expect(
      listDependencyCandidates({ projectId: 'p1', taskOrder, tasks, excludeTaskId: 'a' }),
    ).toEqual(['b']);
  });

  it('returns nothing for a project with no tasks', () => {
    expect(listDependencyCandidates({ projectId: 'p3', taskOrder, tasks })).toEqual([]);
  });
});

describe('shouldHoldAgentSpawn', () => {
  const block = { dependencyId: 'a', reason: 'unlanded' } as const;

  it('holds an agent terminal while blocked', () => {
    expect(shouldHoldAgentSpawn({ block })).toBe(true);
  });

  it('never holds a shell terminal — the worktree exists and must stay inspectable', () => {
    expect(shouldHoldAgentSpawn({ isShell: true, block })).toBe(false);
  });

  it('does not hold when there is no block', () => {
    expect(shouldHoldAgentSpawn({ block: null })).toBe(false);
    expect(shouldHoldAgentSpawn({ isShell: true, block: null })).toBe(false);
  });
});
