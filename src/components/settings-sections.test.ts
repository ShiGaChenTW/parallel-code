import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { catalogueFor } from '../lib/i18n';

/* The settings dialog's left-hand navigation shipped with nine groups, one of
   which — `terminal` — was a pair of cards about which terminal emulator to
   hand a task to, plus the terminal font picker. `4dacc39` deleted the emulator
   card, and what was left behind was a whole navigation group holding two font
   pickers: "Terminal Font" and the CJK fallback. A group is a promise that its
   contents are a subject of their own; two font pickers are not. They are the
   same subject "Appearance" already covers, one card down from "Text
   rendering", which is the setting for how those same glyphs are drawn.

   So the group is gone and the two cards moved, and this file pins the parts of
   that which are invisible at runtime. Vitest runs with `environment: 'node'`
   and no DOM, so `SettingsDialog.tsx` cannot be imported here at all — these
   read its source, the way `i18n-coverage` and `panel-title-bar-alignment`
   already do. That means they prove where the cards are written, not what they
   look like: nothing here can catch an Appearance panel that now scrolls too
   far to find them, which is a judgement no test makes.

   The one failure mode that is not covered by the type system: `terminal` was a
   member of the `as const` array `SettingsSectionId` is derived from, so every
   stale reference to it is a compile error and `npm run check` finds them. What
   the compiler cannot see is the catalogue — `tr('Terminal')` was the only
   caller of the `Terminal` entry, and nothing goes red when a translation is
   left behind, because `i18n-coverage`'s stranded-entry check only looks at
   sentence-length keys (a short one collides with ordinary source text). Hence
   the last test here. */

const dialog = readFileSync(resolve(__dirname, 'SettingsDialog.tsx'), 'utf8');
const catalogue = catalogueFor('zh-TW');

/** The groups the navigation is supposed to offer, in the order it offers them. */
const SECTIONS = [
  'general',
  'appearance',
  'tasks',
  'ai',
  'privacy',
  'integrations',
  'updates',
  'experimental',
];

/** The section ids listed in the `as const` array the union is derived from. */
function declaredSections(): string[] {
  const block = dialog.match(/const SETTINGS_SECTIONS = \[([^\]]*)\] as const;/);
  expect(block, 'SETTINGS_SECTIONS is no longer a flat literal array').not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Where a section's panel opens in the source, or -1. */
const panelAt = (id: string) => dialog.indexOf(`<Match when={activeSection() === '${id}'}>`);

/** Where a card with this English title is written, or -1. */
const cardAt = (title: string) => dialog.indexOf(`title={tr('${title}')}`);

describe('settings navigation groups', () => {
  it('offers eight groups, with no terminal group among them', () => {
    expect(declaredSections()).toEqual(SECTIONS);
    expect(declaredSections()).not.toContain('terminal');
  });

  it('leaves behind no label and no panel for the group it dropped', () => {
    expect(dialog).not.toContain("case 'terminal':");
    expect(panelAt('terminal')).toBe(-1);
    // Every group that is offered still has both, which is what makes the two
    // absences above a removal rather than a half-finished one.
    for (const id of SECTIONS) {
      expect(dialog, id).toContain(`case '${id}':`);
      expect(panelAt(id), id).toBeGreaterThan(-1);
    }
  });

  it('renders both font cards inside the appearance panel', () => {
    // Bounded by whichever panel opens next, not by `tasks` specifically: the
    // terminal panel used to sit between the two, so a `tasks` bound would call
    // the cards "inside appearance" while they were still in a group of their
    // own. `<Match>` blocks are siblings, so the next one is appearance's end.
    const start = panelAt('appearance');
    const end = dialog.indexOf('<Match when={activeSection() ===', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(end).toBe(panelAt('tasks'));

    for (const marker of [cardAt('Terminal Font'), dialog.indexOf('<CjkFontSection />')]) {
      expect(marker).toBeGreaterThan(start);
      expect(marker).toBeLessThan(end);
    }
  });

  it('files the two font cards with the other type setting, not at the end', () => {
    // Appearance runs from the broadest choice to the narrowest: the theme, then
    // how interface text is drawn, then which face the terminal draws with, then
    // its CJK fallback — after which the subject changes to window chrome (icon,
    // opacity, blur, dimming). Appending the fonts instead would have split the
    // two type settings around four unrelated cards.
    const order = [
      cardAt('Themes'),
      cardAt('Text rendering'),
      cardAt('Terminal Font'),
      dialog.indexOf('<CjkFontSection />'),
      dialog.indexOf('<AppIconSection />'),
    ];
    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('moves the font cards without rewriting them', () => {
    // The card bodies are the same markup, one indent level over. Their copy and
    // their one conditional are the cheapest evidence of that.
    expect(dialog).toContain("description={tr('Font used to draw every terminal panel.')}");
    expect(dialog).toContain('onClick={() => setTerminalFont(font)}');
    expect(dialog).toContain('<Show when={LIGATURE_FONTS.has(store.terminalFont)}>');
    expect(dialog).toContain(
      "{tr('This font includes ligatures which may impact rendering performance.')}",
    );
  });

  it('walks the navigation by list position rather than a fixed count', () => {
    // Home/End and the arrow keys read the array, so dropping a member moves
    // eight buttons instead of nine with nothing else to change. A literal index
    // or count here is how a roving tabindex ends up focusing a button that is
    // no longer rendered.
    expect(dialog).toContain('const count = SETTINGS_SECTIONS.length;');
    expect(dialog).toContain('SETTINGS_SECTIONS.indexOf(from)');
    expect(dialog).toContain('focusSection(SETTINGS_SECTIONS[0])');
    expect(dialog).toContain('focusSection(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1])');

    // The selected group is component state seeded with a literal from the list
    // and only ever reassigned from it — nothing persists it, so no reopened
    // dialog can restore a group that no longer exists.
    expect(dialog).toContain("createSignal<SettingsSectionId>('general')");
  });

  it('drops the translation the removed label was the only caller of', () => {
    expect(dialog).not.toContain("tr('Terminal')");
    expect(Object.keys(catalogue)).not.toContain('Terminal');
    // The labels that remain are still translated — the catalogue lost one
    // entry, not the group of them.
    for (const label of ['Appearance', 'General', 'Tasks', 'Privacy', 'Updates']) {
      expect(catalogue[label], label).toBeTruthy();
    }
  });
});
