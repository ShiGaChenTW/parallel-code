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
}

export function IconButton(props: IconButtonProps) {
  const isSm = () => props.size === 'sm';

  return (
    <button
      class="icon-btn"
      title={props.title}
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
