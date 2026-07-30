// Traditional-Chinese terminal fonts — the catalogue, and every decision that
// can be made about it without touching the network or the DOM.
//
// This module is deliberately pure. vitest runs `environment: 'node'`, so the
// only logic that can be covered is logic that does not reach for a browser or
// a filesystem: "is this font installed", "should we ask before downloading",
// "what happens when the user says no". The component that renders this is a
// dumb view over the results, and the actual download lives in the main
// process (`electron/ipc/font-install.ts`).
//
// ## Why a font can be listed but not downloadable
//
// All five fonts here are SIL OFL 1.1 — each licence file was read directly,
// and `licence.url` names the file it was read from. Licence was never the
// constraint. Packaging was: of the five projects, only two publish a single
// installable font file. The rest ship `.7z` or `.zip` archives, and unpacking
// those would mean adding an archive dependency, which this codebase does not
// take on for a font picker. 7z in particular uses LZMA, which Node has no
// built-in for at all.
//
// Rather than pretend, `delivery.kind` says which is which, and an
// archive-only font gets a `manual-install` plan naming the archive, its size
// and the release page. That is a defined outcome, not a silent failure — and
// it is one table edit away from becoming a `direct` download if the app ever
// grows the ability to unpack.

/** Where a licence claim came from. The URL is the file that was read. */
export interface FontLicence {
  readonly spdxId: string;
  readonly name: string;
  readonly url: string;
}

/**
 * How the font project publishes the file.
 *
 * `direct` — one installable font file over HTTPS, pinned to a release tag.
 * `archive` — a `.zip`/`.7z` we cannot open without a new dependency.
 */
export type CjkFontDelivery =
  | {
      readonly kind: 'direct';
      readonly url: string;
      readonly fileName: string;
      readonly bytes: number;
    }
  | { readonly kind: 'archive'; readonly archiveName: string; readonly bytes: number };

export interface CjkTerminalFont {
  /** Exact family name, as the OS font enumerator reports it and CSS needs it. */
  readonly family: string;
  /** One line on what the font is for. Shown next to the option. */
  readonly note: string;
  /** `owner/repo` of the project that publishes it. */
  readonly project: string;
  /** The release these figures were verified against. */
  readonly releaseTag: string;
  readonly releasePageUrl: string;
  readonly licence: FontLicence;
  readonly delivery: CjkFontDelivery;
}

const OFL: Omit<FontLicence, 'url'> = {
  spdxId: 'OFL-1.1',
  name: 'SIL Open Font License 1.1',
};

/**
 * The five options, verified 2026-07-31 against each project's own repository.
 *
 * Sizes and tags are recorded rather than fetched: a size shown before the user
 * consents has to be known before any request is made, and pinning the tag is
 * what stops the installed bytes changing under a user who chose once.
 */
export const CJK_TERMINAL_FONTS: readonly CjkTerminalFont[] = [
  {
    family: 'Sarasa Term TC',
    note: 'Built for terminals; CJK sits at exactly twice the Latin width',
    project: 'be5invis/Sarasa-Gothic',
    releaseTag: 'v1.0.40',
    releasePageUrl: 'https://github.com/be5invis/Sarasa-Gothic/releases/tag/v1.0.40',
    licence: { ...OFL, url: 'https://github.com/be5invis/Sarasa-Gothic/blob/main/LICENSE' },
    delivery: {
      kind: 'archive',
      archiveName: 'SarasaTermTC-TTF-Unhinted-1.0.40.7z',
      bytes: 50_676_743,
    },
  },
  {
    family: 'Sarasa Mono TC',
    note: 'Stricter monospacing than Sarasa Term, same CJK coverage',
    project: 'be5invis/Sarasa-Gothic',
    releaseTag: 'v1.0.40',
    releasePageUrl: 'https://github.com/be5invis/Sarasa-Gothic/releases/tag/v1.0.40',
    licence: { ...OFL, url: 'https://github.com/be5invis/Sarasa-Gothic/blob/main/LICENSE' },
    delivery: {
      kind: 'archive',
      archiveName: 'SarasaMonoTC-TTF-Unhinted-1.0.40.7z',
      bytes: 50_673_819,
    },
  },
  {
    // The project calls its CJK build "CN", and that is the family name the OS
    // reports — "Maple Mono NF CJK" would simply never match anything.
    family: 'Maple Mono NF CN',
    note: 'Rounded, with ligatures and Nerd Font icons',
    project: 'subframe7536/maple-font',
    releaseTag: 'v7.9',
    releasePageUrl: 'https://github.com/subframe7536/maple-font/releases/tag/v7.9',
    licence: { ...OFL, url: 'https://github.com/subframe7536/maple-font/blob/variable/OFL.txt' },
    delivery: { kind: 'archive', archiveName: 'MapleMono-NF-CN.zip', bytes: 159_498_447 },
  },
  {
    family: 'Noto Sans Mono CJK TC',
    note: 'Conservative and broadly compatible',
    project: 'notofonts/noto-cjk',
    releaseTag: 'Sans2.004',
    releasePageUrl: 'https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004',
    // noto-cjk has no LICENSE at the repository root — one lives under `Sans/`
    // and another under `Serif/`. The GitHub licence API reports 404 for this
    // repo for that reason, so the file itself was read instead.
    licence: { ...OFL, url: 'https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE' },
    // The release asset is a 27.8 MB zip. This repository also commits the
    // built fonts, so the file can be taken straight from the release tag —
    // same project, same tag, no repackager in between.
    delivery: {
      kind: 'direct',
      url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Mono/NotoSansMonoCJKtc-Regular.otf',
      fileName: 'NotoSansMonoCJKtc-Regular.otf',
      bytes: 16_392_304,
    },
  },
  {
    // Traditional Chinese lives in its own repository (`LxgwWenkaiTC`, lower-case
    // `k`); the better-known `LxgwWenKai` publishes the Simplified build only.
    family: 'LXGW WenKai Mono TC',
    note: 'Calligraphic; easiest on the eyes over long sessions',
    project: 'lxgw/LxgwWenkaiTC',
    releaseTag: 'v1.522',
    releasePageUrl: 'https://github.com/lxgw/LxgwWenkaiTC/releases/tag/v1.522',
    licence: { ...OFL, url: 'https://github.com/lxgw/LxgwWenkaiTC/blob/main/OFL.txt' },
    delivery: {
      kind: 'direct',
      url: 'https://github.com/lxgw/LxgwWenkaiTC/releases/download/v1.522/LXGWWenKaiMonoTC-Regular.ttf',
      fileName: 'LXGWWenKaiMonoTC-Regular.ttf',
      bytes: 15_277_228,
    },
  },
];

/** Sarasa Term is the default: terminal-first metrics, and the widest install base. */
export const DEFAULT_CJK_TERMINAL_FONT = 'Sarasa Term TC';

export function findCjkTerminalFont(family: string): CjkTerminalFont | undefined {
  return CJK_TERMINAL_FONTS.find((font) => font.family === family);
}

/**
 * A sentence the view translates.
 *
 * The logic decides *what* to say and the view decides what language to say it
 * in — `tr()` reads a reactive locale signal and so cannot be called from a
 * pure function. `text` is the English source string, which is also the
 * translation key (see `src/lib/i18n.ts`).
 */
export interface FontMessage {
  readonly text: string;
  readonly params: Readonly<Record<string, string>>;
}

export type CjkFontPlan =
  /** Nothing to do but set it. */
  | { readonly action: 'apply'; readonly family: string }
  /** Not installed, and only published as an archive we cannot open. */
  | {
      readonly action: 'manual-install';
      readonly family: string;
      readonly releasePageUrl: string;
      readonly message: FontMessage;
    }
  /** Not installed, downloadable, but the offline switch is on. */
  | { readonly action: 'blocked-offline'; readonly family: string; readonly message: FontMessage }
  /** Not installed, downloadable — ask first. */
  | {
      readonly action: 'confirm-download';
      readonly family: string;
      readonly url: string;
      readonly bytes: number;
      readonly message: FontMessage;
    };

export interface CjkFontSelection {
  readonly family: string;
  readonly installedFamilies: readonly string[];
  readonly offlineMode: boolean;
}

/**
 * Decide what picking `family` should do.
 *
 * Order matters and is not arbitrary:
 *
 * 1. A font we do not manage is applied untouched — the existing system font
 *    picker keeps working exactly as before.
 * 2. An installed font is applied even in offline mode, because reading a file
 *    already on disk is not an outbound request.
 * 3. An archive-only font goes to manual install *before* the offline check.
 *    That path makes no request from the app at all — it hands a release page
 *    to the user's browser, which PRIVACY.md already treats as outside the
 *    switch ("a link is only fetched when you click it"). Reporting "offline
 *    mode blocked this" for it would simply be untrue.
 * 4. Only then does the offline switch apply, to the one case that would
 *    genuinely have made a request.
 */
export function planCjkFontSelection(input: CjkFontSelection): CjkFontPlan {
  const { family, installedFamilies, offlineMode } = input;
  const font = findCjkTerminalFont(family);
  if (!font) return { action: 'apply', family };
  if (isCjkFontInstalled(family, installedFamilies)) return { action: 'apply', family };

  const size = formatFontSize(font.delivery.bytes);

  if (font.delivery.kind === 'archive') {
    return {
      action: 'manual-install',
      family,
      releasePageUrl: font.releasePageUrl,
      message: {
        text:
          '{font} is not installed. Its project publishes it only as {archive} ({size}), ' +
          'which Parallel Code cannot unpack. Open the release page to install it yourself. ' +
          'Licence: {licence}.',
        params: {
          font: family,
          archive: font.delivery.archiveName,
          size,
          licence: font.licence.name,
        },
      },
    };
  }

  if (offlineMode) {
    return {
      action: 'blocked-offline',
      family,
      message: {
        text:
          'Offline mode is on, so {font} was not downloaded. ' +
          'Turn it off in Settings to allow this.',
        params: { font: family },
      },
    };
  }

  return {
    action: 'confirm-download',
    family,
    url: font.delivery.url,
    bytes: font.delivery.bytes,
    message: {
      text:
        '{font} is not installed. Download {size} from {source} and install it for your user ' +
        'account? Licence: {licence}.',
      params: {
        font: family,
        size,
        source: font.delivery.url,
        licence: font.licence.name,
      },
    },
  };
}

export type CjkFontInstallOutcome = 'installed' | 'declined' | 'failed';

/**
 * Which font the terminal should end up on after an install attempt.
 *
 * Declining, or a failed download, leaves the previous font in place. The
 * alternative — applying the choice anyway — drops xterm to its `monospace`
 * fallback, which looks exactly like the feature is broken. A user who said
 * "no" made a decision; the honest response is to leave the setting where it
 * was and say so.
 */
export function fontAfterInstallAttempt(
  previous: string,
  requested: string,
  outcome: CjkFontInstallOutcome,
): string {
  return outcome === 'installed' ? requested : previous;
}

/** Human size for a consent prompt. Decimal MB, matching what an OS reports for a download. */
export function formatFontSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function normaliseFamily(family: string): string {
  return family.trim().toLowerCase();
}

/**
 * Whether `family` appears in a list of font families reported by the system.
 *
 * Matched case-insensitively and whitespace-trimmed: the family name comes out
 * of a font's own name table via whatever enumerator the platform has, and a
 * difference in case there is not a different font.
 */
export function isCjkFontInstalled(family: string, installed: readonly string[]): boolean {
  const wanted = normaliseFamily(family);
  return installed.some((candidate) => normaliseFamily(candidate) === wanted);
}

/**
 * Map font *file names* back to families we know.
 *
 * Needed because font enumeration is not reliable everywhere: macOS ships no
 * fontconfig, so `fc-list` is usually missing and the system enumerator returns
 * nothing at all. Listing the user font directory and recognising the files we
 * wrote ourselves is what makes a just-installed font detectable on the very
 * next check, on every supported platform.
 */
export function familiesFromFontFiles(fileNames: readonly string[]): string[] {
  const byFileName = new Map<string, string>();
  for (const font of CJK_TERMINAL_FONTS) {
    if (font.delivery.kind === 'direct') {
      byFileName.set(font.delivery.fileName.toLowerCase(), font.family);
    }
  }
  const found = new Set<string>();
  for (const name of fileNames) {
    const family = byFileName.get(name.trim().toLowerCase());
    if (family) found.add(family);
  }
  return [...found];
}
