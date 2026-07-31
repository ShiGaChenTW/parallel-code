import { describe, expect, it } from 'vitest';
import {
  TREE_ELBOW_WIDTH_PX,
  TREE_RAIL_LEFT_PX,
  childConnector,
  groupConnector,
  hasElbow,
  rowPaddingLeft,
  trunkHeight,
} from './sidebar-tree';

describe('groupConnector', () => {
  it('terminates the rail on the final row of the group', () => {
    expect(groupConnector(2, 3)).toBe('last');
  });

  it('continues the rail through every earlier row', () => {
    expect(groupConnector(0, 3)).toBe('middle');
    expect(groupConnector(1, 3)).toBe('middle');
  });

  it('gives a lone task a terminating stub rather than a through line', () => {
    expect(groupConnector(0, 1)).toBe('last');
  });

  // A project group is `[...active, ...collapsed]`, and either half may be
  // empty. The last row of whichever half comes last has to terminate, so the
  // caller offsets collapsed indices past the active ones.
  it('terminates on the last collapsed row when the group has both halves', () => {
    const active = 2;
    const total = 3;
    expect(groupConnector(active + 0, total)).toBe('last');
  });

  it('terminates on the last active row when there are no collapsed rows', () => {
    expect(groupConnector(1, 2)).toBe('last');
  });

  it('returns nothing for an index outside the group', () => {
    expect(groupConnector(0, 0)).toBeUndefined();
    expect(groupConnector(3, 3)).toBeUndefined();
    expect(groupConnector(-1, 3)).toBeUndefined();
  });
});

describe('childConnector', () => {
  // A coordinator's children render *below* its own row, so the rail has to
  // pass behind them to reach the next sibling — but without an elbow, because
  // they hang off the coordinator, not off the project.
  it('passes the rail through a coordinator’s children when the rail continues', () => {
    expect(childConnector('middle')).toBe('through');
    expect(childConnector('through')).toBe('through');
  });

  it('draws nothing under the last coordinator — the rail already ended', () => {
    expect(childConnector('last')).toBeUndefined();
  });

  it('draws nothing under an orphaned coordinator', () => {
    expect(childConnector(undefined)).toBeUndefined();
  });
});

describe('trunkHeight', () => {
  it('stops the rail at the elbow on the final row', () => {
    expect(trunkHeight('last')).toBe('50%');
  });

  it('runs the rail the full row height everywhere else', () => {
    expect(trunkHeight('middle')).toBe('100%');
    expect(trunkHeight('through')).toBe('100%');
  });
});

describe('hasElbow', () => {
  it('elbows into rows that belong to the project directly', () => {
    expect(hasElbow('middle')).toBe(true);
    expect(hasElbow('last')).toBe(true);
  });

  it('never elbows into a pass-through row', () => {
    expect(hasElbow('through')).toBe(false);
  });
});

describe('rowPaddingLeft', () => {
  it('leaves untouched rows on the original indent', () => {
    expect(rowPaddingLeft(false, undefined)).toBe('10px');
    expect(rowPaddingLeft(true, undefined)).toBe('22px');
  });

  it('opens room for the elbow on a top-level tree row', () => {
    expect(rowPaddingLeft(false, 'middle')).toBe('13px');
    expect(rowPaddingLeft(false, 'last')).toBe('13px');
  });

  // Coordinator children sit at 22px, far right of the elbow's 10px reach, so
  // the pass-through rail never collides with them and their indent is left
  // exactly as it was.
  it('leaves coordinator children at their existing indent', () => {
    expect(rowPaddingLeft(true, 'through')).toBe('22px');
    expect(rowPaddingLeft(true, 'middle')).toBe('22px');
  });
});

describe('rail geometry', () => {
  // The rail descends from the centre of the project header's colour dot:
  // the header pads 2px, then draws a 6px dot, so its centre is at 5px.
  it('puts the rail under the centre of the project dot', () => {
    expect(TREE_RAIL_LEFT_PX).toBe(5);
  });

  it('stops the elbow short of the row content', () => {
    const elbowEnd = TREE_RAIL_LEFT_PX + TREE_ELBOW_WIDTH_PX;
    // Row content starts at the 1.5px focus border plus the padding below.
    const contentStart = 1.5 + Number(rowPaddingLeft(false, 'middle').replace('px', ''));
    expect(elbowEnd).toBeLessThan(contentStart);
  });
});
