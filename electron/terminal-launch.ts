// What the task title bar's terminal button opens — main's half.
//
// Two things live here: the value model (which targets exist, what they are
// called, which ones a platform may offer) and the argv table that turns an
// external target into a real command line. The renderer needs the first and
// never the second — it sends an id over IPC and lets main do the launching.
//
// The value model is written twice, once here and once in
// `src/lib/native-terminal.ts`, because `no-renderer-importing-main` forbids
// the renderer reaching into `electron/` and `electron/tsconfig.json`'s
// `rootDir` forbids the reverse. `window-blur` and `window-opacity` hit the
// same bind and resolved it the same way: duplicate, then pin the copies
// together with a test that compares source text. `terminal-launch.test.ts`
// does that at the bottom. Drift here is not cosmetic — a target Settings
// offers that this file refuses to launch is a button that does nothing.
//
// Pure on purpose. The spawn happens in `ipc/register.ts`, but which binary and
// which argv is a per-app, per-platform judgement call, and vitest runs without
// Electron. Keeping the judgement here means every command line below is pinned
// by a test rather than discovered by a user whose window did not open.
//
// The list is deliberately closed. There is no free-form "terminal command"
// setting to match `editorCommand`, because the two are not the same problem:
// an editor takes a directory as its last argument and essentially all of them
// agree on that, while terminal emulators disagree about the working-directory
// flag, about whether a new window or a new tab is the default, and about
// whether the CLI entry point exists at all. Two external apps that are tested
// beat a text box that turns every untested emulator into a bug report.

/**
 * What the terminal button opens.
 *
 * `builtin` is the app's own shell panel — the thing the button already did
 * before it moved to the title bar, kept as the default so the move is a move
 * and not a feature swap. It is listed alongside the external emulators rather
 * than modelled as "no app" because from the button's point of view these are
 * three answers to one question, and the setting has to be able to say all
 * three.
 *
 * Note this is *not* the earlier `system` id, which meant Terminal.app on
 * macOS and `x-terminal-emulator` on Linux. That reading left Linux users
 * choosing between two external emulators the picker refused to offer them and
 * a system terminal, with the app's own panel — the one option guaranteed to
 * work everywhere — unreachable from the button at all.
 */
export const TERMINAL_TARGETS = ['builtin', 'ghostty', 'alacritty'] as const;

export type TerminalTarget = (typeof TERMINAL_TARGETS)[number];

/** The targets that mean "launch something outside this process". */
export type ExternalTerminalApp = Exclude<TerminalTarget, 'builtin'>;

/** Product names, for tooltips and the settings picker. Never translated. */
export const EXTERNAL_TERMINAL_LABELS: Record<ExternalTerminalApp, string> = {
  ghostty: 'Ghostty',
  alacritty: 'Alacritty',
};

/** A command to run without a shell: `spawn(command, args, { cwd })`. */
export interface TerminalLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** Working directory for the spawned process. */
  readonly cwd: string;
  /**
   * True when `command` is a launcher that hands off and exits (macOS `open`),
   * so its exit status is a usable success signal and the caller should wait
   * for it. False when `command` is the emulator itself, which stays alive for
   * as long as its window — waiting on that would hang until the user quits.
   *
   * This is the only way to notice "you picked Ghostty and Ghostty is not
   * installed" on macOS: `open` resolves from /usr/bin no matter how bare the
   * PATH is, so the spawn always succeeds and the failure is in the exit code.
   */
  readonly exitsAfterLaunch: boolean;
}

/**
 * True for the three ids above. Used to sanitise persisted state, which is not
 * trusted input — a state file naming a fourth app must fall back rather than
 * reach the launcher.
 */
export function isTerminalTarget(value: unknown): value is TerminalTarget {
  return typeof value === 'string' && (TERMINAL_TARGETS as readonly string[]).includes(value);
}

export function isExternalTerminalApp(target: TerminalTarget): target is ExternalTerminalApp {
  return target !== 'builtin';
}

/**
 * Which targets the picker may offer on `platform`.
 *
 * Both shipped desktop platforms get all three. macOS launches through
 * `open -a`, which finds an installed app bundle by name without anything
 * being on PATH; Linux launches the binary directly, which needs it on PATH —
 * and main resolves it there via `resolveSpawnExecutable`, the same path the
 * editor setting already uses, so a Dock- or .desktop-launched app can still
 * see a Homebrew or ~/.local/bin install.
 *
 * Offering the external apps on Linux is a deliberate reversal of an earlier
 * decision to hide them there. The stated reason was that a radio button for
 * an app the machine does not have is a control that does nothing — but that
 * is equally true on macOS, where they were offered anyway, and the honest fix
 * is the one applied to both: let the user pick, and say plainly what happened
 * when the app turns out to be missing.
 *
 * Anything else — a platform this app does not ship for — gets the built-in
 * panel only, because that is the one target with no external dependency.
 */
export function availableTerminalTargets(platform: string): TerminalTarget[] {
  return platform === 'darwin' || platform === 'linux' ? [...TERMINAL_TARGETS] : ['builtin'];
}

/**
 * How to launch `app` at `cwd`, or null when this platform cannot offer it.
 *
 * Null rather than a fallback: if the stored choice is Ghostty and the machine
 * cannot do Ghostty, opening the built-in panel instead looks like success and
 * is not. The caller reports it.
 *
 * `builtin` cannot be passed — it is not a launch, and the type says so, which
 * is why the caller never has to remember to check for it before spawning.
 *
 * `cwd` is never interpolated into a string. Every spec is handed to `spawn`
 * without a shell, so a path containing spaces, quotes or semicolons is safe
 * precisely because it stays one argv element and is not escaped here.
 */
export function terminalLaunchSpec(
  app: ExternalTerminalApp,
  platform: string,
  cwd: string,
): TerminalLaunchSpec | null {
  if (cwd.trim() === '') return null;
  if (!availableTerminalTargets(platform).includes(app)) return null;

  if (platform === 'darwin') {
    // -n forces a new instance. Without it `open` raises the existing window,
    // which is still sitting in whatever directory it had, and the --args are
    // dropped on the floor.
    const bundle = app === 'ghostty' ? 'Ghostty' : 'Alacritty';
    return {
      command: 'open',
      args: ['-na', bundle, '--args', ...workingDirectoryFlag(app, cwd)],
      cwd,
      exitsAfterLaunch: true,
    };
  }

  // Linux: the binary itself. `cwd` is set on the child as well as passed as a
  // flag — the flag is what actually matters for Ghostty, whose GTK
  // single-instance mode opens the new window from an already-running process
  // that inherited a different directory, and the child cwd is what covers
  // Alacritty if its flag spelling ever changes under us.
  return {
    command: app,
    args: [...workingDirectoryFlag(app, cwd)],
    cwd,
    exitsAfterLaunch: false,
  };
}

/**
 * The two emulators spell the same flag differently: Ghostty's parser takes
 * `--key=value` only, while Alacritty's documentation uses the spaced form.
 */
function workingDirectoryFlag(app: ExternalTerminalApp, cwd: string): string[] {
  return app === 'ghostty' ? [`--working-directory=${cwd}`] : ['--working-directory', cwd];
}
