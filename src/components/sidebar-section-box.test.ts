import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { SECTION_BOX_PADDING, SECTION_BOX_RADIUS } from './SidebarSection';

const srcDir = resolve(__dirname, '..');
const sidebarSource = readFileSync(join(srcDir, 'components/Sidebar.tsx'), 'utf8');
const sectionSource = readFileSync(join(srcDir, 'components/SidebarSection.tsx'), 'utf8');
const actionButtonSource = readFileSync(join(srcDir, 'components/SidebarActionButton.tsx'), 'utf8');
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
 * What the "Connect Phone" row *looks* like.
 *
 * That row is the reference the section headings were asked to copy, and it
 * still lives in this repo — so unlike the deleted "New Task" button it can be
 * read back rather than remembered. Pinning the literals below *and* checking
 * them against this slice is the point: the literals say what the headings
 * agreed to be, and the slice catches the day someone restyles the row and
 * leaves the headings behind.
 *
 * The look moved out of `Sidebar.tsx` when the Settings row joined it — two
 * rows that must match cannot each own a copy of the geometry — so this now
 * reads `SidebarActionButton`, which is the only place the numbers exist.
 * Strictly a better anchor than the old inline slice: there is nothing left to
 * drift *from*.
 */
function actionRowLookSource(): string {
  expect(actionButtonSource.length, 'no SidebarActionButton.tsx').toBeGreaterThan(0);
  return actionButtonSource;
}

/**
 * Where the "Connect Phone" row *sits*, and how it tints itself — both of which
 * stayed at the call site in `Sidebar.tsx`, because they are the row's own
 * business rather than the shared frame's.
 */
function connectPhoneCallSiteSource(): string {
  const start = sidebarSource.indexOf('{/* Sidebar actions:');
  expect(start, 'no sidebar actions container in Sidebar.tsx').toBeGreaterThanOrEqual(0);
  const end = sidebarSource.indexOf('<SidebarFooter />', start);
  expect(end, 'no SidebarFooter after the sidebar actions').toBeGreaterThan(start);
  return sidebarSource.slice(start, end);
}

/**
 * What the phone button draws. Pinned as literals rather than derived from the
 * constants under test — a test that reads its expectation off the thing it
 * checks proves nothing.
 */
const PHONE_BUTTON_RADIUS = '8px';
const PHONE_BUTTON_PADDING = '8px 12px';
const PHONE_BUTTON_FONT_SIZE = 'sf(13)';
/** Where the button sits, not how it looks. The headings deliberately skip it. */
const PHONE_BUTTON_MARGIN = '4px 8px';

describe('sidebar section box geometry', () => {
  it('matches the box the Connect Phone button draws', () => {
    expect(SECTION_BOX_RADIUS).toBe(PHONE_BUTTON_RADIUS);
    expect(SECTION_BOX_PADDING).toBe(PHONE_BUTTON_PADDING);
  });

  it('reads those numbers off the button that is still in the tree', () => {
    const phone = actionRowLookSource();
    expect(phone).toContain(`padding: '${PHONE_BUTTON_PADDING}'`);
    expect(phone).toContain(`'border-radius': '${PHONE_BUTTON_RADIUS}'`);
    expect(phone).toContain(`'font-size': ${PHONE_BUTTON_FONT_SIZE}`);
  });

  it('applies that geometry to the section heading frame', () => {
    const frame = exportedFunction(sectionSource, 'SidebarSectionHeader');
    expect(frame).toContain('padding: SECTION_BOX_PADDING');
    expect(frame).toContain("'border-radius': SECTION_BOX_RADIUS");
    // The hard-coded pair the frame used before must be gone, not shadowed.
    expect(frame).not.toContain("padding: '2px 4px'");
    expect(frame).not.toContain("'border-radius': '6px'");
  });

  it('copies the phone button’s look but not the margin that positions it', () => {
    // The row is inset 8px from the panel padding because it stands at the foot
    // of the column. A heading names the list directly under it, and that list
    // starts flush at the panel's own 16px — insetting the heading would pull
    // the label off the rows it labels.
    //
    // The inset now sits on the container holding the Connect Phone and
    // Settings rows rather than on the phone button itself, so that the pair
    // shares one edge. Same 4px 8px, one level out.
    expect(connectPhoneCallSiteSource()).toContain(`margin: '${PHONE_BUTTON_MARGIN}'`);
    expect(exportedFunction(sectionSource, 'SidebarSectionHeader')).not.toContain('margin');
  });

  it('sets the heading text at the phone button’s size', () => {
    const label = exportedFunction(sectionSource, 'SidebarSectionLabel');
    expect(label).toContain(`'font-size': ${PHONE_BUTTON_FONT_SIZE}`);
    expect(label).not.toContain("'font-size': sf(12)");
  });

  it('borrows the phone button’s resting colour and never invents its lit one', () => {
    // The button tints itself `theme.success` while a phone is attached. A
    // heading has no such state, so faking one would light it up permanently.
    const label = exportedFunction(sectionSource, 'SidebarSectionLabel');
    expect(label).toContain('color: theme.fgMuted');
    expect(label).not.toContain('theme.success');
    expect(connectPhoneCallSiteSource()).toContain('connected() ? theme.success : theme.fgMuted');
  });

  it('gives the heading label no padding of its own', () => {
    // The frame now supplies 12px of horizontal inset. A label that also
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
