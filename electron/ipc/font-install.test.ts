import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CJK_FONT_DOWNLOADS,
  findCjkFontDownload,
  installCjkFont,
  isAllowedFontDownloadUrl,
  isPlausibleFontSize,
  looksLikeFontFile,
  parseFcListFamilies,
  userFontDirectory,
} from './font-install.js';
import { OfflineModeError, setOfflineMode } from './offline.js';

// The switch is module-level state shared with every other surface suite. Both
// hooks run so a test never inherits a value and never leaves one behind.
beforeEach(() => setOfflineMode(false));
afterEach(() => setOfflineMode(false));

// `vi.clearAllMocks()` resets recorded calls but leaves implementations in
// place, so a `mockResolvedValue` set in one test stays visible to the next and
// a suite can pass as a file while failing when a single test is run alone.
// Unstubbing the global removes the stub outright, which has no such half-state.
afterEach(() => vi.unstubAllGlobals());

/** A minimal but genuine TrueType header, so the signature check is satisfied. */
function fontBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  buf.set([0x00, 0x01, 0x00, 0x00]);
  return buf;
}

function okResponse(body: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

describe('the download table', () => {
  it('is not empty — a table with no entries would make every install fail quietly', () => {
    expect(CJK_FONT_DOWNLOADS.length).toBeGreaterThan(0);
  });

  it('has one entry per family', () => {
    const families = CJK_FONT_DOWNLOADS.map((f) => f.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it('holds only URLs this process is willing to fetch', () => {
    for (const font of CJK_FONT_DOWNLOADS) {
      expect(isAllowedFontDownloadUrl(font.url), `${font.family}: ${font.url}`).toBe(true);
    }
  });
});

// The renderer and main each hold a copy of the font table, because the build
// makes sharing one impossible: `electron/tsconfig.json` has `rootDir: '.'` so
// this project cannot see `src/`, and dependency-cruiser forbids the reverse
// import. Two copies are acceptable only while something checks they agree —
// the same bargain `preload-allowlist.test.ts` strikes for IPC channels.
describe('main and renderer describe the same fonts', () => {
  const rendererSource = readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lib', 'cjk-fonts.ts'),
    'utf8',
  );

  it('agrees on family, URL, file name and byte size for every downloadable font', () => {
    for (const font of CJK_FONT_DOWNLOADS) {
      expect(rendererSource, `family ${font.family}`).toContain(`family: '${font.family}'`);
      expect(rendererSource, `url for ${font.family}`).toContain(`url: '${font.url}'`);
      expect(rendererSource, `fileName for ${font.family}`).toContain(
        `fileName: '${font.fileName}'`,
      );
      // Both files write byte counts with numeric separators (15_277_228).
      const asLiteral = font.bytes.toLocaleString('en-US').replace(/,/g, '_');
      expect(rendererSource, `bytes for ${font.family}`).toContain(`bytes: ${asLiteral}`);
    }
  });

  it('covers every font the renderer marks downloadable, and no more', () => {
    // `fileName: '…'` appears once per direct delivery and nowhere else — the
    // type declaration spells it `readonly fileName: string`.
    const directCount = [...rendererSource.matchAll(/fileName: '/g)].length;
    expect(directCount).toBe(CJK_FONT_DOWNLOADS.length);
  });
});

describe('isAllowedFontDownloadUrl', () => {
  it('accepts GitHub release assets and repository files', () => {
    expect(isAllowedFontDownloadUrl('https://github.com/o/r/releases/download/v1/a.ttf')).toBe(
      true,
    );
    expect(isAllowedFontDownloadUrl('https://raw.githubusercontent.com/o/r/tag/a.otf')).toBe(true);
  });

  it('rejects plain HTTP, which anyone on the path could rewrite', () => {
    expect(isAllowedFontDownloadUrl('http://github.com/o/r/releases/download/v1/a.ttf')).toBe(
      false,
    );
  });

  it('rejects hosts that are not the font project', () => {
    expect(isAllowedFontDownloadUrl('https://cdn.example.com/a.ttf')).toBe(false);
    expect(isAllowedFontDownloadUrl('https://github.com.example.com/a.ttf')).toBe(false);
  });

  it('rejects input that is not a URL at all', () => {
    expect(isAllowedFontDownloadUrl('')).toBe(false);
    expect(isAllowedFontDownloadUrl('not a url')).toBe(false);
  });
});

describe('userFontDirectory', () => {
  it('uses the per-user font directory on macOS, which needs no administrator rights', () => {
    expect(userFontDirectory('darwin', '/Users/x')).toBe('/Users/x/Library/Fonts');
  });

  it('uses the XDG user font directory on Linux', () => {
    expect(userFontDirectory('linux', '/home/x')).toBe('/home/x/.local/share/fonts');
  });

  it('says plainly that other platforms are unsupported rather than inventing a path', () => {
    expect(() => userFontDirectory('win32', 'C:\\Users\\x')).toThrow(/not supported on win32/);
  });
});

describe('looksLikeFontFile', () => {
  it('accepts the sfnt signatures a real font starts with', () => {
    expect(looksLikeFontFile(new Uint8Array([0x00, 0x01, 0x00, 0x00]))).toBe(true);
    expect(looksLikeFontFile(new TextEncoder().encode('OTTO...'))).toBe(true);
    expect(looksLikeFontFile(new TextEncoder().encode('ttcf...'))).toBe(true);
    expect(looksLikeFontFile(new TextEncoder().encode('true...'))).toBe(true);
  });

  // The failure this exists for: a captive portal or a moved release answers
  // 200 with an HTML page, and it lands in the font directory named `.ttf`.
  it('rejects an HTML page served in place of the font', () => {
    expect(looksLikeFontFile(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false);
  });

  it('rejects a response too short to identify', () => {
    expect(looksLikeFontFile(new Uint8Array([0x00, 0x01]))).toBe(false);
    expect(looksLikeFontFile(new Uint8Array())).toBe(false);
  });
});

describe('isPlausibleFontSize', () => {
  it('accepts a release that has been re-cut but is still the same font', () => {
    expect(isPlausibleFontSize(15_000_000, 15_277_228)).toBe(true);
    expect(isPlausibleFontSize(18_000_000, 15_277_228)).toBe(true);
  });

  it('rejects a response of an entirely different scale', () => {
    expect(isPlausibleFontSize(4_096, 15_277_228)).toBe(false);
    expect(isPlausibleFontSize(400_000_000, 15_277_228)).toBe(false);
  });
});

describe('parseFcListFamilies', () => {
  it('keeps every name on a line, including localised CJK aliases', () => {
    const families = parseFcListFamilies('Sarasa Term TC,更紗黑體 TC\nMenlo\n');
    expect(families).toEqual(['Sarasa Term TC', '更紗黑體 TC', 'Menlo']);
  });

  it('drops hidden families and blank lines', () => {
    expect(parseFcListFamilies('\n.LastResort\n  \n')).toEqual([]);
  });

  it('reports each family once however often fc-list repeats it', () => {
    expect(parseFcListFamilies('Menlo\nMenlo\nMenlo,Menlo\n')).toEqual(['Menlo']);
  });
});

describe('installCjkFont', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-font-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // The offline-mode assertion this feature had to earn. The switch is checked
  // before the table lookup, so there is no ordering in which a request could
  // slip out — and the spy proves it rather than the code claiming it.
  it('makes no request at all while offline mode is on', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setOfflineMode(true);

    await expect(installCjkFont('LXGW WenKai Mono TC', { directory: tempDir })).rejects.toThrow(
      OfflineModeError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('names the surface on the offline error, so the reason reaches the user', async () => {
    vi.stubGlobal('fetch', vi.fn());
    setOfflineMode(true);
    await installCjkFont('LXGW WenKai Mono TC', { directory: tempDir }).then(
      () => expect.unreachable('should have refused'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(OfflineModeError);
        expect((err as OfflineModeError).surface).toBe('font-download');
        expect((err as OfflineModeError).message).toContain('Turn it off in Settings');
      },
    );
  });

  // Refuses even with the switch off: an archive-only font is not in main's
  // table, and a font the renderer invented certainly is not.
  it('refuses a font it does not publish a download for', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(installCjkFont('Sarasa Term TC', { directory: tempDir })).rejects.toThrow(
      /cannot download "Sarasa Term TC"/,
    );
    await expect(installCjkFont('Comic Sans', { directory: tempDir })).rejects.toThrow(
      /cannot download "Comic Sans"/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('writes the font under its published file name once the download succeeds', async () => {
    const font = findCjkFontDownload('LXGW WenKai Mono TC');
    if (!font) throw new Error('table changed');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(fontBytes(font.bytes))),
    );

    const result = await installCjkFont(font.family, { directory: tempDir });

    expect(result.path).toBe(path.join(tempDir, font.fileName));
    expect(await fs.readdir(tempDir)).toEqual([font.fileName]);
  });

  it('requests exactly the pinned URL from the table, never one supplied by the caller', async () => {
    const font = findCjkFontDownload('LXGW WenKai Mono TC');
    if (!font) throw new Error('table changed');
    const fetchSpy = vi.fn(async (_url: string) => okResponse(fontBytes(font.bytes)));
    vi.stubGlobal('fetch', fetchSpy);

    await installCjkFont(font.family, { directory: tempDir });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(font.url);
  });

  it('reports an HTTP failure in words, and leaves nothing behind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }) as Response),
    );

    await expect(installCjkFont('LXGW WenKai Mono TC', { directory: tempDir })).rejects.toThrow(
      /answered 404 Not Found/,
    );
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('reports a network failure in words rather than surfacing a raw fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(installCjkFont('LXGW WenKai Mono TC', { directory: tempDir })).rejects.toThrow(
      /Could not reach github\.com to download LXGW WenKai Mono TC/,
    );
  });

  it('refuses an HTML page served in place of the font, and installs nothing', async () => {
    const font = findCjkFontDownload('LXGW WenKai Mono TC');
    if (!font) throw new Error('table changed');
    const html = new Uint8Array(font.bytes);
    html.set(new TextEncoder().encode('<!DOCTYPE html>'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(html)),
    );

    await expect(installCjkFont(font.family, { directory: tempDir })).rejects.toThrow(
      /was not a font file/,
    );
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('refuses a response of an implausible size, and installs nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(fontBytes(2_048))),
    );

    await expect(installCjkFont('LXGW WenKai Mono TC', { directory: tempDir })).rejects.toThrow(
      /expected roughly/,
    );
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  // A partial file named `.ttf` in the font directory is worse than no file:
  // the OS tries to load it. The staging name must never survive.
  it('leaves no staging file behind after a successful install', async () => {
    const font = findCjkFontDownload('Noto Sans Mono CJK TC');
    if (!font) throw new Error('table changed');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(fontBytes(font.bytes))),
    );

    await installCjkFont(font.family, { directory: tempDir });

    const entries = await fs.readdir(tempDir);
    expect(entries.filter((name) => name.endsWith('.part'))).toEqual([]);
  });
});
