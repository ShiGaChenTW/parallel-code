import { describe, expect, it } from 'vitest';

import { menuKeyAction, triggerKeyAction } from './sidebar-menu';

const TWO = 2;

describe('triggerKeyAction', () => {
  it('opens on ArrowDown with the first item focused', () => {
    expect(triggerKeyAction('ArrowDown', TWO)).toEqual({ kind: 'open', index: 0 });
  });

  it('opens on ArrowUp with the last item focused', () => {
    // Matches the platform menu convention: arrowing up into a closed menu
    // lands on the bottom entry rather than the top one.
    expect(triggerKeyAction('ArrowUp', TWO)).toEqual({ kind: 'open', index: 1 });
  });

  it('opens on Enter and Space from the first item', () => {
    expect(triggerKeyAction('Enter', TWO)).toEqual({ kind: 'open', index: 0 });
    expect(triggerKeyAction(' ', TWO)).toEqual({ kind: 'open', index: 0 });
  });

  it('ignores keys that are not menu openers', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Escape', 'Tab', 'a', 'Home']) {
      expect(triggerKeyAction(key, TWO), key).toEqual({ kind: 'ignore' });
    }
  });

  it('ignores every opener when the menu has no items', () => {
    // A menu with nothing in it must not steal Enter from the button, or the
    // trigger would look broken rather than empty.
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      expect(triggerKeyAction(key, 0), key).toEqual({ kind: 'ignore' });
    }
  });
});

describe('menuKeyAction', () => {
  it('moves down and wraps past the last item', () => {
    expect(menuKeyAction('ArrowDown', 0, 3)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKeyAction('ArrowDown', 2, 3)).toEqual({ kind: 'focus', index: 0 });
  });

  it('moves up and wraps past the first item', () => {
    expect(menuKeyAction('ArrowUp', 2, 3)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKeyAction('ArrowUp', 0, 3)).toEqual({ kind: 'focus', index: 2 });
  });

  it('jumps to the ends with Home and End', () => {
    expect(menuKeyAction('Home', 2, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction('End', 0, 3)).toEqual({ kind: 'focus', index: 2 });
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    // Focus must return to the `+` button; dropping it on <body> would strand
    // a keyboard user at the top of the document.
    expect(menuKeyAction('Escape', 1, 3)).toEqual({ kind: 'close', restoreFocus: true });
  });

  it('closes on Tab without stealing focus, so Tab still moves on', () => {
    expect(menuKeyAction('Tab', 1, 3)).toEqual({ kind: 'close', restoreFocus: false });
  });

  it('activates the focused item on Enter and Space', () => {
    expect(menuKeyAction('Enter', 1, 3)).toEqual({ kind: 'activate', index: 1 });
    expect(menuKeyAction(' ', 2, 3)).toEqual({ kind: 'activate', index: 2 });
  });

  it('ignores keys with no menu meaning', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'x', 'Shift']) {
      expect(menuKeyAction(key, 0, 3), key).toEqual({ kind: 'ignore' });
    }
  });

  it('clamps an out-of-range index instead of focusing nothing', () => {
    // The item list is reactive: it can shrink while the menu is open, and a
    // stale index must still resolve to a real row.
    expect(menuKeyAction('ArrowDown', 9, 2)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction('ArrowUp', 9, 2)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction('Enter', 9, 2)).toEqual({ kind: 'activate', index: 1 });
  });

  it('closes on any navigation key once the menu has emptied', () => {
    expect(menuKeyAction('ArrowDown', 0, 0)).toEqual({ kind: 'close', restoreFocus: true });
    expect(menuKeyAction('Enter', 0, 0)).toEqual({ kind: 'close', restoreFocus: true });
  });
});
