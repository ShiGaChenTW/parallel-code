/**
 * Keyboard behaviour for the sidebar's `+` menu, as pure functions.
 *
 * Split out of the component rather than written inline because vitest runs
 * with `environment: 'node'` — there is no DOM here to dispatch a keydown into,
 * so navigation logic living inside an `onKeyDown` handler would ship
 * untested. The component keeps only the effects (move focus, call the item);
 * every branch of *which* effect belongs to which key is decided here and
 * asserted directly in `sidebar-menu.test.ts`.
 *
 * The vocabulary follows the WAI-ARIA menu button pattern: a closed trigger
 * opens on Down/Up/Enter/Space, an open menu roves with Up/Down/Home/End, and
 * Escape returns focus to the trigger while Tab leaves it where the browser
 * wants it.
 */

export type MenuAction =
  /** Key carries no menu meaning — let it through untouched. */
  | { readonly kind: 'ignore' }
  /** Open the menu and put focus on `index`. */
  | { readonly kind: 'open'; readonly index: number }
  /** Close the menu. `restoreFocus` sends focus back to the `+` trigger. */
  | { readonly kind: 'close'; readonly restoreFocus: boolean }
  /** Menu stays open; move focus to `index`. */
  | { readonly kind: 'focus'; readonly index: number }
  /** Run the item at `index` (the component still honours `disabled`). */
  | { readonly kind: 'activate'; readonly index: number };

const IGNORE: MenuAction = { kind: 'ignore' };

/**
 * Keep a possibly stale index inside the list.
 *
 * The item list is reactive — the "New task" row is disabled and re-created
 * when the last project is unlinked — so the highlighted index can outlive the
 * row it pointed at. Wrapping arithmetic on a negative or oversized index would
 * land on nothing at all; clamping first means every key still resolves to a
 * real row.
 */
function clampIndex(index: number, itemCount: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.trunc(index), itemCount - 1);
}

/** What a key pressed on the closed `+` button should do. */
export function triggerKeyAction(key: string, itemCount: number): MenuAction {
  // An empty menu must not swallow Enter — a trigger that visibly does nothing
  // reads as broken, where a trigger that never opens reads as unavailable.
  if (itemCount <= 0) return IGNORE;

  switch (key) {
    case 'ArrowDown':
    case 'Enter':
    case ' ':
      return { kind: 'open', index: 0 };
    case 'ArrowUp':
      return { kind: 'open', index: itemCount - 1 };
    default:
      return IGNORE;
  }
}

/** What a key pressed inside the open menu should do. */
export function menuKeyAction(key: string, index: number, itemCount: number): MenuAction {
  if (key === 'Escape') return { kind: 'close', restoreFocus: true };
  // Tab is the one exit that must not pull focus back: the user asked to move
  // forward, and re-focusing the trigger would undo exactly that.
  if (key === 'Tab') return { kind: 'close', restoreFocus: false };

  if (itemCount <= 0) {
    // Nothing left to land on. Closing beats holding an empty popup open.
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
      case 'Enter':
      case ' ':
        return { kind: 'close', restoreFocus: true };
      default:
        return IGNORE;
    }
  }

  const current = clampIndex(index, itemCount);

  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: (current + 1) % itemCount };
    case 'ArrowUp':
      return { kind: 'focus', index: (current - 1 + itemCount) % itemCount };
    case 'Home':
      return { kind: 'focus', index: 0 };
    case 'End':
      return { kind: 'focus', index: itemCount - 1 };
    case 'Enter':
    case ' ':
      return { kind: 'activate', index: current };
    default:
      return IGNORE;
  }
}
