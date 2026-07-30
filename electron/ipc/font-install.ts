// Downloading and installing a CJK terminal font into the user's own font
// directory. The tenth outbound surface governed by the offline switch.
//
// ## Why main keeps its own copy of the font table
//
// The renderer sends a *family name*, never a URL. If it sent a URL, this
// handler would be a general-purpose "fetch anything the renderer asks for"
// primitive sitting in the main process, which is precisely the shape you do
// not want next to a filesystem write.
//
// The renderer's copy of the same table lives in `src/lib/cjk-fonts.ts`, and
// the two cannot import each other: `electron/tsconfig.json` sets
// `rootDir: '.'`, so this TypeScript project cannot see `src/` at all, and
// dependency-cruiser's `no-renderer-importing-main` forbids the reverse. The
// codebase already handles this exact situation for IPC channels — the
// manifest, the enum and the preload allowlist are three copies kept honest by
// `preload-allowlist.test.ts`. `font-install.test.ts` does the same job here,
// asserting the two font tables agree entry for entry.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertOnline } from './offline.js';

export interface CjkFontDownload {
  readonly family: string;
  readonly url: string;
  readonly fileName: string;
  readonly bytes: number;
}

/**
 * The fonts this process is willing to fetch.
 *
 * Only the ones whose project publishes a single installable file. An
 * archive-only font is absent on purpose: asking to install one is a bug in
 * the caller, and it is answered with a refusal rather than a partial attempt.
 *
 * Must stay identical to the `direct` entries of `CJK_TERMINAL_FONTS` in
 * `src/lib/cjk-fonts.ts`.
 */
export const CJK_FONT_DOWNLOADS: readonly CjkFontDownload[] = [
  {
    family: 'Noto Sans Mono CJK TC',
    url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Mono/NotoSansMonoCJKtc-Regular.otf',
    fileName: 'NotoSansMonoCJKtc-Regular.otf',
    bytes: 16_392_304,
  },
  {
    family: 'LXGW WenKai Mono TC',
    url: 'https://github.com/lxgw/LxgwWenkaiTC/releases/download/v1.522/LXGWWenKaiMonoTC-Regular.ttf',
    fileName: 'LXGWWenKaiMonoTC-Regular.ttf',
    bytes: 15_277_228,
  },
];

/** The hosts a font may be fetched from — GitHub serving the project's own repo. */
const ALLOWED_DOWNLOAD_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'raw.githubusercontent.com',
  // GitHub redirects release-asset downloads here. `fetch` follows the
  // redirect itself, so this is only reached by the pre-flight URL check.
  'objects.githubusercontent.com',
]);

export function findCjkFontDownload(family: string): CjkFontDownload | undefined {
  return CJK_FONT_DOWNLOADS.find((font) => font.family === family);
}

/**
 * HTTPS, and a host we recognise.
 *
 * Belt and braces given the table is a compile-time constant — but the table
 * is also the kind of thing that gets edited in a hurry, and a plain `http`
 * URL slipping in would mean installing a font delivered over a channel
 * anybody on the path can rewrite.
 */
export function isAllowedFontDownloadUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname);
}

/**
 * Where a font installs for the current user, with no administrator rights.
 *
 * Windows is absent because the app ships for macOS and Linux only; being told
 * so is more useful than a path that would not work.
 */
export function userFontDirectory(platform: NodeJS.Platform, home: string): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Fonts');
  if (platform === 'linux') return path.join(home, '.local', 'share', 'fonts');
  throw new Error(`Installing fonts is not supported on ${platform}.`);
}

/**
 * Does this look like an actual font file?
 *
 * Every sfnt-based font opens with one of a small set of four-byte tags. The
 * failure this catches is the common one: a proxy, a captive portal or a
 * moved release answers 200 with an HTML page, and without this check that
 * page lands in the font directory named `.ttf` and the font silently never
 * appears.
 */
export function looksLikeFontFile(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const tag = String.fromCharCode(head[0], head[1], head[2], head[3]);
  // 'OTTO' — CFF outlines. 'true'/'ttcf' — Apple TrueType and collections.
  if (tag === 'OTTO' || tag === 'true' || tag === 'ttcf') return true;
  // 0x00010000 — the plain TrueType version tag.
  return head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00;
}

/**
 * Reject a response whose length is nowhere near what the user consented to.
 *
 * The band is wide rather than exact because upstream can re-cut a release
 * without changing the URL. It is not a checksum; it is a guard against
 * installing something of an entirely different nature to what was described.
 */
export function isPlausibleFontSize(actual: number, expected: number): boolean {
  return actual >= expected * 0.5 && actual <= expected * 1.5;
}

export interface InstalledFont {
  readonly family: string;
  readonly path: string;
  readonly bytes: number;
}

/**
 * Fetch a font and write it into the user font directory.
 *
 * The offline check is the first statement in the function, ahead of even the
 * table lookup, so there is no ordering in which a request could be made with
 * the switch on.
 */
export async function installCjkFont(
  family: string,
  options?: { readonly directory?: string },
): Promise<InstalledFont> {
  assertOnline('font-download');

  const font = findCjkFontDownload(family);
  if (!font) {
    throw new Error(`Parallel Code cannot download "${family}". Install it manually instead.`);
  }
  if (!isAllowedFontDownloadUrl(font.url)) {
    throw new Error(`Refusing to download ${family}: ${font.url} is not an allowed source.`);
  }

  let response: Response;
  try {
    response = await fetch(font.url, { redirect: 'follow' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach ${new URL(font.url).hostname} to download ${family}: ${detail}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Downloading ${family} failed: ${new URL(font.url).hostname} answered ` +
        `${response.status} ${response.statusText}.`,
    );
  }

  const data = new Uint8Array(await response.arrayBuffer());
  if (!isPlausibleFontSize(data.byteLength, font.bytes)) {
    throw new Error(
      `Downloading ${family} failed: expected roughly ${font.bytes} bytes but received ` +
        `${data.byteLength}. The release may have moved.`,
    );
  }
  if (!looksLikeFontFile(data)) {
    throw new Error(
      `Downloading ${family} failed: the response was not a font file. ` +
        `Something on the network may have answered in place of the release.`,
    );
  }

  // Resolved here rather than as a default argument so the offline check above
  // is genuinely the first thing that can fail.
  const directory = options?.directory ?? userFontDirectory(process.platform, os.homedir());
  await fs.promises.mkdir(directory, { recursive: true });
  const target = path.join(directory, font.fileName);
  // Write beside the target and rename, so an interrupted download never
  // leaves a half-written file that the font system tries to load.
  const staging = `${target}.part`;
  await fs.promises.writeFile(staging, data);
  await fs.promises.rename(staging, target);

  return { family, path: target, bytes: data.byteLength };
}

/**
 * Font families known to be present, from every source available.
 *
 * Two sources, unioned, because neither is sufficient alone:
 *
 * - `fc-list` without a spacing filter. The existing monospace enumerator
 *   passes `:spacing=mono`, and Sarasa Term is a 2:1 dual-width design whose
 *   fontconfig spacing is not something to bet detection on.
 * - the user font directory. macOS ships no fontconfig at all, so `fc-list` is
 *   usually simply missing there; recognising the files we wrote ourselves is
 *   what makes a font detectable immediately after installing it.
 */
export async function listInstalledCjkFontFamilies(): Promise<string[]> {
  const [enumerated, onDisk] = await Promise.all([
    queryFontConfigFamilies(),
    readUserFontDirectory(),
  ]);
  const found = new Set<string>();
  const wanted = new Map<string, string>();
  for (const font of CJK_FONT_DOWNLOADS) wanted.set(font.fileName.toLowerCase(), font.family);

  for (const family of enumerated) found.add(family);
  for (const file of onDisk) {
    const family = wanted.get(file.toLowerCase());
    if (family) found.add(family);
  }
  return [...found];
}

async function readUserFontDirectory(): Promise<string[]> {
  try {
    const directory = userFontDirectory(process.platform, os.homedir());
    return await fs.promises.readdir(directory);
  } catch {
    // No font directory yet, or an unsupported platform. Neither is an error
    // worth surfacing — it just means nothing was found this way.
    return [];
  }
}

function queryFontConfigFamilies(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'fc-list',
      [':', 'family'],
      { timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(parseFcListFamilies(stdout));
      },
    );
  });
}

/**
 * Pull family names out of `fc-list ... family` output.
 *
 * Each line is a comma-separated list: the primary family first, then aliases
 * for weight variants and localised names. Unlike the monospace enumerator,
 * every name on the line is kept — a CJK font's Traditional Chinese localised
 * name is a legitimate way for the family to be reported.
 */
export function parseFcListFamilies(stdout: string): string[] {
  const families = new Set<string>();
  for (const line of stdout.split('\n')) {
    for (const part of line.split(',')) {
      const name = part.trim();
      if (name && !name.startsWith('.')) families.add(name);
    }
  }
  return [...families];
}
