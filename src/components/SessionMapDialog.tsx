import { For, Show, createEffect, createSignal, createUniqueId, on } from 'solid-js';
import { Dialog } from './Dialog';
import { menuKeyAction } from './sidebar-menu';
import {
  computeSessionMapItems,
  sessionMapShortcutLabel,
  type SessionMapItem,
} from './session-map';
import { setActiveTask, store, toggleSessionMap } from '../store/store';
import { resolvedBindings } from '../store/keybindings';
import { tr } from '../store/i18n';
import { isMac } from '../lib/platform';
import { theme } from '../lib/theme';

/**
 * The session map: every open section, listed, on demand.
 *
 * A SECOND COMPONENT, not a variant of `FocusModeTaskIndicators`.
 *
 * The two share their data — both read `computeSessionMapItems` — and share
 * nothing else. The strip is sixteen-pixel unlabelled dots living inside the OS
 * window-drag region, pointer-events carved out, deliberately not reachable by
 * Tab because it decorates a titlebar. This is a focus-trapping modal with a
 * roving-tabindex listbox, text labels and an Escape route. Folding them into
 * one component behind a `variant` prop would make nearly every attribute in
 * the markup conditional on that prop — two components in a trench coat, with a
 * change to either landing in the file that renders the other. The strip's
 * behaviour is untouched by this wave, which is the point.
 *
 * Keyboard behaviour is `sidebar-menu.ts` verbatim, not a second
 * implementation: arrows wrap, Home/End jump, Enter activates, Escape closes.
 * Tab closes too — that is the module's semantic for "the user asked to leave",
 * and it is right here, because the list is the whole panel and there is
 * nowhere else in it to tab to.
 *
 * STYLING IS INLINE, except two rules.
 *
 * `styles.css` is render-blocking and this component is `lazy()`, so a byte of
 * layout moved into the stylesheet is a byte paid on every launch for a panel
 * most launches never open — while the same byte inline rides in a chunk that
 * is only fetched on first use. The token cards, hierarchy rails and section
 * boxes of the last few waves went inline for the same reason. Only `:hover`
 * and `:focus-visible` are in the stylesheet, because a pseudo-class cannot be
 * expressed as a style object at all.
 */
export function SessionMapDialog() {
  const titleId = createUniqueId();

  const items = () =>
    computeSessionMapItems({
      taskOrder: store.taskOrder,
      tasks: store.tasks,
      terminals: store.terminals,
    });

  const isActive = (id: string) => id === store.activeTaskId;

  const shortcut = () => sessionMapShortcutLabel(resolvedBindings(), isMac);

  /**
   * Accessible name for a row.
   *
   * Carries the kind, which the visual row draws as a shape and therefore does
   * not say out loud — without this a screen-reader user would get no task/
   * terminal distinction at all. Whole sentences rather than a bare `Task` /
   * `Terminal` label concatenated onto the name, which is what `lib/i18n.ts`
   * asks for: one catalogue entry per sentence, so a translator owns the word
   * order instead of inheriting English's.
   */
  const rowLabel = (item: SessionMapItem): string => {
    if (item.kind === 'terminal') {
      return isActive(item.id)
        ? tr('Terminal {name}, current section', { name: item.name })
        : tr('Terminal {name}', { name: item.name });
    }
    return isActive(item.id)
      ? tr('Task {name}, current section', { name: item.name })
      : tr('Task {name}', { name: item.name });
  };

  // Start on the active section, so the map opens where the user already is and
  // Enter is a no-op rather than a surprise.
  const [focusedIndex, setFocusedIndex] = createSignal(0);
  let listRef: HTMLDivElement | undefined;

  const focusRow = (index: number) => {
    setFocusedIndex(index);
    const row = listRef?.querySelector<HTMLElement>(`[data-map-index="${index}"]`);
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  };

  // On open, not on every item change: re-seeking the active row while the map
  // is up would fight the arrow keys, since moving off it is what they are for.
  createEffect(
    on(
      () => store.showSessionMap,
      (open) => {
        if (!open) return;
        const start = Math.max(
          items().findIndex((item) => isActive(item.id)),
          0,
        );
        setFocusedIndex(start);
        // After the Portal has painted the rows.
        queueMicrotask(() => focusRow(start));
      },
    ),
  );

  const close = () => toggleSessionMap(false);

  const activate = (index: number) => {
    const item = items()[index];
    if (!item) return;
    setActiveTask(item.id);
    close();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const action = menuKeyAction(event.key, focusedIndex(), items().length);
    if (action.kind === 'ignore') return;
    event.preventDefault();
    // Escape would otherwise also reach `Dialog`'s document-level handler. The
    // second close is harmless, but stopping here keeps one owner for the key.
    event.stopPropagation();
    switch (action.kind) {
      case 'close':
        close();
        return;
      case 'focus':
        focusRow(action.index);
        return;
      case 'activate':
        activate(action.index);
        return;
      case 'open':
        // Unreachable: `menuKeyAction` only opens from a closed trigger, and
        // there is no trigger here — the map is already open when it listens.
        return;
    }
  };

  return (
    <Dialog
      open={store.showSessionMap}
      onClose={close}
      width="min(440px, 92vw)"
      labelledBy={titleId}
      panelStyle={{ padding: '18px', gap: '12px' }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'baseline',
          'justify-content': 'space-between',
          gap: '12px',
        }}
      >
        <h2
          id={titleId}
          style={{ margin: '0', 'font-size': '14px', 'font-weight': '600', color: theme.fg }}
        >
          {tr('Open sections')}
        </h2>
        <Show when={shortcut()}>
          {(combo) => (
            <kbd
              style={{
                'font-family': 'var(--font-mono, monospace)',
                'font-size': '11px',
                color: theme.fgSubtle,
                border: `1px solid ${theme.border}`,
                'border-radius': '5px',
                padding: '2px 6px',
                'white-space': 'nowrap',
              }}
            >
              {combo()}
            </kbd>
          )}
        </Show>
      </div>

      <Show
        when={items().length > 0}
        fallback={
          <p style={{ margin: '0', 'font-size': '12px', color: theme.fgSubtle }}>
            {tr('Nothing is open yet.')}
          </p>
        }
      >
        <div
          ref={listRef}
          role="listbox"
          aria-label={tr('Open sections')}
          onKeyDown={handleKeyDown}
          style={{
            display: 'flex',
            'flex-direction': 'column',
            gap: '2px',
            'max-height': '52vh',
            'overflow-y': 'auto',
            // Not a tab stop itself: one row is, via roving tabindex.
            outline: 'none',
          }}
        >
          <For each={items()}>
            {(item, index) => (
              <button
                type="button"
                role="option"
                data-map-index={index()}
                aria-selected={isActive(item.id) ? 'true' : 'false'}
                aria-label={rowLabel(item)}
                // Roving tabindex: one stop for the whole list, so Tab leaves
                // the map instead of walking every open section.
                tabIndex={index() === focusedIndex() ? 0 : -1}
                class="session-map-row"
                onClick={() => activate(index())}
                onFocus={() => setFocusedIndex(index())}
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '7px 10px',
                  border: '0',
                  'border-radius': '8px',
                  background: 'transparent',
                  color: theme.fg,
                  'font-size': '13px',
                  'text-align': 'left',
                  cursor: 'pointer',
                }}
              >
                {/* Same dot vocabulary as the titlebar strip, squared off for a
                    terminal. Drawn rather than spelled: a word per row would be
                    a second text column in a list whose only job is to be
                    scanned, and it is the accessible name's job to say it. */}
                <span
                  aria-hidden="true"
                  style={{
                    flex: '0 0 auto',
                    width: '8px',
                    height: '8px',
                    'border-radius': item.kind === 'terminal' ? '2px' : '999px',
                    border: isActive(item.id)
                      ? '1px solid color-mix(in srgb, var(--accent) 82%, white 18%)'
                      : '1px solid color-mix(in srgb, var(--fg-muted) 60%, transparent)',
                    background: isActive(item.id)
                      ? theme.accent
                      : 'color-mix(in srgb, var(--fg-muted) 28%, transparent)',
                  }}
                />
                <span
                  style={{
                    flex: '1 1 auto',
                    'min-width': '0',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {item.name}
                </span>
                <Show when={isActive(item.id)}>
                  <span
                    aria-hidden="true"
                    style={{ flex: '0 0 auto', 'font-size': '11px', color: theme.accent }}
                  >
                    {tr('current')}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>

      <p style={{ margin: '0', 'font-size': '12px', color: theme.fgSubtle }}>
        {tr('Arrows to move, Enter to jump, Esc to close.')}
      </p>
    </Dialog>
  );
}
