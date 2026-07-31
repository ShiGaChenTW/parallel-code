/**
 * Geometry for the hierarchy rail that ties a project's tasks back to their
 * project header in the sidebar.
 *
 * The sidebar renders a project header and its tasks as flat siblings of one
 * flex column — the grouping is real in `computeGroupedTasks`, but nothing on
 * screen said so. The rail says it: a hairline descending from the project
 * header's colour dot, elbowing right into each task underneath.
 *
 * Every row draws its own slice of that rail rather than a wrapper drawing one
 * continuous line, because a wrapper would have to become a flex item and the
 * drag-reorder code walks `[data-task-index]` siblings and measures their
 * rects. Per-row slices leave the DOM shape, the drop indicators, and the drag
 * index space exactly as they were. It also gives the last row somewhere to
 * stop: it draws only the half of the rail above its elbow, so the line ends at
 * the elbow instead of running out the bottom of the group.
 *
 * This module is deliberately pure. Vitest runs `environment: 'node'` here, so
 * there is no DOM to assert a rendered line against; keeping the decisions
 * (which row terminates, which row is a pass-through, how far the indent
 * moves) in plain functions is what makes them testable at all.
 */

/**
 * What a row draws of the rail.
 *
 * - `middle` — rail through the full row height, plus an elbow into the row.
 * - `last` — rail down to the elbow and no further. Terminates the group.
 * - `through` — rail through the full row height, no elbow. Used for a
 *   coordinator's nested children: the rail has to reach the coordinator's next
 *   sibling, but the children hang off the coordinator, not off the project, so
 *   claiming them with an elbow would be a lie.
 */
export type TreeConnector = 'middle' | 'last' | 'through';

/**
 * Horizontal position of the rail, in px from the row's left edge.
 *
 * The project header pads `0 2px` and then draws a 6px colour dot, putting the
 * dot's centre at 5px. The rail is directly below it, so it reads as descending
 * out of the project rather than as a stray line beside it.
 */
export const TREE_RAIL_LEFT_PX = 5;

/** How far the elbow reaches right from the rail, in px. */
export const TREE_ELBOW_WIDTH_PX = 5;

/** Row indents. `TREE` is the only new one — the other two are pre-existing. */
const PADDING_LEFT_PLAIN = '10px';
const PADDING_LEFT_INDENTED = '22px';
const PADDING_LEFT_TREE = '13px';

/**
 * Which slice of the rail the row at `index` of a project group draws.
 *
 * A group is `[...active, ...collapsed]` flattened, so the caller offsets
 * collapsed indices past the active ones and either half may be empty — the
 * terminator lands on whichever row is genuinely last. A lone task still gets
 * `last`: a stub descending from the project dot into its single elbow.
 *
 * Returns `undefined` for an index outside the group, which is also the answer
 * for orphaned tasks: they have no project header above them, so there is
 * nothing for a rail to descend from.
 */
export function groupConnector(index: number, total: number): TreeConnector | undefined {
  if (index < 0 || index >= total) return undefined;
  return index === total - 1 ? 'last' : 'middle';
}

/** Which slice a coordinator's nested children draw, given the coordinator's own. */
export function childConnector(parent: TreeConnector | undefined): TreeConnector | undefined {
  return parent === 'middle' || parent === 'through' ? 'through' : undefined;
}

/** Height of the rail segment: half the row on the terminator, all of it otherwise. */
export function trunkHeight(connector: TreeConnector): string {
  return connector === 'last' ? '50%' : '100%';
}

/** Whether the row is claimed by the project directly, and so gets an elbow. */
export function hasElbow(connector: TreeConnector): boolean {
  return connector !== 'through';
}

/**
 * Left padding for a task row.
 *
 * Top-level rows on the rail move 10px → 13px so the elbow (which ends at 10px)
 * clears their content, which starts at the 1.5px focus border plus the
 * padding. Coordinator children stay at 22px: they are already well right of
 * the elbow's reach, and moving them would disturb an indent that already reads
 * correctly against their coordinator.
 */
export function rowPaddingLeft(indented: boolean, connector: TreeConnector | undefined): string {
  if (indented) return PADDING_LEFT_INDENTED;
  return connector === undefined ? PADDING_LEFT_PLAIN : PADDING_LEFT_TREE;
}
