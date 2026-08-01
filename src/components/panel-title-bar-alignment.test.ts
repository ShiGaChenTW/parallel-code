import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_TITLE_BAR_HEIGHT_PX,
  TASK_BRANCH_BAR_HEIGHT_PX,
  TASK_STEPS_LINE_HEIGHT_PX,
  taskHeaderStackHeightPx,
} from '../lib/panelChrome';

/* `TilingLayout` lays its children out in identical cells, side by side, and
   two of those children open with a title bar: `TaskPanel` (via
   `TaskTitleBar`) and `TerminalPanel`. Because both bars are the first row
   inside the same `.task-column` card and both close with a 1px
   `border-bottom`, their seams read as one continuous line across the strip
   only while the two agree on a height.

   They did not agree. The task panel has carried 50 since 3ff6cc6 (17 Feb
   2026); the standalone terminal panel shipped three days later in d7b180b
   with its own 36. Neither literal referred to the other, so the 14px step
   between the cards survived every later pass over both files — including
   d2e26df/abadf2c, which had just finished making the two cards share a
   radius. These tests pin the shared metric that replaced both literals, the
   measurement the metric's value now comes from, and the fact that everything
   downstream of it is derived rather than restated. */

const dir = (name: string) => resolve(__dirname, name);
const terminalPanel = readFileSync(dir('TerminalPanel.tsx'), 'utf8');
const taskPanel = readFileSync(dir('TaskPanel.tsx'), 'utf8');
const taskTitleBar = readFileSync(dir('TaskTitleBar.tsx'), 'utf8');
const iconButton = readFileSync(dir('IconButton.tsx'), 'utf8');
const currentStateLine = readFileSync(dir('TaskCurrentStateLine.tsx'), 'utf8');
const tilingLayout = readFileSync(dir('TilingLayout.tsx'), 'utf8');
const panelChrome = readFileSync(resolve(__dirname, '../lib/panelChrome.ts'), 'utf8');

/** The metric both title bars are supposed to read instead of a literal. */
const SHARED_CONST = 'PANEL_TITLE_BAR_HEIGHT_PX';

/** The box every icon in either title bar is drawn in. */
const ICON_BOX_PX = 16;

/** Space kept above and below the tallest control, matching the row's own gap. */
const CONTROL_CLEARANCE_PX = 8;

/** The value that metric holds, read from its own module. */
function sharedTitleBarHeight(): number {
  const match = panelChrome.match(new RegExp(`export const ${SHARED_CONST} = (\\d+);`));
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe('panel title bar alignment', () => {
  it('gives both side-by-side panel kinds one title-bar height to read', () => {
    // The point of the change: one number, one place, two importers. A local
    // literal in either file is how the two drifted apart the first time.
    // Matched as a named import rather than a whole line: TaskPanel now takes
    // three metrics from the module, so prettier wraps the clause.
    const sharedImport = new RegExp(
      `import \\{[^}]*\\b${SHARED_CONST}\\b[^}]*\\} from '\\.\\./lib/panelChrome'`,
    );
    for (const [name, source] of [
      ['TerminalPanel', terminalPanel],
      ['TaskPanel', taskPanel],
    ] as const) {
      expect(source, name).toMatch(sharedImport);
    }

    // TerminalPanel sets the bar directly; TaskPanel sizes the cell it fills.
    expect(terminalPanel).toContain(`height: \`\${${SHARED_CONST}}px\``);
    expect(terminalPanel).toContain(`'min-height': \`\${${SHARED_CONST}}px\``);
    expect(taskPanel).toContain(`flex: \`0 0 \${${SHARED_CONST}}px\``);
  });

  it('settles on a height measured from the tallest control the bars carry', () => {
    // The alignment pass picked the task panel's 50 over the terminal panel's
    // 36 because 50 was the older literal — the right direction of travel, but
    // neither number had ever been measured against what the bars hold, and 50
    // turned out to be thick. This is that measurement.
    //
    // The tallest item in either bar is an `IconButton`: a 16px icon box in
    // 4px of padding inside a 1px border, so 26px. Nothing else comes close —
    // an 8px `StatusDot`, a ~20px badge, the 14px title, and the ~25px edit
    // input the title turns into. 42 is that 26 with 8px of clearance above
    // and below, and 8px is not invented: it is the gap the row already keeps
    // between its own items, so the bar breathes at the rhythm it already has.
    expect(sharedTitleBarHeight()).toBe(42);
    expect(PANEL_TITLE_BAR_HEIGHT_PX).toBe(sharedTitleBarHeight());
  });

  it('keeps the height equal to the control it was measured from', () => {
    // The derivation above is only true while its inputs are. Read them back
    // out of the control itself, so moving `IconButton`'s padding or border
    // lands here rather than silently eating the bar's clearance.
    const padding = iconButton.match(/padding: isSm\(\) \? '\d+px' : '(\d+)px'/);
    expect(padding).not.toBeNull();
    const border = iconButton.match(/border: `(\d+)px solid/);
    expect(border).not.toBeNull();

    // Every icon in either bar fits the 16px box the height was measured
    // against; the 8px and 9px glyphs are badge overlays, never the control.
    const iconWidths = [...taskTitleBar.matchAll(/width="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...iconWidths)).toBe(ICON_BOX_PX);

    const control = ICON_BOX_PX + 2 * Number(padding?.[1]) + 2 * Number(border?.[1]);
    expect(sharedTitleBarHeight()).toBe(control + 2 * CONTROL_CLEARANCE_PX);

    // The clearance is also what keeps the count badges the prompt-history and
    // push buttons hang below themselves from being cropped: the header stack
    // clips with `overflow: hidden`, so anything past the bar's own edge is
    // gone rather than merely tight.
    const overhangs = [...taskTitleBar.matchAll(/bottom: '-(\d+)px'/g)].map((m) => Number(m[1]));
    expect(overhangs.length).toBeGreaterThan(0);
    expect(CONTROL_CLEARANCE_PX).toBeGreaterThan(Math.max(...overhangs));
  });

  it('leaves no stray copy of either old literal in the two title bars', () => {
    // A leftover 36 anywhere in the terminal panel's chrome would mean some
    // part of the bar is still sized independently of the shared metric.
    expect(terminalPanel).not.toContain(`'36px'`);
    expect(taskPanel).not.toContain(`flex: '0 0 50px'`);
  });

  it('derives the task panel header stack from the rows it contains', () => {
    // The stack is a fixed total and the title bar is its first row, so a
    // shared height that moves without the total cropping the bottom row
    // against `overflow: hidden`. The previous pass left the total as two
    // literals and pinned the arithmetic here instead, on the argument that a
    // loud test beats a silent crop. It was loud, on the very next change —
    // and the fix was still arithmetic done by hand. Twice is a pattern, so
    // the sum now lives with the metrics it sums and this test checks that it
    // is the one being used rather than restating it.
    expect(taskPanel).toContain(
      'flex: `0 0 ${taskHeaderStackHeightPx(props.task.stepsEnabled)}px`',
    );
    expect(taskPanel).not.toMatch(/stepsEnabled \? \d+ : \d+\}px/);

    // Each row reads back the same metric it contributes, so no row can grow
    // on its own — which is what made the hand-summed total wrong in the first
    // place.
    expect(taskPanel).toContain(`flex: \`0 0 \${TASK_BRANCH_BAR_HEIGHT_PX}px\``);
    expect(taskPanel).not.toMatch(
      /flex: '0 0 \d+px', overflow: 'hidden' \}\}>\s*<TaskBranchInfoBar/,
    );
    expect(currentStateLine).toContain('${TASK_STEPS_LINE_HEIGHT_PX}px');
    expect(currentStateLine).not.toMatch(/height: props\.variant === 'card' \? '\d+px'/);

    // And the sum is those three rows, in both shapes the card has.
    expect(taskHeaderStackHeightPx(false)).toBe(
      PANEL_TITLE_BAR_HEIGHT_PX + TASK_BRANCH_BAR_HEIGHT_PX,
    );
    expect(taskHeaderStackHeightPx(true)).toBe(
      PANEL_TITLE_BAR_HEIGHT_PX + TASK_STEPS_LINE_HEIGHT_PX + TASK_BRANCH_BAR_HEIGHT_PX,
    );
    // `stepsEnabled` is optional on the task, and absent means off.
    expect(taskHeaderStackHeightPx(undefined)).toBe(taskHeaderStackHeightPx(false));
  });

  it('accounts for every panel kind the tiling strip can put in a row', () => {
    // Aligning two of three would just move the ragged edge. The third child,
    // NewTaskPlaceholder, is a 48px rail of two dashed buttons with no title
    // bar and no card — nothing to align — and the Arena is an overlay mounted
    // from App.tsx, never a sibling in this strip. If a fourth panel kind ever
    // joins the layout, this is where someone has to decide which it is.
    const rendered = ['TaskPanel', 'TerminalPanel', 'NewTaskPlaceholder'];
    for (const name of rendered) {
      expect(tilingLayout, name).toContain(`import { ${name} } from './${name}'`);
    }
    const panelImports = [...tilingLayout.matchAll(/import \{ (\w+Panel|\w+Placeholder) \}/g)].map(
      (m) => m[1],
    );
    expect(panelImports.sort()).toEqual([...rendered].sort());

    // `island-header-active` is the marker every draggable title bar carries.
    // The placeholder has none, which is why it is exempt rather than missed.
    const placeholder = readFileSync(dir('NewTaskPlaceholder.tsx'), 'utf8');
    expect(placeholder).not.toContain('island-header-active');
    expect(placeholder).not.toContain(SHARED_CONST);
  });
});
