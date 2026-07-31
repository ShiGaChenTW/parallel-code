import { describe, expect, it } from 'vitest';
import { createMarkerNav, type MarkerNavTerminal } from './terminalMarkerNav';

/** Minimal stand-in for the parts of xterm this module touches. */
function fakeTerminal() {
  const scrolled: number[] = [];
  let nextLine = 10;
  const registered: { line: number; isDisposed: boolean }[] = [];
  const term: MarkerNavTerminal = {
    registerMarker() {
      const marker = { line: nextLine++, isDisposed: false };
      registered.push(marker);
      return marker;
    },
    scrollToLine(line) {
      scrolled.push(line);
    },
  };
  return { term, scrolled, registered };
}

describe('createMarkerNav', () => {
  it('anchors a key to the line the terminal is on when it is marked', () => {
    const { term, scrolled } = fakeTerminal();
    const nav = createMarkerNav(() => term);
    nav.mark(1);
    nav.mark(2);
    expect(nav.jump(1)).toBe(true);
    expect(nav.jump(2)).toBe(true);
    expect(scrolled).toEqual([10, 11]);
  });

  // Marking twice happens whenever the caller replays a list it has already
  // seen; the first anchor is the real one and must win.
  it('keeps the first anchor when the same key is marked again', () => {
    const { term, scrolled } = fakeTerminal();
    const nav = createMarkerNav(() => term);
    nav.mark(1);
    nav.mark(1);
    nav.jump(1);
    expect(scrolled).toEqual([10]);
  });

  it('reports an unmarked key as not anchored and refuses to jump to it', () => {
    const { term, scrolled } = fakeTerminal();
    const nav = createMarkerNav(() => term);
    expect(nav.isAnchored(99)).toBe(false);
    expect(nav.jump(99)).toBe(false);
    expect(scrolled).toEqual([]);
  });

  // xterm disposes a marker once its line falls off the end of the scrollback.
  // That is the "scrolled out of the buffer" case the UI has to show honestly.
  it('reports a disposed marker as not anchored and refuses to jump to it', () => {
    const { term, scrolled, registered } = fakeTerminal();
    const nav = createMarkerNav(() => term);
    nav.mark(1);
    expect(nav.isAnchored(1)).toBe(true);
    registered[0].isDisposed = true;
    expect(nav.isAnchored(1)).toBe(false);
    expect(nav.jump(1)).toBe(false);
    expect(scrolled).toEqual([]);
  });

  it('is inert before the terminal exists, and marks nothing it cannot anchor', () => {
    const pane: { term?: MarkerNavTerminal } = {};
    const nav = createMarkerNav(() => pane.term);
    nav.mark(1);
    expect(nav.isAnchored(1)).toBe(false);
    expect(nav.jump(1)).toBe(false);
    const fake = fakeTerminal();
    pane.term = fake.term;
    // The key was never anchored, so a later mark still takes effect.
    nav.mark(1);
    expect(nav.jump(1)).toBe(true);
    expect(fake.scrolled).toEqual([10]);
  });

  // registerMarker returns undefined when the buffer cannot host a marker.
  it('does not anchor a key when the terminal declines to register a marker', () => {
    const nav = createMarkerNav(() => ({
      registerMarker: () => undefined,
      scrollToLine: () => {},
    }));
    nav.mark(1);
    expect(nav.isAnchored(1)).toBe(false);
  });
});
