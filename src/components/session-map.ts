/**
 * Row model for the session map, as pure functions.
 *
 * `FocusModeTaskIndicators` derived this list inline, three lines of it, and
 * that was fine while it had one reader. It now has two — the titlebar dot
 * strip and the session map overlay — and vitest runs with
 * `environment: 'node'`, so a list computed inside a `.tsx` component is a list
 * no test can reach. Same split, and for the same reason, as `sidebar-menu.ts`:
 * the components keep the rendering, the decisions live here and are asserted
 * directly.
 *
 * ORDER IS `taskOrder`, UNCHANGED — and deliberately not the sidebar's.
 *
 * `taskOrder` is the panel strip: the left-to-right sequence of sections the
 * main area actually renders, the sequence `Cmd+1..9` indexes into, and the one
 * Cmd+Alt+Arrow cycles. `computeSidebarTaskOrder()` is a different list on
 * purpose — it regroups the same ids under project headings and appends
 * collapsed tasks — because the sidebar answers "where does this task belong"
 * while the strip answers "what is on screen, left to right".
 *
 * The map answers the second question, so it takes the second list. This is
 * load-bearing rather than incidental: a flat list is the right shape for this
 * map *only* because the layout is one-dimensional, which makes vertical
 * position in the list mean horizontal position on screen. Re-sorting the rows
 * into project groups would spend exactly the property that justified the
 * shape.
 *
 * COLLAPSED TASKS ARE ABSENT, because they are absent from the strip. A
 * collapsed task has no panel and no running agent; `store.collapsedTaskOrder`
 * holds it, and the only way to reach one is `uncollapseTask`, which respawns
 * every saved agent definition as a fresh process. That is a create, not a
 * jump, and putting it behind a row that looks like navigation would make the
 * map's cheapest-looking click its most expensive one. The sidebar already
 * offers that action, under a heading that says the task is collapsed.
 */

import { formatKeyCombo, type KeyBinding } from '../lib/keybindings';

/** Which record a row's id resolved to. */
export type SessionMapItemKind = 'task' | 'terminal';

/**
 * One row of the map.
 *
 * A record rather than a string, and the reason is the next wave: the intended
 * follow-up is a per-row "what is it doing" line — agent working, waiting for
 * input, idle for eleven minutes — which `TaskCurrentStateLine` already
 * computes elsewhere. Adding it here is adding a field to this interface and a
 * derivation to `computeSessionMapItems`; every call site keeps compiling,
 * because they all take the whole item. `kind` is already carried for the same
 * reason — a status renderer has to branch on task vs terminal, and rederiving
 * that from the store at render time would be the second place that decision
 * lives.
 *
 * Which row is *selected* is deliberately not a field. That is view state, not
 * row data, and folding it in would be a live regression rather than a style
 * point: the dot strip's `items()` does not read `activeTaskId` today, so
 * switching tasks rewrites two attributes on two existing dots. Track
 * `activeTaskId` in here and every write to it yields a fresh array, `<For>`
 * rebuilds every dot by reference, and the 0.15s transitions on
 * `.focus-mode-task-indicator::before` restart from nothing on each switch.
 * Both components compare against `store.activeTaskId` at render instead.
 */
export interface SessionMapItem {
  readonly id: string;
  readonly name: string;
  readonly kind: SessionMapItemKind;
}

/**
 * The store reads this computation needs, structurally typed.
 *
 * Passed in rather than imported so the function is callable from a node-env
 * test without standing up a SolidJS store — and so widening it for the status
 * wave is a visible edit here rather than a new import inside a component.
 */
export interface SessionMapSnapshot {
  readonly taskOrder: readonly string[];
  readonly tasks: Readonly<Record<string, { readonly name: string } | undefined>>;
  readonly terminals: Readonly<Record<string, { readonly name: string } | undefined>>;
}

/**
 * Label for an id in `taskOrder` that resolves to neither record.
 *
 * Reachable: `closeTerminal` deletes the terminal record before the id leaves
 * `taskOrder`. Kept untranslated because this module is pure and cannot read
 * the locale, and because the string it replaces was untranslated too — this
 * wave is not the place to change what that transient row says.
 */
const UNKNOWN_ITEM_NAME = 'Open item';

/**
 * The map's rows, in panel-strip order.
 *
 * Ids that resolve to neither a task nor a terminal are kept, not dropped: the
 * dot strip has always drawn one dot per `taskOrder` entry, and silently
 * shortening the strip mid-teardown would be a behaviour change smuggled in
 * under a refactor.
 */
export function computeSessionMapItems(snapshot: SessionMapSnapshot): SessionMapItem[] {
  return snapshot.taskOrder.map((id) => {
    const task = snapshot.tasks[id];
    const terminal = task ? undefined : snapshot.terminals[id];
    return {
      id,
      name: task?.name ?? terminal?.name ?? UNKNOWN_ITEM_NAME,
      // A row that resolved to nothing is typed as a task, matching the
      // fallback label: it is a panel that is going away, not a terminal.
      kind: terminal ? 'terminal' : ('task' as SessionMapItemKind),
    };
  });
}

/** Registry id of the binding that opens and closes the map. */
export const SESSION_MAP_BINDING_ID = 'app.toggle-session-map';

/**
 * The combo to advertise inside the map, or null when there is none.
 *
 * Reads the *resolved* binding rather than spelling `Cmd+K` into the markup, on
 * the same terms as `newTerminalTooltip`: a user who rebinds the map in
 * Settings sees their own combo, and `resolvedBindings()` has already dropped
 * entries the user unbound, so a cleared shortcut degrades to no hint at all
 * instead of advertising a dead key.
 *
 * `isMac` is threaded through rather than left to `formatKeyCombo`'s platform
 * default so the test can assert both platforms.
 */
export function sessionMapShortcutLabel(bindings: KeyBinding[], isMac?: boolean): string | null {
  const binding = bindings.find((b) => b.id === SESSION_MAP_BINDING_ID);
  return binding ? formatKeyCombo(binding, isMac) : null;
}
