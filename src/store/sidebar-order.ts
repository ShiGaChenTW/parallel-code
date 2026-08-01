import { store } from './core';

export interface GroupedSidebarTasks {
  grouped: Record<string, { active: string[]; collapsed: string[] }>;
  orphanedActive: string[];
  orphanedCollapsed: string[];
}

/**
 * Get ordered child task IDs for a coordinator, preserving taskOrder ordering.
 * Returns both active and collapsed children separately.
 */
export function getCoordinatorChildren(coordinatorId: string): {
  active: string[];
  collapsed: string[];
} {
  const active: string[] = [];
  const collapsed: string[] = [];
  for (const taskId of store.taskOrder) {
    if (store.tasks[taskId]?.coordinatedBy === coordinatorId) {
      active.push(taskId);
    }
  }
  for (const taskId of store.collapsedTaskOrder) {
    const task = store.tasks[taskId];
    if (task?.collapsed && task.coordinatedBy === coordinatorId) {
      collapsed.push(taskId);
    }
  }
  return { active, collapsed };
}

/**
 * Check if a task is a child of any coordinator.
 */
export function isCoordinatedChild(taskId: string): boolean {
  const task = store.tasks[taskId];
  if (!task?.coordinatedBy) return false;
  // Only treat as child if the coordinator still exists
  return !!store.tasks[task.coordinatedBy];
}

/**
 * Whether this id occupies a slot in the sidebar's drag index space.
 *
 * `taskOrder` is the panel strip's order, and the strip holds two kinds of
 * thing: tasks and standalone terminals. The sidebar's drag-reorder numbers
 * rows by walking that list, so it has to say which entries are rows it can
 * number — coordinated children render nested under their coordinator and move
 * with it, and terminals are not draggable at all.
 *
 * Shared by `Sidebar.tsx` (which stamps `data-task-index` and resolves a
 * mousedown back to an id) and `reorderTaskVisually` (which resolves a drop
 * index to the task to insert before). Those two must agree on the space or a
 * drag lands somewhere the drop indicator never pointed.
 */
export function isDraggableTask(id: string): boolean {
  return !!store.tasks[id] && !isCoordinatedChild(id);
}

/**
 * Standalone terminals, in `taskOrder` sequence.
 *
 * `createTerminal` appends the terminal's id to `taskOrder` so `TilingLayout`
 * gives it a panel, which means terminals and tasks share one list keyed only
 * by which record the id resolves to. They have no `projectId` — a terminal is
 * not opened *in* a project — so they cannot be grouped and get their own
 * bucket at the end of the sidebar instead.
 *
 * Ids that resolve to neither record are dropped: `closeTerminal` deletes the
 * terminal before the id leaves `taskOrder`, so that state is reachable.
 */
export function computeSidebarTerminals(): string[] {
  return store.taskOrder.filter((id) => !!store.terminals[id]);
}

/** Group tasks by project: active first, then collapsed. Tasks without a valid project go to orphans.
 *  Coordinated children are excluded from the flat list — they render nested under their coordinator. */
export function computeGroupedTasks(): GroupedSidebarTasks {
  const grouped: Record<string, { active: string[]; collapsed: string[] }> = {};
  const orphanedActive: string[] = [];
  const orphanedCollapsed: string[] = [];
  const projectIds = new Set(store.projects.map((p) => p.id));

  for (const taskId of store.taskOrder) {
    const task = store.tasks[taskId];
    if (!task) continue;
    // Skip coordinated children — they'll be rendered nested under their coordinator
    if (isCoordinatedChild(taskId)) continue;
    if (task.projectId && projectIds.has(task.projectId)) {
      (grouped[task.projectId] ??= { active: [], collapsed: [] }).active.push(taskId);
    } else {
      orphanedActive.push(taskId);
    }
  }

  for (const taskId of store.collapsedTaskOrder) {
    const task = store.tasks[taskId];
    if (!task?.collapsed) continue;
    // Skip coordinated children
    if (isCoordinatedChild(taskId)) continue;
    if (task.projectId && projectIds.has(task.projectId)) {
      (grouped[task.projectId] ??= { active: [], collapsed: [] }).collapsed.push(taskId);
    } else {
      orphanedCollapsed.push(taskId);
    }
  }

  return { grouped, orphanedActive, orphanedCollapsed };
}

/**
 * Flatten grouped tasks into the visual sidebar order: per project active then
 * collapsed, then orphans, then standalone terminals.
 *
 * This is the list ↑/↓ walks, and it walks it by id — `indexOf` on the focused
 * id, then the neighbouring entry — so appending the terminals is the whole of
 * making them reachable from the keyboard. Last, because that is where they
 * render.
 */
export function computeSidebarTaskOrder(): string[] {
  const { grouped, orphanedActive, orphanedCollapsed } = computeGroupedTasks();
  const order: string[] = [];
  const pushWithVisibleChildren = (taskId: string) => {
    order.push(taskId);
    const task = store.tasks[taskId];
    if (!task?.coordinatorMode) return;
    const children = getCoordinatorChildren(taskId);
    order.push(...children.active, ...children.collapsed);
  };
  for (const project of store.projects) {
    const group = grouped[project.id];
    if (group) {
      for (const taskId of group.active) pushWithVisibleChildren(taskId);
      for (const taskId of group.collapsed) pushWithVisibleChildren(taskId);
    }
  }
  for (const taskId of orphanedActive) pushWithVisibleChildren(taskId);
  for (const taskId of orphanedCollapsed) pushWithVisibleChildren(taskId);
  order.push(...computeSidebarTerminals());
  return order;
}
