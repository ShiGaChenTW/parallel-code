import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

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
   radius. These tests pin the shared metric that replaced both literals, and
   the arithmetic downstream of it that a future change would otherwise break
   silently. */

const dir = (name: string) => resolve(__dirname, name);
const terminalPanel = readFileSync(dir('TerminalPanel.tsx'), 'utf8');
const taskPanel = readFileSync(dir('TaskPanel.tsx'), 'utf8');
const currentStateLine = readFileSync(dir('TaskCurrentStateLine.tsx'), 'utf8');
const tilingLayout = readFileSync(dir('TilingLayout.tsx'), 'utf8');
const panelChrome = readFileSync(resolve(__dirname, '../lib/panelChrome.ts'), 'utf8');

/** The metric both title bars are supposed to read instead of a literal. */
const SHARED_CONST = 'PANEL_TITLE_BAR_HEIGHT_PX';

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
    for (const [name, source] of [
      ['TerminalPanel', terminalPanel],
      ['TaskPanel', taskPanel],
    ] as const) {
      expect(source, name).toContain(`import { ${SHARED_CONST} } from '../lib/panelChrome'`);
    }

    // TerminalPanel sets the bar directly; TaskPanel sizes the cell it fills.
    expect(terminalPanel).toContain(`height: \`\${${SHARED_CONST}}px\``);
    expect(terminalPanel).toContain(`'min-height': \`\${${SHARED_CONST}}px\``);
    expect(taskPanel).toContain(`flex: \`0 0 \${${SHARED_CONST}}px\``);
  });

  it('settles on the task panel height, not the terminal panel one', () => {
    // Same direction of travel as the card radius in d2e26df: the task panel is
    // the reference, and the terminal panel is what moves to meet it. 50 also
    // has the older claim — it predates the terminal panel's 36 by three days.
    expect(sharedTitleBarHeight()).toBe(50);
  });

  it('leaves no stray copy of either old literal in the two title bars', () => {
    // A leftover 36 anywhere in the terminal panel's chrome would mean some
    // part of the bar is still sized independently of the shared metric.
    expect(terminalPanel).not.toContain(`'36px'`);
    expect(taskPanel).not.toContain(`flex: '0 0 50px'`);
  });

  it('keeps the task panel header stack equal to the rows it contains', () => {
    // The stack is a fixed total, and the title bar is its first row. Nothing
    // in TaskPanel derives that total, so raising the shared height without
    // raising the total would crop the bottom row against `overflow: hidden`
    // instead of growing the header. This is the test that says so out loud.
    const stack = taskPanel.match(/stepsEnabled \? (\d+) : (\d+)\}px/);
    expect(stack).not.toBeNull();
    const withSteps = Number(stack?.[1]);
    const withoutSteps = Number(stack?.[2]);

    const branch = taskPanel.match(
      /flex: '0 0 (\d+)px', overflow: 'hidden' \}\}>\s*<TaskBranchInfoBar/,
    );
    expect(branch).not.toBeNull();
    const branchHeight = Number(branch?.[1]);

    const steps = currentStateLine.match(/height: props\.variant === 'card' \? '(\d+)px'/);
    expect(steps).not.toBeNull();
    const stepsHeight = Number(steps?.[1]);

    expect(withoutSteps).toBe(sharedTitleBarHeight() + branchHeight);
    expect(withSteps).toBe(sharedTitleBarHeight() + stepsHeight + branchHeight);
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
