// Shell operations — wraps Electron shell IPC calls.

import { IPC } from '../../electron/ipc/channels';
import type { ExternalTerminalApp } from './native-terminal';

export async function revealItemInDir(filePath: string): Promise<void> {
  await window.electron.ipcRenderer.invoke(IPC.ShellReveal, { filePath });
}

export async function openFileInEditor(worktreePath: string, filePath: string): Promise<void> {
  const errorMessage = (await window.electron.ipcRenderer.invoke(IPC.ShellOpenFile, {
    worktreePath,
    filePath,
  })) as string;
  if (errorMessage) throw new Error(errorMessage);
}

export async function openInEditor(editorCommand: string, worktreePath: string): Promise<void> {
  await window.electron.ipcRenderer.invoke(IPC.ShellOpenInEditor, {
    editorCommand,
    worktreePath,
  });
}

/**
 * Open a worktree in an external terminal emulator.
 *
 * Rejects rather than resolving quietly when the app is missing — the caller
 * turns that into something the user can read. See `IPC.ShellOpenTerminal`.
 */
export async function openInNativeTerminal(
  app: ExternalTerminalApp,
  worktreePath: string,
): Promise<void> {
  await window.electron.ipcRenderer.invoke(IPC.ShellOpenTerminal, { app, worktreePath });
}
