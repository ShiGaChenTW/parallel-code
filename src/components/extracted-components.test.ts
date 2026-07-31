import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { presetsForTone } from '../lib/look';
import { CheckboxOption, InlineBanner } from './NewTaskDialog';
import { PresetThemeCard, SettingsCheckboxRow } from './SettingsDialog';
import { TaskRowShell } from './Sidebar';

describe('extracted component helpers', () => {
  it('renders settings checkbox rows with label, description, and checked state', () => {
    const html = renderToString(() =>
      SettingsCheckboxRow({
        label: 'Show plans',
        description: 'Keep task plans visible',
        checked: true,
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('Show plans');
    expect(html).toContain('Keep task plans visible');
  });

  it('renders active preset theme cards with clone affordance', () => {
    const preset = presetsForTone('light')[0];
    const html = renderToString(() =>
      PresetThemeCard({
        preset,
        active: true,
        onSelect: vi.fn(),
        onClone: vi.fn(),
      }),
    );

    expect(html).toContain('settings-theme-card active');
    expect(html).toContain(preset.label);
    expect(html).toContain(preset.description);
    expect(html).toContain('title="Clone as custom theme"');
  });

  it('renders new-task checkbox options with disabled state and title', () => {
    const html = renderToString(() =>
      CheckboxOption({
        label: 'Run in Docker container',
        checked: false,
        disabled: true,
        title: 'Docker unavailable',
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain('title="Docker unavailable"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled');
    expect(html).toContain('Run in Docker container');
  });

  it('renders inline banners with custom text and sizing', () => {
    const html = renderToString(() =>
      InlineBanner({
        color: '#f59e0b',
        fontSize: '12px',
        children: 'Coordinator Docker warning',
      }),
    );

    expect(html).toContain('Coordinator Docker warning');
    expect(html).toContain('font-size:12px');
  });

  it('renders task row shell navigation metadata and children', () => {
    const html = renderToString(() =>
      TaskRowShell({
        taskId: 'task-1',
        class: 'task-item',
        taskIndex: 2,
        sidebarTaskId: 'task-1',
        role: 'button',
        tabIndex: 0,
        title: 'Open task',
        onClick: vi.fn(),
        fontSize: '13px',
        cursor: 'pointer',
        opacity: '1',
        children: 'Task Alpha',
      }),
    );

    expect(html).toContain('class="task-item"');
    expect(html).toContain('role="button"');
    expect(html).toContain('data-task-index="2"');
    expect(html).toContain('data-sidebar-task-id="task-1"');
    expect(html).toContain('Task Alpha');
  });
});

/**
 * These render the real markup rather than re-asserting `sidebar-tree`'s pure
 * functions. Vitest runs in `environment: 'node'` with no layout engine, so
 * this is as far as verification goes: it proves what is emitted, not what it
 * looks like. Nothing here can catch a rail that is drawn one pixel off, hidden
 * behind the row content, or invisible under some theme.
 */
describe('sidebar hierarchy rail', () => {
  const shell = (connector?: 'middle' | 'last' | 'through') =>
    renderToString(() =>
      TaskRowShell({
        taskId: 'task-1',
        class: 'task-item',
        connector,
        onClick: vi.fn(),
        fontSize: '12px',
        cursor: 'pointer',
        opacity: '1',
        children: 'Task Alpha',
      }),
    );

  it('draws no rail at all when the row has no project above it', () => {
    const html = shell(undefined);
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).toContain('padding-left:10px');
  });

  it('runs the rail through a row that is not the last of its project', () => {
    const html = shell('middle');
    // Full-height trunk, plus an elbow at the row's midpoint.
    expect(html).toContain('height:100%');
    expect(html).toContain('top:50%');
    expect(html).toContain('width:5px');
    expect(html).toContain('padding-left:13px');
  });

  it('stops the rail at the elbow on the last row of a project', () => {
    const html = shell('last');
    expect(html).toContain('height:50%');
    expect(html).not.toContain('height:100%');
    // The elbow is still drawn — only the trunk below it is gone.
    expect(html).toContain('top:50%');
  });

  it('passes the rail behind coordinator children without claiming them', () => {
    const html = shell('through');
    expect(html).toContain('height:100%');
    expect(html).not.toContain('top:50%');
  });

  it('paints the rail from a theme token, never a literal colour', () => {
    const html = shell('middle');
    expect(html).toContain('color-mix(in srgb, var(--fg) 16%, transparent)');
    // Both halves of the original rule still hold. No literal colour reaches the
    // markup in any notation -- `rgba(255,255,255,0.16)` would give the white
    // Scott asked for on his dark theme and a rail that cannot be seen at all on
    // `islands-light`, so it is banned here rather than left to review.
    expect(html).not.toMatch(/background:\s*#[0-9a-f]{3,8}/i);
    expect(html).not.toMatch(/background:\s*(?:rgba?|hsla?)\(/i);
  });

  it('derives the rail from the foreground token so it inverts with the theme', () => {
    const html = shell('middle');
    // `--fg` is near-white on all eleven dark presets, which is the white
    // translucent hairline that was asked for, and near-black (#1f2329) on
    // `islands-light`, where a white one would be invisible. One expression,
    // both directions, and custom themes get it for free.
    expect(html).toContain('var(--fg)');
    expect(html).not.toContain('var(--border-subtle)');
    // The alpha is derived, not chosen -- see the comment on TREE_RAIL_COLOR.
    expect(html).toContain('16%');
  });

  it('keeps the rail out of the pointer path so drag targets are unchanged', () => {
    expect(shell('middle')).toContain('pointer-events:none');
  });
});
