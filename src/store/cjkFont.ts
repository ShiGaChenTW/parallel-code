// Traditional-Chinese terminal font selection — the impure half.
//
// Every decision this module makes is delegated to `src/lib/cjk-fonts.ts`,
// which is pure and covered by tests. What lives here is the part that cannot
// be: IPC calls, the consent dialog, and a signal the Settings view renders.
// The component stays a dumb view over `cjkFontStatus()`.

import { createSignal } from 'solid-js';

import {
  fontAfterInstallAttempt,
  planCjkFontSelection,
  type CjkFontInstallOutcome,
  type FontMessage,
} from '../lib/cjk-fonts';
import { confirm } from '../lib/dialog';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { store } from './core';
import { tr } from './i18n';
import { setTerminalFont } from './ui';

export type CjkFontPhase = 'idle' | 'downloading' | 'notice' | 'error';

export interface CjkFontStatus {
  readonly phase: CjkFontPhase;
  readonly family: string;
  readonly message: FontMessage | null;
  /**
   * Set when the last attempt failed in a way that trying again could fix.
   * A failure with no way forward is a dead end, so the view renders a Retry
   * button whenever this is present.
   */
  readonly retryFamily: string | null;
}

const IDLE: CjkFontStatus = { phase: 'idle', family: '', message: null, retryFamily: null };

const [cjkFontStatus, setCjkFontStatus] = createSignal<CjkFontStatus>(IDLE);
const [installedFamilies, setInstalledFamilies] = createSignal<readonly string[]>([]);

export { cjkFontStatus, installedFamilies };

export function dismissCjkFontStatus(): void {
  setCjkFontStatus(IDLE);
}

/**
 * Ask the main process which font families are present.
 *
 * Failure is deliberately quiet: an empty list means "nothing detected", which
 * makes the app offer to install rather than silently assume a font is there.
 * Offering an unnecessary download is recoverable; wrongly applying a font
 * that is not installed is the state that looks broken.
 */
export async function refreshInstalledCjkFonts(): Promise<void> {
  try {
    setInstalledFamilies(await invoke<string[]>(IPC.ListInstalledCjkFonts));
  } catch {
    setInstalledFamilies([]);
  }
}

/**
 * Handle the user picking `family` in Settings.
 *
 * Nothing here decides policy — `planCjkFontSelection` does, and this function
 * carries out whichever of the four outcomes it returned.
 */
export async function chooseCjkFont(family: string): Promise<void> {
  const previous = store.terminalFont;
  const plan = planCjkFontSelection({
    family,
    installedFamilies: installedFamilies(),
    offlineMode: store.offlineMode,
  });

  if (plan.action === 'apply') {
    setCjkFontStatus(IDLE);
    setTerminalFont(family);
    return;
  }

  if (plan.action === 'blocked-offline') {
    setCjkFontStatus({ phase: 'notice', family, message: plan.message, retryFamily: null });
    return;
  }

  if (plan.action === 'manual-install') {
    setCjkFontStatus({ phase: 'notice', family, message: plan.message, retryFamily: null });
    // An ordinary link handed to the user's browser. No request is made by the
    // app, which is why offline mode does not gate this path.
    await invoke(IPC.ShellOpenExternal, { url: plan.releasePageUrl });
    return;
  }

  const consented = await confirm(tr(plan.message.text, plan.message.params), {
    title: 'Download font',
    okLabel: 'Download',
    cancelLabel: "Don't download",
  });
  if (!consented) {
    finish(previous, family, 'declined');
    return;
  }

  setCjkFontStatus({ phase: 'downloading', family, message: null, retryFamily: null });
  try {
    await invoke(IPC.InstallCjkFont, { family });
    await refreshInstalledCjkFonts();
    finish(previous, family, 'installed');
  } catch (err) {
    finish(previous, family, 'failed', err);
  }
}

/** Re-run the whole flow for the font that failed, consent prompt included. */
export async function retryCjkFontInstall(): Promise<void> {
  const family = cjkFontStatus().retryFamily;
  if (family) await chooseCjkFont(family);
}

function finish(
  previous: string,
  requested: string,
  outcome: CjkFontInstallOutcome,
  err?: unknown,
): void {
  // Declining or failing leaves the previous font in place. Applying the
  // choice anyway would drop xterm to its `monospace` fallback, which is
  // indistinguishable from the feature being broken.
  const next = fontAfterInstallAttempt(previous, requested, outcome);
  if (next !== previous) setTerminalFont(next);

  if (outcome === 'installed') {
    setCjkFontStatus({
      phase: 'notice',
      family: requested,
      message: { text: '{font} installed.', params: { font: requested } },
      retryFamily: null,
    });
    return;
  }
  if (outcome === 'declined') {
    setCjkFontStatus({
      phase: 'notice',
      family: requested,
      message: {
        text: '{font} was not downloaded, so your terminal font is still {previous}.',
        params: { font: requested, previous },
      },
      retryFamily: null,
    });
    return;
  }
  setCjkFontStatus({
    phase: 'error',
    family: requested,
    message: {
      text: 'Could not install {font}: {reason} Your terminal font is still {previous}.',
      params: { font: requested, reason: readableError(err), previous },
    },
    retryFamily: requested,
  });
}

/**
 * Strip Electron's IPC wrapper off a main-process error.
 *
 * `ipcMain.handle` rejections arrive as
 * `Error invoking remote method 'install_cjk_font': Error: <the real message>`,
 * and showing that to a user buries the sentence that was written for them.
 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = /Error invoking remote method '[^']*':\s*(?:Error:\s*)?(.*)$/s.exec(raw);
  return (match ? match[1] : raw).trim();
}
