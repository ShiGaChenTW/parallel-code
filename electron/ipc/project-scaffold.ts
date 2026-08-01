// Creating a brand-new project folder, and optionally initialising it as an
// S.CodingFlow project.
//
// WHICH COMMAND, AND HOW IT WAS ESTABLISHED
//
// The command is `scvb-specgate init`, run with the new folder as its working
// directory. That was verified on this machine rather than taken from the
// S.CodingFlow docs, because the docs and the installed binaries disagree at
// first glance:
//
//   which scvb           -> not found
//   which specgate       -> /opt/homebrew/bin/specgate     (no `init` subcommand)
//   which scvb-specgate  -> /opt/homebrew/bin/scvb-specgate (HAS `init`)
//
// `specgate` and `scvb-specgate` are two different binaries. The short one
// exposes only `hook`, `status`, `check` and `version`; the prefixed one is the
// full CLI, and its own help lists `init` exactly as 使用方法.md describes it:
// "openspec scaffold（冪等，不覆蓋）". So the documented command is correct and
// present — it just is not the binary a `which specgate` lands on.
//
// A trap worth recording: `scvb-specgate init --help` is NOT read-only. It
// prints a plan and creates the files anyway. Nothing here may invoke it to
// probe for availability; availability is decided by resolving the command on
// PATH, which touches no disk. (`init --check` is the genuinely read-only form.)
//
// WHAT IS DELIBERATELY NOT RUN
//
// Only `init`. The documented sequence continues `setup` / `setup --yes` /
// `doctor`, and `setup --yes` merges PreToolUse and UserPromptSubmit hooks into
// the project's `.claude/settings.json`. That is a change to how the user's
// coding agent behaves, and an app creating a folder has no business making it
// without being asked. `init` is idempotent, overwrites nothing, and only adds
// template files — which is the whole of what "start this folder as an
// S.CodingFlow project" needs to mean here.
//
// The tool being absent is never an error. The folder is created and the
// project is added either way; the skip is reported as information.

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import { resolveCommandPath } from '../command-path.js';
import { debug as logDebug } from '../log.js';

/** The verified S.CodingFlow entry point. See the header for how. */
export const SPECGATE_COMMAND = 'scvb-specgate';

/** Give up rather than hang if the CLI stalls; the folder is already made. */
const SPECGATE_TIMEOUT_MS = 60_000;

export type FolderNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate a folder name typed into the New Project dialog.
 *
 * Returns the reason rather than throwing, because the dialog renders it under
 * the field as the user types — the common path is that a rejection never
 * becomes an error, only a disabled button and a hint.
 */
export function validateProjectFolderName(raw: string): FolderNameCheck {
  const name = raw.trim();

  if (!name) {
    return { ok: false, reason: 'Enter a name for the project folder.' };
  }
  if (name.length > 255) {
    return { ok: false, reason: 'That name is too long for a folder (255 characters maximum).' };
  }
  // Escaped rather than written literally: a literal control character in
  // the source makes git classify this whole file as binary, which costs
  // every future diff and review of it.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001F\u007F]/.test(name)) {
    return { ok: false, reason: 'A folder name cannot contain line breaks or control characters.' };
  }
  if (name.includes('/') || name.includes('\\')) {
    return {
      ok: false,
      reason: 'A folder name cannot contain a slash. Choose the destination with "Change…".',
    };
  }
  if (name === '.' || name === '..') {
    return { ok: false, reason: 'That is not a folder name.' };
  }
  if (name.startsWith('.')) {
    return {
      ok: false,
      reason: 'A name starting with a dot creates a hidden folder you will not see in Finder.',
    };
  }
  if (name.startsWith('-')) {
    return {
      ok: false,
      reason: 'A name starting with a dash is read as an option by command-line tools.',
    };
  }

  return { ok: true, name };
}

/**
 * Create the project folder. Fails if anything is already there.
 *
 * Deliberately not `recursive: true`. Creating missing parents would let a
 * typo'd destination silently build a tree nobody asked for, and adopting an
 * existing directory would turn "new project" into "whatever was already in
 * that folder" — including, in the worst case, a folder full of files the
 * S.CodingFlow scaffold then writes into.
 */
export async function createProjectFolder(parentDir: string, name: string): Promise<string> {
  const check = validateProjectFolderName(name);
  if (!check.ok) throw new Error(check.reason);

  const parent = path.resolve(parentDir);
  const target = path.resolve(parent, check.name);

  // Belt and braces over `validateProjectFolderName`: the join is the thing
  // that can escape, so the escape is checked after the join.
  if (path.dirname(target) !== parent) {
    throw new Error('That name would create the folder outside the destination you chose.');
  }

  if (!fs.existsSync(parent)) {
    throw new Error(`The destination folder no longer exists: ${parent}`);
  }
  if (fs.existsSync(target)) {
    throw new Error(
      `"${check.name}" already exists in that destination. Choose a different name, or add it with "Choose a local folder".`,
    );
  }

  await fs.promises.mkdir(target);
  return target;
}

export type ScaffoldToolResult =
  | { readonly ran: true }
  | { readonly ran: false; readonly reason: string };

export interface SpecgateDeps {
  /** Locate the CLI without touching the disk beyond a PATH stat. */
  readonly resolve?: (command: string) => string | null;
  /** Run it. Rejects on non-zero exit. */
  readonly run?: (command: string, args: string[], cwd: string) => Promise<void>;
}

function defaultRun(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: SPECGATE_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message)
          .trim()
          .split('\n')
          .filter(Boolean)
          .slice(-3)
          .join(' ');
        reject(new Error(detail || err.message));
        return;
      }
      resolve();
    });
  });
}

/**
 * Run `scvb-specgate init` inside a freshly created folder.
 *
 * Never throws. Both "not installed" and "exited non-zero" come back as
 * `{ ran: false, reason }`: by the time this runs the folder exists and the
 * project is about to be linked, so a thrown error would leave the user with a
 * created folder behind a failure dialog — the worst of both outcomes.
 */
export async function runSpecgateInit(
  projectDir: string,
  deps: SpecgateDeps = {},
): Promise<ScaffoldToolResult> {
  const resolve = deps.resolve ?? resolveCommandPath;
  const run = deps.run ?? defaultRun;

  const binary = resolve(SPECGATE_COMMAND);
  if (!binary) {
    return {
      ran: false,
      reason:
        `The folder was created, but S.CodingFlow was not started: \`${SPECGATE_COMMAND}\` is not ` +
        `on this machine's PATH. Install it, then run \`${SPECGATE_COMMAND} init\` in the new ` +
        `folder yourself. If it is installed, relaunch Parallel Code from a terminal so it ` +
        `inherits your shell PATH.`,
    };
  }

  try {
    logDebug('git', `${SPECGATE_COMMAND} init in ${projectDir}`);
    await run(binary, ['init'], projectDir);
    return { ran: true };
  } catch (err) {
    return {
      ran: false,
      reason:
        `The folder was created, but \`${SPECGATE_COMMAND} init\` did not finish: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface NewProjectResult {
  /** Absolute path of the created folder. */
  readonly path: string;
  /** Whether S.CodingFlow initialisation ran, and why not if it did not. */
  readonly specgate: ScaffoldToolResult;
}

/**
 * Create the folder, then start S.CodingFlow in it.
 *
 * The order matters and is not reversible: a failure to create the folder is
 * fatal to the operation, a failure to initialise it is not.
 */
export async function scaffoldNewProject(
  parentDir: string,
  name: string,
  initSpecgate: boolean,
  deps: SpecgateDeps = {},
): Promise<NewProjectResult> {
  const created = await createProjectFolder(parentDir, name);
  if (!initSpecgate) return { path: created, specgate: { ran: false, reason: '' } };
  return { path: created, specgate: await runSpecgateInit(created, deps) };
}
