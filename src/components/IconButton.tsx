import { type JSX } from 'solid-js';
import { theme } from '../lib/theme';

interface IconButtonProps {
  icon: string | JSX.Element;
  onClick: (e: MouseEvent) => void;
  title?: string;
  size?: 'sm' | 'md';
  /**
   * Tints the button to show that what it toggles is currently open.
   *
   * Every other button in the title bar is a one-shot action, so a toggle
   * without this looks the same whether or not its panel is showing.
   */
  active?: boolean;
  /**
   * The block below exists so a menu trigger can be an IconButton rather than a
   * hand-rolled copy of one. The sidebar puts a `+` on both section headings;
   * one opens a folder picker and one opens a menu, and they sit in matching
   * frames a few rows apart, so they have to be the same button down to the
   * pixel. Every field is optional — a plain icon button passes none of them.
   */
  ref?: (el: HTMLButtonElement) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Needed when the visible content is a glyph and `title` is not enough. */
  ariaLabel?: string;
  ariaHasPopup?: 'menu' | 'dialog' | 'listbox';
  ariaExpanded?: boolean;
  ariaControls?: string;
}

export function IconButton(props: IconButtonProps) {
  const isSm = () => props.size === 'sm';

  return (
    <button
      ref={props.ref}
      class="icon-btn"
      title={props.title}
      aria-label={props.ariaLabel}
      aria-haspopup={props.ariaHasPopup}
      aria-expanded={props.ariaExpanded}
      aria-controls={props.ariaControls}
      onKeyDown={(e) => props.onKeyDown?.(e)}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick(e);
      }}
      style={{
        background: props.active
          ? `color-mix(in srgb, ${theme.accent} 14%, transparent)`
          : 'transparent',
        border: `1px solid ${props.active ? theme.accent : theme.border}`,
        color: props.active ? theme.fg : theme.fgMuted,
        cursor: 'pointer',
        'border-radius': '6px',
        padding: isSm() ? '2px' : '4px',
        'font-size': isSm() ? '11px' : '13px',
        'line-height': '1',
        'flex-shrink': '0',
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
      }}
    >
      {props.icon}
    </button>
  );
}
