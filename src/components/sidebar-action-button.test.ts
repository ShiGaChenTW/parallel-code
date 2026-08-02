import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BINDINGS, resolveBindings } from '../lib/keybindings';
import type { KeyBinding } from '../lib/keybindings';
import { settingsTooltip } from './Sidebar';
import { SidebarActionButton } from './SidebarActionButton';

/** The bindings the app actually resolves with no user overrides applied. */
function defaultResolved(): KeyBinding[] {
  return resolveBindings(DEFAULT_BINDINGS, { preset: 'default', userOverrides: {} });
}

/**
 * The gear in the sidebar header built this string as `` `${mod}+,` `` for as
 * long as it existed. `mod` only ever chose between Cmd and Ctrl — the comma
 * was a literal — so the tooltip claimed `Cmd+,` no matter where the user had
 * moved `app.toggle-settings`. The Settings row in the footer would have
 * inherited that bug by copy-paste; both read the resolved binding instead.
 */
describe('settingsTooltip', () => {
  it('advertises the shipped Cmd+, shortcut on mac', () => {
    expect(settingsTooltip(defaultResolved(), true)).toBe('Settings (Cmd + ,)');
  });

  it('advertises the Ctrl variant off mac', () => {
    expect(settingsTooltip(defaultResolved(), false)).toBe('Settings (Ctrl + ,)');
  });

  it('follows a rebound shortcut instead of hardcoding the default combo', () => {
    // The regression the old `${mod}+,` template could not survive.
    const rebound = resolveBindings(DEFAULT_BINDINGS, {
      preset: 'default',
      userOverrides: {
        'app.toggle-settings': { key: 'P', modifiers: { cmdOrCtrl: true, shift: true } },
      },
    });

    const tooltip = settingsTooltip(rebound, true);
    expect(tooltip).toBe('Settings (Cmd + Shift + P)');
    expect(tooltip).not.toContain(',');
  });

  it('degrades to the bare label when the user has cleared the binding', () => {
    // `resolveBindings` drops a cleared entry, so the tooltip must not invent a
    // combo for a key that no longer fires.
    const cleared = defaultResolved().filter((b) => b.id !== 'app.toggle-settings');

    expect(settingsTooltip(cleared, true)).toBe('Settings');
  });
});

/**
 * "Both buttons use the same design" is the requirement Scott stated, so it is
 * the thing worth pinning. These assertions compare two rendered rows against
 * each other rather than against a literal style string: a spec that lists
 * `padding: 8px 12px` passes forever while the two rows drift, which is the
 * failure this component exists to prevent.
 */
describe('SidebarActionButton', () => {
  const dot = () => null;

  /** Everything outside the parts a caller is allowed to vary. */
  function frameOf(html: string): string {
    return html
      .replace(/>[^<>]*</g, '><') // labels
      .replace(/<(circle|rect|line|path)\b[^>]*\/?>/g, '<glyph>'); // glyph shapes
  }

  it('gives two differently-labelled rows the same frame', () => {
    const phone = renderToString(() =>
      SidebarActionButton({ icon: dot(), label: 'Connect Phone', onClick: () => {} }),
    );
    const settings = renderToString(() =>
      SidebarActionButton({ icon: dot(), label: 'Settings', onClick: () => {} }),
    );

    expect(phone).not.toBe(settings);
    expect(frameOf(phone)).toBe(frameOf(settings));
  });

  it('draws both glyphs at one size in one stroke treatment', () => {
    const html = renderToString(() =>
      SidebarActionButton({ icon: dot(), label: 'Settings', onClick: () => {} }),
    );

    // The reference design the batch settled on: 14px, 24-unit viewBox, stroked
    // rather than filled. A caller supplies shapes; it cannot supply these.
    expect(html).toContain('width="14"');
    expect(html).toContain('height="14"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke-width="2"');
  });

  it('sizes itself by flex stretch rather than an overflowing width', () => {
    // The stylesheet has no global `border-box`, so `width: 100%` alongside
    // 12px of padding and a 1px border would render wider than its container.
    const html = renderToString(() =>
      SidebarActionButton({ icon: dot(), label: 'Settings', onClick: () => {} }),
    );

    expect(html).not.toContain('width:100%');
    expect(html).not.toContain('width: 100%');
  });

  it('takes its colours from the theme, never from a literal', () => {
    // 12 themes ship. A hex or a named colour here would be wrong in 11 of them.
    const html = renderToString(() =>
      SidebarActionButton({ icon: dot(), label: 'Settings', onClick: () => {} }),
    );

    const style = /style="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(style).toContain('var(--');
  });

  it('lets a caller tint the row without letting it reshape the row', () => {
    // Connect Phone turns green while connected. That is the whole licence:
    // colour changes, geometry does not.
    const plain = renderToString(() =>
      SidebarActionButton({ icon: dot(), label: 'Settings', onClick: () => {} }),
    );
    const tinted = renderToString(() =>
      SidebarActionButton({
        icon: dot(),
        label: 'Settings',
        onClick: () => {},
        accent: 'var(--success)',
        border: 'var(--success)',
      }),
    );

    expect(tinted).toContain('var(--success)');
    expect(tinted).not.toBe(plain);
    for (const geometry of ['padding:8px 12px', 'border-radius:8px', 'gap:8px']) {
      expect(plain.replace(/ /g, '')).toContain(geometry.replace(/ /g, ''));
      expect(tinted.replace(/ /g, '')).toContain(geometry.replace(/ /g, ''));
    }
  });
});
