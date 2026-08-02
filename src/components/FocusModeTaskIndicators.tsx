import { For, Show } from 'solid-js';
import { setActiveTask, store } from '../store/store';
import { computeSessionMapItems } from './session-map';

/**
 * The titlebar dot strip: one dot per open section, the current one filled.
 *
 * Behaviour is untouched by the session-map wave — same list, same order, same
 * click, same reactivity. The three lines that derived the list moved to
 * `session-map.ts` so the map overlay reads the same rows from the same place,
 * and so the derivation is finally covered by a test that can run without a
 * DOM. `computeSessionMapItems` over `store.taskOrder` returns exactly what the
 * inline `.map()` returned, and `isActive` stays a separate accessor for the
 * reason recorded on `SessionMapItem`.
 *
 * Not macOS-only, and never was: `App.tsx` mounts this inside
 * `mac-titlebar-spacer` on macOS, and `WindowTitleBar` mounts it everywhere
 * else. `styles.css` has carried the `.window-titlebar >` rule for it all along.
 */
export function FocusModeTaskIndicators() {
  const items = () =>
    computeSessionMapItems({
      taskOrder: store.taskOrder,
      tasks: store.tasks,
      terminals: store.terminals,
    });

  return (
    <Show when={items().length > 0}>
      <div class="focus-mode-task-indicators">
        <For each={items()}>
          {(item) => {
            const isActive = () => item.id === store.activeTaskId;
            return (
              <button
                type="button"
                class={`focus-mode-task-indicator${isActive() ? ' active' : ''}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setActiveTask(item.id)}
                title={isActive() ? `${item.name} (current)` : `Switch to ${item.name}`}
                aria-label={isActive() ? `${item.name}, current item` : `Switch to ${item.name}`}
                aria-current={isActive() ? 'true' : undefined}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
}
