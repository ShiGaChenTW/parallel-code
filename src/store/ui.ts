import { batch } from 'solid-js';
import { produce } from 'solid-js/store';
import { store, setStore } from './core';
import { setActiveTask } from './navigation';
import { setTaskFocusedPanel } from './focused-panel';
import type { LookPreset, AppearanceMode } from '../lib/look';
import { osIsDark } from '../lib/os-appearance';
import type { CustomTheme } from '../lib/custom-theme';
import type { AppIconId } from '../lib/app-icon';
import { normalizeWindowOpacity } from '../lib/window-opacity';
import { normalizeWindowBlur } from '../lib/window-blur';
import type { WindowBlur } from '../lib/window-blur';
import { themeToCss } from '../lib/custom-theme';
import type { PersistedWindowState, TaskViewportVisibility } from './types';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';

// Set to true after loadCustomThemes() resolves. Sanitization of persisted slot
// IDs is skipped until then so the startup reactive effect cannot null them out
// before the theme files have been loaded into the store.
let customThemesReady = false;

export function markCustomThemesReady(): void {
  customThemesReady = true;
  applyAppearanceMode();
}

export function _resetCustomThemesReadyForTest(): void {
  customThemesReady = false;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.1;

// --- Global Scale ---

export function adjustGlobalScale(delta: 1 | -1): void {
  const current = store.globalScale;
  const next =
    Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta * SCALE_STEP)) * 10) / 10;
  setStore('globalScale', next);
}

export function resetGlobalScale(): void {
  setStore('globalScale', 1);
}

// --- Panel User Sizes ---
//
// Presence of an entry means the user dragged the panel to that pixel size;
// absence means the panel falls back to its content-sized or flex-absorber
// default. No separate "manual" flag — the entry itself is the pin.

export function getPanelUserSize(key: string): number | undefined {
  return store.panelUserSize[key];
}

export function setPanelUserSize(key: string, px: number): void {
  setStore('panelUserSize', key, px);
}

export function deletePanelUserSize(keys: string[]): void {
  if (keys.length === 0) return;
  batch(() => {
    setStore(
      'panelUserSize',
      produce((sizes: Record<string, number>) => {
        for (const key of keys) delete sizes[key];
      }),
    );
  });
}

export function getTaskViewportVisibility(taskId: string): TaskViewportVisibility | null {
  return store.taskViewportVisibility[taskId] ?? null;
}

export function setTaskViewportVisibility(entries: Record<string, TaskViewportVisibility>): void {
  setStore('taskViewportVisibility', entries);
}

// --- Sidebar ---

export function toggleSidebar(): void {
  setStore('sidebarVisible', !store.sidebarVisible);
}

export function setTerminalFont(terminalFont: string): void {
  setStore('terminalFont', terminalFont);
}

export function applyAppearanceMode(): void {
  const isDark = osIsDark();
  const mode = store.appearanceMode;
  const slot = mode === 'system' ? (isDark ? 'dark' : 'light') : mode;

  // Sanitize both slots so the inactive grid in System mode also shows a selected card.
  // Skip before customThemesReady: theme files aren't in the store yet, and nulling
  // the persisted IDs now would permanently lose the user's selection.
  if (customThemesReady) {
    const rawDark = store.darkThemeCustomId;
    if (rawDark && !store.customThemes[rawDark]) setStore('darkThemeCustomId', null);
    const rawLight = store.lightThemeCustomId;
    if (rawLight && !store.customThemes[rawLight]) setStore('lightThemeCustomId', null);
  }

  const preset = slot === 'dark' ? store.darkThemePreset : store.lightThemePreset;
  const customId = slot === 'dark' ? store.darkThemeCustomId : store.lightThemeCustomId;
  setStore('themePreset', preset);
  setStore('activeCustomThemeId', customId);
}

export function setAppearanceMode(mode: AppearanceMode): void {
  setStore('appearanceMode', mode);
  applyAppearanceMode();
}

export function setLightTheme(preset: LookPreset, customId: string | null): void {
  batch(() => {
    setStore('lightThemePreset', preset);
    setStore('lightThemeCustomId', customId);
  });
  applyAppearanceMode();
}

export function setDarkTheme(preset: LookPreset, customId: string | null): void {
  batch(() => {
    setStore('darkThemePreset', preset);
    setStore('darkThemeCustomId', customId);
  });
  applyAppearanceMode();
}

/**
 * Persist the chosen app-icon variant and ask main to swap the live icon.
 *
 * The IPC call is deliberately not awaited and its failure is swallowed: the
 * icon is cosmetic, main already refuses to blank it on a bad read, and a
 * rejected promise here would surface as an unhandled rejection for something
 * the user cannot act on. The selection is stored either way, so a restart
 * still lands on the right icon.
 */
export function setAppIcon(id: AppIconId): void {
  setStore('appIcon', id);
  void invoke(IPC.SetAppIcon, { id }).catch(() => {});
}

/**
 * Persist the window opacity and ask main to apply it to the live window.
 *
 * Normalized here as well as in main: this is the value that reaches state.json
 * and is read back at the next launch, so it has to be a legal step whatever the
 * slider handed over.
 *
 * Not awaited, for the same reason as `setAppIcon` — the setting is cosmetic and
 * the value is stored either way, so a restart still lands on it. Settings only
 * offers the control where Electron implements opacity, so main applying it is
 * the expected case rather than a hope.
 */
export function setWindowOpacity(value: number): void {
  const opacity = normalizeWindowOpacity(value);
  setStore('windowOpacity', opacity);
  void invoke(IPC.SetWindowOpacity, { opacity, blur: store.windowBlur }).catch(() => {});
}

/**
 * Persist the window blur and ask main to apply it to the live window.
 *
 * Both settings are sent on both channels so main can decide what the window
 * should actually run at without holding any state of its own: blur and opacity
 * must not be composited together (see `effectiveWindowOpacity` in
 * `electron/ipc/window-blur.ts`), and a main process that remembered only the
 * last value it was told would answer that question differently depending on
 * which control the user touched last.
 *
 * The stored opacity is deliberately left alone while blur is on. Writing 1 into
 * it would make switching blur on destroy a setting the user chose, and make
 * switching it off again a different app than the one they had.
 *
 * The `data-window-blur` attribute that drives the CSS veil is applied in
 * `App.tsx` alongside `data-look`, not here, so the theme and the veil flip in
 * the same frame.
 */
export function setWindowBlur(value: WindowBlur): void {
  const blur = normalizeWindowBlur(value);
  setStore('windowBlur', blur);
  void invoke(IPC.SetWindowBlur, { blur, opacity: store.windowOpacity }).catch(() => {});
}

export async function saveCustomTheme(theme: CustomTheme): Promise<void> {
  const css = themeToCss(theme.name, theme.description, theme.terminalBackground, theme.vars);
  await invoke(IPC.SaveCustomTheme, { id: theme.id, css });
  setStore('customThemes', theme.id, theme);
}

export async function deleteCustomTheme(id: string): Promise<void> {
  await invoke(IPC.DeleteCustomTheme, { id });
  setStore(
    'customThemes',
    produce((themes: Record<string, CustomTheme>) => {
      delete themes[id];
    }),
  );
  batch(() => {
    if (store.darkThemeCustomId === id) setStore('darkThemeCustomId', null);
    if (store.lightThemeCustomId === id) setStore('lightThemeCustomId', null);
    if (store.activeCustomThemeId === id) setStore('activeCustomThemeId', null);
  });
  applyAppearanceMode();
}

export function setAutoTrustFolders(autoTrustFolders: boolean): void {
  setStore('autoTrustFolders', autoTrustFolders);
}

export function setShowPlans(showPlans: boolean): void {
  setStore('showPlans', showPlans);
}

export function setShowSidebarTips(show: boolean): void {
  setStore('showSidebarTips', show);
}

export function setShowSidebarProgress(show: boolean): void {
  setStore('showSidebarProgress', show);
}

export function setProjectsCollapsed(collapsed: boolean): void {
  batch(() => {
    setStore('projectsCollapsed', collapsed);
    // Drop any project highlight when the section hides — keeping it would let
    // ↑/↓ walk through invisible items with no visual feedback.
    if (collapsed && store.sidebarFocusedProjectId !== null) {
      setStore('sidebarFocusedProjectId', null);
    }
  });
}

export function setShowPromptInput(show: boolean): void {
  setStore('showPromptInput', show);
}

export function setFontSmoothing(enabled: boolean): void {
  setStore('fontSmoothing', enabled);
}

export function setDesktopNotificationsEnabled(enabled: boolean): void {
  setStore('desktopNotificationsEnabled', enabled);
}

export function setVerboseLogging(enabled: boolean): void {
  setStore('verboseLogging', enabled);
}

export function setCoordinatorModeEnabled(enabled: boolean): void {
  setStore('coordinatorModeEnabled', enabled);
  invoke(IPC.SetCoordinatorModeEnabled, { enabled }).catch((e) =>
    console.warn('Failed to set coordinator mode backend:', e),
  );
}

export function setDefaultStepsEnabled(enabled: boolean): void {
  setStore('defaultStepsEnabled', enabled);
}

export function setDefaultSkipPermissions(enabled: boolean): void {
  setStore('defaultSkipPermissions', enabled);
}

export function setDefaultPropagateSkipPermissions(enabled: boolean): void {
  setStore('defaultPropagateSkipPermissions', enabled);
}

export function setCoordinatorNotificationDelayMs(ms: number): void {
  const clamped = Math.max(5_000, Math.min(300_000, Math.round(ms)));
  setStore('coordinatorNotificationDelayMs', clamped);
}

export function setInactiveColumnOpacity(opacity: number): void {
  setStore('inactiveColumnOpacity', Math.round(Math.max(0.3, Math.min(1.0, opacity)) * 100) / 100);
}

export function setEditorCommand(command: string): void {
  setStore('editorCommand', command);
}

export function setDockerImage(image: string): void {
  setStore('dockerImage', image || 'parallel-code-agent:latest');
}

export function setAskCodeProvider(provider: 'claude' | 'minimax'): void {
  setStore('askCodeProvider', provider);
}

export function setMinimaxApiKey(key: string): void {
  invoke(IPC.SetMinimaxApiKey, { key: key.trim() }).catch((e) =>
    console.warn('Failed to set MiniMax API key:', e),
  );
}

export function setDockerAvailable(available: boolean): void {
  setStore('dockerAvailable', available);
}

export function setShareDockerAgentAuth(enabled: boolean): void {
  setStore('shareDockerAgentAuth', enabled);
}

export function toggleArena(show?: boolean): void {
  setStore('showArena', show ?? !store.showArena);
}

export function toggleFocusMode(on?: boolean): void {
  setStore('focusMode', on ?? !store.focusMode);
}

export function toggleTaskFocusMode(taskId: string | null = store.activeTaskId): void {
  if (!taskId || !store.tasks[taskId]) return;
  const enteringFocusMode = !store.focusMode;
  if (store.activeTaskId !== taskId) setActiveTask(taskId);
  toggleFocusMode();
  if (!enteringFocusMode) return;
  const panel = store.focusedPanel[taskId] ?? 'ai-terminal';
  requestAnimationFrame(() => setTaskFocusedPanel(taskId, panel));
}

export function setTaskSplitMode(taskId: string, active: boolean): void {
  if (!!store.taskSplitMode[taskId] === active) return;
  setStore('taskSplitMode', taskId, active);
}

export function setWindowState(windowState: PersistedWindowState): void {
  const current = store.windowState;
  if (
    current &&
    current.x === windowState.x &&
    current.y === windowState.y &&
    current.width === windowState.width &&
    current.height === windowState.height &&
    current.maximized === windowState.maximized
  ) {
    return;
  }
  setStore('windowState', windowState);
}
