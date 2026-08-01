import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

/* The standalone terminal panel shipped square (`border-radius: '0'`) while the
   task panel shipped as a 12px card. Both render the same `.task-column` class
   into the same tiling cell, so the square corners were not a layout
   requirement — they were a deliberate authoring choice ("no border radius" is
   listed in d7b180b's commit body) with one real consequence attached to it,
   which these tests pin down.

   The consequence is the focus ring. `.focusable-panel:focus-within::after` in
   styles.css draws itself with `border-radius: inherit`. In TaskPanel every
   `.focusable-panel` is buried inside resizable cells that carry no radius, so
   `inherit` resolves to 0 and the ring is square. In TerminalPanel the
   focusable panel is a *direct child* of the rounded root, so `inherit` would
   resolve to the root's radius and paint rounded top corners in the middle of
   the panel, right under the flat title-bar seam. Rounding the card therefore
   requires pinning that ring's radius explicitly. */

const terminalPanel = readFileSync(resolve(__dirname, 'TerminalPanel.tsx'), 'utf8');
const taskPanel = readFileSync(resolve(__dirname, 'TaskPanel.tsx'), 'utf8');
const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

/** The card radius both panels paint on their `.task-column` root. */
const CARD_RADIUS_PX = 12;
/** The 1px frame the root draws; the clip curve is inset by exactly this. */
const CARD_BORDER_PX = 1;
/** Radius of the padding box the root's `overflow: clip` actually cuts against. */
const INNER_RADIUS_PX = CARD_RADIUS_PX - CARD_BORDER_PX;

/** The style object literal on the `.task-column` root of a panel component. */
function rootStyle(source: string): string {
  const classIdx = source.indexOf('class={`task-column');
  expect(classIdx).toBeGreaterThan(-1);
  const start = source.indexOf('style={{', classIdx);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('}}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** The style object literal on TerminalPanel's `.focusable-panel` wrapper. */
function terminalFocusableStyle(): string {
  const classIdx = terminalPanel.indexOf(`class="focusable-panel"`);
  expect(classIdx).toBeGreaterThan(-1);
  const start = terminalPanel.indexOf('style={{', classIdx);
  expect(start).toBeGreaterThan(-1);
  const end = terminalPanel.indexOf('}}', start);
  expect(end).toBeGreaterThan(start);
  return terminalPanel.slice(start, end);
}

/** Every rule whose selectors all target `.task-column` itself, comments stripped. */
function taskColumnRules(): { selectors: string[]; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selectors: string[]; body: string }[] = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped))) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!selectors.length) continue;
    if (!selectors.every((s) => /\.task-column(\.active|\.focus-mode)?$/.test(s))) continue;
    rules.push({ selectors, body: match[2] });
  }
  return rules;
}

describe('standalone terminal panel card', () => {
  it('wears the same card radius as the task panel', () => {
    // The whole point of the change: one card shape for both panel kinds.
    expect(rootStyle(terminalPanel)).toContain(`'border-radius': '${CARD_RADIUS_PX}px'`);
    expect(rootStyle(terminalPanel)).not.toContain(`'border-radius': '0'`);
  });

  it('keeps the clip and the frame so the card edge stays one closed shape', () => {
    // `overflow: clip` is what makes the radius cut the terminal rather than
    // let it square off the corners it is painted into.
    const style = rootStyle(terminalPanel);
    expect(style).toContain(`overflow: 'clip'`);
    expect(style).toContain('border: `1px solid ${theme.border}`');
  });

  it('pins the focus ring radius instead of letting it inherit the card curve', () => {
    // Square at the top (the ring's top edge is the title-bar seam, mid-panel),
    // curved at the bottom (where it meets the card's own clip).
    expect(terminalFocusableStyle()).toContain(
      `'border-radius': '0 0 ${INNER_RADIUS_PX}px ${INNER_RADIUS_PX}px'`,
    );
  });

  it('derives the focus ring curve from the card radius minus the frame', () => {
    // `overflow` clips against the padding box, whose corner radius is the
    // border-box radius less the border width. Anything else leaves the ring
    // either poking through the corner or floating inside it.
    expect(INNER_RADIUS_PX).toBe(11);
    const ring = terminalFocusableStyle().match(/'border-radius': '0 0 (\d+)px (\d+)px'/);
    expect(ring).not.toBeNull();
    expect(Number(ring?.[1])).toBe(CARD_RADIUS_PX - CARD_BORDER_PX);
    expect(Number(ring?.[2])).toBe(CARD_RADIUS_PX - CARD_BORDER_PX);
  });

  it('leaves the task panel as the reference card it already was', () => {
    // The terminal panel moved to meet the task panel, never the other way.
    expect(rootStyle(taskPanel)).toContain(`'border-radius': '${CARD_RADIUS_PX}px'`);
  });

  it('lets only the workbench look square the card off', () => {
    // 11 looks ship. If any other one started overriding `.task-column`'s
    // radius, the two panels could drift apart again under that look alone.
    const withRadius = taskColumnRules().filter((r) => /border-radius/.test(r.body));
    expect(withRadius).toHaveLength(1);
    expect(withRadius[0].selectors).toEqual(["html[data-look='workbench'] .task-column"]);
    expect(withRadius[0].body).toMatch(/border-radius:\s*0 !important/);
  });

  it('keeps translucency compositing inside the rounded card', () => {
    // d0cb2f5 moved surface alpha onto `.task-column` itself. Because the mix
    // paints that element's own background, the radius clips it with the frame
    // and the corner cut-outs fall through to the `#root::before` veil rather
    // than to a hard-edged rectangle of panel colour.
    expect(css).toMatch(/html\[data-window-blur\] \.task-column \{\s*background: color-mix\(/);
  });

  it('introduces no hardcoded colour into the terminal panel chrome', () => {
    // Every surface here has to keep coming from the theme, across all looks.
    expect(terminalPanel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(terminalPanel).not.toMatch(/\brgba?\(/);
  });

  it('does not buy the corners by re-padding the shared terminal view', () => {
    // TerminalView is shared with in-task shells and agent terminals; changing
    // its container padding to clear the curve would resize every terminal in
    // the app, not just the standalone panel.
    const view = readFileSync(resolve(__dirname, 'TerminalView.tsx'), 'utf8');
    expect(view).toContain(`padding: '4px 0 0 4px'`);
  });
});
