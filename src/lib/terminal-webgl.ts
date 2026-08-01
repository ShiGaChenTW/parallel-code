/**
 * Attaches xterm's WebGL renderer to a terminal, loading it off the startup path.
 *
 * WHY THIS IS NOT JUST `new WebglAddon()` AT THE CALL SITE
 *
 * `@xterm/addon-webgl` is 247,233 B of the renderer's startup budget — 19.3% of
 * it, second only to xterm itself — and it is not needed to put a terminal on
 * screen. `term.open()` starts on the DOM renderer regardless; the addon only
 * ever *replaces* that renderer. So the import is `import()`ed here instead of
 * static, which moves those bytes out of the entry chunk and into a chunk fetched
 * after the first frame.
 *
 * Making the load asynchronous introduces exactly one thing the synchronous
 * version could not hit: an unmount that lands while the chunk is still in
 * flight. A terminal pane closed within a few ms of opening would otherwise
 * construct a WebGL context onto a `Terminal` that is already disposed. That is
 * what `dispose()` before settle guards — the addon is never constructed at all,
 * rather than constructed and torn down.
 *
 * Everything else here mirrors the behaviour the synchronous call site already
 * had, because the addon was always allowed to fail: a constructor throw (no
 * WebGL2) and a context loss both hand the terminal back to the DOM renderer,
 * and neither is an error the user should see.
 */

/**
 * The slice of `@xterm/addon-webgl`'s `WebglAddon` this module drives.
 *
 * `activate` is here only so this type still satisfies xterm's `ITerminalAddon`:
 * `Terminal.loadAddon` is declared as a property, not a method, so its parameter
 * is checked contravariantly under `strictFunctionTypes` and a narrower addon
 * type would make a real `Terminal` unassignable to `WebglTerminalLike`. Nothing
 * in this file calls it — xterm does.
 */
export interface WebglAddonLike {
  activate(terminal: unknown): void;
  onContextLoss(handler: () => void): void;
  dispose(): void;
}

/** The slice of xterm's `Terminal` this module drives. */
export interface WebglTerminalLike {
  loadAddon(addon: WebglAddonLike): void;
}

/** The addon constructor, as the lazily-loaded chunk exports it. */
export type WebglAddonCtor = new () => WebglAddonLike;

export interface WebglRenderer {
  /**
   * Settles when the attach attempt is over — attached, declined or cancelled.
   * Never rejects: every failure mode here is a fallback, not an error.
   *
   * The app does not await this; it exists so the sequence is testable without
   * a DOM, which is the only way this file can be covered at all under
   * `environment: 'node'`.
   */
  readonly settled: Promise<void>;
  /** Detach: disposes the addon, or cancels a load still in flight. */
  dispose(): void;
}

/** The real chunk. Split out so tests can substitute it without a bundler. */
function loadWebglAddonChunk(): Promise<WebglAddonCtor> {
  return import('@xterm/addon-webgl').then((m) => m.WebglAddon as unknown as WebglAddonCtor);
}

export function attachWebglRenderer(
  term: WebglTerminalLike,
  loadAddon: () => Promise<WebglAddonCtor> = loadWebglAddonChunk,
): WebglRenderer {
  let addon: WebglAddonLike | undefined;
  let cancelled = false;

  const settled = loadAddon().then(
    (WebglAddon) => {
      if (cancelled) return;

      let created: WebglAddonLike;
      try {
        created = new WebglAddon();
      } catch {
        // WebGL2 not supported — xterm keeps the DOM renderer.
        return;
      }

      created.onContextLoss(() => {
        // Context loss is terminal for this addon instance: drop the reference
        // first so a later unmount does not dispose it twice, then dispose so
        // xterm falls back to the DOM renderer.
        addon = undefined;
        created.dispose();
      });

      addon = created;
      term.loadAddon(created);
    },
    () => {
      // The chunk did not load. A terminal without GPU acceleration is a working
      // terminal, so this is silent for the same reason the constructor throw is.
    },
  );

  return {
    settled,
    dispose() {
      cancelled = true;
      addon?.dispose();
      addon = undefined;
    },
  };
}
