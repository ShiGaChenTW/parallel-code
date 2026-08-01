import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BINDINGS, resolveBindings } from '../lib/keybindings';
import type { KeyBinding } from '../lib/keybindings';
import { catalogueFor } from '../lib/i18n';
import { SidebarTerminalButton, newTerminalTooltip } from './Sidebar';

/** The bindings the app actually resolves with no user overrides applied. */
function defaultResolved(): KeyBinding[] {
  return resolveBindings(DEFAULT_BINDINGS, { preset: 'default', userOverrides: {} });
}

describe('newTerminalTooltip', () => {
  it('advertises the shipped Cmd+Shift+D shortcut on mac', () => {
    expect(newTerminalTooltip(defaultResolved(), true)).toBe('New terminal (Cmd + Shift + D)');
  });

  it('advertises the Ctrl variant off mac', () => {
    expect(newTerminalTooltip(defaultResolved(), false)).toBe('New terminal (Ctrl + Shift + D)');
  });

  it('follows a rebound shortcut instead of hardcoding the default combo', () => {
    // A user who remaps app.new-terminal in Settings must see their own combo.
    const rebound = resolveBindings(DEFAULT_BINDINGS, {
      preset: 'default',
      userOverrides: {
        'app.new-terminal': { key: 'T', modifiers: { cmdOrCtrl: true, alt: true } },
      },
    });

    const tooltip = newTerminalTooltip(rebound, true);
    expect(tooltip).toBe('New terminal (Cmd + Opt + T)');
    expect(tooltip).not.toContain('Shift');
  });

  it('degrades to the plain label when the shortcut is unbound', () => {
    // resolveBindings drops unbound entries, so the tooltip must not advertise
    // a key combination the user has cleared.
    const unbound = resolveBindings(DEFAULT_BINDINGS, {
      preset: 'default',
      userOverrides: { 'app.new-terminal': null },
    });

    expect(unbound.some((b) => b.id === 'app.new-terminal')).toBe(false);
    expect(newTerminalTooltip(unbound, true)).toBe('New terminal');
  });

  it('keeps both tooltip strings translatable', () => {
    const zh = catalogueFor('zh-TW');
    expect(zh['New terminal']).toBeTruthy();
    expect(zh['New terminal ({shortcut})']).toContain('{shortcut}');
  });
});

describe('SidebarTerminalButton', () => {
  const render = () =>
    renderToString(() =>
      SidebarTerminalButton({
        label: 'New terminal',
        tooltip: 'New terminal (Cmd + Shift + D)',
        onClick: vi.fn(),
      }),
    );

  it('renders the label, tooltip, and accessible name', () => {
    const html = render();
    expect(html).toContain('New terminal');
    expect(html).toContain('title="New terminal (Cmd + Shift + D)"');
    expect(html).toContain('aria-label="New terminal"');
  });

  it('matches the phone button chrome so the two read as one stack', () => {
    const html = render();
    expect(html).toContain('margin:4px 8px');
    expect(html).toContain('border-radius:8px');
    expect(html).toContain('padding:8px 12px');
    expect(html).toContain('flex-shrink:0');
  });

  it('declares no width of its own so the resizable sidebar stays intact', () => {
    // The sidebar resizes between 160px and 480px; a fixed width here would
    // overflow at the low end. Only the 14px icon carries a width, and that is
    // an SVG attribute, never a style declaration.
    const html = render();
    expect(html).not.toContain('width:');
  });

  it('renders a terminal glyph rather than a text-only row', () => {
    const html = render();
    expect(html).toContain('<svg');
    expect(html).toContain('polyline');
  });

  it('stays a plain enabled button so repeated clicks keep opening terminals', () => {
    // Nothing here latches after the first press — no disabled attribute and no
    // pressed state — so the button can add terminal after terminal.
    const html = render();
    expect(html).toContain('<button');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('aria-pressed');
  });
});
