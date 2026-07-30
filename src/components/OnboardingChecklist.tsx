import { For } from 'solid-js';
import { tr } from '../store/i18n';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import type { OnboardingStep } from '../lib/onboarding';

/**
 * The stage-1 path, rendered as a four-line checklist inside the existing
 * empty state.
 *
 * A dumb renderer on purpose: it receives already-computed steps and decides
 * nothing. Which steps are done, which one is next, and whether this is shown
 * at all are all settled by the pure functions in `lib/onboarding.ts`, which is
 * what makes them testable under vitest's node environment.
 *
 * No tour, no overlay, no highlight ring — the checklist sits in the flow of
 * the empty state the user is already looking at, and every action it names is
 * reachable from that same screen.
 */
export function OnboardingChecklist(props: { steps: OnboardingStep[] }) {
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
        'min-width': '220px',
        padding: '14px 18px',
        'border-radius': '10px',
        background: theme.islandBg,
        border: `1px solid ${theme.border}`,
      }}
    >
      <span
        style={{
          'font-size': sf(11),
          color: theme.fgSubtle,
          'text-transform': 'uppercase',
          'letter-spacing': '0.05em',
        }}
      >
        {tr('First run')}
      </span>
      <For each={props.steps}>
        {(step) => (
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              'font-size': sf(13),
              color: step.current ? theme.fg : step.done ? theme.fgSubtle : theme.fgMuted,
              'font-weight': step.current ? '600' : '400',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '14px',
                'text-align': 'center',
                'flex-shrink': '0',
                color: step.done ? theme.success : theme.fgSubtle,
              }}
            >
              {step.done ? '✓' : '○'}
            </span>
            <span>{tr(step.label)}</span>
          </div>
        )}
      </For>
    </div>
  );
}
