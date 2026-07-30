/**
 * Tab-selection state machine for the Notes panel.
 *
 * Lives outside TaskNotesBody.tsx because vitest runs `environment: 'node'`:
 * logic left inside a Solid component cannot be tested. The component computes
 * availability (folding in `store.showPlans`) and renders; every decision about
 * *which* tab should be showing is made here.
 */

export type NotesTab = 'notes' | 'plan' | 'handoff';

/** Which optional tabs currently have content behind them. */
export interface NotesTabAvailability {
  plan: boolean;
  handoff: boolean;
}

/** Tabs to render, in display order. `notes` is always present. */
export function visibleNotesTabs(availability: NotesTabAvailability): NotesTab[] {
  const tabs: NotesTab[] = ['notes'];
  if (availability.plan) tabs.push('plan');
  if (availability.handoff) tabs.push('handoff');
  return tabs;
}

/**
 * Resolves the tab to show after an availability change.
 *
 * Two rules, both inherited from the plan tab's original behaviour:
 *  - content that *newly* appears takes focus (it is the event worth seeing);
 *  - content that disappears out from under the active tab falls back to notes.
 *
 * Plan wins a simultaneous appearance purely so the pre-existing single-tab
 * behaviour is reproduced verbatim rather than approximately.
 */
export function nextNotesTab(args: {
  current: NotesTab;
  previous: NotesTabAvailability;
  next: NotesTabAvailability;
}): NotesTab {
  const { current, previous, next } = args;

  if (!previous.plan && next.plan) return 'plan';
  if (!previous.handoff && next.handoff) return 'handoff';

  if (current === 'plan' && !next.plan) return 'notes';
  if (current === 'handoff' && !next.handoff) return 'notes';

  return current;
}
