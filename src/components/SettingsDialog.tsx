import { For, Show, Switch, Match, createSignal, createEffect, createUniqueId, on } from 'solid-js';
import type { JSX } from 'solid-js';
import { Dialog } from './Dialog';
import { CustomThemeDialog } from './CustomThemeDialog';
import {
  getAvailableTerminalFonts,
  fetchAvailableTerminalFonts,
  getTerminalFontFamily,
  LIGATURE_FONTS,
} from '../lib/fonts';
import { CJK_TERMINAL_FONTS, formatFontSize, isCjkFontInstalled } from '../lib/cjk-fonts';
import {
  chooseCjkFont,
  cjkFontStatus,
  dismissCjkFontStatus,
  installedFamilies,
  refreshInstalledCjkFonts,
  retryCjkFontInstall,
} from '../store/cjkFont';
import { presetsForTone } from '../lib/look';
import type { AppearanceMode } from '../lib/look';
import { LOCALES, LOCALE_LABELS } from '../lib/i18n';
import { tr, trParts, setLocale } from '../store/i18n';
import { theme, sectionLabelStyle, readCssVarsForPreset } from '../lib/theme';
import { themeToCss, detectThemeTone } from '../lib/custom-theme';
import {
  store,
  setTerminalFont,
  setAutoTrustFolders,
  setShowPlans,
  setShowPromptInput,
  setShowSidebarTips,
  setShowSidebarProgress,
  setFontSmoothing,
  setDesktopNotificationsEnabled,
  setOfflineMode,
  setTranscriptEnabled,
  clearTranscripts,
  setVerboseLogging,
  setInactiveColumnOpacity,
  setEditorCommand,
  setDockerImage,
  setShareDockerAgentAuth,
  setAskCodeProvider,
  setMinimaxApiKey,
  setAppearanceMode,
  setLightTheme,
  setDarkTheme,
  setCoordinatorModeEnabled,
  setCoordinatorNotificationDelayMs,
  setDefaultStepsEnabled,
  setDefaultSkipPermissions,
  setDefaultPropagateSkipPermissions,
  updateStatus,
  checkForUpdates,
} from '../store/store';
import { CustomAgentEditor } from './CustomAgentEditor';
import { HulySettings } from './HulySettings';
import { TokenUsageSection } from './TokenUsageSection';
import { mod } from '../lib/platform';
import { DEFAULT_DOCKER_IMAGE, PROJECT_DOCKERFILE_RELATIVE_PATH } from '../lib/docker';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function ensureSelectedFont(available: string[]): string[] {
  if (available.includes(store.terminalFont)) return available;
  return [store.terminalFont, ...available];
}

/**
 * Traditional-Chinese terminal fonts.
 *
 * A dumb view: every decision — installed or not, ask or refuse, what the
 * sentence says — comes from `planCjkFontSelection` and `cjkFontStatus()`.
 * vitest runs without a DOM, so anything decided here would be untestable.
 */
function CjkFontSection() {
  const status = cjkFontStatus;
  const installed = (family: string) => isCjkFontInstalled(family, installedFamilies());

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
      <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>
        {tr('Chinese Terminal Font')}
      </div>
      <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
        {tr(
          'Fonts are never bundled or downloaded automatically. Picking one that is not installed asks first.',
        )}
      </span>
      <div class="settings-font-grid">
        <For each={CJK_TERMINAL_FONTS}>
          {(font) => (
            <button
              type="button"
              class={`settings-font-card${store.terminalFont === font.family ? ' active' : ''}`}
              disabled={status().phase === 'downloading'}
              onClick={() => void chooseCjkFont(font.family)}
            >
              <span class="settings-font-name">{font.family}</span>
              <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>{tr(font.note)}</span>
              <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>
                {installed(font.family)
                  ? tr('Installed')
                  : tr('Not installed — {size}', {
                      size: formatFontSize(font.delivery.bytes),
                    })}
                {' · '}
                {font.licence.name}
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={status().phase === 'downloading'}>
        <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
          {tr('Downloading {font}…', { font: status().family })}
        </span>
      </Show>
      <Show when={status().message}>
        {(message) => (
          <div
            style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'flex-wrap': 'wrap' }}
          >
            <span
              style={{
                'font-size': '12px',
                color: status().phase === 'error' ? theme.error : theme.fgSubtle,
              }}
            >
              {tr(message().text, message().params)}
            </span>
            <Show when={status().retryFamily}>
              <button type="button" onClick={() => void retryCjkFontInstall()}>
                {tr('Retry')}
              </button>
            </Show>
            <button type="button" onClick={dismissCjkFontStatus}>
              {tr('Dismiss')}
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}

type SettingsTab = 'general' | 'themes' | 'experimental';
type ThemeSlot = 'light' | 'dark';

function SettingsSection(props: { title: string; children: JSX.Element }) {
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
      <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>{props.title}</div>
      {props.children}
    </div>
  );
}

export function SettingsCheckboxRow(props: {
  label: string;
  description: JSX.Element;
  checked: boolean;
  onChange: (checked: boolean) => void;
  align?: 'center' | 'flex-start';
}) {
  return (
    <label
      style={{
        display: 'flex',
        'align-items': props.align ?? 'center',
        gap: '10px',
        cursor: 'pointer',
        padding: '8px 12px',
        'border-radius': '8px',
        background: theme.bgInput,
        border: `1px solid ${theme.border}`,
      }}
    >
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        style={{ 'accent-color': theme.accent, cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
        <span style={{ 'font-size': '14px', color: theme.fg }}>{props.label}</span>
        <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>{props.description}</span>
      </div>
    </label>
  );
}

/**
 * "Clear transcripts" — the delete half of the opt-in.
 *
 * A recording feature the user cannot undo is not really opt-in, so this sits
 * directly beneath the switch rather than in a submenu. It reports how many
 * files went, because "Cleared" with no number leaves you wondering whether it
 * found anything. The button stays enabled while the switch is off: turning
 * recording off does not delete what was already recorded, and that is exactly
 * when someone wants this.
 */
function TranscriptClearRow() {
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<string | null>(null);

  const clear = async () => {
    if (busy()) return;
    setBusy(true);
    setResult(null);
    try {
      const removed = await clearTranscripts();
      setResult(
        removed === 1
          ? tr('Deleted 1 transcript')
          : `${tr('Deleted')} ${removed} ${tr('transcripts')}`,
      );
    } catch {
      setResult(tr('Could not delete transcripts'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
        padding: '8px 12px',
        'border-radius': '8px',
        background: theme.bgInput,
        border: `1px solid ${theme.border}`,
      }}
    >
      <button
        class="btn-secondary"
        type="button"
        disabled={busy()}
        onClick={() => void clear()}
        style={{
          padding: '4px 12px',
          'font-size': '13px',
          background: theme.bgInput,
          color: theme.fg,
          border: `1px solid ${theme.border}`,
          'border-radius': '6px',
          cursor: busy() ? 'default' : 'pointer',
          opacity: busy() ? '0.6' : '1',
        }}
      >
        {tr('Clear transcripts')}
      </button>
      <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
        {result() ?? tr('Deletes every recorded transcript from disk. Cannot be undone.')}
      </span>
    </div>
  );
}

export function PresetThemeCard(props: {
  preset: ReturnType<typeof presetsForTone>[number];
  active: boolean;
  onSelect: () => void;
  onClone: () => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        class={`settings-theme-card${props.active ? ' active' : ''}`}
        onClick={() => props.onSelect()}
      >
        <span class="settings-theme-title">{props.preset.label}</span>
        <span class="settings-theme-desc">{props.preset.description}</span>
      </button>
      <button
        type="button"
        title={tr('Clone as custom theme')}
        onClick={(e) => {
          e.stopPropagation();
          props.onClone();
        }}
        style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          background: theme.bgElevated,
          border: `1px solid ${theme.border}`,
          'border-radius': '4px',
          color: theme.fgMuted,
          cursor: 'pointer',
          'font-size': '10px',
          padding: '2px 6px',
          opacity: '0',
          transition: 'opacity 0.15s',
        }}
        class="preset-clone-btn"
      >
        {tr('Clone')}
      </button>
    </div>
  );
}

function CustomThemeCard(props: {
  customTheme: (typeof store.customThemes)[string];
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        class={`settings-theme-card${props.active ? ' active' : ''}`}
        onClick={() => props.onSelect()}
      >
        <span class="settings-theme-title">{props.customTheme.name}</span>
        <span class="settings-theme-desc">{props.customTheme.description || 'Custom theme'}</span>
      </button>
      <button
        type="button"
        title={tr('Edit custom theme')}
        onClick={(e) => {
          e.stopPropagation();
          props.onEdit();
        }}
        style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          background: theme.bgElevated,
          border: `1px solid ${theme.border}`,
          'border-radius': '4px',
          color: theme.fgMuted,
          cursor: 'pointer',
          'font-size': '10px',
          padding: '2px 6px',
          opacity: '0',
          transition: 'opacity 0.15s',
        }}
        class="preset-clone-btn"
      >
        {tr('Edit')}
      </button>
    </div>
  );
}

function ThemeGrid(props: {
  slot: ThemeSlot;
  onClonePreset: (presetId: string, label: string) => void;
  onEditCustom: (themeId: string) => void;
}) {
  return (
    <div class="settings-theme-grid">
      <For each={presetsForTone(props.slot)}>
        {(preset) => {
          const active = () =>
            props.slot === 'light'
              ? store.lightThemeCustomId === null && store.lightThemePreset === preset.id
              : store.darkThemeCustomId === null && store.darkThemePreset === preset.id;
          return (
            <PresetThemeCard
              preset={preset}
              active={active()}
              onSelect={() => {
                if (props.slot === 'light') {
                  setLightTheme(preset.id, null);
                } else {
                  setDarkTheme(preset.id, null);
                }
              }}
              onClone={() => props.onClonePreset(preset.id, preset.label)}
            />
          );
        }}
      </For>
      <For
        each={Object.values(store.customThemes).filter(
          (customTheme) => detectThemeTone(customTheme.vars) === props.slot,
        )}
      >
        {(customTheme) => {
          const active = () =>
            props.slot === 'light'
              ? store.lightThemeCustomId === customTheme.id
              : store.darkThemeCustomId === customTheme.id;
          return (
            <CustomThemeCard
              customTheme={customTheme}
              active={active()}
              onSelect={() => {
                if (props.slot === 'light') {
                  setLightTheme(store.lightThemePreset, customTheme.id);
                } else {
                  setDarkTheme(store.darkThemePreset, customTheme.id);
                }
              }}
              onEdit={() => props.onEditCustom(customTheme.id)}
            />
          );
        }}
      </For>
    </div>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const titleId = createUniqueId();
  const [fonts, setFonts] = createSignal<string[]>(ensureSelectedFont(getAvailableTerminalFonts()));
  const [activeTab, setActiveTab] = createSignal<SettingsTab>('general');
  const [customThemeDialogOpen, setCustomThemeDialogOpen] = createSignal(false);
  const [editingThemeId, setEditingThemeId] = createSignal<string | null>(null);
  const [cloneCss, setCloneCss] = createSignal<string | undefined>(undefined);

  function openCloneDialog(presetId: string, label: string) {
    const vars = readCssVarsForPreset(presetId);
    const bg = vars['--task-panel-bg'] ?? '#000000';
    setCloneCss(themeToCss(`${label} (copy)`, '', bg, vars));
    setEditingThemeId(null);
    setCustomThemeDialogOpen(true);
  }

  // Styles shared across the Updates section's rows, buttons and messages.
  const updateRowStyle = {
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'space-between',
    gap: '12px',
  };
  const updateSecondaryButtonStyle = (disabled: boolean) => ({
    padding: '6px 12px',
    'border-radius': '6px',
    border: `1px solid ${theme.border}`,
    background: theme.bgElevated,
    color: theme.fg,
    'font-size': '13px',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? '0.6' : '1',
  });
  const updateMessageStyle = (color: string) => ({ 'font-size': '12px', color });

  // Phases that permit a manual check. An allow-list keeps a future phase
  // from defaulting to "shown" the way excluding non-checkable phases would.
  // 'offline' is on the list so the button stays available: the fix is to turn
  // the switch off and press it again, which needs the button to still be there.
  const canCheckForUpdates = () =>
    ['idle', 'checking', 'up-to-date', 'available', 'error', 'offline'].includes(
      updateStatus().phase,
    );

  // Fetch system fonts when the dialog opens
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          fetchAvailableTerminalFonts().then((available) =>
            setFonts(ensureSelectedFont(available)),
          );
          // Re-checked on every open rather than cached for the session: a user
          // can install a font outside the app, and a stale "not installed"
          // would offer a download they do not need.
          void refreshInstalledCjkFonts();
        }
      },
    ),
  );

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      width="640px"
      zIndex={1100}
      labelledBy={titleId}
      panelStyle={{ 'max-width': 'calc(100vw - 32px)', padding: '24px', gap: '18px' }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
        }}
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
          <h2
            id={titleId}
            style={{
              margin: '0',
              'font-size': '17px',
              color: theme.fg,
              'font-weight': '600',
            }}
          >
            {tr('Settings')}
          </h2>
          <span style={{ 'font-size': '13px', color: theme.fgSubtle }}>
            {/* The shortcut is a styled <kbd>, not a string, so the sentence is
                rendered from segments. The translation decides where the key cap
                lands; before this it was hard-coded English, never translated. */}
            <For each={trParts('Customize your workspace. Shortcut: {shortcut}')}>
              {(segment) =>
                segment.kind === 'text' ? (
                  segment.value
                ) : (
                  <kbd
                    style={{
                      background: theme.bgInput,
                      border: `1px solid ${theme.border}`,
                      'border-radius': '4px',
                      padding: '1px 6px',
                      'font-family': "'JetBrains Mono', monospace",
                      color: theme.fgMuted,
                    }}
                  >
                    {mod}+,
                  </kbd>
                )
              }
            </For>
          </span>
        </div>
        <button
          onClick={() => props.onClose()}
          aria-label={tr('Close settings')}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.fgMuted,
            cursor: 'pointer',
            'font-size': '19px',
            padding: '0 4px',
            'line-height': '1',
          }}
        >
          &times;
        </button>
      </div>

      <div
        role="tablist"
        aria-label={tr('Settings tabs')}
        style={{
          display: 'flex',
          gap: '2px',
          'border-bottom': `1px solid ${theme.border}`,
          'padding-bottom': '0',
          'margin-bottom': '2px',
        }}
      >
        <For each={['general', 'themes', 'experimental'] as SettingsTab[]}>
          {(tab) => (
            <button
              role="tab"
              aria-selected={activeTab() === tab}
              aria-controls={`settings-tab-${tab}`}
              id={`settings-tabbutton-${tab}`}
              type="button"
              onClick={() => setActiveTab(tab)}
              onKeyDown={(e) => {
                const tabs: SettingsTab[] = ['general', 'themes', 'experimental'];
                const idx = tabs.indexOf(tab);
                if (e.key === 'ArrowRight') setActiveTab(tabs[(idx + 1) % tabs.length]);
                else if (e.key === 'ArrowLeft')
                  setActiveTab(tabs[(idx + tabs.length - 1) % tabs.length]);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                'border-bottom':
                  activeTab() === tab ? `2px solid ${theme.accent}` : '2px solid transparent',
                color: activeTab() === tab ? theme.fg : theme.fgMuted,
                cursor: 'pointer',
                'font-size': '14px',
                'font-weight': activeTab() === tab ? '600' : '400',
                padding: '6px 14px',
                'margin-bottom': '-1px',
                'border-radius': '0',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab === 'general'
                ? tr('General')
                : tab === 'themes'
                  ? tr('Themes')
                  : tr('Experimental')}
            </button>
          )}
        </For>
      </div>

      <Show when={activeTab() === 'general'}>
        <div
          id="settings-tab-general"
          role="tabpanel"
          aria-labelledby="settings-tabbutton-general"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '18px' }}
        >
          <SettingsSection title={tr('Behavior')}>
            <SettingsCheckboxRow
              label={tr('Auto-trust folders')}
              checked={store.autoTrustFolders}
              onChange={setAutoTrustFolders}
              description={tr('Automatically accept trust and permission dialogs from agents')}
            />
            <SettingsCheckboxRow
              label={tr('Show plans')}
              checked={store.showPlans}
              onChange={setShowPlans}
              description={tr('Display Claude Code plan files in a tab next to Notes')}
            />
            <SettingsCheckboxRow
              label={tr('Desktop notifications')}
              checked={store.desktopNotificationsEnabled}
              onChange={setDesktopNotificationsEnabled}
              description={tr('Show native notifications when tasks finish or need attention')}
            />
            <SettingsCheckboxRow
              label={tr('Show prompt input box below terminal')}
              checked={store.showPromptInput}
              onChange={setShowPromptInput}
              description={tr(
                'When hidden, the terminal occupies the full panel and auto-focuses on activation',
              )}
            />
            <SettingsCheckboxRow
              label={tr('Show progress section in sidebar')}
              checked={store.showSidebarProgress}
              onChange={setShowSidebarProgress}
              description={tr(
                'Daily completed-task count and merged-line totals at the bottom of the sidebar',
              )}
            />
            <SettingsCheckboxRow
              label={tr('Show tips section in sidebar')}
              checked={store.showSidebarTips}
              onChange={setShowSidebarTips}
              description={tr('Keyboard shortcut hints at the bottom of the sidebar')}
            />
            <SettingsCheckboxRow
              label={tr('Font smoothing')}
              checked={store.fontSmoothing}
              onChange={setFontSmoothing}
              description={tr('Enable antialiasing and geometric text rendering')}
              align="flex-start"
            />
          </SettingsSection>

          <SettingsSection title={tr('Privacy')}>
            <SettingsCheckboxRow
              label={tr('Offline mode')}
              checked={store.offlineMode}
              onChange={setOfflineMode}
              description={tr(
                'Stop Parallel Code making any network request of its own: update checks, PR check polling, Huly sync, inline code Q&A, Docker image builds, starting a Docker task whose image is not on this machine, git push, and external images in rendered markdown. Each one reports that offline mode is on rather than failing silently. This does not cover the AI CLIs you run as agents — those talk to their own vendors under their own configuration, and Parallel Code neither can nor should intercept them.',
              )}
              align="flex-start"
            />
            <SettingsCheckboxRow
              label={tr('Record session transcripts')}
              checked={store.transcriptEnabled}
              onChange={setTranscriptEnabled}
              description={tr(
                'Write a timestamped record of each task — agent starts and exits, step updates, attention changes, merges, PR check results and commits — to transcripts/<taskId>.jsonl in the application data directory, so a task can be reviewed after a restart. Nothing leaves your machine. Known secret shapes (API keys, tokens, private key headers) are masked before anything is written, but a transcript quotes your source code and instructions, so treat it as sensitive: masking catches shapes, not meaning. Kept for 30 days or 5000 events per task, whichever comes first.',
              )}
              align="flex-start"
            />
            <TranscriptClearRow />
          </SettingsSection>

          <SettingsSection title={tr('AI Usage')}>
            <TokenUsageSection />
          </SettingsSection>

          <SettingsSection title={tr('New Task Defaults')}>
            <SettingsCheckboxRow
              label={tr('Steps tracking')}
              checked={store.defaultStepsEnabled}
              onChange={setDefaultStepsEnabled}
              description={tr('Pre-tick Steps tracking in the New Task dialog')}
            />
            <SettingsCheckboxRow
              label={tr('Dangerously skip all confirms by default')}
              checked={store.defaultSkipPermissions}
              onChange={setDefaultSkipPermissions}
              description={tr(
                'Pre-tick skip-permissions for every new task. The agent will run without asking for confirmation. Only honoured when the selected agent supports it.',
              )}
            />
            <Show when={store.coordinatorModeEnabled}>
              <SettingsCheckboxRow
                label={tr('Propagate skip-permissions to sub-tasks')}
                checked={store.defaultPropagateSkipPermissions}
                onChange={setDefaultPropagateSkipPermissions}
                description={tr(
                  'Pre-tick Propagate to sub-tasks when both coordinator mode and skip-permissions are enabled for a task',
                )}
              />
            </Show>
          </SettingsSection>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div
              style={{
                ...sectionLabelStyle,
                'font-weight': '600',
              }}
            >
              {tr('Editor')}
            </div>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '6px',
                padding: '8px 12px',
                'border-radius': '8px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                }}
              >
                <span style={{ 'font-size': '14px', color: theme.fg, 'white-space': 'nowrap' }}>
                  {tr('Editor command')}
                </span>
                <input
                  type="text"
                  value={store.editorCommand}
                  onInput={(e) => setEditorCommand(e.currentTarget.value)}
                  placeholder="e.g. code, cursor, zed, subl"
                  style={{
                    flex: '1',
                    background: theme.taskPanelBg,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '6px',
                    padding: '6px 10px',
                    color: theme.fg,
                    'font-size': '14px',
                    'font-family': "'JetBrains Mono', monospace",
                    outline: 'none',
                  }}
                />
              </label>
              <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                {tr(
                  'CLI command to open worktree folders. Click the path bar in a task to open it.',
                )}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div
              style={{
                ...sectionLabelStyle,
                'font-weight': '600',
              }}
            >
              {tr('Ask about Code')}
            </div>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '6px',
                padding: '8px 12px',
                'border-radius': '8px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                }}
              >
                <span style={{ 'font-size': '13px', color: theme.fg, 'white-space': 'nowrap' }}>
                  {tr('LLM provider')}
                </span>
                <select
                  value={store.askCodeProvider}
                  onChange={(e) =>
                    setAskCodeProvider(e.currentTarget.value as 'claude' | 'minimax')
                  }
                  style={{
                    flex: '1',
                    background: theme.taskPanelBg,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '6px',
                    padding: '6px 10px',
                    color: theme.fg,
                    'font-size': '13px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="claude">Claude Code (claude CLI)</option>
                  <option value="minimax">MiniMax (M2.7)</option>
                </select>
              </label>
              <Show when={store.askCodeProvider === 'minimax'}>
                <label
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '10px',
                    'margin-top': '4px',
                  }}
                >
                  <span style={{ 'font-size': '13px', color: theme.fg, 'white-space': 'nowrap' }}>
                    {tr('MiniMax API key')}
                  </span>
                  <input
                    type="password"
                    onInput={(e) => setMinimaxApiKey(e.currentTarget.value)}
                    placeholder="Enter your MINIMAX_API_KEY (stored in memory only)"
                    style={{
                      flex: '1',
                      background: theme.taskPanelBg,
                      border: `1px solid ${theme.border}`,
                      'border-radius': '6px',
                      padding: '6px 10px',
                      color: theme.fg,
                      'font-size': '13px',
                      'font-family': "'JetBrains Mono', monospace",
                      outline: 'none',
                    }}
                  />
                </label>
              </Show>
              <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>
                {store.askCodeProvider === 'minimax'
                  ? 'Uses MiniMax M2.7 (204K context) via the OpenAI-compatible API — no Claude Code CLI required.'
                  : 'Uses the claude CLI to answer questions about selected code. Requires Claude Code to be installed.'}
              </span>
            </div>
          </div>

          <Show when={store.dockerAvailable}>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
              <div
                style={{
                  'font-size': '12px',
                  color: theme.fgMuted,
                  'text-transform': 'uppercase',
                  'letter-spacing': '0.05em',
                  'font-weight': '600',
                }}
              >
                {tr('Docker Isolation')}
              </div>
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  gap: '6px',
                  padding: '8px 12px',
                  'border-radius': '8px',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '10px',
                  }}
                >
                  <span style={{ 'font-size': '14px', color: theme.fg, 'white-space': 'nowrap' }}>
                    {tr('Default image')}
                  </span>
                  <input
                    type="text"
                    value={store.dockerImage}
                    onInput={(e) => setDockerImage(e.currentTarget.value)}
                    placeholder={DEFAULT_DOCKER_IMAGE}
                    style={{
                      flex: '1',
                      background: theme.taskPanelBg,
                      border: `1px solid ${theme.border}`,
                      'border-radius': '6px',
                      padding: '6px 10px',
                      color: theme.fg,
                      'font-size': '14px',
                      'font-family': "'JetBrains Mono', monospace",
                      outline: 'none',
                    }}
                  />
                </label>
                <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                  Docker image used when "Run in Docker container" is enabled for a task. The agent
                  runs inside the container with only the project directory mounted.
                </span>
                <div style={{ 'font-size': '11px', color: theme.fgMuted, 'margin-top': '4px' }}>
                  Projects with a{' '}
                  <code
                    style={{ 'font-family': "'JetBrains Mono', monospace", 'font-size': '11px' }}
                  >
                    {PROJECT_DOCKERFILE_RELATIVE_PATH}
                  </code>{' '}
                  will use a project-specific image instead.
                </div>
              </div>
              <SettingsCheckboxRow
                label={tr('Share agent auth across Linux containers')}
                checked={store.shareDockerAgentAuth}
                onChange={setShareDockerAgentAuth}
                description={tr(
                  'Persist agent credentials in a user-owned host directory so you only need to sign in once per agent type. Auth on first run is saved automatically for future containers.',
                )}
              />
            </div>
          </Show>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div
              style={{
                ...sectionLabelStyle,
                'font-weight': '600',
              }}
            >
              {tr('Focus Dimming')}
            </div>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '8px',
                padding: '8px 12px',
                'border-radius': '8px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'space-between',
                }}
              >
                <span style={{ 'font-size': '14px', color: theme.fg }}>
                  {tr('Inactive column opacity')}
                </span>
                <span
                  style={{
                    'font-size': '13px',
                    color: theme.fgMuted,
                    'font-family': "'JetBrains Mono', monospace",
                    'min-width': '36px',
                    'text-align': 'right',
                  }}
                >
                  {Math.round(store.inactiveColumnOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="100"
                step="5"
                value={store.inactiveColumnOpacity * 100}
                onInput={(e) => setInactiveColumnOpacity(Number(e.currentTarget.value) / 100)}
                style={{
                  width: '100%',
                  'accent-color': theme.accent,
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  'justify-content': 'space-between',
                  'font-size': '11px',
                  color: theme.fgSubtle,
                }}
              >
                <span>{tr('More dimmed')}</span>
                <span>{tr('No dimming')}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div
              style={{
                ...sectionLabelStyle,
                'font-weight': '600',
              }}
            >
              {tr('Custom Agents')}
            </div>
            <CustomAgentEditor />
          </div>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div
              style={{
                ...sectionLabelStyle,
                'font-weight': '600',
              }}
            >
              {tr('Terminal Font')}
            </div>
            <div class="settings-font-grid">
              <For each={fonts()}>
                {(font) => (
                  <button
                    type="button"
                    class={`settings-font-card${store.terminalFont === font ? ' active' : ''}`}
                    onClick={() => setTerminalFont(font)}
                  >
                    <span class="settings-font-name">{font}</span>
                    <span
                      class="settings-font-preview"
                      style={{ 'font-family': getTerminalFontFamily(font) }}
                    >
                      AaBb 0Oo1Il →
                    </span>
                  </button>
                )}
              </For>
            </div>
            <Show when={LIGATURE_FONTS.has(store.terminalFont)}>
              <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                {tr('This font includes ligatures which may impact rendering performance.')}
              </span>
            </Show>
          </div>

          <CjkFontSection />

          <SettingsSection title="Huly">
            <HulySettings />
          </SettingsSection>

          <SettingsSection title={tr('Diagnostics')}>
            <SettingsCheckboxRow
              label={tr('Verbose logging')}
              checked={store.verboseLogging}
              onChange={setVerboseLogging}
              description="Emit debug-level logs to the developer console. Verbose logs may include file paths, branch names, commit messages, IPC channel activity, and pty lifecycle events. Review the contents before sharing."
            />
          </SettingsSection>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>{tr('Updates')}</div>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '10px',
                padding: '12px',
                'border-radius': '8px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
              }}
            >
              <div style={updateRowStyle}>
                <span style={{ 'font-size': '14px', color: theme.fg }}>
                  {tr('Current version')}
                  <Show when={updateStatus().currentVersion}>
                    {' '}
                    <span style={{ color: theme.fgMuted }}>v{updateStatus().currentVersion}</span>
                  </Show>
                </span>
                <Show when={canCheckForUpdates()}>
                  <button
                    type="button"
                    disabled={updateStatus().phase === 'checking'}
                    onClick={() => void checkForUpdates()}
                    style={updateSecondaryButtonStyle(updateStatus().phase === 'checking')}
                  >
                    {updateStatus().phase === 'checking' ? 'Checking…' : 'Check for updates'}
                  </button>
                </Show>
              </div>

              <Switch>
                <Match when={updateStatus().phase === 'unsupported'}>
                  <span style={updateMessageStyle(theme.fgSubtle)}>
                    Automatic updates are not available for this build. Download the latest release
                    from GitHub to update.
                  </span>
                </Match>

                <Match when={updateStatus().phase === 'offline'}>
                  <span style={updateMessageStyle(theme.fgSubtle)}>
                    {updateStatus().error ?? tr('Offline mode is on.')}
                  </span>
                </Match>

                <Match when={updateStatus().phase === 'up-to-date'}>
                  <span style={updateMessageStyle(theme.fgSubtle)}>
                    {tr('You are on the latest version.')}
                  </span>
                </Match>

                <Match when={updateStatus().phase === 'available'}>
                  <span style={updateMessageStyle(theme.fg)}>
                    Version {updateStatus().latestVersion} is available. Use the update button in
                    the sidebar to install.
                  </span>
                </Match>

                <Match when={updateStatus().phase === 'downloading'}>
                  <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
                    <span style={updateMessageStyle(theme.fgSubtle)}>
                      Downloading update… {updateStatus().downloadPercent}%
                    </span>
                    <div
                      style={{
                        height: '6px',
                        'border-radius': '3px',
                        background: theme.bgElevated,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${updateStatus().downloadPercent}%`,
                          background: theme.accent,
                          transition: 'width 0.2s',
                        }}
                      />
                    </div>
                  </div>
                </Match>

                <Match when={updateStatus().phase === 'downloaded'}>
                  <span style={updateMessageStyle(theme.fg)}>
                    Version {updateStatus().latestVersion} is downloaded. Use the update button in
                    the sidebar to restart &amp; install.
                  </span>
                </Match>

                <Match when={updateStatus().phase === 'error'}>
                  <span style={updateMessageStyle(theme.error)}>
                    Update check failed: {updateStatus().error}
                  </span>
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </Show>

      <Show when={activeTab() === 'themes'}>
        <div
          id="settings-tab-themes"
          role="tabpanel"
          aria-labelledby="settings-tabbutton-themes"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '18px' }}
        >
          {/* Language selector */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>{tr('Language')}</div>
            <div
              style={{
                display: 'flex',
                gap: '4px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                'border-radius': '8px',
                padding: '4px',
              }}
            >
              <For each={LOCALES}>
                {(locale) => (
                  <button
                    type="button"
                    style={{
                      flex: '1',
                      padding: '6px',
                      'border-radius': '6px',
                      border: 'none',
                      background: store.locale === locale ? theme.bgElevated : 'transparent',
                      color: store.locale === locale ? theme.fg : theme.fgMuted,
                      cursor: 'pointer',
                      'font-size': '13px',
                      'font-weight': store.locale === locale ? '600' : '400',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onClick={() => setLocale(locale)}
                  >
                    {/* Each language names itself — a reader who cannot read the
                        current UI language still recognises their own. */}
                    {LOCALE_LABELS[locale]}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Appearance mode selector */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>{tr('Appearance')}</div>
            <div
              style={{
                display: 'flex',
                gap: '4px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                'border-radius': '8px',
                padding: '4px',
              }}
            >
              <For each={['light', 'dark', 'system'] as AppearanceMode[]}>
                {(mode) => (
                  <button
                    type="button"
                    style={{
                      flex: '1',
                      padding: '6px',
                      'border-radius': '6px',
                      border: 'none',
                      background: store.appearanceMode === mode ? theme.bgElevated : 'transparent',
                      color: store.appearanceMode === mode ? theme.fg : theme.fgMuted,
                      cursor: 'pointer',
                      'font-size': '13px',
                      'font-weight': store.appearanceMode === mode ? '600' : '400',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onClick={() => setAppearanceMode(mode)}
                  >
                    {tr(mode)}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Theme section header with Create New button */}
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-between',
            }}
          >
            <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>{tr('Themes')}</div>
            <button
              type="button"
              onClick={() => {
                setCloneCss(undefined);
                setEditingThemeId(null);
                setCustomThemeDialogOpen(true);
              }}
              style={{
                background: theme.accent,
                border: 'none',
                color: theme.accentText,
                cursor: 'pointer',
                'font-size': '12px',
                'font-weight': '600',
                padding: '4px 12px',
                'border-radius': '5px',
              }}
            >
              + Create New
            </button>
          </div>

          {/* Single mode (Light or Dark): built-ins + matching custom themes in one grid */}
          <Show when={store.appearanceMode !== 'system'}>
            <ThemeGrid
              slot={store.appearanceMode as ThemeSlot}
              onClonePreset={openCloneDialog}
              onEditCustom={(themeId) => {
                setCloneCss(undefined);
                setEditingThemeId(themeId);
                setCustomThemeDialogOpen(true);
              }}
            />
          </Show>

          {/* System mode: dual grids, each with built-ins + tone-matching custom themes */}
          <Show when={store.appearanceMode === 'system'}>
            <For each={['dark', 'light'] as const}>
              {(slot) => (
                <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
                  <div style={{ ...sectionLabelStyle, 'font-weight': '600' }}>
                    {slot === 'dark' ? 'Dark Theme' : 'Light Theme'}
                  </div>
                  <ThemeGrid
                    slot={slot}
                    onClonePreset={openCloneDialog}
                    onEditCustom={(themeId) => {
                      setCloneCss(undefined);
                      setEditingThemeId(themeId);
                      setCustomThemeDialogOpen(true);
                    }}
                  />
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <CustomThemeDialog
        open={customThemeDialogOpen()}
        editId={editingThemeId()}
        initialCss={cloneCss()}
        onClose={() => setCustomThemeDialogOpen(false)}
      />

      <Show when={activeTab() === 'experimental'}>
        <div
          id="settings-tab-experimental"
          role="tabpanel"
          aria-labelledby="settings-tabbutton-experimental"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '18px' }}
        >
          <SettingsSection title={tr('Coordinator')}>
            <SettingsCheckboxRow
              label={tr('Coordinator mode')}
              checked={store.coordinatorModeEnabled}
              onChange={setCoordinatorModeEnabled}
              description="Enable the Coordinator option when creating tasks. Coordinators can spawn sub-tasks, send prompts, and merge branches automatically via MCP tools. Requires app restart to fully disable."
            />
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '6px',
                padding: '8px 12px',
                'border-radius': '8px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                }}
              >
                <span style={{ 'font-size': '14px', color: theme.fg, 'white-space': 'nowrap' }}>
                  {tr('Coordinator notification delay (seconds)')}
                </span>
                <input
                  type="number"
                  min="5"
                  max="300"
                  step="5"
                  value={Math.round(store.coordinatorNotificationDelayMs / 1000)}
                  onInput={(e) => {
                    const seconds = Number(e.currentTarget.value);
                    if (Number.isFinite(seconds)) {
                      setCoordinatorNotificationDelayMs(seconds * 1000);
                    }
                  }}
                  style={{
                    width: '80px',
                    background: theme.taskPanelBg,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '6px',
                    padding: '6px 10px',
                    color: theme.fg,
                    'font-size': '14px',
                    'font-family': "'JetBrains Mono', monospace",
                    outline: 'none',
                    'text-align': 'right',
                  }}
                />
              </label>
              <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                How long the coordinator waits before firing a notification after a sub-task
                completes. Default: 60s. Failed sub-tasks use max(10s, delay ÷ 4).
              </span>
            </div>
          </SettingsSection>
        </div>
      </Show>
    </Dialog>
  );
}
