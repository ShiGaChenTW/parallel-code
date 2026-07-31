import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { TaskTokenUsagePanel } from './TaskTokenUsagePanel';

/**
 * The card's chrome, which is the whole point of the change that produced it.
 *
 * The panel used to render as a strip inside the notes card, above its tab
 * strip, and read as the notes card cut in half. It is now a card in its own
 * right, and "a card" in this UI is a specific, checkable structure: the
 * `focusable-panel` class the islands look hangs its border, radius and shadow
 * off; a header row carrying the name and separated by a hairline; and a body
 * that scrolls rather than growing without limit.
 *
 * Numbers and shares are `token-usage-format.ts`'s job and are tested there.
 * This file only pins the frame, because the frame is what regressed.
 */

const html = () => renderToString(() => TaskTokenUsagePanel({ worktreePath: '/tmp/wt' }));

/** The root element's inline style. Asserted non-empty so a regex that stopped
 *  matching fails loudly instead of turning every `not.toContain` below green. */
function rootStyle(): string {
  const style = /^<div[^>]*class="focusable-panel" style="([^"]*)"/.exec(html())?.[1];
  expect(style).toBeTruthy();
  return style ?? '';
}

describe('TaskTokenUsagePanel card chrome', () => {
  it('is a focusable-panel, which is what draws the card border and radius', () => {
    expect(html()).toContain('class="focusable-panel"');
  });

  it('fills its cell rather than shrinking to content', () => {
    // The old strip was `flex-shrink: 0` inside somebody else's column. A card
    // is sized by its ResizablePanel cell and fills it.
    const root = rootStyle();

    expect(root).toContain('height:100%');
    expect(root).not.toContain('flex-shrink:0');
  });

  it('no longer draws the bottom hairline it used to separate itself with', () => {
    // Inside the notes card the strip drew its own bottom border to fake a
    // seam. Between cards that seam is the resize handle's, and a leftover
    // border reads as a doubled line.
    const root = /^<div[^>]*class="focusable-panel" style="([^"]*)"/.exec(html())?.[1] ?? '';

    expect(root).not.toContain('border-bottom');
  });

  it('carries its name in a header row, like the sibling cards', () => {
    expect(html()).toContain('Token Usage');
  });

  it('puts the headline total in the header instead of a second label row', () => {
    const markup = html();

    // The label the total used to sit under is gone — the card header says it.
    expect(markup).not.toContain('Tokens in this worktree');
    // And the header's uppercase does not reach the number, so `842k` cannot
    // come out as `842K`.
    expect(markup).toContain('text-transform:none');
  });

  it('scrolls its body rather than growing past its cell', () => {
    expect(html()).toContain('overflow:auto');
  });

  it('still renders the empty state, the footnote and the four kinds', () => {
    const markup = html();

    expect(markup).toContain('No AI CLI usage has been recorded for this worktree yet.');
    expect(markup).toContain('Counts only this task. The Settings table covers every worktree.');
  });
});
