// What the task title bar's terminal button opens — the renderer's half.
//
// This is the value model only: which targets exist, what they are called, and
// which ones this platform may offer. The argv table that turns a target into a
// real command line lives in `electron/terminal-launch.ts` and is main's alone,
// because the renderer never launches anything — it sends an id over IPC.
//
// Written twice, deliberately. `no-renderer-importing-main` forbids the
// renderer reaching into `electron/`, and `electron/tsconfig.json`'s `rootDir`
// forbids the reverse, which is the same bind `window-blur` and `window-opacity`
// hit before this. Both resolved it by duplicating the model and pinning the
// copies together with a test that compares source text; `terminal-launch.test.ts`
// does the same here. Widening the dependency-cruiser exception was the other
// option and is the wrong one: the two existing exceptions are platform-neutral
// pure data, while this module's sibling is a per-platform argv table — exactly
// the thing that rule exists to keep out of the renderer.
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
