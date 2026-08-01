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
 */
export const PANEL_TITLE_BAR_HEIGHT_PX = 50;
