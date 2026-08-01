import { describe, it, expect, vi } from 'vitest';
import {
  attachWebglRenderer,
  type WebglAddonCtor,
  type WebglAddonLike,
  type WebglTerminalLike,
} from './terminal-webgl';

/** Records what xterm would have been handed. */
function fakeTerminal() {
  const loaded: WebglAddonLike[] = [];
  const term: WebglTerminalLike = {
    loadAddon(addon) {
      loaded.push(addon);
    },
  };
  return { term, loaded };
}

/** A stand-in for `WebglAddon` that reports how it was driven. */
function fakeAddon() {
  const addon = {
    disposeCount: 0,
    contextLoss: undefined as (() => void) | undefined,
    activate() {
      // xterm calls this; this module never does.
    },
    onContextLoss(handler: () => void) {
      addon.contextLoss = handler;
    },
    dispose() {
      addon.disposeCount += 1;
    },
  };
  return addon;
}

/** A constructor that hands back `addon`, standing in for the real chunk export. */
function ctorFor(addon: WebglAddonLike): WebglAddonCtor {
  return function WebglAddonStub() {
    return addon;
  } as unknown as WebglAddonCtor;
}

describe('attachWebglRenderer', () => {
  it('loads the addon into the terminal once the chunk resolves', async () => {
    const { term, loaded } = fakeTerminal();
    const addon = fakeAddon();

    const renderer = attachWebglRenderer(term, () => Promise.resolve(ctorFor(addon)));
    // Nothing is attached synchronously — that is the whole point of the change.
    expect(loaded).toEqual([]);

    await renderer.settled;
    expect(loaded).toEqual([addon]);
    expect(addon.contextLoss).toBeTypeOf('function');
  });

  it('never touches the terminal when disposed while the chunk is still loading', async () => {
    const { term, loaded } = fakeTerminal();
    const addon = fakeAddon();
    const ctor = vi.fn(ctorFor(addon));

    const renderer = attachWebglRenderer(term, () =>
      Promise.resolve(ctor as unknown as WebglAddonCtor),
    );
    // The unmount that races the import: TerminalView's onCleanup can run before
    // a chunk read from local disk has resolved.
    renderer.dispose();
    await renderer.settled;

    expect(ctor).not.toHaveBeenCalled();
    expect(loaded).toEqual([]);
    expect(addon.disposeCount).toBe(0);
  });

  it('disposes the addon when disposed after attaching', async () => {
    const { term } = fakeTerminal();
    const addon = fakeAddon();

    const renderer = attachWebglRenderer(term, () => Promise.resolve(ctorFor(addon)));
    await renderer.settled;
    renderer.dispose();

    expect(addon.disposeCount).toBe(1);
  });

  it('disposes on context loss and does not dispose twice on unmount', async () => {
    const { term } = fakeTerminal();
    const addon = fakeAddon();

    const renderer = attachWebglRenderer(term, () => Promise.resolve(ctorFor(addon)));
    await renderer.settled;
    addon.contextLoss?.();
    renderer.dispose();

    // Context loss already handed the terminal back to the DOM renderer; the
    // synchronous version dropped its reference there too, so unmount must not
    // dispose a second time.
    expect(addon.disposeCount).toBe(1);
  });

  it('falls back to the DOM renderer when the addon constructor throws', async () => {
    const { term, loaded } = fakeTerminal();
    const throwing = function ThrowingWebglAddon() {
      // What xterm's addon does on a machine without WebGL2.
      throw new Error('WebGL2 not supported');
    } as unknown as WebglAddonCtor;

    const renderer = attachWebglRenderer(term, () => Promise.resolve(throwing));

    await expect(renderer.settled).resolves.toBeUndefined();
    expect(loaded).toEqual([]);
  });

  it('falls back to the DOM renderer when the chunk itself fails to load', async () => {
    const { term, loaded } = fakeTerminal();

    const renderer = attachWebglRenderer(term, () => Promise.reject(new Error('chunk 404')));

    await expect(renderer.settled).resolves.toBeUndefined();
    expect(loaded).toEqual([]);
  });
});
