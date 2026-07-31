import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { BrowserWindow } from 'electron';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_OPACITY,
  MIN_WINDOW_OPACITY,
  WINDOW_OPACITY_STEP,
  applyWindowOpacity,
  isWindowOpacitySupported,
  normalizeWindowOpacity,
  windowOpacityFromState,
} from './window-opacity.js';

function fakeWindow(destroyed = false): { win: BrowserWindow; calls: number[] } {
  const calls: number[] = [];
  const win = {
    isDestroyed: () => destroyed,
    setOpacity: (value: number) => calls.push(value),
  } as unknown as BrowserWindow;
  return { win, calls };
}

describe('isWindowOpacitySupported', () => {
  it('gates on the platforms Electron 40 documents setOpacity for', () => {
    expect(isWindowOpacitySupported('darwin')).toBe(true);
    expect(isWindowOpacitySupported('win32')).toBe(true);
    expect(isWindowOpacitySupported('linux')).toBe(false);
  });
});

// The guard on everything arriving over IPC. `setOpacity` itself clamps only to
// [0, 1], so without this a renderer asking for 0.02 would hand back a window
// too faint for the user to fix it in.
describe('normalizeWindowOpacity', () => {
  it('passes a legal step through', () => {
    expect(normalizeWindowOpacity(0.85)).toBe(0.85);
  });

  it('clamps to the floor and the ceiling', () => {
    expect(normalizeWindowOpacity(0.02)).toBe(MIN_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(2)).toBe(DEFAULT_WINDOW_OPACITY);
  });

  it('snaps off-grid and float-noise values', () => {
    expect(normalizeWindowOpacity(0.83)).toBe(0.85);
    expect(normalizeWindowOpacity(0.7500000000000001)).toBe(0.75);
  });

  it('falls back to opaque for anything that is not a finite number', () => {
    for (const bad of [undefined, null, NaN, Infinity, '0.8', {}]) {
      expect(normalizeWindowOpacity(bad)).toBe(DEFAULT_WINDOW_OPACITY);
    }
  });
});

describe('windowOpacityFromState', () => {
  it('reads a persisted value', () => {
    expect(windowOpacityFromState(JSON.stringify({ windowOpacity: 0.8 }))).toBe(0.8);
  });

  it('defaults to opaque when the key was never persisted', () => {
    expect(windowOpacityFromState(JSON.stringify({ appIcon: 'nord' }))).toBe(
      DEFAULT_WINDOW_OPACITY,
    );
  });

  it('defaults to opaque on a first launch with no state file', () => {
    expect(windowOpacityFromState(null)).toBe(DEFAULT_WINDOW_OPACITY);
    expect(windowOpacityFromState('')).toBe(DEFAULT_WINDOW_OPACITY);
  });

  it('defaults to opaque rather than throwing on a corrupted state file', () => {
    expect(windowOpacityFromState('{ not json')).toBe(DEFAULT_WINDOW_OPACITY);
    expect(windowOpacityFromState('null')).toBe(DEFAULT_WINDOW_OPACITY);
    expect(windowOpacityFromState('[]')).toBe(DEFAULT_WINDOW_OPACITY);
    expect(windowOpacityFromState('"0.7"')).toBe(DEFAULT_WINDOW_OPACITY);
  });

  it('clamps a hand-edited value that would make the window unusable', () => {
    expect(windowOpacityFromState(JSON.stringify({ windowOpacity: 0.01 }))).toBe(
      MIN_WINDOW_OPACITY,
    );
  });
});

describe('applyWindowOpacity', () => {
  it('applies on macOS and reports success', () => {
    const { win, calls } = fakeWindow();
    expect(applyWindowOpacity(win, 0.8, 'darwin')).toBe(true);
    expect(calls).toEqual([0.8]);
  });

  it('reports failure on Linux instead of pretending, and does not call through', () => {
    // The whole point of the platform gate: Electron would accept the call and
    // silently do nothing, so a `true` here would be a lie the UI acts on.
    const { win, calls } = fakeWindow();
    expect(applyWindowOpacity(win, 0.8, 'linux')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reports failure when there is no window', () => {
    expect(applyWindowOpacity(null, 0.8, 'darwin')).toBe(false);
  });

  it('reports failure when the window is already destroyed', () => {
    const { win, calls } = fakeWindow(true);
    expect(applyWindowOpacity(win, 0.8, 'darwin')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('normalizes before applying, so a bad caller cannot hide the window', () => {
    const { win, calls } = fakeWindow();
    expect(applyWindowOpacity(win, 0.02, 'darwin')).toBe(true);
    expect(calls).toEqual([MIN_WINDOW_OPACITY]);
  });
});

/**
 * The value model is written twice — once here, once in `src/lib/window-opacity.ts`
 * — because `no-renderer-importing-main` forbids the renderer reaching into
 * `electron/` and `electron/tsconfig.json`'s `rootDir` forbids the reverse. That
 * makes drift a real risk: a floor raised on one side and not the other gives
 * the user a slider whose left end main quietly overrides.
 *
 * The two files cannot be imported into one program, so the check reads the
 * renderer copy as text, the way `i18n-coverage.test.ts` reads components it
 * cannot import. Text is enough for the part that drifts: the numbers, and the
 * one line that decides which platforms get the feature at all.
 */
describe('parity with the renderer copy', () => {
  const root = resolve(__dirname, '..', '..');
  const rendererSource = readFileSync(resolve(root, 'src', 'lib', 'window-opacity.ts'), 'utf8');
  const mainSource = readFileSync(resolve(root, 'electron', 'ipc', 'window-opacity.ts'), 'utf8');

  function constantIn(source: string, name: string): number {
    const match = new RegExp(`export const ${name} = ([\\d.]+);`).exec(source);
    if (!match) throw new Error(`${name} is no longer declared as a literal in both copies`);
    return Number(match[1]);
  }

  /** The body of a top-level `export function`, as written. */
  function bodyIn(source: string, name: string): string {
    const match = new RegExp(
      `export function ${name}\\([^)]*\\)[^{]*\\{\\n([\\s\\S]*?)\\n\\}`,
    ).exec(source);
    if (!match) throw new Error(`${name} changed shape and can no longer be compared as text`);
    return match[1];
  }

  it('agrees on the floor, the default and the step', () => {
    for (const name of ['MIN_WINDOW_OPACITY', 'DEFAULT_WINDOW_OPACITY', 'WINDOW_OPACITY_STEP']) {
      expect(constantIn(rendererSource, name), name).toBe(constantIn(mainSource, name));
    }
    // Pinned against the values under test, so the two copies cannot agree on a
    // number that this suite is not the one asserting behaviour for.
    expect(constantIn(mainSource, 'MIN_WINDOW_OPACITY')).toBe(MIN_WINDOW_OPACITY);
    expect(constantIn(mainSource, 'DEFAULT_WINDOW_OPACITY')).toBe(DEFAULT_WINDOW_OPACITY);
    expect(constantIn(mainSource, 'WINDOW_OPACITY_STEP')).toBe(WINDOW_OPACITY_STEP);
  });

  it('agrees on which platforms are supported', () => {
    expect(bodyIn(rendererSource, 'isWindowOpacitySupported')).toBe(
      bodyIn(mainSource, 'isWindowOpacitySupported'),
    );
  });

  it('agrees on the normalization arithmetic', () => {
    expect(bodyIn(rendererSource, 'normalizeWindowOpacity')).toBe(
      bodyIn(mainSource, 'normalizeWindowOpacity'),
    );
  });
});
