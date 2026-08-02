import type { JSX } from 'solid-js';

import { theme, sectionLabelStyle } from '../lib/theme';

/**
 * A group of related settings, drawn as a card.
 *
 * Was `SettingsSection` — a bold label with children stacked under it, which put
 * every group on the same visual plane as the controls inside it. Nine groups
 * rendered that way read as one undifferentiated column, which is what made the
 * old General tab a 600-line scroll nobody could navigate.
 *
 * `description` is not decoration and is not optional. A group name alone
 * ("Behavior", "Privacy") says which drawer something lives in, not what it
 * does; the sentence is where a reader finds out whether this is the card they
 * want before reading seven checkboxes. Every one of them is derived from the
 * code the card controls — an invented description is worse than none, because
 * the reader has no way to tell the two apart.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * It lived inside `SettingsDialog.tsx` until `CreateProjectDialog` needed the
 * same shape for its S.CodingFlow group. It could not simply be exported from
 * there: `SettingsDialog` is `lazy()`-imported by `App.tsx`, while
 * `CreateProjectDialog` is reached through the eagerly-imported
 * `AddProjectFlow`, so one import across that line would have pulled the whole
 * 1,700-line settings module into the renderer entry chunk that
 * `check-bundle-size.mjs` budgets. A leaf module both sides import costs the
 * entry chunk this file and nothing else.
 *
 * The alternative — a second card built to match by eye in
 * `CreateProjectDialog` — is what this file exists to prevent. Two hand-matched
 * cards drift on the first change to either, and the drift shows up as one
 * dialog looking a version behind the other.
 */
export function SettingsCard(props: {
  title: string;
  description: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '10px',
        padding: '14px 16px',
        // Derived from the dialog's own background rather than picked from the
        // token list: `--bg-elevated` and `--bg-input` are the same colour in
        // some presets, which would make the card and the rows inside it one
        // flat rectangle. A mix against `--island-bg` is a card in every theme.
        background: 'color-mix(in srgb, var(--fg) 4%, var(--island-bg))',
        border: `1px solid ${theme.borderSubtle}`,
        'border-radius': '12px',
      }}
    >
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '3px' }}>
        <h3
          style={{ ...sectionLabelStyle, color: theme.accent, 'font-weight': '600', margin: '0' }}
        >
          {props.title}
        </h3>
        <p
          style={{ margin: '0', 'font-size': '12px', color: theme.fgSubtle, 'line-height': '1.5' }}
        >
          {props.description}
        </p>
      </div>
      {props.children}
    </section>
  );
}
