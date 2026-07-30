/**
 * Tab-selection state machine for the Notes panel.
 *
 * Lives outside TaskNotesBody.tsx because vitest runs `environment: 'node'`:
 * logic left inside a Solid component cannot be tested. The component computes
 * availability (folding in `store.showPlans`) and renders; every decision about
 * *which* tab should be showing is made here.
 */

export type NotesTab = 'notes' | 'plan' | 'handoff' | 'timeline';

/** Which optional tabs currently have content behind them. */
export interface NotesTabAvailability {
  plan: boolean;
  handoff: boolean;
  /**
   * The session transcript tab. Optional so the two content-driven tabs keep
   * their exact prior shape at every existing call site — and because this one
   * is not content-driven at all: it tracks a settings switch, not a file
   * appearing. That difference is why it never auto-steals focus below.
   */
  timeline?: boolean;
}

/** Tabs to render, in display order. `notes` is always present. */
export function visibleNotesTabs(availability: NotesTabAvailability): NotesTab[] {
  const tabs: NotesTab[] = ['notes'];
  if (availability.plan) tabs.push('plan');
  if (availability.handoff) tabs.push('handoff');
  if (availability.timeline) tabs.push('timeline');
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
 *
 * Timeline is the deliberate exception to the first rule. It appears because
 * the user turned a setting on, not because a task produced something — so
 * pulling every open task's panel onto it the moment the switch flips would be
 * the app shouting about its own configuration change. It still obeys the
 * second rule: switching recording off must not strand you on a dead tab.
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
  if (current === 'timeline' && !next.timeline) return 'notes';

  return current;
}
