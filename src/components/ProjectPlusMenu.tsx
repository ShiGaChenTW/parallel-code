import { SidebarPlusMenu } from './SidebarSection';
import type { SidebarMenuItem } from './SidebarSection';
import { tr } from '../store/i18n';
import { startAddProject } from '../store/projects';
import { openCreateProject } from '../store/create-project';

/**
 * The Projects `+` menu.
 *
 * Its own file rather than more of `Sidebar.tsx`, which is already 1500 lines
 * and is being reworked concurrently. `Sidebar.tsx` needs to know one thing
 * about this feature — that the `+` on the Projects heading is now a menu — so
 * one import and one element is the whole of its involvement.
 *
 * The menu itself is `SidebarPlusMenu`, unchanged: the Session heading's `+`
 * already established the keyboard behaviour, the ARIA wiring and the popup
 * styling, and a second implementation would only be a second thing to keep in
 * step with it.
 */

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
    </svg>
  );
}

function CloudGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4.75 13.5a3.75 3.75 0 0 1-.53-7.46 4.5 4.5 0 0 1 8.6-1.02A3.5 3.5 0 0 1 12.5 13.5h-7.75Zm3.78-6.28a.75.75 0 0 0-1.06 0L5.72 8.97a.75.75 0 1 0 1.06 1.06l.47-.47v1.69a.75.75 0 0 0 1.5 0V9.56l.47.47a.75.75 0 1 0 1.06-1.06L8.53 7.22Z" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a.75.75 0 0 1 .71.51l.9 2.64 2.64.9a.75.75 0 0 1 0 1.42l-2.64.9-.9 2.64a.75.75 0 0 1-1.42 0l-.9-2.64-2.64-.9a.75.75 0 0 1 0-1.42l2.64-.9.9-2.64A.75.75 0 0 1 8 1Zm4.25 8a.75.75 0 0 1 .71.51l.36 1.06 1.06.36a.75.75 0 0 1 0 1.42l-1.06.36-.36 1.06a.75.75 0 0 1-1.42 0l-.36-1.06-1.06-.36a.75.75 0 0 1 0-1.42l1.06-.36.36-1.06A.75.75 0 0 1 12.25 9Z" />
    </svg>
  );
}

/**
 * The three ways a project can arrive.
 *
 * Exported as a plain function so the labels, order and wiring are assertable
 * without a DOM — the same split `sidebar-menu.ts` makes for the keyboard
 * decisions, and for the same reason: vitest runs with `environment: 'node'`.
 *
 * Order is deliberate. "Choose a local folder" is first because it is the
 * existing behaviour and the overwhelmingly common case — a user who never
 * reads the menu and hits Enter gets exactly what the `+` did before.
 */
export function projectMenuItems(): SidebarMenuItem[] {
  return [
    {
      label: tr('Choose a local folder'),
      tooltip: tr('Add a project that is already on this machine'),
      icon: <FolderGlyph />,
      onSelect: () => void startAddProject(),
    },
    {
      label: tr('Clone from a URL'),
      tooltip: tr('Clone a repository, then add it as a project'),
      icon: <CloudGlyph />,
      onSelect: () => openCreateProject('clone'),
    },
    {
      label: tr('New project'),
      tooltip: tr('Create an empty folder and start S.CodingFlow in it'),
      icon: <SparkGlyph />,
      onSelect: () => openCreateProject('new'),
    },
  ];
}

export function ProjectPlusMenu() {
  return (
    <SidebarPlusMenu
      triggerLabel={tr('Add project')}
      menuLabel={tr('Add project')}
      items={projectMenuItems()}
    />
  );
}
