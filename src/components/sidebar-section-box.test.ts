import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { SECTION_BOX_PADDING, SECTION_BOX_RADIUS } from './SidebarSection';

const srcDir = resolve(__dirname, '..');
const sidebarSource = readFileSync(join(srcDir, 'components/Sidebar.tsx'), 'utf8');
const sectionSource = readFileSync(join(srcDir, 'components/SidebarSection.tsx'), 'utf8');
const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');
const catalogue = readFileSync(join(srcDir, 'lib/i18n.ts'), 'utf8');

/**
 * Every non-test source file under `src/`.
 *
 * Test files are excluded on purpose: `persistence.test.ts` names the retired
 * `projectsCollapsed` key deliberately, to prove an old state file carrying it
 * is inert. Counting that as a surviving reference would make the two tests
 * contradict each other.
 */
function productionSources(): string[] {
  const files: string[] = [];
  (function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        files.push(full);
      }
    }
  })(srcDir);
  return files;
}

/**
 * The source of one exported function, from its declaration up to the next
 * top-level `export` (or end of file). Needed because several components in
 * `SidebarSection.tsx` legitimately use the radius the heading frame must not:
 * the menu rows are still 6px, and only the frame itself changed.
 */
function exportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  expect(start, `no exported ${name}`).toBeGreaterThanOrEqual(0);
  const after = source.indexOf('\nexport ', start + 1);
  return source.slice(start, after === -1 ? source.length : after);
}

/**
 * The geometry the removed "New Task" button carried, copied here before it was
 * deleted. It was the reference the section headings were asked to match, so it
 * is pinned as a literal rather than read back from the constants under test —
 * a test that derives its expectation from the thing it checks proves nothing.
 */
const NEW_TASK_BUTTON_RADIUS = '8px';
const NEW_TASK_BUTTON_PADDING = '8px 14px';

describe('sidebar section box geometry', () => {
  it('matches the box the New Task button used to draw', () => {
    expect(SECTION_BOX_RADIUS).toBe(NEW_TASK_BUTTON_RADIUS);
    expect(SECTION_BOX_PADDING).toBe(NEW_TASK_BUTTON_PADDING);
  });

  it('applies that geometry to the section heading frame', () => {
    const frame = exportedFunction(sectionSource, 'SidebarSectionHeader');
    expect(frame).toContain('padding: SECTION_BOX_PADDING');
    expect(frame).toContain("'border-radius': SECTION_BOX_RADIUS");
    // The hard-coded pair the frame used before must be gone, not shadowed.
    expect(frame).not.toContain("padding: '2px 4px'");
    expect(frame).not.toContain("'border-radius': '6px'");
  });

  it('gives the heading label no padding of its own', () => {
    // The frame now supplies 14px of horizontal inset. A label that also
    // padded itself would sit visibly off the frame's left edge.
    const label = exportedFunction(sectionSource, 'SidebarSectionLabel');
    expect(label).not.toContain('padding:');
  });

  it('shares the geometry with the Link Project button below it', () => {
    // The two boxes stack in the same column, so a drift shows up immediately
    // as a mismatched edge.
    expect(sidebarSource).toContain("'border-radius': SECTION_BOX_RADIUS");
    expect(sidebarSource).toContain('padding: SECTION_BOX_PADDING');
  });
});

describe('the Projects section can no longer be collapsed shut', () => {
  it('keeps no reference to the retired persisted flag in shipped code', () => {
    // The chevron was the only control that set this flag, and the flag was
    // written to disk. Reading it again anywhere would let an old `true`
    // hide the project list with nothing left in the UI to reveal it.
    const offenders = productionSources().filter((file) =>
      readFileSync(file, 'utf8').includes('projectsCollapsed'),
    );
    expect(offenders).toEqual([]);
  });

  it('renders the Projects heading as a plain label, not a toggle', () => {
    expect(sidebarSource).toContain("<SidebarSectionLabel>{tr('Projects')}</SidebarSectionLabel>");
    expect(sidebarSource).not.toContain('projects-toggle');
    expect(sidebarSource).not.toContain('aria-controls="sidebar-projects-list"');
  });

  it('drops the collapse animation styles along with the control', () => {
    for (const dead of ['.projects-toggle', '.projects-collapser', '.projects-clip']) {
      expect(css).not.toContain(dead);
    }
  });

  it('leaves no orphaned collapse strings in the catalogue', () => {
    expect(catalogue).not.toContain('Expand projects');
    expect(catalogue).not.toContain('Collapse projects');
  });
});

describe('the New Task button is gone but starting out is not', () => {
  it('no longer draws a New Task button beneath the Session heading', () => {
    // The Session `+` menu offers the same action a row above.
    expect(sidebarSource).not.toContain("{tr('New Task')}");
    expect(sidebarSource).not.toContain('onClick={() => toggleNewTaskDialog(true)}');
  });

  it('still offers Link Project as the way in when nothing is linked', () => {
    // Someone with no projects cannot start a task at all — the Session menu's
    // task entry is aria-disabled in exactly that state — so this full-width
    // button is their only obvious route, and it must survive the removal.
    expect(sidebarSource).toContain('<Show when={store.projects.length === 0}>');
    expect(sidebarSource).toContain("{tr('Link Project')}");
  });

  it('keeps the Session menu wired to the task dialog', () => {
    // `newTaskTooltip` looked orphaned once the button went, but it still
    // serves the menu entry. Deleting it would have taken the shortcut hint
    // off the only remaining way to open the dialog.
    expect(sidebarSource).toContain('export function newTaskTooltip');
    expect(sidebarSource).toContain('onSelect: () => toggleNewTaskDialog(true)');
  });
});
