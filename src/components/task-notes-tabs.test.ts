// Tab-selection state machine for the Notes / Plan / Handoff strip.
//
// Extracted from TaskNotesBody so it can be tested at all: vitest runs
// `environment: 'node'` with no DOM harness, so anything left inside the
// component is unreachable. The component keeps only the reactive plumbing.

import { describe, expect, it } from 'vitest';
import { nextNotesTab, visibleNotesTabs, type NotesTabAvailability } from './task-notes-tabs';

const NONE: NotesTabAvailability = { plan: false, handoff: false };
const PLAN: NotesTabAvailability = { plan: true, handoff: false };
const HANDOFF: NotesTabAvailability = { plan: false, handoff: true };
const BOTH: NotesTabAvailability = { plan: true, handoff: true };

describe('visibleNotesTabs', () => {
  it('shows notes alone when there is nothing else to show', () => {
    // The tab strip is hidden entirely in this case — a lone tab is noise.
    expect(visibleNotesTabs(NONE)).toEqual(['notes']);
  });

  it('adds each available tab in a stable left-to-right order', () => {
    expect(visibleNotesTabs(PLAN)).toEqual(['notes', 'plan']);
    expect(visibleNotesTabs(HANDOFF)).toEqual(['notes', 'handoff']);
    expect(visibleNotesTabs(BOTH)).toEqual(['notes', 'plan', 'handoff']);
  });
});

describe('nextNotesTab — preserved plan behaviour', () => {
  it('switches to plan the moment plan content first appears', () => {
    expect(nextNotesTab({ current: 'notes', previous: NONE, next: PLAN })).toBe('plan');
  });

  it('falls back to notes when the plan disappears', () => {
    expect(nextNotesTab({ current: 'plan', previous: PLAN, next: NONE })).toBe('notes');
  });

  it('does not re-steal focus while the plan merely updates', () => {
    // The agent rewriting plan.md must not yank the user off the notes tab.
    expect(nextNotesTab({ current: 'notes', previous: PLAN, next: PLAN })).toBe('notes');
  });
});

describe('nextNotesTab — handoff', () => {
  it('switches to handoff the moment a handoff file first appears', () => {
    expect(nextNotesTab({ current: 'notes', previous: NONE, next: HANDOFF })).toBe('handoff');
  });

  it('falls back to notes when the handoff file is deleted or emptied', () => {
    expect(nextNotesTab({ current: 'handoff', previous: HANDOFF, next: NONE })).toBe('notes');
  });

  it('does not re-steal focus while the handoff merely updates', () => {
    expect(nextNotesTab({ current: 'notes', previous: HANDOFF, next: HANDOFF })).toBe('notes');
  });

  it('leaves the handoff tab alone when an unrelated plan disappears', () => {
    expect(nextNotesTab({ current: 'handoff', previous: BOTH, next: HANDOFF })).toBe('handoff');
  });

  it('prefers plan when both appear in the same update, keeping old behaviour exact', () => {
    expect(nextNotesTab({ current: 'notes', previous: NONE, next: BOTH })).toBe('plan');
  });

  it('switches to handoff when it appears alongside an already-present plan', () => {
    expect(nextNotesTab({ current: 'plan', previous: PLAN, next: BOTH })).toBe('handoff');
  });

  it('is idempotent when nothing changed', () => {
    for (const current of ['notes', 'plan', 'handoff'] as const) {
      const availability = BOTH;
      expect(nextNotesTab({ current, previous: availability, next: availability })).toBe(current);
    }
  });
});
