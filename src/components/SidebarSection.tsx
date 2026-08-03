import { For, Show, createSignal, createUniqueId } from 'solid-js';
import type { JSX } from 'solid-js';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { IconButton } from './IconButton';
import { menuKeyAction, triggerKeyAction } from './sidebar-menu';
import type { MenuAction } from './sidebar-menu';

/**
 * The box geometry every framed control in the sidebar column shares.
 *
 * These numbers used to be the removed "New Task" button's. The reference is
 * now the "Connect Phone" button at the foot of the same column — the one
 * framed control in the sidebar that survived every pass, and the one the
 * headings were asked to be indistinguishable from. Its radius was already
 * 8px, so only the horizontal inset moved: 14px to 12px.
 *
 * The phone button also carries `margin: 4px 8px`, and that is deliberately
 * *not* copied here. Its margin is not part of how the button looks, it is
 * where the button sits — a standalone footer control inset from the panel's
 * own 16px padding. The headings label the lists directly beneath them, and
 * those lists (plus "Link Project" and the task list) all start flush at that
 * 16px. Insetting only the headings would pull each label 8px off the rows it
 * names, which is a worse mismatch than the one it fixes.
 *
 * Exported rather than inlined because two things still need to agree: the
 * section headings below, and the full-width "Link Project" button that is all
 * a user with no projects sees. Those two stack directly on top of each other
 * in the same column, so a radius or padding that drifts on one shows up
 * immediately as a mismatched edge on the other. Link Project was already the
 * closest thing in the column to the phone button — same 13px text, same
 * muted token, same 14px leading icon — so moving the shared inset to 12px
 * carries it the last step rather than dragging it somewhere it did not want
 * to go.
 */
export const SECTION_BOX_RADIUS = '8px';
export const SECTION_BOX_PADDING = '8px 12px';

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
  /**
   * Makes the whole frame the hit target for the trailing control.
   *
   * The `+` was a 24px square in a box eight times its width, and every pixel
   * of the rest of that box looked clickable and was not. Only pass this where
   * `children` is a plain label: a heading whose label is itself a button would
   * fire both handlers on one click.
   */
  activatesTrailing?: boolean;
}) {
  let trailingRef: HTMLDivElement | undefined;

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '4px',
        padding: SECTION_BOX_PADDING,
        background: 'transparent',
        border: `1px solid ${theme.border}`,
        'border-radius': SECTION_BOX_RADIUS,
        'flex-shrink': '0',
        cursor: props.activatesTrailing ? 'pointer' : undefined,
      }}
      onClick={(e) => {
        if (!props.activatesTrailing) return;
        // The trailing control owns its own clicks — and its popup renders
        // inside it, so a click on a menu row must not bounce back here and
        // re-open what the row just closed.
        if (trailingRef?.contains(e.target as Node)) return;
        trailingRef?.querySelector('button')?.click();
      }}
    >
      {props.children}
      <div ref={trailingRef} style={{ display: 'contents' }}>
        {props.trailing}
      </div>
    </div>
  );
}

/**
 * The one treatment every heading glyph wears.
 *
 * Every number here is read off the "Connect Phone" button's icon, which is the
 * control these headings were asked to be indistinguishable from: 14px box, a
 * 24-unit viewBox, `fill="none"`, 2-unit stroke, round caps and joins. That
 * button is a Feather icon (`smartphone`), and so is the sidebar's existing
 * `TerminalGlyph` (`terminal`) — one 24-unit stroke family already runs through
 * this column, so the two glyphs below are drawn from it rather than invented.
 *
 * `stroke` is the token, not `currentColor`, for the same reason the phone
 * button passes its own `accent()`: twelve presets swap `--fg-muted`, and a
 * glyph that inherits its colour silently changes meaning the day someone
 * nests it somewhere that sets a different one.
 *
 * `flex-shrink: 0` because the sidebar resizes down to 160px. The label text
 * beside it is the thing that ellipsises; an icon that squashed instead would
 * turn a folder into a smear before a single character was dropped.
 *
 * Wrapping the treatment in one component rather than repeating the `<svg>` at
 * each glyph is the whole point: two headings sit four rows apart, and the day
 * one of them gains a 1.5 stroke or a 16-unit viewBox is the day they stop
 * reading as a pair. Only the path differs.
 */
function SectionGlyph(props: { children: JSX.Element }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={theme.fgMuted}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ 'flex-shrink': '0' }}
    >
      {props.children}
    </svg>
  );
}

/**
 * A folder, for the Projects heading.
 *
 * The most literal thing the section could be given, which at 14px is the
 * point — the tabbed top-left step is legible as a silhouette even when the
 * 1.2px strokes it is drawn with stop resolving individually.
 *
 * The 16-unit filled folder already in the tree (the "Link Project" button, and
 * `TaskBranchInfoBar`) is deliberately *not* reused. It is a solid Octicon; the
 * treatment these headings were told to copy is a 24-unit Feather outline, and
 * rescaling a filled path into a stroked box would produce neither. The two do
 * appear together in the empty state — a stroked folder on the heading, a
 * filled one on the button directly beneath it. That is a real seam, and
 * unifying it means restyling the Link Project button, which this pass was
 * explicitly told not to touch.
 */
export function ProjectsGlyph() {
  return (
    <SectionGlyph>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </SectionGlyph>
  );
}

/**
 * Two panes side by side, for the Session heading.
 *
 * A session is not a container of files, it is the set of panes running right
 * now — the tasks and terminals the `+` beside this very label adds. Feather's
 * `columns` says exactly that, and in an app called Parallel Code a split pane
 * is close to a self-portrait.
 *
 * Not the terminal `>_`: that glyph is already spoken for by the "New terminal"
 * row inside this heading's own menu, so a heading wearing it would announce
 * itself as one of the two things it can contain.
 *
 * Not `layers` or `grid` either, which are the other obvious "several things at
 * once" glyphs. Both stack three or four shapes inside 24 units; at 14px the
 * gaps between them fall below the stroke weight and the icon fills in. This is
 * one closed outline and one straight line — the simplest silhouette that still
 * means something, and the furthest from the folder above it that the same
 * family allows: symmetric and flat-topped against asymmetric and stepped.
 */
export function SessionGlyph() {
  return (
    <SectionGlyph>
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18" />
    </SectionGlyph>
  );
}

/**
 * The heading text for a section, and the glyph that leads it.
 *
 * Carries no padding of its own. It used to carry `2px 4px` to match the
 * padding on the Projects collapse toggle, so the two headings started their
 * text at the same x. That toggle is gone and both headings are now this same
 * component, so the frame's own `SECTION_BOX_PADDING` is the only inset —
 * keeping the old value here would inset the text a second time and leave the
 * label floating well off the frame's left edge.
 *
 * 13px, not 12px, because the "Connect Phone" button sets 13px and these
 * headings are meant to read as the same control. `theme.fgMuted` was already
 * the phone button's colour in its resting state and did not have to move; the
 * connected state tints it `theme.success`, which a heading has no equivalent
 * of and must not fake.
 *
 * The text is set plain. It spent one release uppercased and tracked out at
 * 0.05em, which is what a heading looks like when it has nothing but weight to
 * distinguish it from the rows below. It has a frame and now a glyph, so the
 * borrowed emphasis is spare capacity — and the button these headings copy sets
 * "Connect Phone" in ordinary Title Case. Copying its box, its size and its
 * colour while shouting its text would have left one visible tell.
 *
 * The icon lives here rather than at the call site because there are two call
 * sites and they must not drift. Passing the glyph into the frame's `children`
 * slot instead would put it on the far side of the frame's own 4px gap — the
 * one holding the `+` off the label — where 8px is what the phone button sets
 * between its icon and its text. Nesting it in the label makes that gap the
 * label's business, and leaves the ellipsis on the text alone: the inner span
 * is what overflows, so a narrow sidebar clips "Projects" and never the folder.
 */
export function SidebarSectionLabel(props: { icon?: JSX.Element; children: JSX.Element }) {
  return (
    <span
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        'font-size': sf(13),
        color: theme.fgMuted,
        'min-width': '0',
        overflow: 'hidden',
      }}
    >
      <Show when={props.icon}>{props.icon}</Show>
      <span
        style={{
          'min-width': '0',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        {props.children}
      </span>
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
