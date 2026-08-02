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
 * The body of one function, exported or not, without its leading doc comment.
 *
 * `exportedFunction` above slices to the next top-level `export`, which sweeps
 * up whatever comment introduces the next declaration. That is harmless when
 * the assertions are about style objects, and actively wrong for the glyphs
 * below: their comments quote the very attributes under test (`fill="none"`,
 * `viewBox`), so a slice that included them would go green on prose.
 */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `no function ${name}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}', start);
  expect(end, `no close for ${name}`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
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

describe('section headings are set like the phone button, not like a legend', () => {
  it('sets the heading text plain, with no uppercasing and no tracking', () => {
    // Not a concession to make a red test green — nothing asserted this before.
    // The heading spent one release shouting because that was all it had: no
    // frame, no glyph, nothing but weight to separate it from the rows beneath.
    // It has both now, so the emphasis is a third signal doing a job already
    // done twice, and it is the one signal the reference control does not use.
    const label = exportedFunction(sectionSource, 'SidebarSectionLabel');
    expect(label).not.toContain('text-transform');
    expect(label).not.toContain('letter-spacing');
  });

  it('reads that back off the button rather than taking the rule on trust', () => {
    // Same coupling as the geometry tests above: the literals say what the
    // headings agreed to be, this says the button still is it. If someone ever
    // tracks out "Connect Phone", the headings are the next thing to move.
    const phone = actionRowLookSource();
    expect(phone).not.toContain('text-transform');
    expect(phone).not.toContain('letter-spacing');
  });
});

describe('each section heading leads with a glyph', () => {
  it('gives both headings one, drawn by the same component', () => {
    // Two call sites, one path. A heading that hand-rolled its own <svg> is
    // how the pair drifts apart four rows from each other.
    expect(sidebarSource).toContain('icon={<ProjectsGlyph />}');
    expect(sidebarSource).toContain('icon={<SessionGlyph />}');
    for (const glyph of ['ProjectsGlyph', 'SessionGlyph']) {
      expect(functionSource(sectionSource, glyph), glyph).toContain('<SectionGlyph>');
    }
  });

  it('wears the icon treatment the Connect Phone button already wears', () => {
    const glyph = functionSource(sectionSource, 'SectionGlyph');
    const phone = actionRowLookSource();
    // The action row now sizes its glyph from a constant rather than a literal,
    // so the size is checked through that constant. Everything else still
    // compares literal against literal on both sides.
    expect(phone).toContain('export const SIDEBAR_ACTION_ICON_SIZE = 14;');
    expect(phone).toContain('width={SIDEBAR_ACTION_ICON_SIZE}');
    expect(glyph).toContain('width="14"');
    expect(glyph).toContain('height="14"');
    for (const attribute of [
      'viewBox="0 0 24 24"',
      'fill="none"',
      'stroke-width="2"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
    ]) {
      expect(glyph, attribute).toContain(attribute);
      expect(phone, attribute).toContain(attribute);
    }
  });

  it('strokes the glyph with the token, never a literal colour', () => {
    // Twelve presets swap --fg-muted. A hex would be right in one of them.
    const glyph = functionSource(sectionSource, 'SectionGlyph');
    expect(glyph).toContain('stroke={theme.fgMuted}');
    expect(glyph).not.toMatch(/stroke="#[0-9a-f]{3,8}"/i);
  });

  it('holds the glyph at size while the label beside it ellipsises', () => {
    // The sidebar resizes to 160px. Whatever gives, it must not be the icon.
    expect(functionSource(sectionSource, 'SectionGlyph')).toContain("'flex-shrink': '0'");
    expect(exportedFunction(sectionSource, 'SidebarSectionLabel')).toContain(
      "'text-overflow': 'ellipsis'",
    );
  });

  it('sets the two glyphs 8px off their text, as the phone button does', () => {
    expect(exportedFunction(sectionSource, 'SidebarSectionLabel')).toContain("gap: '8px'");
    expect(actionRowLookSource()).toContain("gap: '8px'");
  });

  it('draws two different paths, so the sections are told apart and not doubled', () => {
    const pathOf = (name: string): string => {
      const path = / d="([^"]+)"/.exec(functionSource(sectionSource, name))?.[1];
      if (path === undefined) throw new Error(`no path in ${name}`);
      return path;
    };
    expect(pathOf('ProjectsGlyph')).not.toBe(pathOf('SessionGlyph'));
  });

  it('leaves the terminal glyph to the menu row that already spends it', () => {
    // `>_` names "New terminal" inside this heading's own menu. A heading
    // wearing it would announce itself as one of the two things it contains.
    const session = functionSource(sectionSource, 'SessionGlyph');
    expect(session).not.toContain('polyline');
    expect(sidebarSource).toContain('icon: <TerminalGlyph />');
  });

  it('leaves the Link Project button’s own leading icon alone', () => {
    // It shares SECTION_BOX_* with the headings and stacks right under one, so
    // it is the thing most likely to be caught by a change up here. Its glyph
    // is a filled 16-unit Octicon folder and stays that way this pass.
    expect(sidebarSource).toContain(
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">',
    );
    expect(sidebarSource).toContain("{tr('Link Project')}");
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
    // The label now carries a leading glyph. That is decoration on a <span>,
    // not a control: the two lines below are what actually hold the "not a
    // toggle" line, and neither of them moved.
    expect(sidebarSource).toContain(
      "<SidebarSectionLabel icon={<ProjectsGlyph />}>{tr('Projects')}</SidebarSectionLabel>",
    );
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
