import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { catalogueFor } from '../lib/i18n';
import { SettingsCard } from './SettingsCard';
import { SpecgateOption } from './CreateProjectDialog';

/* The S.CodingFlow group in the New Project dialog was a bare checkbox followed
   by one 11px grey sentence that said three things at once — what the command
   adds, that it overwrites nothing, and what happens when the CLI is absent. It
   is now a card with a title, a one-line summary, and a button that opens the
   long form in its own panel.

   Two of those changes are the kind that break quietly, so they are pinned here.

   The first is structural. The old block was a single `<label>`, which meant
   every click anywhere in it toggled the checkbox. Adding a button inside that
   label would have made "read the explanation" also mean "change the setting",
   and it would have looked completely fine in review. The button is therefore a
   sibling of the label rather than a descendant, and the ordering test below is
   what stops a later refactor from folding it back in.

   The second is visual reuse. The card is the shared `SettingsCard`, not a
   second card built to match by eye, so the two cannot drift apart.

   Vitest runs with `environment: 'node'` and `solidPlugin({ ssr: true })`, so
   these render real markup with no layout engine — the same ceiling
   `extracted-components.test.ts` works under. They prove what is emitted, not
   what it looks like. Nothing here can catch a card whose contrast fails on one
   of the twelve themes, a button that wraps at a narrow width, or a panel that
   opens off-screen. Those were not verified. */

const source = readFileSync(resolve(__dirname, 'CreateProjectDialog.tsx'), 'utf8');
const catalogue = catalogueFor('zh-TW');

const renderOption = (over: Partial<Parameters<typeof SpecgateOption>[0]> = {}) =>
  renderToString(() =>
    SpecgateOption({
      checked: true,
      disabled: false,
      infoOpen: false,
      onChange: vi.fn(),
      onShowInfo: vi.fn(),
      ...over,
    }),
  );

describe('S.CodingFlow option row', () => {
  it('closes the label before the details button opens, so the button is not a label descendant', () => {
    const html = renderOption();
    const labelClose = html.indexOf('</label>');
    const buttonOpen = html.indexOf('<button');

    expect(labelClose, 'no </label> in the row').toBeGreaterThan(-1);
    expect(buttonOpen, 'no <button> in the row').toBeGreaterThan(-1);
    // The whole safety property in one assertion: a `<label>` only activates
    // its control for clicks inside it, so a button written after the closing
    // tag cannot toggle the checkbox no matter what any handler does.
    expect(buttonOpen).toBeGreaterThan(labelClose);
  });

  it('keeps the checkbox inside the label, so the text is still a click target for it', () => {
    const html = renderOption();
    expect(html.indexOf('type="checkbox"')).toBeLessThan(html.indexOf('</label>'));
    // One label, not one per child — two would mean the row had been split in a
    // way that puts the button inside the second.
    expect(html.match(/<label/g)).toHaveLength(1);
  });

  it('carries no `stopPropagation`, because the structure is what does the work', () => {
    // If this ever fails, the row was rearranged so that suppression became
    // necessary. That is allowed — but the comment on `SpecgateOption` and the
    // ordering test above both describe a different design, so both have to be
    // rewritten with it rather than left claiming something untrue.
    const row = source.slice(
      source.indexOf('export function SpecgateOption'),
      source.indexOf('One dialog for both new ways'),
    );
    expect(row).not.toContain('stopPropagation');
    expect(row).not.toContain('preventDefault');
  });

  it('reflects checked and disabled state', () => {
    expect(renderOption({ checked: true })).toContain('checked');
    expect(renderOption({ checked: false, disabled: true })).toContain('disabled');
  });

  it('announces the details button as opening a dialog', () => {
    expect(renderOption()).toContain('aria-haspopup="dialog"');
    expect(renderOption({ infoOpen: true })).toContain('aria-expanded');
  });

  it('paints from theme tokens, never a literal colour', () => {
    const html = renderOption();
    // Twelve themes ship, so a literal here is a row that is legible on the one
    // it was picked against and invisible on at least one other.
    expect(html).not.toMatch(/(?:color|background|border-color):\s*#[0-9a-f]{3,8}/i);
    expect(html).not.toMatch(/(?:color|background|border-color):\s*(?:rgba?|hsla?)\(/i);
    expect(html).toContain('var(--');
  });
});

describe('S.CodingFlow card', () => {
  it('is the shared SettingsCard, so it cannot drift from the settings cards', () => {
    // Imported from the leaf module rather than from `SettingsDialog`, which is
    // `lazy()` while this dialog is eager — importing across that line would
    // pull the whole settings module into the renderer entry chunk that
    // `check-bundle-size.mjs` budgets.
    expect(source).toContain("from './SettingsCard'");
    expect(source).toContain('<SettingsCard');

    const html = renderToString(() =>
      SettingsCard({ title: 'S.CodingFlow', description: 'Summary', children: 'Body' }),
    );
    expect(html).toContain('border-radius:12px');
    expect(html).toContain('color-mix(in srgb, var(--fg) 4%, var(--island-bg))');
    expect(html).toContain('S.CodingFlow');
  });
});

describe('S.CodingFlow explainer panel', () => {
  it('reuses Dialog, which is what supplies Escape, the focus trap and focus restore', () => {
    // Not `ConfirmDialog`: the panel asks nothing, so a confirm/cancel pair
    // would be two buttons for a decision that does not exist.
    expect(source).toContain('<Dialog');
    expect(source).toContain('open={showSpecgateInfo()}');
  });

  it('stacks above the create dialog, whose own default is 1000', () => {
    const z = source.match(/zIndex=\{(\d+)\}/);
    expect(z, 'the explainer no longer sets an explicit z-index').not.toBeNull();
    expect(Number(z?.[1])).toBeGreaterThan(1000);
  });

  it('resets when the create dialog is reopened', () => {
    // The component mounts once for the life of the app, so a panel left open
    // at dismissal would still be open the next time the dialog is reached.
    expect(source).toContain('setShowSpecgateInfo(false)');
  });

  it('moved the three-in-one sentence out of the checkbox and left nothing behind', () => {
    const stranded =
      'Runs `scvb-specgate init`, which adds openspec/, PRD.md and facet-brief.md. ' +
      'Nothing is overwritten. Skipped with a note if the CLI is not installed.';
    expect(source).not.toContain(stranded);
    // `i18n-coverage`'s stranded-entry check covers this too; naming it here
    // records that the removal was deliberate rather than incidental.
    expect(catalogue).not.toHaveProperty(stranded);
  });

  it('translates every sentence it adds, as a whole sentence', () => {
    const added = [
      'Sets the new folder up as a spec-driven project before you start work.',
      'What this does',
      'About S.CodingFlow',
      'What it runs',
      'Runs `scvb-specgate init` once, with the new folder as its working directory. Nothing else is run.',
      'What it adds',
      'Seven template items: an `openspec/` folder holding its config, the gate profiles, and empty `specs/` and `changes/` directories — plus `PRD.md` and `facet-brief.md` in the new folder itself.',
      'What it leaves alone',
      'The command is idempotent: anything already there is skipped, never overwritten or merged. `setup` and `doctor` are deliberately not run, so your agent hooks and `.claude/settings.json` are untouched.',
      'What is still yours to do',
      'The PRD template ships with its Non-Goals left blank on purpose, so S.CodingFlow keeps blocking until you fill them in. That is the scaffold working, not a fault.',
      'If the CLI is missing',
      'Nothing fails. The folder is still created and the project is still added — you get a note saying the step was skipped. Install `scvb-specgate`, or relaunch Parallel Code from a terminal so it inherits your shell PATH.',
    ];

    for (const key of added) {
      expect(source, `${key} is not rendered through tr()`).toContain(key);
      expect(catalogue, `${key} has no zh-TW translation`).toHaveProperty(key);
    }
  });
});
