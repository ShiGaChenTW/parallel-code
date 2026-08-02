import { describe, expect, it } from 'vitest';
import {
  computeSessionMapItems,
  sessionMapShortcutLabel,
  SESSION_MAP_BINDING_ID,
  type SessionMapSnapshot,
} from './session-map';
import { DEFAULT_BINDINGS, type KeyBinding } from '../lib/keybindings';
import { menuKeyAction } from './sidebar-menu';

function snapshot(over: Partial<SessionMapSnapshot> = {}): SessionMapSnapshot {
  return { taskOrder: [], tasks: {}, terminals: {}, ...over };
}

describe('computeSessionMapItems', () => {
  it('returns nothing when the strip is empty', () => {
    expect(computeSessionMapItems(snapshot())).toEqual([]);
  });

  it('lists tasks in panel-strip order, not alphabetical or insertion order', () => {
    const items = computeSessionMapItems(
      snapshot({
        taskOrder: ['c', 'a', 'b'],
        tasks: { a: { name: 'Alpha' }, b: { name: 'Beta' }, c: { name: 'Gamma' } },
      }),
    );
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(items.map((i) => i.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('covers terminals as well as tasks, from the one shared list', () => {
    const items = computeSessionMapItems(
      snapshot({
        taskOrder: ['t1', 'sh1'],
        tasks: { t1: { name: 'Understand the project' } },
        terminals: { sh1: { name: 'Terminal 3' } },
      }),
    );
    expect(items).toEqual([
      { id: 't1', name: 'Understand the project', kind: 'task' },
      { id: 'sh1', name: 'Terminal 3', kind: 'terminal' },
    ]);
  });

  it('carries no selection field — that is view state, and tracking it here would', () => {
    // …make every task switch produce a fresh array, which rebuilds every dot
    // in the titlebar strip and restarts its CSS transitions. Both components
    // compare against `store.activeTaskId` at render instead.
    const items = computeSessionMapItems(
      snapshot({ taskOrder: ['a'], tasks: { a: { name: 'Alpha' } } }),
    );
    expect(Object.keys(items[0]).sort()).toEqual(['id', 'kind', 'name']);
  });

  it('keeps a row whose record is already gone rather than shortening the strip', () => {
    // `closeTerminal` deletes the terminal before the id leaves `taskOrder`.
    // Dropping the row here would make the dot strip flicker one dot shorter.
    const items = computeSessionMapItems(snapshot({ taskOrder: ['ghost'] }));
    expect(items).toEqual([{ id: 'ghost', name: 'Open item', kind: 'task' }]);
  });

  it('prefers the task name when an id somehow resolves to both records', () => {
    const items = computeSessionMapItems(
      snapshot({
        taskOrder: ['x'],
        tasks: { x: { name: 'From task' } },
        terminals: { x: { name: 'From terminal' } },
      }),
    );
    expect(items[0].name).toBe('From task');
    expect(items[0].kind).toBe('task');
  });

  it('ignores collapsedTaskOrder entirely — a collapsed task has no section', () => {
    // Reaching a collapsed task means `uncollapseTask`, which respawns its
    // agents. That is a create, not a jump, and the map only offers jumps.
    const items = computeSessionMapItems(
      snapshot({
        taskOrder: ['live'],
        tasks: { live: { name: 'Live' }, hidden: { name: 'Collapsed' } },
      }),
    );
    expect(items.map((i) => i.id)).toEqual(['live']);
  });
});

describe('sessionMapShortcutLabel', () => {
  const binding = (over: Partial<KeyBinding> = {}): KeyBinding => ({
    id: SESSION_MAP_BINDING_ID,
    layer: 'app',
    category: 'App',
    description: 'Toggle session map',
    platform: 'both',
    key: 'k',
    modifiers: { cmdOrCtrl: true },
    ...over,
  });

  it('spells the combo the way the running platform does', () => {
    expect(sessionMapShortcutLabel([binding()], true)).toBe('Cmd + K');
    expect(sessionMapShortcutLabel([binding()], false)).toBe('Ctrl + K');
  });

  it('follows a user rebind rather than a hardcoded combo', () => {
    const rebound = binding({ key: 'ArrowUp', modifiers: { alt: true, shift: true } });
    expect(sessionMapShortcutLabel([rebound], false)).toBe('Alt + Shift + ↑');
  });

  it('returns null when the binding is absent, so an unbound key is not advertised', () => {
    // `resolvedBindings()` drops entries the user cleared, so absence here is
    // exactly the "user unbound it" case.
    expect(sessionMapShortcutLabel([], true)).toBeNull();
  });

  it('is wired to a binding that actually ships in the defaults', () => {
    expect(DEFAULT_BINDINGS.find((b) => b.id === SESSION_MAP_BINDING_ID)?.action).toBe(
      'toggleSessionMap',
    );
  });

  it('does not collide with another default binding on the same key', () => {
    const map = DEFAULT_BINDINGS.find((b) => b.id === SESSION_MAP_BINDING_ID);
    if (!map) throw new Error('session map binding is missing from DEFAULT_BINDINGS');
    const clashes = DEFAULT_BINDINGS.filter(
      (b) =>
        b.id !== SESSION_MAP_BINDING_ID &&
        b.key.toLowerCase() === map.key.toLowerCase() &&
        JSON.stringify(b.modifiers) === JSON.stringify(map.modifiers),
    );
    expect(clashes).toEqual([]);
  });
});

describe('session map keyboard, borrowed from sidebar-menu', () => {
  // The map does not reimplement roving focus; it reads `menuKeyAction`. These
  // assert the contract the overlay depends on, so a change to the menu's
  // semantics fails here rather than silently changing the map.
  it('wraps around both ends of the list', () => {
    expect(menuKeyAction('ArrowDown', 2, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction('ArrowUp', 0, 3)).toEqual({ kind: 'focus', index: 2 });
  });

  it('jumps to the ends with Home and End', () => {
    expect(menuKeyAction('Home', 2, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction('End', 0, 3)).toEqual({ kind: 'focus', index: 2 });
  });

  it('closes on Escape and activates on Enter', () => {
    expect(menuKeyAction('Escape', 1, 3)).toEqual({ kind: 'close', restoreFocus: true });
    expect(menuKeyAction('Enter', 1, 3)).toEqual({ kind: 'activate', index: 1 });
  });

  it('clamps an index left over from a longer list', () => {
    // The strip is reactive: a task can close while the map is open.
    expect(menuKeyAction('Enter', 7, 2)).toEqual({ kind: 'activate', index: 1 });
  });
});
