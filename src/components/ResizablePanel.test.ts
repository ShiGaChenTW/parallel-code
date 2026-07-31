import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { ResizablePanel, type PanelChild } from './ResizablePanel';
import { getPanelUserSize, setPanelUserSize } from '../store/store';

/**
 * What happens to the other cards when a card is added to or removed from a
 * `ResizablePanel`'s children.
 *
 * Written for the token-usage card, which is a conditional member of both task
 * layout trees: it enters the array when the title-bar toggle is on and leaves
 * when it is off, while its siblings carry user-dragged sizes that must not
 * move. Two separate worries, and the file answers both by rendering the same
 * tree with and without the extra child and comparing what each cell was
 * actually told to be.
 *
 * Reading emitted style attributes rather than asserting on internals is the
 * point: `childStyle` is the whole layout contract, and a cell's flex/size/min
 * triple is exactly what the browser acts on. `environment: 'node'` means SSR
 * output, which carries the inline styles and no effects — so these cover the
 * sizing path, and the stale-pin `createEffect` is covered by the separate
 * store assertions below plus its own guard conditions.
 */

/** Every `.rp-cell`'s inline style, keyed by the text its child rendered. */
function cellStyles(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /class="rp-cell" style="([^"]*)">([^<]*)</g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    out[match[2]] = match[1];
  }
  return out;
}

/** The ids of the cells, in the order they were rendered. */
function cellOrder(html: string): string[] {
  return Object.keys(cellStyles(html));
}

function child(id: string, overrides: Partial<PanelChild> = {}): PanelChild {
  return { id, minSize: 100, content: () => id, ...overrides };
}

function render(children: PanelChild[], persistKey: string, absorberIds: string[]): string {
  return renderToString(() =>
    ResizablePanel({ direction: 'vertical', persistKey, absorberIds, children }),
  );
}

const TOKEN_CARD = child('token-usage', { minSize: 60, maxAutoSize: 'min(200px, 33vh)' });
const NOTES = child('notes', { maxAutoSize: 'min(400px, 33vh)' });
const CHANGED_FILES = child('changed-files', { maxAutoSize: 'min(300px, 33vh)' });
const SHELL = child('shell-section', { minSize: 28 });

describe('persisted sizes across a changing children array', () => {
  it('keys a stored size by child id, so inserting a child cannot shift it', () => {
    const key = 'trap1';
    setPanelUserSize(`${key}:notes`, 220);
    setPanelUserSize(`${key}:changed-files`, 180);

    const without = cellStyles(render([CHANGED_FILES, NOTES, SHELL], key, ['shell-section']));
    const with_ = cellStyles(
      render([TOKEN_CARD, CHANGED_FILES, NOTES, SHELL], key, ['shell-section']),
    );

    // Both siblings keep the exact pixel size they were pinned to, even though
    // each moved down one position in the array.
    expect(without.notes).toContain('flex:0 0 220px');
    expect(without['changed-files']).toContain('flex:0 0 180px');
    expect(with_.notes).toBe(without.notes);
    expect(with_['changed-files']).toBe(without['changed-files']);

    // And the store still holds those two entries, under the same keys.
    expect(getPanelUserSize(`${key}:notes`)).toBe(220);
    expect(getPanelUserSize(`${key}:changed-files`)).toBe(180);
    // The new card was never pinned, so it holds no entry of its own.
    expect(getPanelUserSize(`${key}:token-usage`)).toBeUndefined();
  });

  it('leaves every unpinned sibling identical too', () => {
    const key = 'trap1-unpinned';

    const without = cellStyles(render([CHANGED_FILES, NOTES, SHELL], key, ['shell-section']));
    const with_ = cellStyles(
      render([TOKEN_CARD, CHANGED_FILES, NOTES, SHELL], key, ['shell-section']),
    );

    for (const id of ['changed-files', 'notes', 'shell-section']) {
      expect(with_[id]).toBe(without[id]);
    }
  });
});

describe('a card entering and leaving the children array', () => {
  it('takes its space from the absorber, not from its pinned siblings', () => {
    const key = 'trap2';
    setPanelUserSize(`${key}:notes`, 220);

    const off = cellStyles(render([NOTES, SHELL], key, ['shell-section']));
    const on = cellStyles(render([TOKEN_CARD, NOTES, SHELL], key, ['shell-section']));

    // The absorber keeps `flex: 1 1 0` in both states — it is the only child
    // whose rendered size changes, and it changes by giving up whatever the new
    // content-sized card takes.
    expect(off['shell-section']).toContain('flex:1 1 0');
    expect(on['shell-section']).toBe(off['shell-section']);
    // The pinned card is untouched by the arrival.
    expect(on.notes).toBe(off.notes);
  });

  it('sizes the new card by its content, capped by maxAutoSize', () => {
    const html = render([TOKEN_CARD, NOTES, SHELL], 'trap2-cap', ['shell-section']);

    expect(cellStyles(html)['token-usage']).toBe(
      'flex:0 0 auto;min-height:60px;max-height:min(200px, 33vh);overflow:hidden',
    );
  });

  it('does not change which children absorb', () => {
    // The task trees name their absorbers explicitly rather than relying on the
    // "last child absorbs" default, so a card inserted anywhere — including at
    // the end — cannot promote or demote anything.
    const key = 'trap2-absorbers';
    const before = cellStyles(render([NOTES, SHELL], key, ['shell-section']));
    const appended = cellStyles(render([NOTES, SHELL, TOKEN_CARD], key, ['shell-section']));

    expect(appended['shell-section']).toBe(before['shell-section']);
    expect(appended['token-usage']).toContain('flex:0 0 auto');
  });

  it('restores the previous layout exactly when the card leaves again', () => {
    const key = 'trap2-roundtrip';
    setPanelUserSize(`${key}:notes`, 220);
    setPanelUserSize(`${key}:changed-files`, 180);

    const before = render([CHANGED_FILES, NOTES, SHELL], key, ['shell-section']);
    render([TOKEN_CARD, CHANGED_FILES, NOTES, SHELL], key, ['shell-section']);
    const after = render([CHANGED_FILES, NOTES, SHELL], key, ['shell-section']);

    expect(cellStyles(after)).toEqual(cellStyles(before));
  });
});

describe('the token card in both task layout trees', () => {
  // The stack tree nests notes and changed-files inside one `notes-files` row,
  // so the only position above notes is above that row. The split-right tree
  // stacks them, and the card goes above both so it occupies the same slot in
  // either layout and crossing the split threshold does not shuffle the column.
  const NOTES_FILES = child('notes-files', { minSize: 60, absorberWeight: 0.5 });
  const AI_TERMINAL = child('ai-terminal', { minSize: 80 });

  it('is the first child of the stack tree', () => {
    const html = render([TOKEN_CARD, NOTES_FILES, SHELL, AI_TERMINAL], 'stack', [
      'notes-files',
      'ai-terminal',
    ]);

    expect(cellOrder(html)).toEqual(['token-usage', 'notes-files', 'shell-section', 'ai-terminal']);
  });

  it('is the first child of the split-right tree, above changed files and notes', () => {
    const html = render([TOKEN_CARD, CHANGED_FILES, NOTES, SHELL], 'split-right', [
      'shell-section',
    ]);

    expect(cellOrder(html)).toEqual(['token-usage', 'changed-files', 'notes', 'shell-section']);
  });

  it('keeps both weighted absorbers weighted when it joins the stack tree', () => {
    // `absorberWeight: 0.5` on the notes row is what gives the AI terminal ~2/3
    // of the remaining space. A third card taking content height off the top
    // must not disturb that ratio.
    const key = 'stack-weights';
    const off = cellStyles(
      render([NOTES_FILES, SHELL, AI_TERMINAL], key, ['notes-files', 'ai-terminal']),
    );
    const on = cellStyles(
      render([TOKEN_CARD, NOTES_FILES, SHELL, AI_TERMINAL], key, ['notes-files', 'ai-terminal']),
    );

    expect(off['notes-files']).toContain('flex:0.5 1 0');
    expect(off['ai-terminal']).toContain('flex:1 1 0');
    expect(on['notes-files']).toBe(off['notes-files']);
    expect(on['ai-terminal']).toBe(off['ai-terminal']);
  });
});
