import path from 'path';
import { fileURLToPath } from 'url';
import { app, nativeImage, type BrowserWindow } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ids of the shipped app-icon variants. Kept in sync by hand with
 * `src/lib/app-icon.ts` (renderer-side labels/swatches) and with the PNG files
 * under `build/icons/`.
 */
export const APP_ICON_IDS = [
  'terminal-green',
  'signal-amber',
  'indigo-dusk',
  'nord',
  'mono-paper',
  'classic',
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

export const DEFAULT_APP_ICON: AppIconId = 'terminal-green';

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === 'string' && (APP_ICON_IDS as readonly string[]).includes(value);
}

/**
 * Packaged builds get `build/icons/` copied to `resources/icons/` via
 * electron-builder `extraResources`; dev runs read straight out of the repo.
 */
function iconFile(id: AppIconId, size: number): string {
  const name = `${id}-${size}.png`;
  if (app.isPackaged) return path.join(process.resourcesPath, 'icons', name);
  return path.join(__dirname, '..', '..', 'build', 'icons', name);
}

/**
 * Swap the running app's icon.
 *
 * The `.icns` baked into a macOS `.app` bundle cannot be replaced at runtime —
 * what this changes is the Dock icon, which is the part users actually look at
 * while the app is open. On Linux it swaps the window icon. Windows is not a
 * published target for this app, so it is deliberately a no-op there.
 *
 * Returns false when the variant's PNG could not be read, so callers can leave
 * the previous icon in place rather than blanking it.
 */
export function applyAppIcon(win: BrowserWindow | null, id: AppIconId): boolean {
  if (process.platform === 'darwin') {
    if (!app.dock) return false;
    const image = nativeImage.createFromPath(iconFile(id, 512));
    if (image.isEmpty()) return false;
    app.dock.setIcon(image);
    return true;
  }

  if (process.platform === 'linux') {
    if (!win || win.isDestroyed()) return false;
    const image = nativeImage.createFromPath(iconFile(id, 256));
    if (image.isEmpty()) return false;
    win.setIcon(image);
    return true;
  }

  return false;
}
