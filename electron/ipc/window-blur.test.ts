import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { BrowserWindow } from 'electron';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINDOW_BLUR,
  WINDOW_BACKDROP_OPAQUE,
  WINDOW_BACKDROP_TRANSPARENT,
  WINDOW_BLUR_MATERIALS,
  WINDOW_VISUAL_EFFECT_STATE,
  applyWindowBlur,
  effectiveWindowBlur,
  isWindowBlurSupported,
  normalizeWindowBlur,
  windowBlurFromState,
} from './window-blur.js';

type Call = { readonly kind: 'vibrancy' | 'background'; readonly value: string | null };

function fakeWindow(destroyed = false): { win: BrowserWindow; calls: Call[] } {
  const calls: Call[] = [];
  const win = {
    isDestroyed: () => destroyed,
    setVibrancy: (value: string | null) => calls.push({ kind: 'vibrancy', value }),
    setBackgroundColor: (value: string) => calls.push({ kind: 'background', value }),
  } as unknown as BrowserWindow;
  return { win, calls };
}

describe('isWindowBlurSupported', () => {
  it('gates on the one platform Electron 40 documents vibrancy for', () => {
    expect(isWindowBlurSupported('darwin')).toBe(true);
    // Narrower than opacity's rule, which also covers Windows: `backgroundMaterial`
    // is a different option with a different value set, not this one.
    expect(isWindowBlurSupported('win32')).toBe(false);
    expect(isWindowBlurSupported('linux')).toBe(false);
  });
});

describe('normalizeWindowBlur', () => {
  it('passes every offered material through', () => {
    for (const material of WINDOW_BLUR_MATERIALS) {
      expect(normalizeWindowBlur(material)).toBe(material);
    }
    expect(normalizeWindowBlur('off')).toBe('off');
  });

  it('falls back to off for anything unrecognised', () => {
    // `setVibrancy` throws outside its union, so an unknown string reaching it
    // would take the handler down rather than degrade.
    for (const bad of [undefined, null, 42, {}, 'blurry', '']) {
      expect(normalizeWindowBlur(bad)).toBe('off');
    }
  });

  it('rejects materials Electron accepts but this app does not offer', () => {
    // Real members of Electron's union, deliberately not in the shortlist. A
    // value arriving from a hand-edited state file must not reach the window.
    for (const excluded of ['menu', 'popover', 'tooltip', 'titlebar', 'appearance-based']) {
      expect(normalizeWindowBlur(excluded)).toBe('off');
    }
  });
});

describe('windowBlurFromState', () => {
  it('reads a persisted value', () => {
    expect(windowBlurFromState(JSON.stringify({ windowBlur: 'hud' }))).toBe('hud');
  });

  it('defaults to off when the key was never persisted', () => {
    expect(windowBlurFromState(JSON.stringify({ appIcon: 'nord' }))).toBe(DEFAULT_WINDOW_BLUR);
  });

  it('defaults to off on a first launch with no state file', () => {
    expect(windowBlurFromState(null)).toBe(DEFAULT_WINDOW_BLUR);
    expect(windowBlurFromState('')).toBe(DEFAULT_WINDOW_BLUR);
  });

  it('defaults to off rather than throwing on a corrupted state file', () => {
    expect(windowBlurFromState('{ not json')).toBe(DEFAULT_WINDOW_BLUR);
    expect(windowBlurFromState('null')).toBe(DEFAULT_WINDOW_BLUR);
    expect(windowBlurFromState('[]')).toBe(DEFAULT_WINDOW_BLUR);
    expect(windowBlurFromState('"hud"')).toBe(DEFAULT_WINDOW_BLUR);
  });
});

/**
 * macOS "Reduce transparency". Apple's wording is imperative — "don't use
 * semitransparent backgrounds ... use only opaque windows" — so this is not a
 * hint the app gets to weigh against its own preference.
 */
describe('effectiveWindowBlur', () => {
  it('passes the chosen material through when transparency is not reduced', () => {
    for (const material of WINDOW_BLUR_MATERIALS) {
      expect(effectiveWindowBlur(material, false)).toBe(material);
    }
    expect(effectiveWindowBlur('off', false)).toBe('off');
  });

  it('collapses every material to off when the accessibility flag is set', () => {
    for (const material of WINDOW_BLUR_MATERIALS) {
      expect(effectiveWindowBlur(material, true)).toBe('off');
    }
    expect(effectiveWindowBlur('off', true)).toBe('off');
  });

  it('does not consume the stored value, so the choice comes back', () => {
    // Someone who turns "Reduce transparency" off again gets the material they
    // picked, not a setting the app quietly forgot on their behalf.
    const stored = 'under-window';
    expect(effectiveWindowBlur(stored, true)).toBe('off');
    expect(effectiveWindowBlur(stored, false)).toBe(stored);
  });

  it('still normalizes, so it is safe on the IPC boundary', () => {
    // It is what the handlers call in place of `normalizeWindowBlur`, so it has
    // to be at least as defensive — `setVibrancy` throws outside its union.
    for (const bad of [undefined, null, 42, {}, 'menu', 'appearance-based', '']) {
      expect(effectiveWindowBlur(bad, false)).toBe(DEFAULT_WINDOW_BLUR);
      expect(effectiveWindowBlur(bad, true)).toBe(DEFAULT_WINDOW_BLUR);
    }
  });
});

/**
 * The one-line fix for the most visible defect this feature had: the material
 * turning into a flat grey panel every time the window lost focus.
 */
describe('WINDOW_VISUAL_EFFECT_STATE', () => {
  it('pins the material active rather than following window focus', () => {
    // Unset means `followWindow`, Electron's documented default, which is
    // exactly the desaturate-on-blur behaviour users read as the effect breaking.
    expect(WINDOW_VISUAL_EFFECT_STATE).toBe('active');
  });

  it('is handed to the constructor unconditionally on macOS', () => {
    // There is no `setVisualEffectState()` — electron#25513 is still open — and
    // the value is read when the vibrant NSView is first created, which for a
    // launch-with-blur-off profile happens inside a later `setVibrancy()`. Tying
    // it to the constructor `vibrancy` would give two different appearances for
    // the same setting depending on how the user got there.
    const main = readFileSync(resolve(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toContain('visualEffectState: chrome.visualEffectState');
    expect(main).toMatch(/visualEffectState = blurSupported \? WINDOW_VISUAL_EFFECT_STATE/);
  });
});

/**
 * Blur and transparency are no longer mutually exclusive, and main no longer
 * knows what transparency is.
 *
 * The exclusion existed because `setOpacity` fades everything the window has
 * drawn — including the vibrancy layer, which is itself a blurred picture of the
 * desktop. Fading that toward the desktop it was blurred from doubles the image
 * rather than dimming it, so one setting had to win. CSS alpha is applied by the
 * renderer, above the vibrancy layer and never to it, so the conflict is gone
 * along with the code that arbitrated it.
 */
describe('the blur/opacity exclusion is gone', () => {
  const source = readFileSync(resolve(__dirname, 'window-blur.ts'), 'utf8');
  const register = readFileSync(resolve(__dirname, 'register.ts'), 'utf8');

  it('no longer arbitrates between the two settings', () => {
    expect(source).not.toContain('effectiveWindowOpacity');
  });

  it('leaves main with no opacity call at all', () => {
    // The *call*, not the word: both files still name `setOpacity` in prose
    // explaining why it is gone, and that prose is the point. What must not come
    // back is an invocation.
    expect(source).not.toMatch(/\.setOpacity\(/);
    expect(register).not.toMatch(/\.setOpacity\(/);
    expect(register).not.toContain('applyWindowOpacity(');
  });

  it('carries only the blur on the one remaining channel', () => {
    // The payload used to be `{ blur, opacity }` so main could decide which won.
    expect(register).toContain('ipcMain.handle(IPC.SetWindowBlur');
    expect(register).not.toContain('IPC.SetWindowOpacity');
  });
});

describe('applyWindowBlur', () => {
  it('clears the backdrop before setting the material, so vibrancy is never hidden', () => {
    const { win, calls } = fakeWindow();
    expect(applyWindowBlur(win, 'under-window', 'darwin')).toBe(true);
    expect(calls).toEqual([
      { kind: 'background', value: WINDOW_BACKDROP_TRANSPARENT },
      { kind: 'vibrancy', value: 'under-window' },
    ]);
  });

  it('reports failure on Linux instead of pretending, and does not call through', () => {
    const { win, calls } = fakeWindow();
    expect(applyWindowBlur(win, 'hud', 'linux')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reports failure when there is no window', () => {
    expect(applyWindowBlur(null, 'hud', 'darwin')).toBe(false);
  });

  it('reports failure when the window is already destroyed', () => {
    const { win, calls } = fakeWindow(true);
    expect(applyWindowBlur(win, 'hud', 'darwin')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('normalizes before applying, so a bad caller cannot crash setVibrancy', () => {
    const { win, calls } = fakeWindow();
    expect(applyWindowBlur(win, 'menu' as never, 'darwin')).toBe(true);
    expect(calls).toEqual([
      { kind: 'vibrancy', value: null },
      { kind: 'background', value: WINDOW_BACKDROP_OPAQUE },
    ]);
  });
});

/**
 * Turning blur off has to leave a fully opaque window. This is the failure mode
 * worth the most test surface: a half-undone teardown leaves the user with a
 * permanently see-through app and no obvious way to explain it, and unlike a
 * wrong colour it does not look like a bug in this feature — it looks like the
 * app is broken.
 */
describe('switching blur off restores an opaque window', () => {
  it('removes the material AND restores the opaque backdrop', () => {
    const { win, calls } = fakeWindow();
    expect(applyWindowBlur(win, 'off', 'darwin')).toBe(true);
    // Both halves. `setVibrancy(null)` alone would leave the web contents
    // transparent — an app you can see straight through, with nothing behind it.
    expect(calls).toEqual([
      { kind: 'vibrancy', value: null },
      { kind: 'background', value: WINDOW_BACKDROP_OPAQUE },
    ]);
  });

  it('removes the material before repainting, so no frame hides a live effect', () => {
    const { calls } = (() => {
      const w = fakeWindow();
      applyWindowBlur(w.win, 'off', 'darwin');
      return w;
    })();
    expect(calls[0].kind).toBe('vibrancy');
  });

  it('round-trips: on then off ends exactly where a fresh opaque launch starts', () => {
    const { win, calls } = fakeWindow();
    for (const material of WINDOW_BLUR_MATERIALS) {
      applyWindowBlur(win, material, 'darwin');
      applyWindowBlur(win, 'off', 'darwin');
    }
    const final = calls.slice(-2);
    expect(final).toEqual([
      { kind: 'vibrancy', value: null },
      { kind: 'background', value: WINDOW_BACKDROP_OPAQUE },
    ]);
  });
});

/**
 * The renderer half of the restoration, checked against the stylesheet itself.
 *
 * `styles.css` is the only place the veil exists, and it is not importable from
 * a test — so it is read as text, the way `i18n-coverage.test.ts` reads the
 * components it cannot import. What matters is not the exact rules but one
 * structural property: every rule that makes something translucent is scoped
 * under `[data-window-blur]`, an attribute the renderer *removes* when blur is
 * off. That is what makes "off" mean "no rule matches" rather than "a second set
 * of rules that has to faithfully reproduce the original".
 */
describe('the stylesheet cannot leak translucency into the blur-off state', () => {
  const root = resolve(__dirname, '..', '..');
  const css = readFileSync(resolve(root, 'src', 'styles.css'), 'utf8');

  /** The blur block, from its banner to the rule that follows it. */
  const blurBlock = (): string => {
    const start = css.indexOf('/* --- Window blur (macOS vibrancy)');
    expect(start, 'the window blur block is no longer findable in styles.css').toBeGreaterThan(-1);
    const end = css.indexOf('\nbody {', start);
    expect(end, 'the blur block no longer ends where expected').toBeGreaterThan(start);
    return css.slice(start, end);
  };

  /** Every selector in the block, with at-rule preludes (`@media …`) dropped —
   * an at-rule is a condition on when its contents apply, not a thing that can
   * be gated on an attribute. The rules *inside* it still come through this list
   * and are still held to the same requirement. */
  const selectorsInBlurBlock = (): string[] =>
    blurBlock()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('{')
      .slice(0, -1)
      .flatMap((chunk) => {
        const afterLastRule = chunk.split('}');
        return afterLastRule[afterLastRule.length - 1].split(',');
      })
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith('@'));

  it('scopes every selector in the blur block under the attribute', () => {
    const selectors = selectorsInBlurBlock();
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, `${selector} is not gated on the blur attribute`).toContain(
        '[data-window-blur]',
      );
    }
  });

  it('gates its only at-rule on reduced transparency, and nothing else', () => {
    // An at-rule escapes the scoping check above, so the set of them is pinned
    // here instead: anything new in this block has to be justified by a test
    // rather than slipping past on a technicality.
    const atRules = [...blurBlock().matchAll(/@[a-z-]+[^{]*/g)].map((m) => m[0].trim());
    expect(atRules).toEqual(['@media (prefers-reduced-transparency: reduce)']);
  });

  it('leaves the opaque backdrop declaration standing outside the block', () => {
    // The rule the veil overrides. If this stops being opaque, "off" stops
    // being opaque, and no amount of scoping above would save it.
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*background:\s*#0e1215;/);
  });

  it('agrees with main on the opaque backdrop colour', () => {
    // Construction and the runtime off path both write WINDOW_BACKDROP_OPAQUE;
    // this is what keeps it equal to what the stylesheet paints, so the window
    // behind the page and the page itself are never two different darks.
    expect(css).toContain(WINDOW_BACKDROP_OPAQUE);
  });
});

/**
 * The value model is written twice — once here, once in `src/lib/window-blur.ts`
 * — because `no-renderer-importing-main` forbids the renderer reaching into
 * `electron/` and `electron/tsconfig.json`'s `rootDir` forbids the reverse. That
 * makes drift a real risk: a material offered in Settings that main normalizes
 * away is a button that silently does nothing.
 *
 * The two files cannot be imported into one program, so the check reads the
 * renderer copy as text, exactly as `window-opacity.test.ts` does.
 */
describe('parity with the renderer copy', () => {
  const root = resolve(__dirname, '..', '..');
  const rendererSource = readFileSync(resolve(root, 'src', 'lib', 'window-blur.ts'), 'utf8');
  const mainSource = readFileSync(resolve(root, 'electron', 'ipc', 'window-blur.ts'), 'utf8');

  function materialsIn(source: string): string {
    const match = /export const WINDOW_BLUR_MATERIALS = \[([^\]]*)\] as const;/.exec(source);
    if (!match) throw new Error('WINDOW_BLUR_MATERIALS is no longer a literal in both copies');
    return match[1].replace(/\s/g, '');
  }

  /** The body of a top-level `export function`, as written. */
  function bodyIn(source: string, name: string): string {
    const match = new RegExp(
      `export function ${name}\\([^)]*\\)[^{]*\\{\\n([\\s\\S]*?)\\n\\}`,
    ).exec(source);
    if (!match) throw new Error(`${name} changed shape and can no longer be compared as text`);
    return match[1];
  }

  it('offers exactly the same materials on both sides', () => {
    expect(materialsIn(rendererSource)).toBe(materialsIn(mainSource));
    // Pinned against the values under test, so the two copies cannot agree on a
    // set this suite is not the one asserting behaviour for.
    expect(materialsIn(mainSource)).toBe(WINDOW_BLUR_MATERIALS.map((m) => `'${m}'`).join(','));
  });

  it('agrees on the default', () => {
    for (const source of [rendererSource, mainSource]) {
      expect(source).toContain("export const DEFAULT_WINDOW_BLUR: WindowBlur = 'off';");
    }
    expect(DEFAULT_WINDOW_BLUR).toBe('off');
  });

  it('agrees on which platforms are supported', () => {
    expect(bodyIn(rendererSource, 'isWindowBlurSupported')).toBe(
      bodyIn(mainSource, 'isWindowBlurSupported'),
    );
  });

  it('agrees on the normalization', () => {
    expect(bodyIn(rendererSource, 'normalizeWindowBlur')).toBe(
      bodyIn(mainSource, 'normalizeWindowBlur'),
    );
  });
});
