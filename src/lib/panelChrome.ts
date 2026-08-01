/**
 * Chrome metrics shared by the panel kinds the tiling layout renders side by
 * side.
 *
 * `TilingLayout` puts `TaskPanel` and `TerminalPanel` in identical cells, and
 * both open with a title bar as the first row inside the same `.task-column`
 * card. Their bottom borders therefore land on the same horizontal line only
 * while the two agree on this height — and they did not. The task panel has
 * carried 50 since 3ff6cc6 (17 Feb 2026, then a `fixed` `PanelChild` of
 * `initialSize: 50`); the standalone terminal panel shipped three days later in
 * d7b180b with a freshly written 36, and nothing since reconciled them. That is
 * a drift no reader could have caught, because neither number said anywhere
 * that it had a counterpart.
 *
 * Both panels now read the height from here, so the next change to it moves
 * them together instead of pulling them apart again.
 *
 * The value is measured rather than inherited. 50 won the alignment only
 * because it was the older of the two literals; nobody had checked it against
 * what the bars actually hold, and it read thick. The tallest item in either
 * bar is an `IconButton` — a 16px icon box in 4px of padding inside a 1px
 * border, so 26px — and everything else sits well under it: an 8px
 * `StatusDot`, a ~20px badge, the 14px title, and the ~25px input the title
 * becomes while being edited. 42 is that 26 with 8px of clearance above and
 * below, and the 8 is the gap the row already keeps between its own items
 * rather than a number invented for the occasion. The clearance also has to
 * outlast the count badges the prompt-history and push buttons hang 4px below
 * themselves, because the header stack clips.
 */
export const PANEL_TITLE_BAR_HEIGHT_PX = 42;

/** The task card's steps line, in its `card` variant. */
export const TASK_STEPS_LINE_HEIGHT_PX = 24;

/** The task card's branch bar, the row that closes the header stack. */
export const TASK_BRANCH_BAR_HEIGHT_PX = 28;

/**
 * Height of the task card's fixed header stack: title bar, the steps line when
 * the task shows one, and the branch bar.
 *
 * The stack is a fixed total sized independently of its rows, and it clips —
 * so a total smaller than its contents crops the branch bar off the bottom
 * rather than growing the header. It used to be two literals (78 and 102) with
 * a test pinning them to the same arithmetic, on the argument that a loud test
 * beats a silent crop. The test was loud, on the very next change to the title
 * bar height, and the fix was still arithmetic redone by hand. So the sum now
 * lives next to the metrics it sums, and there is nothing left to restate.
 */
export function taskHeaderStackHeightPx(stepsEnabled: boolean | undefined): number {
  return (
    PANEL_TITLE_BAR_HEIGHT_PX +
    (stepsEnabled ? TASK_STEPS_LINE_HEIGHT_PX : 0) +
    TASK_BRANCH_BAR_HEIGHT_PX
  );
}
