import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { catalogueFor } from '../lib/i18n';
import type { Terminal } from '../store/types';
import { SidebarTerminalRow } from './Sidebar';

/**
 * The sidebar row for a standalone terminal.
 *
 * Terminals opened from the Session `+` menu already live in `taskOrder` and
 * already get a panel from `TilingLayout`; until now nothing in the sidebar
 * rendered them, so the only way back to one was to scroll the panel strip.
 * This row is that way back.
 *
 * It is shaped after `TaskRow` deliberately — same `TaskRowShell`, same
 * `task-item` class, same appearance/removal animation — because a terminal is
 * a peer of a task in the panel strip and reading as a different species of row
 * in the list beside it would be a lie about how the app treats it.
 *
 * The component takes the `Terminal` itself rather than an id, the way
 * `TerminalPanel` does, which is also what lets this file render it with no
 * store standing behind it.
 */

const terminal = (over: Partial<Terminal> = {}): Terminal => ({
  id: 'term-1',
  name: 'Terminal 1',
  agentId: 'agent-1',
  ...over,
});

const render = (t: Terminal = terminal()) =>
  renderToString(() => SidebarTerminalRow({ terminal: t }));

describe('SidebarTerminalRow', () => {
  it('shows the terminal name, which is what the user renamed it to', () => {
    expect(render(terminal({ name: 'deploy logs' }))).toContain('deploy logs');
  });

  it('carries the id the sidebar keyboard focus effect scrolls by', () => {
    // `Sidebar`'s sidebarFocusedTaskId effect looks a row up by
    // `[data-task-index]` first and falls back to `[data-sidebar-task-id]`.
    // Terminals are not in the drag index space, so the fallback is the only
    // way ↑/↓ can scroll one into view.
    expect(render()).toContain('data-sidebar-task-id="term-1"');
  });

  it('stays out of the drag index space', () => {
    // `data-task-index` is what the task list's mousedown handler looks for.
    // A terminal with one would be draggable into the middle of a project
    // group it does not belong to.
    expect(render()).not.toContain('data-task-index');
  });

  it('draws no hierarchy rail — a terminal has no parent to descend from', () => {
    // Same reasoning the orphan bucket already applies: the rail descends from
    // a project header's colour dot, and this row has no project header above
    // it. The row therefore also keeps the plain 10px indent rather than the
    // 13px that opens room for an elbow.
    const html = render();
    expect(html).not.toContain('color-mix(in srgb, var(--fg) 16%, transparent)');
    expect(html).toContain('padding-left:10px');
  });

  it('offers no close button — the terminal panel title bar already has one', () => {
    // No row in the task list carries a close control; the `×` in this sidebar
    // belongs to the project list. Adding one here would make terminals the
    // single exception, and duplicate a control a few hundred pixels away.
    const html = render();
    expect(html).not.toContain('<button');
    expect(html).not.toContain('&times;');
  });

  it('animates in like a task row', () => {
    expect(render()).toContain('task-item-appearing');
  });

  it('animates out while closeTerminal holds the removing status', () => {
    // `closeTerminal` sets `removing` and waits 300ms before deleting, so the
    // panel can animate. The row has to leave on the same beat or the sidebar
    // shows a terminal that is already gone from the strip.
    const html = render(terminal({ closingStatus: 'removing' }));
    expect(html).toContain('task-item-removing');
    expect(html).not.toContain('task-item-appearing');
  });

  it('keeps the closing status short of removing on the appearing class', () => {
    // 'closing' is the synchronous re-entrancy guard `closeTerminal` sets
    // before awaiting KillAgent. The panel does not animate on it, so neither
    // does the row.
    expect(render(terminal({ closingStatus: 'closing' }))).toContain('task-item-appearing');
  });

  it('carries no literal colours — twelve presets swap every one of them', () => {
    expect(render()).not.toMatch(/:\s*#[0-9a-f]{3,8}/i);
  });
});

describe('the Terminals section heading', () => {
  it('is translatable, like every other sidebar section label', () => {
    expect(catalogueFor('zh-TW')['Terminals']).toBeTruthy();
  });
});
