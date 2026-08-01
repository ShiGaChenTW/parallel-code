import { For, Show, createSignal, createUniqueId } from 'solid-js';
import type { JSX } from 'solid-js';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { IconButton } from './IconButton';
import { menuKeyAction, triggerKeyAction } from './sidebar-menu';
import type { MenuAction } from './sidebar-menu';

/**
 * A framed, transparent-backed heading for one region of the sidebar.
 *
 * The frame is what tells the two regions apart now that both carry a `+`:
 * before this, "Projects" was a bare row and the task list had no heading at
 * all, so the only thing separating them was a 1px rule that named neither.
 *
 * The background is `transparent` rather than a surface token on purpose.
 * `.sidebar-panel` already paints itself, and under `html[data-window-blur]`
 * the panel's own colour is what the vibrancy stack composites; a second
 * background here would either double that paint or freeze one strip at full
 * opacity while everything around it went translucent. `transparent` composites
 * with whatever is behind it in the same stacking context — it cannot punch a
 * hole through to the desktop. Nothing in this file uses `backdrop-filter` or
 * `mix-blend-mode`, which are the two things that could.
 *
 * The border is `theme.border`, the same token the phone button and the `+`
 * buttons use, so the sidebar keeps one border weight across all eleven
 * presets instead of gaining a second, subtler one only these headings use.
 */
export function SidebarSectionHeader(props: {
  /** Leading content — a plain label, or a toggle button containing one. */
  children: JSX.Element;
  /** Trailing control, normally the `+` button or its menu. */
  trailing?: JSX.Element;
}) {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '4px',
        padding: '2px 4px',
        background: 'transparent',
        border: `1px solid ${theme.border}`,
        'border-radius': '6px',
        'flex-shrink': '0',
      }}
    >
      {props.children}
      {props.trailing}
    </div>
  );
}

/**
 * The heading text for a section that does not collapse.
 *
 * Carries the same type treatment as the label inside the Projects toggle —
 * and the same `2px 4px` padding the toggle button applies — so both headings
 * start their text at the same x, which is the whole point of framing them.
 */
export function SidebarSectionLabel(props: { children: JSX.Element }) {
  return (
    <span
      style={{
        'font-size': sf(12),
        'text-transform': 'uppercase',
        'letter-spacing': '0.05em',
        color: theme.fgMuted,
        padding: '2px 4px',
        'min-width': '0',
        overflow: 'hidden',
        'text-overflow': 'ellipsis',
        'white-space': 'nowrap',
      }}
    >
      {props.children}
    </span>
  );
}

export interface SidebarMenuItem {
  readonly label: string;
  /** Hover text. Callers build shortcut hints from resolved bindings, never literals. */
  readonly tooltip?: string;
  readonly icon?: JSX.Element;
  /** Kept focusable and announced via `aria-disabled`, per the ARIA menu pattern. */
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/**
 * The `+` button on a section heading, and the menu it opens.
 *
 * Hand-built rather than pulled from a component library: the renderer entry
 * chunk was just cut from 4.96 MB to 1.27 MB, and a menu primitive is not
 * worth spending that back for two items. The shape follows the one dropdown
 * this codebase already has — `BranchCombobox`'s listbox — so it inherits the
 * same elevation, radius and shadow rather than inventing a second look.
 *
 * Positioned `absolute` rather than portalled. The only ancestor that clips is
 * `.sidebar-panel` (`overflow: hidden` under the islands looks); the menu is
 * right-aligned to a trigger near the top of the panel and drops downward into
 * the task list, so it stays inside those bounds at every sidebar width from
 * 160px to 480px. A portal would buy nothing here and would cost a measured
 * position that has to be recomputed on scroll and resize.
 *
 * Keyboard, per the WAI-ARIA menu button pattern: Down/Up/Enter/Space open,
 * Up/Down rove with wrap, Home/End jump, Escape closes and returns focus to
 * the trigger, Tab closes and moves on. The decisions live in `sidebar-menu.ts`
 * where they are unit-tested; this component only performs them.
 */
export function SidebarPlusMenu(props: {
  /** Accessible name and hover text for the `+` button. */
  triggerLabel: string;
  /** Accessible name for the menu itself. */
  menuLabel: string;
  items: readonly SidebarMenuItem[];
}) {
  const [open, setOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(0);
  const menuId = createUniqueId();

  let wrapperRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  const itemRefs: HTMLButtonElement[] = [];

  const itemCount = () => props.items.length;

  function focusItem(index: number): void {
    setFocusedIndex(index);
    // The row may not be mounted yet on the same tick the menu opens.
    queueMicrotask(() => itemRefs[index]?.focus());
  }

  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) triggerRef?.focus();
  }

  function activate(index: number): void {
    const item = props.items[index];
    if (!item || item.disabled) return;
    close(true);
    item.onSelect();
  }

  function apply(action: MenuAction): boolean {
    switch (action.kind) {
      case 'open':
        setOpen(true);
        focusItem(action.index);
        return true;
      case 'focus':
        focusItem(action.index);
        return true;
      case 'close':
        close(action.restoreFocus);
        return true;
      case 'activate':
        activate(action.index);
        return true;
      case 'ignore':
        return false;
    }
  }

  function onTriggerKeyDown(e: KeyboardEvent): void {
    const action = open()
      ? menuKeyAction(e.key, focusedIndex(), itemCount())
      : triggerKeyAction(e.key, itemCount());
    if (apply(action)) e.preventDefault();
  }

  function onMenuKeyDown(e: KeyboardEvent): void {
    const action = menuKeyAction(e.key, focusedIndex(), itemCount());
    if (action.kind === 'ignore') return;
    // Tab keeps its default so focus genuinely moves on; everything else is
    // ours. Escape additionally stops here so it closes the menu and not the
    // dialog or panel behind it.
    if (e.key !== 'Tab') e.preventDefault();
    if (e.key === 'Escape') e.stopPropagation();
    apply(action);
  }

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', display: 'inline-flex', 'flex-shrink': '0' }}
      // Covers both exits a pointer can take: clicking another control moves
      // focus out, and clicking dead space blurs to `null`. Either way the menu
      // closes without yanking focus back to the trigger.
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && wrapperRef?.contains(next)) return;
        setOpen(false);
      }}
    >
      <IconButton
        ref={(el) => (triggerRef = el)}
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
          </svg>
        }
        onClick={() => (open() ? close(true) : apply({ kind: 'open', index: 0 }))}
        onKeyDown={onTriggerKeyDown}
        title={props.triggerLabel}
        ariaLabel={props.triggerLabel}
        ariaHasPopup="menu"
        ariaExpanded={open()}
        ariaControls={open() ? menuId : undefined}
        size="sm"
      />
      <Show when={open()}>
        <div
          id={menuId}
          role="menu"
          aria-label={props.menuLabel}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: '0',
            'z-index': '30',
            'min-width': '160px',
            padding: '4px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '2px',
            background: theme.bgElevated,
            border: `1px solid ${theme.border}`,
            'border-radius': '8px',
            'box-shadow': '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <For each={props.items}>
            {(item, i) => (
              <button
                ref={(el) => (itemRefs[i()] = el)}
                type="button"
                role="menuitem"
                // Roving tabindex: exactly one row is reachable by Tab, and the
                // arrow keys move which one that is.
                tabIndex={focusedIndex() === i() ? 0 : -1}
                aria-disabled={item.disabled ? true : undefined}
                title={item.tooltip}
                onClick={() => activate(i())}
                onFocus={() => setFocusedIndex(i())}
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: '1px solid transparent',
                  'border-radius': '6px',
                  color: item.disabled ? theme.fgSubtle : theme.fg,
                  'font-size': sf(12),
                  'text-align': 'left',
                  'white-space': 'nowrap',
                  cursor: item.disabled ? 'default' : 'pointer',
                }}
              >
                <Show when={item.icon}>{item.icon}</Show>
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
