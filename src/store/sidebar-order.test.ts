import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDefined, type MockStoreHarness } from './test-helpers';

type MockTask = {
  projectId?: string;
  coordinatorMode?: boolean;
  coordinatedBy?: string;
  collapsed?: boolean;
};
type MockTerminal = { id: string };
type MockStore = {
  tasks: Record<string, MockTask>;
  terminals: Record<string, MockTerminal>;
  taskOrder: string[];
  collapsedTaskOrder: string[];
  projects: Array<{ id: string }>;
};

const core = vi.hoisted(() => ({
  harness: undefined as MockStoreHarness<MockStore> | undefined,
}));
let mockStore: MockStore;

vi.mock('./core', async () => {
  const { createMockStoreHarness } = await import('./test-helpers');
  core.harness = createMockStoreHarness<MockStore>({
    tasks: {},
    terminals: {},
    taskOrder: [],
    collapsedTaskOrder: [],
    projects: [],
  });
  return core.harness.moduleMock();
});

import {
  computeGroupedTasks,
  computeSidebarTaskOrder,
  computeSidebarTerminals,
  getCoordinatorChildren,
  isDraggableTask,
} from './sidebar-order';

beforeEach(() => {
  const harness = expectDefined(core.harness, 'mock store harness');
  mockStore = harness.reset({
    tasks: {},
    terminals: {},
    taskOrder: [],
    collapsedTaskOrder: [],
    projects: [],
  });
});

describe('sidebar coordinator ordering', () => {
  it('groups coordinator children only under their coordinator', () => {
    mockStore.projects = [{ id: 'proj-1' }];
    mockStore.taskOrder = ['coord-1', 'child-1', 'task-1'];
    mockStore.collapsedTaskOrder = ['child-2'];
    mockStore.tasks = {
      'coord-1': { projectId: 'proj-1', coordinatorMode: true },
      'child-1': { projectId: 'proj-1', coordinatedBy: 'coord-1' },
      'child-2': { projectId: 'proj-1', coordinatedBy: 'coord-1', collapsed: true },
      'task-1': { projectId: 'proj-1' },
    };

    expect(getCoordinatorChildren('coord-1')).toEqual({
      active: ['child-1'],
      collapsed: ['child-2'],
    });
    expect(computeGroupedTasks().grouped['proj-1']).toEqual({
      active: ['coord-1', 'task-1'],
      collapsed: [],
    });
  });

  it('includes visible nested subtasks in keyboard navigation order', () => {
    mockStore.projects = [{ id: 'proj-1' }];
    mockStore.taskOrder = ['coord-1', 'child-1', 'task-1'];
    mockStore.collapsedTaskOrder = ['child-2'];
    mockStore.tasks = {
      'coord-1': { projectId: 'proj-1', coordinatorMode: true },
      'child-1': { projectId: 'proj-1', coordinatedBy: 'coord-1' },
      'child-2': { projectId: 'proj-1', coordinatedBy: 'coord-1', collapsed: true },
      'task-1': { projectId: 'proj-1' },
    };

    expect(computeSidebarTaskOrder()).toEqual(['coord-1', 'child-1', 'child-2', 'task-1']);
  });
});

/**
 * Standalone terminals share `taskOrder` with tasks — `createTerminal` appends
 * the terminal's id there so `TilingLayout` gives it a panel — but they are not
 * tasks and have no `projectId`. Every reader in this module used to skip them
 * with a bare `if (!task) continue`, which is why the sidebar rendered none of
 * them. They get their own bucket instead of being forced into a project group.
 */
describe('sidebar terminals', () => {
  it('lists standalone terminals in their taskOrder position', () => {
    mockStore.taskOrder = ['term-1', 'task-1', 'term-2'];
    mockStore.tasks = { 'task-1': {} };
    mockStore.terminals = { 'term-1': { id: 'term-1' }, 'term-2': { id: 'term-2' } };

    expect(computeSidebarTerminals()).toEqual(['term-1', 'term-2']);
  });

  it('ignores an id in taskOrder that is neither a task nor a terminal', () => {
    // `closeTerminal` deletes the terminal record before the id leaves
    // taskOrder, so a dangling id is a real intermediate state.
    mockStore.taskOrder = ['term-1', 'ghost'];
    mockStore.terminals = { 'term-1': { id: 'term-1' } };

    expect(computeSidebarTerminals()).toEqual(['term-1']);
  });

  it('never files a terminal into a project group or into the orphan bucket', () => {
    // A terminal has no projectId by design. Grouping it anywhere under a
    // project would be inventing an ownership the data does not have.
    mockStore.projects = [{ id: 'proj-1' }];
    mockStore.taskOrder = ['task-1', 'term-1'];
    mockStore.tasks = { 'task-1': { projectId: 'proj-1' } };
    mockStore.terminals = { 'term-1': { id: 'term-1' } };

    const grouped = computeGroupedTasks();
    expect(grouped.grouped['proj-1']).toEqual({ active: ['task-1'], collapsed: [] });
    expect(grouped.orphanedActive).toEqual([]);
    expect(grouped.orphanedCollapsed).toEqual([]);
  });

  it('puts terminals last in the keyboard navigation order', () => {
    // ↑/↓ in the sidebar walks this list by id, so appending the terminals is
    // the whole of making them reachable from the keyboard — and last matches
    // where they render, below every project group and the orphan bucket.
    mockStore.projects = [{ id: 'proj-1' }];
    mockStore.taskOrder = ['term-1', 'task-1'];
    mockStore.collapsedTaskOrder = [];
    mockStore.tasks = { 'task-1': { projectId: 'proj-1' } };
    mockStore.terminals = { 'term-1': { id: 'term-1' } };

    expect(computeSidebarTaskOrder()).toEqual(['task-1', 'term-1']);
  });

  it('leaves the navigation order untouched when no terminal is open', () => {
    mockStore.projects = [{ id: 'proj-1' }];
    mockStore.taskOrder = ['task-1'];
    mockStore.tasks = { 'task-1': { projectId: 'proj-1' } };

    expect(computeSidebarTaskOrder()).toEqual(['task-1']);
  });
});

/**
 * The drag index space. `Sidebar.tsx` numbers draggable rows by walking
 * `taskOrder`, and `reorderTaskVisually` resolves a drop index against the same
 * walk. A terminal sitting in `taskOrder` used to be counted by both — an
 * invisible slot that shifted every index past it and could be picked as the
 * insert anchor, so dragging a task with a terminal open landed it in the wrong
 * place. Terminals are not draggable, so they are not in the space at all.
 */
describe('isDraggableTask', () => {
  it('counts a plain task', () => {
    mockStore.tasks = { 'task-1': { projectId: 'proj-1' } };
    expect(isDraggableTask('task-1')).toBe(true);
  });

  it('excludes a terminal — it has no row in the drag index space', () => {
    mockStore.terminals = { 'term-1': { id: 'term-1' } };
    expect(isDraggableTask('term-1')).toBe(false);
  });

  it('excludes a coordinated child, which renders nested under its coordinator', () => {
    mockStore.tasks = {
      'coord-1': { coordinatorMode: true },
      'child-1': { coordinatedBy: 'coord-1' },
    };
    expect(isDraggableTask('child-1')).toBe(false);
    expect(isDraggableTask('coord-1')).toBe(true);
  });

  it('excludes an id that names nothing', () => {
    expect(isDraggableTask('ghost')).toBe(false);
  });
});
