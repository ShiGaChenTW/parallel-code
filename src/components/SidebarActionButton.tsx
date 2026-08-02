import type { JSX } from 'solid-js';

import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

/**
 * The full-width action row at the bottom of the sidebar.
 *
 * Connect Phone shipped this look first and the Settings row now shares it, so
 * the look lives here rather than in two call sites. "Both buttons use the same
 * design" is the requirement; a component that owns the frame *and* the icon
 * frame is the only version of that which cannot drift — copy-paste siblings
 * agree until the day someone edits one of them.
 *
 * What the caller supplies is deliberately small: the glyph's inner shapes, a
 * label, a click handler, and optionally a colour. It cannot supply padding, a
 * radius, a font size, or an icon size, because those are the things that would
 * make the two rows stop matching.
 *
 * No `width: 100%`. The rows are flex children of a column container, so the
 * default `stretch` already sizes them, and the stylesheet has no global
 * `border-box` — an explicit 100% plus padding plus border would overflow the
 * container it is trying to fill. This is how the Connect Phone button has
 * always sized itself; it is not changing now.
 */
export interface SidebarActionButtonProps {
  /** Inner shapes of the glyph only. The `<svg>` frame belongs to this component. */
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  title?: string;
  /** Label and icon stroke. Defaults to `theme.fgMuted`. */
  accent?: string;
  /** Border colour. Defaults to `theme.border`. */
  border?: string;
}

/** Icon edge length, in px. Fixed so the two rows cannot disagree about it. */
export const SIDEBAR_ACTION_ICON_SIZE = 14;

export function SidebarActionButton(props: SidebarActionButtonProps): JSX.Element {
  // Read through accessors so a theme switch or a connection state change
  // repaints the row. There are 12 themes; nothing here may be a literal colour.
  const accent = () => props.accent ?? theme.fgMuted;
  const border = () => props.border ?? theme.border;

  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      title={props.title}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '8px 12px',
        background: 'transparent',
        border: `1px solid ${border()}`,
        'border-radius': '8px',
        color: accent(),
        'font-size': sf(13),
        cursor: 'pointer',
        'flex-shrink': '0',
      }}
    >
      <svg
        width={SIDEBAR_ACTION_ICON_SIZE}
        height={SIDEBAR_ACTION_ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke={accent()}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {props.icon}
      </svg>
      {props.label}
    </button>
  );
}
