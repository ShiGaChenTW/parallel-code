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
import { APP_ICON_VARIANTS, type AppIconVariant } from '../lib/app-icon';
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
  setAppIcon,
  setWindowOpacity,
  setWindowBlur,
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
import { mod, rendererPlatform } from '../lib/platform';
import {
  MIN_WINDOW_OPACITY,
  WINDOW_OPACITY_STEP,
  isWindowOpacitySupported,
  windowOpacityReadability,
} from '../lib/window-opacity';
import { WINDOW_BLUR_MATERIALS, isWindowBlurSupported } from '../lib/window-blur';
import type { WindowBlurMaterial } from '../lib/window-blur';
import { DEFAULT_DOCKER_IMAGE, PROJECT_DOCKERFILE_RELATIVE_PATH } from '../lib/docker';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function ensureSelectedFont(available: string[]): string[] {
  if (available.includes(store.terminalFont)) return available;
  return [store.terminalFont, ...available];
}

type ThemeSlot = 'light' | 'dark';

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
 */
function SettingsCard(props: { title: string; description: JSX.Element; children: JSX.Element }) {
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
    <SettingsCard
      title={tr('Chinese Terminal Font')}
      description={tr(
        'Fonts are never bundled or downloaded automatically. Picking one that is not installed asks first.',
      )}
    >
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
    </SettingsCard>
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
      // Two whole sentences rather than translated words glued around a number.
      // The concatenation this replaces pinned the count to the middle of the
      // sentence in every language, which is what the placeholder syntax exists
      // to undo.
      setResult(
        removed === 1
          ? tr('Deleted 1 transcript')
          : tr('Deleted {count} transcripts', { count: removed }),
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
        <span class="settings-theme-desc">
          {props.customTheme.description || tr('Custom theme')}
        </span>
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

/**
 * Preview of an app-icon variant, drawn from the same geometry the real icon
 * uses rather than loading its PNG — stays crisp at any size and keeps Settings
 * free of image requests.
 */
function AppIconSwatch(props: { variant: AppIconVariant; size: number }) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 512 512"
      style={{ 'border-radius': '22%', display: 'block' }}
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="114" fill={props.variant.bg} />
      <Show
        when={!props.variant.legacy}
        fallback={
          <g fill="none" stroke={props.variant.live} stroke-width="37">
            <line x1="91" y1="55" x2="91" y2="457" />
            <line x1="201" y1="55" x2="201" y2="457" />
            <path d="M274 73 H430 V219 H274" />
            <path d="M448 293 H293 V439 H448" />
          </g>
        }
      >
        <g fill="none" stroke-width="50" stroke-linecap="round">
          <path d="M152 120 V 392" stroke={props.variant.track} />
          <path d="M256 120 V 392" stroke={props.variant.track} />
          <path d="M360 120 V 392" stroke={props.variant.track} />
          <path d="M152 120 V 214" stroke={props.variant.live} />
          <path d="M256 120 V 296" stroke={props.variant.live} />
          <path d="M360 120 V 392" stroke={props.variant.live} />
        </g>
      </Show>
    </svg>
  );
}

function AppIconSection() {
  return (
    <SettingsCard
      title={tr('App icon')}
      description={tr('Changes the Dock icon on macOS and the window icon on Linux.')}
    >
      <div style={{ display: 'flex', gap: '10px', 'flex-wrap': 'wrap' }}>
        <For each={APP_ICON_VARIANTS}>
          {(variant) => {
            const active = () => store.appIcon === variant.id;
            return (
              <button
                type="button"
                aria-pressed={active()}
                title={tr(variant.label)}
                onClick={() => setAppIcon(variant.id)}
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': 'center',
                  gap: '7px',
                  padding: '9px',
                  background: active() ? theme.bgSelected : theme.bgInput,
                  border: `1px solid ${active() ? theme.borderFocus : theme.border}`,
                  'border-radius': '10px',
                  cursor: 'pointer',
                  color: active() ? theme.fg : theme.fgMuted,
                  'font-size': '11px',
                }}
              >
                <AppIconSwatch variant={variant} size={52} />
                <span>{tr(variant.label)}</span>
              </button>
            );
          }}
        </For>
      </div>
    </SettingsCard>
  );
}

/**
 * Transparency, or an explanation of its absence.
 *
 * The same control over the same persisted number, now meaning something
 * entirely different. It used to drive `win.setOpacity()`, which fades the
 * composited window — glyphs, chrome and traffic-light buttons along with the
 * background. No terminal emulator works that way; all six surveyed fade the
 * background and leave text at full opacity. It now drives the `--surface-alpha`
 * custom property, which `styles.css` applies to background layers only, so the
 * description leads with exactly that.
 *
 * It depends on blur, and the copy says so rather than leaving the user to find
 * out. Painting a background at 80% only reveals the desktop if the window is
 * translucent, and the only thing that makes it translucent here is a vibrancy
 * material — which is also why the slider is withheld on Linux, where vibrancy
 * does not exist at all.
 *
 * What is *gone* from this card is the note saying the setting was paused while
 * blur was on. That exclusion existed because `setOpacity` faded the vibrancy
 * layer along with everything else and produced a doubled image; nothing in the
 * CSS path does that, so the two settings are now one mechanism instead of two
 * that had to be kept apart.
 */
function WindowOpacitySection() {
  const supported = isWindowOpacitySupported(rendererPlatform);
  const readability = () => windowOpacityReadability(store.windowOpacity);
  return (
    <SettingsCard
      title={tr('Transparency')}
      description={
        supported
          ? tr(
              'Lets the desktop through the app’s backgrounds. Text, icons and window controls stay fully opaque. Needs window blur on to show anything.',
            )
          : tr(
              'Not available on Linux — the window can only be made translucent by a macOS vibrancy material, so a slider here would do nothing.',
            )
      }
    >
      <Show when={supported}>
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
            style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}
          >
            <span style={{ 'font-size': '14px', color: theme.fg }}>{tr('Opacity')}</span>
            <span
              style={{
                'font-size': '13px',
                color: theme.fgMuted,
                'font-family': "'JetBrains Mono', monospace",
                'min-width': '36px',
                'text-align': 'right',
              }}
            >
              {Math.round(store.windowOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={Math.round(MIN_WINDOW_OPACITY * 100)}
            max="100"
            step={Math.round(WINDOW_OPACITY_STEP * 100)}
            value={Math.round(store.windowOpacity * 100)}
            aria-label={tr('Transparency')}
            onInput={(e) => setWindowOpacity(Number(e.currentTarget.value) / 100)}
            style={{ width: '100%', 'accent-color': theme.accent, cursor: 'pointer' }}
          />
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'font-size': '11px',
              color: theme.fgSubtle,
            }}
          >
            <span>{tr('More transparent')}</span>
            <span>{tr('Opaque')}</span>
          </div>
        </div>
        <Show when={readability() !== 'ok'}>
          <div style={{ 'font-size': '12px', color: theme.fgMuted }}>
            {tr(
              'At this level, text over a bright desktop falls below the contrast the built-in themes are checked against.',
            )}
          </div>
        </Show>
        <Show when={store.windowBlur === 'off'}>
          <div style={{ 'font-size': '12px', color: theme.fgMuted }}>
            {tr(
              'Has no effect while window blur is off — without a vibrancy material there is nothing behind the window for the backgrounds to reveal.',
            )}
          </div>
        </Show>
        <Show when={store.windowOpacity < 1}>
          <div style={{ 'font-size': '12px', color: theme.fgMuted }}>
            {tr(
              'Below 100% the terminal switches to transparent rendering, which xterm.js draws with greyscale rather than subpixel antialiasing — text may look slightly lighter. Set this back to 100% to compare.',
            )}
          </div>
        </Show>
      </Show>
    </SettingsCard>
  );
}

/** Display names for the four materials. Kept beside the section rather than in
 * `lib/window-blur.ts` so the value model stays free of UI text. */
const WINDOW_BLUR_LABELS: Record<WindowBlurMaterial, string> = {
  'under-window': 'Window',
  sidebar: 'Sidebar',
  hud: 'HUD panel',
  'fullscreen-ui': 'Full screen',
};

/**
 * Window blur, or an explanation of its absence.
 *
 * Electron 40 implements vibrancy on macOS only — a narrower rule than opacity's,
 * which also covers Windows — and Linux is one of this app's two published
 * targets. So the control is not rendered there, for the same reason the opacity
 * slider is not: a control that changes nothing is worse than no control, and
 * worse than a sentence saying why.
 *
 * Four materials out of Electron's fifteen; the shortlist is argued in
 * `lib/window-blur.ts`. The short version is that most of the fifteen name
 * controls (menu, popover, tooltip) rather than windows, and read as flat wash
 * when stretched across one.
 *
 * The description no longer claims panels stay opaque, because they no longer
 * do — that sentence was an accurate description of why the feature did not
 * work. Vibrancy is painted behind the web contents, and the terminal surface
 * covered nearly all of it, so the effect was visible only in the gaps. What
 * replaced the claim is the honest one: turning this on is what makes the
 * Transparency slider mean anything, and on its own it changes nothing, because
 * that slider defaults to fully opaque.
 */
function WindowBlurSection() {
  const supported = isWindowBlurSupported(rendererPlatform);
  return (
    <SettingsCard
      title={tr('Window blur')}
      description={
        supported
          ? tr(
              'Frosts the desktop behind the window. On its own it changes nothing — turn Transparency below 100% to let it show through.',
            )
          : tr(
              'Not available on Linux — Electron implements window blur on macOS only, so a control here would do nothing.',
            )
      }
    >
      <Show when={supported}>
        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }}>
          <For each={['off', ...WINDOW_BLUR_MATERIALS] as const}>
            {(value) => {
              const active = () => store.windowBlur === value;
              return (
                <button
                  type="button"
                  aria-pressed={active()}
                  onClick={() => setWindowBlur(value)}
                  style={{
                    padding: '7px 14px',
                    background: active() ? theme.bgSelected : theme.bgInput,
                    border: `1px solid ${active() ? theme.borderFocus : theme.border}`,
                    'border-radius': '8px',
                    cursor: 'pointer',
                    color: active() ? theme.fg : theme.fgMuted,
                    'font-size': '13px',
                  }}
                >
                  {value === 'off' ? tr('Off') : tr(WINDOW_BLUR_LABELS[value])}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </SettingsCard>
  );
}

/**
 * The left-hand navigation.
 *
 * Nine groups replace three tabs. The old split was `general` / `themes` /
 * `experimental`, which meant `general` held everything that was not a theme —
 * fourteen unrelated groups in one 600-line scroll, with the language picker
 * filed under "themes" because that tab happened to exist.
 *
 * The order is not alphabetical and not arbitrary. It runs from what a new user
 * changes first (language, what the app does, how it looks) through what a
 * working user changes occasionally (terminals, task defaults, AI tools) to what
 * is consulted rather than set (privacy, integrations, updates), with the
 * unfinished work last. `experimental` stays last for the same reason it was a
 * separate tab: it is the one group whose contents can change under you.
 *
 * The list is fixed rather than filtered by availability — `dockerAvailable`
 * hides a card inside `tasks`, not the group. A navigation whose items appear
 * and disappear between machines cannot be described in a bug report.
 */
const SETTINGS_SECTIONS = [
  'general',
  'appearance',
  'terminal',
  'tasks',
  'ai',
  'privacy',
  'integrations',
  'updates',
  'experimental',
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

/**
 * Nav label per group. A `switch` over literals rather than a lookup table so
 * every key is visible to the i18n coverage scanner as a literal `tr()` call.
 */
function sectionLabel(id: SettingsSectionId): string {
  switch (id) {
    case 'general':
      return tr('General');
    case 'appearance':
      return tr('Appearance');
    case 'terminal':
      return tr('Terminal');
    case 'tasks':
      return tr('Tasks');
    case 'ai':
      return tr('AI tools');
    case 'privacy':
      return tr('Privacy');
    case 'integrations':
      return tr('Integrations');
    case 'updates':
      return tr('Updates');
    case 'experimental':
      return tr('Experimental');
  }
}

export function SettingsDialog(props: SettingsDialogProps) {
  const titleId = createUniqueId();
  const [fonts, setFonts] = createSignal<string[]>(ensureSelectedFont(getAvailableTerminalFonts()));
  const [activeSection, setActiveSection] = createSignal<SettingsSectionId>('general');
  const [customThemeDialogOpen, setCustomThemeDialogOpen] = createSignal(false);
  const [editingThemeId, setEditingThemeId] = createSignal<string | null>(null);
  const [cloneCss, setCloneCss] = createSignal<string | undefined>(undefined);

  // Roving tabindex: only the selected nav item is in the tab order, and the
  // arrow keys move both selection and focus. The horizontal tabs this replaces
  // moved selection without focus, so a screen reader announced a panel the
  // user's focus was not in.
  const navButtons = new Map<SettingsSectionId, HTMLButtonElement>();
  const focusSection = (id: SettingsSectionId) => {
    setActiveSection(id);
    navButtons.get(id)?.focus();
  };
  const step = (from: SettingsSectionId, delta: number) => {
    const count = SETTINGS_SECTIONS.length;
    const next = SETTINGS_SECTIONS[(SETTINGS_SECTIONS.indexOf(from) + delta + count) % count];
    focusSection(next);
  };

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

  // Shared by the free-form control cards (editor command, provider picker,
  // docker image, sliders): the framed strip a control sits in.
  const controlRowStyle = {
    display: 'flex',
    'flex-direction': 'column',
    gap: '6px',
    padding: '8px 12px',
    'border-radius': '8px',
    background: theme.bgInput,
    border: `1px solid ${theme.border}`,
  } as const;
  const textInputStyle = {
    flex: '1',
    background: theme.taskPanelBg,
    border: `1px solid ${theme.border}`,
    'border-radius': '6px',
    padding: '6px 10px',
    color: theme.fg,
    'font-size': '14px',
    'font-family': "'JetBrains Mono', monospace",
    outline: 'none',
  } as const;
  const inlineLabelStyle = { display: 'flex', 'align-items': 'center', gap: '10px' } as const;
  const segmentedGroupStyle = {
    display: 'flex',
    gap: '4px',
    background: theme.bgInput,
    border: `1px solid ${theme.border}`,
    'border-radius': '8px',
    padding: '4px',
  } as const;
  const segmentedButtonStyle = (selected: boolean) => ({
    flex: '1',
    padding: '6px',
    'border-radius': '6px',
    border: 'none',
    background: selected ? theme.bgElevated : 'transparent',
    color: selected ? theme.fg : theme.fgMuted,
    cursor: 'pointer',
    'font-size': '13px',
    'font-weight': selected ? '600' : '400',
    transition: 'background 0.15s, color 0.15s',
  });

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
      width="880px"
      zIndex={1100}
      labelledBy={titleId}
      panelStyle={{
        'max-width': 'calc(100vw - 32px)',
        padding: '0',
        gap: '0',
        // The panel is a frame now, not a scroller: the nav must stay put and
        // the footer must stay visible while the content moves. `Dialog`'s own
        // `overflow: auto` would scroll all three together.
        height: 'min(660px, 80vh)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'flex-start',
          'justify-content': 'space-between',
          gap: '16px',
          padding: '20px 24px 16px',
          'border-bottom': `1px solid ${theme.border}`,
          'flex-shrink': '0',
        }}
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '3px' }}>
          {/* Product name, not a translatable string — the app is called this
              in every locale, and the catalogue keeps vendor names in English. */}
          <span style={{ ...sectionLabelStyle, color: theme.accent, 'font-weight': '600' }}>
            Parallel Code
          </span>
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

      <div style={{ display: 'flex', flex: '1', 'min-height': '0' }}>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={tr('Settings tabs')}
          style={{
            display: 'flex',
            'flex-direction': 'column',
            gap: '2px',
            width: '176px',
            'flex-shrink': '0',
            padding: '12px 8px',
            'border-right': `1px solid ${theme.border}`,
            'overflow-y': 'auto',
          }}
        >
          <For each={SETTINGS_SECTIONS}>
            {(id) => {
              const selected = () => activeSection() === id;
              return (
                <button
                  ref={(el) => navButtons.set(id, el)}
                  role="tab"
                  aria-selected={selected()}
                  aria-controls={selected() ? `settings-panel-${id}` : undefined}
                  id={`settings-tabbutton-${id}`}
                  type="button"
                  tabIndex={selected() ? 0 : -1}
                  onClick={() => setActiveSection(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      step(id, 1);
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      step(id, -1);
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      focusSection(SETTINGS_SECTIONS[0]);
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      focusSection(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]);
                    }
                  }}
                  style={{
                    'text-align': 'left',
                    background: selected() ? theme.bgSelected : 'transparent',
                    border: 'none',
                    'border-radius': '7px',
                    color: selected() ? theme.fg : theme.fgMuted,
                    cursor: 'pointer',
                    'font-size': '13px',
                    'font-weight': selected() ? '600' : '400',
                    padding: '7px 10px',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {sectionLabel(id)}
                </button>
              );
            }}
          </For>
        </div>

        {/* `tabIndex` so the scroll region is reachable from the keyboard: the
            dialog panel no longer scrolls, so without this the content of a long
            group would be unreadable without a mouse. */}
        <div
          id={`settings-panel-${activeSection()}`}
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`settings-tabbutton-${activeSection()}`}
          style={{
            flex: '1',
            'min-width': '0',
            'overflow-y': 'auto',
            padding: '18px 22px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '14px',
          }}
        >
          <Switch>
            <Match when={activeSection() === 'general'}>
              <SettingsCard
                title={tr('Language')}
                description={tr(
                  'Language of the Parallel Code interface. Terminal output is written by the agents and is not translated.',
                )}
              >
                <div style={segmentedGroupStyle}>
                  <For each={LOCALES}>
                    {(locale) => (
                      <button
                        type="button"
                        style={segmentedButtonStyle(store.locale === locale)}
                        onClick={() => setLocale(locale)}
                      >
                        {/* Each language names itself — a reader who cannot read
                            the current UI language still recognises their own. */}
                        {LOCALE_LABELS[locale]}
                      </button>
                    )}
                  </For>
                </div>
              </SettingsCard>

              <SettingsCard
                title={tr('Behavior')}
                description={tr('What Parallel Code does on its own while an agent is running.')}
              >
                <SettingsCheckboxRow
                  label={tr('Auto-trust folders')}
                  checked={store.autoTrustFolders}
                  onChange={setAutoTrustFolders}
                  description={tr('Automatically accept trust and permission dialogs from agents')}
                />
                <SettingsCheckboxRow
                  label={tr('Desktop notifications')}
                  checked={store.desktopNotificationsEnabled}
                  onChange={setDesktopNotificationsEnabled}
                  description={tr('Show native notifications when tasks finish or need attention')}
                />
              </SettingsCard>

              <SettingsCard
                title={tr('Interface')}
                description={tr('Which panels and sidebar sections are shown.')}
              >
                <SettingsCheckboxRow
                  label={tr('Show plans')}
                  checked={store.showPlans}
                  onChange={setShowPlans}
                  description={tr('Display Claude Code plan files in a tab next to Notes')}
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
              </SettingsCard>

              <SettingsCard
                title={tr('Editor')}
                description={tr(
                  'CLI command to open worktree folders. Click the path bar in a task to open it.',
                )}
              >
                <div style={controlRowStyle}>
                  <label style={inlineLabelStyle}>
                    <span style={{ 'font-size': '14px', color: theme.fg, 'white-space': 'nowrap' }}>
                      {tr('Editor command')}
                    </span>
                    <input
                      type="text"
                      value={store.editorCommand}
                      onInput={(e) => setEditorCommand(e.currentTarget.value)}
                      placeholder={tr('e.g. code, cursor, zed, subl')}
                      style={textInputStyle}
                    />
                  </label>
                </div>
              </SettingsCard>
            </Match>

            <Match when={activeSection() === 'appearance'}>
              <SettingsCard
                title={tr('Themes')}
                description={tr(
                  'Presets for light and dark, and which of the two the app follows.',
                )}
              >
                <div style={segmentedGroupStyle}>
                  <For each={['light', 'dark', 'system'] as AppearanceMode[]}>
                    {(appearance) => (
                      <button
                        type="button"
                        style={segmentedButtonStyle(store.appearanceMode === appearance)}
                        onClick={() => setAppearanceMode(appearance)}
                      >
                        {tr(appearance)}
                      </button>
                    )}
                  </For>
                </div>

                <div
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'flex-end',
                  }}
                >
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
                    {tr('+ Create New')}
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
                          {slot === 'dark' ? tr('Dark Theme') : tr('Light Theme')}
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
              </SettingsCard>

              <SettingsCard
                title={tr('Text rendering')}
                description={tr('Applies antialiased, grayscale font smoothing to the interface.')}
              >
                <SettingsCheckboxRow
                  label={tr('Font smoothing')}
                  checked={store.fontSmoothing}
                  onChange={setFontSmoothing}
                  description={tr('Enable antialiasing and geometric text rendering')}
                  align="flex-start"
                />
              </SettingsCard>

              <AppIconSection />

              <WindowOpacitySection />
              <WindowBlurSection />

              <SettingsCard
                title={tr('Focus Dimming')}
                description={tr('Dims every task column except the active one.')}
              >
                <div style={{ ...controlRowStyle, gap: '8px' }}>
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
              </SettingsCard>
            </Match>

            <Match when={activeSection() === 'terminal'}>
              <SettingsCard
                title={tr('Terminal Font')}
                description={tr('Font used to draw every terminal panel.')}
              >
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
              </SettingsCard>

              <CjkFontSection />
            </Match>

            <Match when={activeSection() === 'tasks'}>
              <SettingsCard
                title={tr('New Task Defaults')}
                description={tr(
                  'How the New Task dialog is pre-filled. Every task can still be changed before it starts.',
                )}
              >
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
              </SettingsCard>

              <SettingsCard
                title={tr('Custom Agents')}
                description={tr(
                  'CLI agents added here appear in the agent picker alongside the built-in ones.',
                )}
              >
                <CustomAgentEditor />
              </SettingsCard>

              <Show when={store.dockerAvailable}>
                <SettingsCard
                  title={tr('Docker Isolation')}
                  description={tr(
                    'Docker image used when "Run in Docker container" is enabled for a task. The agent runs inside the container with only the project directory mounted.',
                  )}
                >
                  <div style={controlRowStyle}>
                    <label style={inlineLabelStyle}>
                      <span
                        style={{ 'font-size': '14px', color: theme.fg, 'white-space': 'nowrap' }}
                      >
                        {tr('Default image')}
                      </span>
                      <input
                        type="text"
                        value={store.dockerImage}
                        onInput={(e) => setDockerImage(e.currentTarget.value)}
                        placeholder={DEFAULT_DOCKER_IMAGE}
                        style={textInputStyle}
                      />
                    </label>
                    <div style={{ 'font-size': '11px', color: theme.fgMuted, 'margin-top': '4px' }}>
                      {/* The path is a styled <code> element, not a string, so the
                          sentence renders from segments and the translation decides
                          which side of it the path falls on. */}
                      <For
                        each={trParts(
                          'Projects with a {path} will use a project-specific image instead.',
                        )}
                      >
                        {(segment) =>
                          segment.kind === 'text' ? (
                            segment.value
                          ) : (
                            <code
                              style={{
                                'font-family': "'JetBrains Mono', monospace",
                                'font-size': '11px',
                              }}
                            >
                              {PROJECT_DOCKERFILE_RELATIVE_PATH}
                            </code>
                          )
                        }
                      </For>
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
                </SettingsCard>
              </Show>
            </Match>

            <Match when={activeSection() === 'ai'}>
              <SettingsCard
                title={tr('Ask about Code')}
                description={tr(
                  'Which model answers questions about text you select in the diff and plan views.',
                )}
              >
                <div style={controlRowStyle}>
                  <label style={inlineLabelStyle}>
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
                    <label style={{ ...inlineLabelStyle, 'margin-top': '4px' }}>
                      <span
                        style={{ 'font-size': '13px', color: theme.fg, 'white-space': 'nowrap' }}
                      >
                        {tr('MiniMax API key')}
                      </span>
                      <input
                        type="password"
                        onInput={(e) => setMinimaxApiKey(e.currentTarget.value)}
                        placeholder={tr('Enter your MINIMAX_API_KEY (stored in memory only)')}
                        style={{ ...textInputStyle, 'font-size': '13px' }}
                      />
                    </label>
                  </Show>
                  <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>
                    {store.askCodeProvider === 'minimax'
                      ? tr(
                          'Uses MiniMax M2.7 (204K context) via the OpenAI-compatible API — no Claude Code CLI required.',
                        )
                      : tr(
                          'Uses the claude CLI to answer questions about selected code. Requires Claude Code to be installed.',
                        )}
                  </span>
                </div>
              </SettingsCard>

              <SettingsCard
                title={tr('AI Usage')}
                description={tr(
                  'Token counts read from AI CLI logs already on this machine. Nothing is requested from a vendor.',
                )}
              >
                <TokenUsageSection />
              </SettingsCard>
            </Match>

            <Match when={activeSection() === 'privacy'}>
              <SettingsCard
                title={tr('Privacy')}
                description={tr('What leaves this machine, and what is written to disk.')}
              >
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
              </SettingsCard>

              <SettingsCard
                title={tr('Diagnostics')}
                description={tr('Extra logging for reporting a problem. Off by default.')}
              >
                <SettingsCheckboxRow
                  label={tr('Verbose logging')}
                  checked={store.verboseLogging}
                  onChange={setVerboseLogging}
                  description={tr(
                    'Emit debug-level logs to the developer console. Verbose logs may include file paths, branch names, commit messages, IPC channel activity, and pty lifecycle events. Review the contents before sharing.',
                  )}
                />
              </SettingsCard>
            </Match>

            <Match when={activeSection() === 'integrations'}>
              <SettingsCard
                title="Huly"
                description={tr(
                  'Connect a Huly workspace so a task can start from an issue. The token is encrypted by the OS keychain and never read back for display.',
                )}
              >
                <HulySettings />
              </SettingsCard>
            </Match>

            <Match when={activeSection() === 'updates'}>
              <SettingsCard
                title={tr('Updates')}
                description={tr('Which version is running, and whether a newer one is available.')}
              >
                <div style={{ ...controlRowStyle, gap: '10px', padding: '12px' }}>
                  <div style={updateRowStyle}>
                    <span style={{ 'font-size': '14px', color: theme.fg }}>
                      {tr('Current version')}
                      <Show when={updateStatus().currentVersion}>
                        {' '}
                        <span style={{ color: theme.fgMuted }}>
                          v{updateStatus().currentVersion}
                        </span>
                      </Show>
                    </span>
                    <Show when={canCheckForUpdates()}>
                      <button
                        type="button"
                        disabled={updateStatus().phase === 'checking'}
                        onClick={() => void checkForUpdates()}
                        style={updateSecondaryButtonStyle(updateStatus().phase === 'checking')}
                      >
                        {updateStatus().phase === 'checking'
                          ? tr('Checking…')
                          : tr('Check for updates')}
                      </button>
                    </Show>
                  </div>

                  <Switch>
                    <Match when={updateStatus().phase === 'unsupported'}>
                      <span style={updateMessageStyle(theme.fgSubtle)}>
                        {tr(
                          'Automatic updates are not available for this build. Download the latest release from GitHub to update.',
                        )}
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
                        {tr(
                          'Version {version} is available. Use the update button in the sidebar to install.',
                          {
                            version: updateStatus().latestVersion ?? '',
                          },
                        )}
                      </span>
                    </Match>

                    <Match when={updateStatus().phase === 'downloading'}>
                      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
                        <span style={updateMessageStyle(theme.fgSubtle)}>
                          {tr('Downloading update… {percent}%', {
                            percent: updateStatus().downloadPercent ?? 0,
                          })}
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
                        {tr(
                          'Version {version} is downloaded. Use the update button in the sidebar to restart & install.',
                          { version: updateStatus().latestVersion ?? '' },
                        )}
                      </span>
                    </Match>

                    <Match when={updateStatus().phase === 'error'}>
                      <span style={updateMessageStyle(theme.error)}>
                        {tr('Update check failed: {error}', { error: updateStatus().error ?? '' })}
                      </span>
                    </Match>
                  </Switch>
                </div>
              </SettingsCard>
            </Match>

            <Match when={activeSection() === 'experimental'}>
              <SettingsCard
                title={tr('Coordinator')}
                description={tr('Lets one task spawn and drive sub-tasks through MCP tools.')}
              >
                <SettingsCheckboxRow
                  label={tr('Coordinator mode')}
                  checked={store.coordinatorModeEnabled}
                  onChange={setCoordinatorModeEnabled}
                  description={tr(
                    'Enable the Coordinator option when creating tasks. Coordinators can spawn sub-tasks, send prompts, and merge branches automatically via MCP tools. Requires app restart to fully disable.',
                  )}
                />
                <div style={controlRowStyle}>
                  <label style={inlineLabelStyle}>
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
                        ...textInputStyle,
                        flex: '0 0 auto',
                        width: '80px',
                        'text-align': 'right',
                      }}
                    />
                  </label>
                  <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                    {tr(
                      'How long the coordinator waits before firing a notification after a sub-task completes. Default: 60s. Failed sub-tasks use max(10s, delay ÷ 4).',
                    )}
                  </span>
                </div>
              </SettingsCard>
            </Match>
          </Switch>
        </div>
      </div>

      {/*
        The footer says what the dialog does, and the button does what it says.
        Nothing here is staged: every control above writes to the store on
        change, and `setupAutosave` persists the result — so a "Save" button
        would be a button that saves nothing, and a "Cancel" button would be a
        lie about what closing does. The honest pair is one sentence and one
        button that closes.
      */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: '12px',
          padding: '14px 24px',
          'border-top': `1px solid ${theme.border}`,
          'flex-shrink': '0',
        }}
      >
        <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
          {tr('Changes apply immediately and are saved automatically.')}
        </span>
        <button
          type="button"
          onClick={() => props.onClose()}
          style={{
            background: theme.accent,
            border: 'none',
            color: theme.accentText,
            cursor: 'pointer',
            'font-size': '13px',
            'font-weight': '600',
            padding: '7px 20px',
            'border-radius': '7px',
          }}
        >
          {tr('Close')}
        </button>
      </div>

      <CustomThemeDialog
        open={customThemeDialogOpen()}
        editId={editingThemeId()}
        initialCss={cloneCss()}
        onClose={() => setCustomThemeDialogOpen(false)}
      />
    </Dialog>
  );
}
