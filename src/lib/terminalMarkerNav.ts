/**
 * Keyed xterm markers: anchor a key to the terminal line that was current when
 * the key was marked, then scroll back to it later.
 *
 * `TerminalView` already did exactly this for agent steps, inline and private.
 * Prompt history needs the same thing keyed by prompt id, and two maps of
 * markers in one component that both call themselves `mark`/`jump` is how you
 * get a step index scrolling to a prompt. Lifting it here gives each consumer
 * its own key space, gives the disposal rule one home, and — because the
 * terminal is reached through a two-method structural interface rather than
 * xterm's `Terminal` — makes it testable under vitest's `environment: 'node'`,
 * where xterm cannot be imported at all.
 *
 * The disposal rule is the reason `isAnchored` exists. xterm frees a marker as
 * soon as its line falls off the end of the scrollback, and a freed marker's
 * `line` is meaningless. A caller that only had `jump` could offer a control
 * that silently does nothing; with `isAnchored` it can show the entry as no
 * longer reachable before the user clicks.
 *
 * Markers are owned by xterm and freed by `term.dispose()`, so there is nothing
 * to clean up here — the nav dies with the component that made it.
 */

/** The one marker property that outlives registration and that callers read. */
export interface MarkerLike {
  readonly line: number;
  readonly isDisposed: boolean;
}

/** The slice of xterm's `Terminal` this module needs. */
export interface MarkerNavTerminal {
  registerMarker(cursorYOffset?: number): MarkerLike | undefined;
  scrollToLine(line: number): void;
}

export interface MarkerNavApi {
  /** Anchor `key` to the current line. A key that is already anchored is left alone. */
  mark(key: number): void;
  /** Scroll to `key`'s line. False when it was never anchored or has scrolled out. */
  jump(key: number): boolean;
  /** Whether `key` still points at a line that is in the buffer. */
  isAnchored(key: number): boolean;
}

export function createMarkerNav(getTerminal: () => MarkerNavTerminal | undefined): MarkerNavApi {
  const markers = new Map<number, MarkerLike>();

  const live = (key: number): MarkerLike | undefined => {
    const marker = markers.get(key);
    return marker && !marker.isDisposed ? marker : undefined;
  };

  return {
    mark(key) {
      // Re-marking a live key would move the anchor to wherever the terminal is
      // now, which for a replayed list is the bottom of the buffer.
      if (live(key)) return;
      const marker = getTerminal()?.registerMarker(0);
      if (marker) markers.set(key, marker);
    },
    jump(key) {
      const marker = live(key);
      const terminal = getTerminal();
      if (!marker || !terminal) return false;
      terminal.scrollToLine(marker.line);
      return true;
    },
    isAnchored(key) {
      return live(key) !== undefined;
    },
  };
}
