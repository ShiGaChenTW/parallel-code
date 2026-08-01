import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BINDINGS, resolveBindings } from '../lib/keybindings';
import type { KeyBinding } from '../lib/keybindings';
import { catalogueFor } from '../lib/i18n';
import { newTaskTooltip, newTerminalTooltip } from './Sidebar';
import { SidebarPlusMenu, SidebarSectionHeader, SidebarSectionLabel } from './SidebarSection';

/** The bindings the app actually resolves with no user overrides applied. */
function defaultResolved(): KeyBinding[] {
  return resolveBindings(DEFAULT_BINDINGS, { preset: 'default', userOverrides: {} });
}

/**
 * The terminal button that used to carry this tooltip is gone — the Session
 * menu's terminal entry carries it now — but `Cmd/Ctrl+Shift+D` is untouched,
 * so every rule about how the combo reaches the user still applies.
 */
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

describe('newTaskTooltip', () => {
  it('advertises the shipped Cmd+N shortcut on mac', () => {
    expect(newTaskTooltip(defaultResolved(), true)).toBe('New task (Cmd + N)');
  });

  it('advertises the Ctrl variant off mac', () => {
    expect(newTaskTooltip(defaultResolved(), false)).toBe('New task (Ctrl + N)');
  });

  it('follows a rebound shortcut instead of hardcoding the default combo', () => {
    const rebound = resolveBindings(DEFAULT_BINDINGS, {
      preset: 'default',
      userOverrides: { 'app.new-task': { key: 'K', modifiers: { cmdOrCtrl: true, shift: true } } },
    });

    const tooltip = newTaskTooltip(rebound, true);
    expect(tooltip).toBe('New task (Cmd + Shift + K)');
    expect(tooltip).not.toContain('N)');
  });

  it('degrades to the plain label when the shortcut is unbound', () => {
    const unbound = resolveBindings(DEFAULT_BINDINGS, {
      preset: 'default',
      userOverrides: { 'app.new-task': null },
    });

    expect(newTaskTooltip(unbound, true)).toBe('New task');
  });

  it('keeps both tooltip strings translatable', () => {
    const zh = catalogueFor('zh-TW');
    expect(zh['New task']).toBeTruthy();
    expect(zh['New task ({shortcut})']).toContain('{shortcut}');
  });
});

describe('SidebarSectionHeader', () => {
  const render = (trailing?: () => string) =>
    renderToString(() =>
      SidebarSectionHeader({
        get children() {
          return SidebarSectionLabel({ children: 'Session' });
        },
        get trailing() {
          return trailing?.();
        },
      }),
    );

  it('draws a frame from the shared border token, never a literal colour', () => {
    // Eleven presets swap --border. A hex here would be right in one of them.
    const html = render();
    expect(html).toContain('border:1px solid var(--border)');
    expect(html).not.toMatch(/border:1px solid #[0-9a-f]{3,8}/i);
  });

  it('keeps the fill transparent so the panel shows through', () => {
    const html = render();
    expect(html).toContain('background:transparent');
  });

  it('never composites, so window blur cannot turn the frame into a hole', () => {
    // `background: transparent` blends with what is painted behind it in the
    // same stacking context. These two are the only declarations that could
    // instead cut through the sidebar panel to the blurred desktop, and the
    // heading uses neither.
    const html = render();
    expect(html).not.toContain('backdrop-filter');
    expect(html).not.toContain('mix-blend-mode');
  });

  it('renders its label and its trailing control', () => {
    const html = render(() => '<span id="trailing-probe"></span>');
    expect(html).toContain('Session');
    expect(html).toContain('trailing-probe');
  });

  it('declares no fixed width, so the resizable sidebar stays intact', () => {
    // The sidebar resizes between 160px and 480px; a fixed width would overflow
    // at the low end. `min-width: 0` on the label is the opposite declaration —
    // it is what lets the heading text ellipsise instead of forcing the frame
    // wider — so the boundary here matches `width` only when it stands alone.
    const html = render();
    expect(html).not.toMatch(/(^|[;"])width:/);
    expect(html).toContain('min-width:0');
  });
});

describe('SidebarPlusMenu', () => {
  const items = [
    { label: 'New task', tooltip: 'New task (Cmd + N)', onSelect: vi.fn() },
    { label: 'New terminal', tooltip: 'New terminal (Cmd + Shift + D)', onSelect: vi.fn() },
  ];

  const render = (overrides: Partial<Parameters<typeof SidebarPlusMenu>[0]> = {}) =>
    renderToString(() =>
      SidebarPlusMenu({
        triggerLabel: 'Add to session',
        menuLabel: 'Add to session',
        items,
        ...overrides,
      }),
    );

  it('names the trigger for a screen reader, not only for a hover', () => {
    const html = render();
    expect(html).toContain('aria-label="Add to session"');
    expect(html).toContain('title="Add to session"');
  });

  it('announces itself as a menu button', () => {
    const html = render();
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('starts closed, so the menu is not in the tab order until asked for', () => {
    const html = render();
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('New terminal');
  });

  it('renders the same plus glyph the Projects heading uses', () => {
    // Both `+` buttons sit in matching frames a few rows apart; a second glyph
    // would read as two different affordances.
    const html = render();
    expect(html).toContain('<svg');
    expect(html).toContain('M7.75 2a.75.75 0 0 1 .75.75V7h4.25');
  });

  it('keeps the trigger a plain enabled button so it can be reopened', () => {
    const html = render();
    expect(html).not.toContain('disabled');
  });

  it('carries no literal colours — eleven presets swap every one of them', () => {
    const html = render();
    expect(html).not.toMatch(/:\s*#[0-9a-f]{3,8}/i);
  });
});
