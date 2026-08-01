import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { registerAllHandlers } from './ipc/register.js';
import { registerLogHandler } from './log.js';
import { installIpcTracing } from './ipc/trace.js';
import { killAllAgents } from './ipc/pty.js';
import { stopAllPlanWatchers } from './ipc/plans.js';
import { stopAllStepsWatchers } from './ipc/steps.js';
import { stopAllHandoffWatchers } from './ipc/handoff.js';
import { stopTokenUsageWatcher } from './ipc/token-usage.js';
import { IPC } from './ipc/channels.js';
import { loadAppState } from './ipc/persistence.js';
import {
  WINDOW_BACKDROP_OPAQUE,
  WINDOW_BACKDROP_TRANSPARENT,
  WINDOW_VISUAL_EFFECT_STATE,
  applyWindowBlur,
  effectiveWindowBlur,
  isWindowBlurSupported,
  windowBlurFromState,
} from './ipc/window-blur.js';
import type { WindowBlurMaterial } from './ipc/window-blur.js';
import { markStartup } from './startup-timing.js';
import { startEnvImport } from './env-import.js';

// First line of our own code to run. Everything before this — Electron's own
// boot — is invisible from in-process, which is why the harness subtracts its
// own spawn time rather than trusting this as t0.
markStartup('main-module-loaded');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When launched from a .desktop file (e.g. AppImage) or the macOS Dock, the
// environment is minimal — often just PATH=/usr/bin:/bin:/usr/sbin:/sbin.
// Resolve the user's full login-interactive shell environment and merge it into
// process.env so spawned PTYs can find CLI tools (claude, codex, gemini, etc.)
// and inherit other expected variables (SSH_AGENT_LAUNCHER, KUBECONFIG, etc.).
//
// Synchronous on the startup path by design: everything downstream reads
// process.env, and the measured cost of the shell round-trip is ~0.4s. What is
// no longer synchronous is the *failure* path — see electron/env-import.ts for
// the retry and reporting behaviour, and for why a failed import now leaves a
// trail a user can act on instead of a single console.warn.
startEnvImport();

// Verify that preload.cjs ALLOWED_CHANNELS stays in sync with the IPC enum.
// Logs a warning in dev if they drift — catches mismatches before they hit users.
//
// preload.cjs uses an inline ALLOWED_CHANNELS literal because sandboxed
// preloads cannot require arbitrary local JSON. Keep that literal in sync
// with the shared channel manifest that backs the IPC export.
function verifyPreloadAllowlist(): void {
  try {
    const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
    const preloadSrc = fs.readFileSync(preloadPath, 'utf8');
    const allowlistMatch = /new Set\(\[([\s\S]*?)\]\)/.exec(preloadSrc);
    if (!allowlistMatch) {
      console.warn('[preload-sync] preload.cjs ALLOWED_CHANNELS literal not found');
      return;
    }
    const preloadValues = new Set(
      [...allowlistMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    );
    const enumValues = new Set(Object.values(IPC));
    const missing = [...enumValues].filter((v) => !preloadValues.has(v));
    const extra = [...preloadValues].filter((v) => !enumValues.has(v));
    if (missing.length > 0 || extra.length > 0) {
      console.warn(
        `[preload-sync] preload.cjs ALLOWED_CHANNELS drift: missing=${missing.join(', ')} extra=${extra.join(', ')}`,
      );
    }
  } catch {
    // Preload file may not be readable in packaged app — skip check
  }
}

if (!app.isPackaged) verifyPreloadAllowlist();

let mainWindow: BrowserWindow | null = null;

function getIconPath(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(__dirname, '..', 'build', 'icon.png');
}

/**
 * The persisted appearance settings that have to be in place before the first
 * frame, as `BrowserWindow` constructor options.
 *
 * Read here rather than pushed from the renderer after boot — the way the app
 * icon is — because both are visible from the first frame. Waiting for
 * `loadState()` to round-trip through IPC would open every launch opaque and
 * unblurred and then pop to the user's settings, which reads as a rendering bug.
 * The cost is one `state.json` read and parse before the window opens; the
 * renderer reads the same file moments later anyway.
 *
 * Transparency is no longer read here, and that is the point of the change it
 * came from: it is a CSS custom property now, so it lands with the renderer's
 * first paint like every other theme value, and there is no `opacity` on the
 * window for a stale state file to get wrong. What is left is the native half,
 * which genuinely cannot wait for the renderer.
 *
 * `backgroundColor` is set explicitly in both directions, and that matters more
 * than it looks. The runtime off path (`applyWindowBlur`) restores
 * `WINDOW_BACKDROP_OPAQUE`, so construction has to use the same value — if it
 * left the option unset, Electron's default white would mean "launched with blur
 * off" and "switched blur off" produced two different windows.
 *
 * `visualEffectState` is the one member here that is *not* derived from the
 * persisted setting, and it has to be handed over at construction because
 * Electron gives it no setter (electron#25513). See `WINDOW_VISUAL_EFFECT_STATE`
 * for why it is passed even when no material is set.
 *
 * `undefined` on any failure: a profile whose state file cannot be read must
 * still get a window, and it gets the plain one.
 */
function initialWindowChrome(): {
  vibrancy: WindowBlurMaterial | undefined;
  visualEffectState: typeof WINDOW_VISUAL_EFFECT_STATE | undefined;
  backgroundColor: string | undefined;
} {
  const blurSupported = isWindowBlurSupported(process.platform);
  // Not derived from state, so it survives an unreadable state file — the one
  // appearance option that must not depend on the read below succeeding.
  const visualEffectState = blurSupported ? WINDOW_VISUAL_EFFECT_STATE : undefined;
  const none = {
    vibrancy: undefined,
    visualEffectState,
    backgroundColor: undefined,
  };
  let state: string | null;
  try {
    state = loadAppState();
  } catch (err) {
    console.warn('[main] Failed to read persisted window appearance:', err);
    return none;
  }

  // The OS accessibility flag outranks the stored setting: launching with a
  // material while "Reduce transparency" is on would give a window macOS refuses
  // to blur behind a page the CSS has already made see-through.
  const blur = blurSupported
    ? effectiveWindowBlur(windowBlurFromState(state), nativeTheme.prefersReducedTransparency)
    : 'off';

  return {
    vibrancy: blur === 'off' ? undefined : blur,
    visualEffectState,
    backgroundColor: blurSupported
      ? blur === 'off'
        ? WINDOW_BACKDROP_OPAQUE
        : WINDOW_BACKDROP_TRANSPARENT
      : undefined,
  };
}

/**
 * Re-apply the blur when macOS's "Reduce transparency" setting is toggled while
 * the app is running.
 *
 * Without this the flag is only honoured at launch, and the two directions fail
 * differently. Turning it *on* is survivable — the renderer's media query fires
 * and repaints opaque over a still-vibrant window. Turning it *off* is not: the
 * window was constructed opaque, so the CSS becomes translucent over a backdrop
 * that has nothing behind it, which is the same hole this whole path exists to
 * close. One listener makes both directions correct instead of one.
 *
 * State is re-read from disk rather than cached, for the same reason the IPC
 * handlers take both settings in their payload: main holds no appearance state
 * of its own, so there is nothing here that can drift from what the renderer
 * believes. The read only happens on a system appearance change, which is a
 * human-speed event.
 */
function watchReducedTransparency(): void {
  if (!isWindowBlurSupported(process.platform)) return;
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const stored = windowBlurFromState(loadAppState());
      applyWindowBlur(
        mainWindow,
        effectiveWindowBlur(stored, nativeTheme.prefersReducedTransparency),
      );
    } catch (err) {
      console.warn('[main] Failed to re-apply window blur after a theme change:', err);
    }
  });
}

function createWindow() {
  markStartup('window-created');
  const chrome = initialWindowChrome();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: getIconPath(),
    vibrancy: chrome.vibrancy,
    visualEffectState: chrome.visualEffectState,
    backgroundColor: chrome.backgroundColor,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Order matters: register the LogFromRenderer handler BEFORE installing
  // the IPC tracing wrapper so log forwards don't themselves emit ipc/git
  // debug traces (which would triple log volume in dev/verbose).
  registerLogHandler(ipcMain);
  installIpcTracing(ipcMain);
  registerAllHandlers(mainWindow);

  // Open links in external browser instead of inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell
        .openExternal(url)
        .catch((e: unknown) => console.warn('[main] Failed to open external URL:', e));
    }
    return { action: 'deny' };
  });

  const devOrigin = process.env.VITE_DEV_SERVER_URL;
  let allowedOrigin: string | undefined;
  try {
    if (devOrigin) allowedOrigin = new URL(devOrigin).origin;
  } catch {
    // Malformed dev URL — skip origin allowlist
  }

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (allowedOrigin && url.startsWith(allowedOrigin)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell
        .openExternal(url)
        .catch((e: unknown) => console.warn('[main] Failed to open external URL:', e));
    }
  });

  // Inject CSS to make data-tauri-drag-region work in Electron
  mainWindow.webContents.on('did-finish-load', () => {
    markStartup('renderer-loaded');
    mainWindow?.webContents.insertCSS(`
      [data-tauri-drag-region] { -webkit-app-region: drag; }
      [data-tauri-drag-region] button,
      [data-tauri-drag-region] input,
      [data-tauri-drag-region] select,
      [data-tauri-drag-region] textarea { -webkit-app-region: no-drag; }
    `);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  watchReducedTransparency();
}

app.whenReady().then(() => {
  markStartup('app-ready');
  // Grant microphone and clipboard access (deny camera/video)
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
        return callback(true);
      }
      if (permission === 'media') {
        const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
        return callback(types.every((t) => t === 'audio'));
      }
      callback(false);
    },
  );

  createWindow();
});

app.on('before-quit', () => {
  killAllAgents();
  stopAllPlanWatchers();
  stopAllStepsWatchers();
  stopAllHandoffWatchers();
  stopTokenUsageWatcher();
});

app.on('window-all-closed', () => {
  app.quit();
});
