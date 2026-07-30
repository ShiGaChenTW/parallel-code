import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `electron-updater`'s `autoUpdater` is a lazy getter that touches `app` on
// first access; the module under test resolves it lazily for exactly that
// reason. Mocking it lets us assert the network call was never reached.
const { mockCheckForUpdates, mockDownloadUpdate } = vi.hoisted(() => ({
  mockCheckForUpdates: vi.fn(() => Promise.resolve(null)),
  mockDownloadUpdate: vi.fn(() => Promise.resolve([])),
}));

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.13.0' },
}));

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: true,
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      checkForUpdates: mockCheckForUpdates,
      downloadUpdate: mockDownloadUpdate,
      quitAndInstall: vi.fn(),
    },
  },
}));

const { checkForUpdates, downloadUpdate, getUpdateStatus } = await import('./updater.js');
const { setOfflineMode } = await import('./offline.js');

// macOS reports as updatable unconditionally; the Linux path needs APPIMAGE.
// Pin the platform so the suite exercises the supported branch everywhere.
const realPlatform = process.platform;
beforeEach(() => {
  // The gate is module-level state. Set it explicitly here so each test holds
  // regardless of order, rather than inheriting a previous test's cleanup.
  setOfflineMode(false);
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  mockCheckForUpdates.mockClear();
  mockDownloadUpdate.mockClear();
});

afterEach(() => {
  setOfflineMode(false);
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
});

describe('checkForUpdates with offline mode on', () => {
  it('never contacts GitHub Releases', async () => {
    setOfflineMode(true);
    await checkForUpdates();
    expect(mockCheckForUpdates).not.toHaveBeenCalled();
  });

  it('reports the offline phase instead of spinning on "checking"', async () => {
    setOfflineMode(true);
    const status = await checkForUpdates();
    expect(status.phase).toBe('offline');
  });

  it('states the reason and the remedy, so the button is not a dead end', async () => {
    setOfflineMode(true);
    const status = await checkForUpdates();
    expect(status.error).toContain('Offline mode is on');
    expect(status.error).toContain('Turn it off in Settings');
  });

  it('leaves the phase readable from getUpdateStatus for a late subscriber', async () => {
    setOfflineMode(true);
    await checkForUpdates();
    expect(getUpdateStatus().phase).toBe('offline');
  });
});

describe('downloadUpdate with offline mode on', () => {
  it('never downloads, even when a version was already found before the switch', async () => {
    setOfflineMode(true);
    await downloadUpdate();
    expect(mockDownloadUpdate).not.toHaveBeenCalled();
  });
});

describe('with offline mode off', () => {
  it('reaches electron-updater as before', async () => {
    await checkForUpdates();
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
  });
});
