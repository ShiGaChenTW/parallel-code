import { createEffect, onMount, onCleanup } from 'solid-js';
import { tr } from '../store/i18n';
import {
  store,
  closeTerminal,
  updateTerminalName,
  setActiveTask,
  reorderTask,
  registerFocusFn,
  unregisterFocusFn,
  triggerFocus,
  setTaskFocusedPanel,
  isPanelFocused,
} from '../store/store';
import { EditableText, type EditableTextHandle } from './EditableText';
import { IconButton } from './IconButton';
import { TerminalView } from './TerminalView';
import { CloseIcon } from './icons';
import { theme } from '../lib/theme';
import { handleDragReorder } from '../lib/dragReorder';
import type { Terminal } from '../store/types';

interface TerminalPanelProps {
  terminal: Terminal;
  isActive: boolean;
}

export function TerminalPanel(props: TerminalPanelProps) {
  let panelRef!: HTMLDivElement;
  let titleEditHandle: EditableTextHandle | undefined;

  // Focus registration
  onMount(() => {
    const id = props.terminal.id;
    registerFocusFn(`${id}:title`, () => titleEditHandle?.startEdit());

    onCleanup(() => {
      unregisterFocusFn(`${id}:title`);
      unregisterFocusFn(`${id}:terminal`);
    });
  });

  // Respond to focus panel changes
  createEffect(() => {
    if (!props.isActive) return;
    const panel = store.focusedPanel[props.terminal.id] ?? 'terminal';
    triggerFocus(`${props.terminal.id}:${panel}`);
  });

  function handleTitleMouseDown(e: MouseEvent) {
    handleDragReorder(e, {
      itemId: props.terminal.id,
      getTaskOrder: () => store.taskOrder,
      onReorder: reorderTask,
      onTap: () => setActiveTask(props.terminal.id),
    });
  }

  return (
    <div
      ref={panelRef}
      class={`task-column ${props.isActive ? 'active' : ''}`}
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        background: theme.taskContainerBg,
        'border-radius': '12px',
        border: `1px solid ${theme.border}`,
        overflow: 'clip',
        position: 'relative',
      }}
      onClick={() => setActiveTask(props.terminal.id)}
    >
      {/* Title bar */}
      <div
        class={props.isActive ? 'island-header-active' : ''}
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          padding: '0 10px',
          height: '36px',
          'min-height': '36px',
          background: 'transparent',
          'border-bottom': `1px solid ${theme.border}`,
          'user-select': 'none',
          cursor: 'grab',
          'flex-shrink': '0',
        }}
        onMouseDown={handleTitleMouseDown}
      >
        <div
          style={{
            overflow: 'hidden',
            flex: '1',
            'min-width': '0',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
          }}
        >
          <span
            style={{
              'font-family': 'monospace',
              'font-size': '14px',
              color: theme.fgMuted,
              'flex-shrink': '0',
            }}
          >
            &gt;_
          </span>
          <EditableText
            value={props.terminal.name}
            onCommit={(v) => updateTerminalName(props.terminal.id, v)}
            class="editable-text"
            ref={(h) => (titleEditHandle = h)}
          />
        </div>
        <div style={{ display: 'flex', gap: '4px', 'margin-left': '8px', 'flex-shrink': '0' }}>
          <IconButton
            icon={<CloseIcon />}
            onClick={() => closeTerminal(props.terminal.id)}
            title={tr('Close terminal')}
          />
        </div>
      </div>

      {/* Terminal. Unlike the task panel — where every focusable panel sits
          inside resizable cells that carry no radius — this one is a direct
          child of the rounded root, so the `border-radius: inherit` on
          `.focusable-panel`'s focus ring would resolve to the card's own 12px
          and draw rounded top corners in the middle of the panel, against the
          flat title-bar seam. Pinning the radius keeps the ring square where it
          meets that seam and curved where it meets the card's clip. The bottom
          11px is the card's 12px less its 1px frame: `overflow` clips against
          the padding box, so that is the curve the ring has to trace. */}
      <div
        class="focusable-panel"
        data-panel-focused={isPanelFocused(props.terminal.id, 'terminal') ? 'true' : 'false'}
        style={{
          height: '100%',
          position: 'relative',
          'border-radius': '0 0 11px 11px',
        }}
        onClick={() => setTaskFocusedPanel(props.terminal.id, 'terminal')}
      >
        <TerminalView
          taskId={props.terminal.id}
          agentId={props.terminal.agentId}
          isShell
          bookmarksEnabled={false}
          isFocused={isPanelFocused(props.terminal.id, 'terminal')}
          command=""
          args={['-l']}
          cwd=""
          onReady={(focusFn) => registerFocusFn(`${props.terminal.id}:terminal`, focusFn)}
          autoFocus
        />
      </div>
    </div>
  );
}
