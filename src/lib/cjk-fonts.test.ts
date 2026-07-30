import { describe, expect, it } from 'vitest';

import { catalogueFor } from './i18n';
import {
  CJK_TERMINAL_FONTS,
  DEFAULT_CJK_TERMINAL_FONT,
  familiesFromFontFiles,
  findCjkTerminalFont,
  fontAfterInstallAttempt,
  formatFontSize,
  isCjkFontInstalled,
  planCjkFontSelection,
} from './cjk-fonts';

// Every font in the catalogue that we can actually fetch as a single file.
const directFonts = CJK_TERMINAL_FONTS.filter((f) => f.delivery.kind === 'direct');
const archiveFonts = CJK_TERMINAL_FONTS.filter((f) => f.delivery.kind === 'archive');

describe('the catalogue', () => {
  it('offers exactly five fonts — the number is the product decision, not an accident', () => {
    expect(CJK_TERMINAL_FONTS).toHaveLength(5);
  });

  it('has no duplicate family names, because family name is the identity used everywhere', () => {
    const families = CJK_TERMINAL_FONTS.map((f) => f.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it('defaults to a font that is actually in the catalogue', () => {
    expect(findCjkTerminalFont(DEFAULT_CJK_TERMINAL_FONT)).toBeDefined();
  });

  // The licence check was the gating step of this work: the brief listed four
  // fonts as "reported open source" with no evidence. Each entry now carries
  // the URL of the licence file that was actually read, so the claim is
  // falsifiable rather than folklore.
  it('records a free licence and the file that licence was read from', () => {
    for (const font of CJK_TERMINAL_FONTS) {
      expect(font.licence.spdxId, `${font.family} has no SPDX id`).toBe('OFL-1.1');
      expect(font.licence.url, `${font.family} has no licence source`).toMatch(/^https:\/\//);
    }
  });

  it('points every download and release link at HTTPS', () => {
    for (const font of CJK_TERMINAL_FONTS) {
      expect(font.releasePageUrl).toMatch(/^https:\/\//);
      if (font.delivery.kind === 'direct') expect(font.delivery.url).toMatch(/^https:\/\//);
    }
  });

  // Guards the provenance rule: fonts come from the project that publishes
  // them, never from a CDN or a repackager.
  it('downloads only from GitHub paths owned by the font project itself', () => {
    for (const font of directFonts) {
      if (font.delivery.kind !== 'direct') throw new Error('filtered wrong');
      const url = new URL(font.delivery.url);
      expect(['github.com', 'raw.githubusercontent.com']).toContain(url.hostname);
      expect(url.pathname.startsWith(`/${font.project}/`)).toBe(true);
    }
  });

  // A pinned tag is what makes the download reproducible. A URL that tracks a
  // branch would silently change what gets installed.
  it('pins every download to the release tag it was verified against', () => {
    for (const font of directFonts) {
      if (font.delivery.kind !== 'direct') throw new Error('filtered wrong');
      expect(font.delivery.url).toContain(font.releaseTag);
      expect(font.releasePageUrl).toContain(font.releaseTag);
    }
  });

  it('states a real byte size for every delivery, so consent is informed', () => {
    for (const font of CJK_TERMINAL_FONTS) {
      expect(font.delivery.bytes).toBeGreaterThan(1_000_000);
    }
  });

  it('names the file it will write for every direct download', () => {
    for (const font of directFonts) {
      if (font.delivery.kind !== 'direct') throw new Error('filtered wrong');
      expect(font.delivery.fileName).toMatch(/\.(ttf|otf|ttc)$/);
      // The written name must match the URL, or the install-detection scan of
      // the font directory would look for a file that was never created.
      expect(font.delivery.url.endsWith(font.delivery.fileName)).toBe(true);
    }
  });

  it('still has at least one font of each delivery kind, which is what makes both paths real', () => {
    expect(directFonts.length).toBeGreaterThan(0);
    expect(archiveFonts.length).toBeGreaterThan(0);
  });
});

describe('findCjkTerminalFont', () => {
  it('finds a font by its exact family name', () => {
    expect(findCjkTerminalFont('LXGW WenKai Mono TC')?.project).toBe('lxgw/LxgwWenkaiTC');
  });

  it('returns undefined for a font it does not manage, rather than guessing', () => {
    expect(findCjkTerminalFont('JetBrains Mono')).toBeUndefined();
    expect(findCjkTerminalFont('')).toBeUndefined();
  });

  it('is case sensitive, because the family name is matched against the OS verbatim', () => {
    expect(findCjkTerminalFont('lxgw wenkai mono tc')).toBeUndefined();
  });
});

describe('isCjkFontInstalled', () => {
  it('reports a font present in the system list', () => {
    expect(isCjkFontInstalled('Sarasa Term TC', ['Menlo', 'Sarasa Term TC'])).toBe(true);
  });

  it('reports a font missing from the system list', () => {
    expect(isCjkFontInstalled('Sarasa Term TC', ['Menlo'])).toBe(false);
  });

  it('treats an empty list as "nothing detected", not as "everything missing but fine"', () => {
    expect(isCjkFontInstalled('Sarasa Term TC', [])).toBe(false);
  });

  // fc-list reports family names with their own spacing/casing depending on the
  // font's name table; a trailing space in one source should not read as a
  // different font.
  it('ignores surrounding whitespace and case differences from the font enumerator', () => {
    expect(isCjkFontInstalled('Sarasa Term TC', ['  sarasa term tc '])).toBe(true);
  });
});

describe('planCjkFontSelection', () => {
  const installedAll = CJK_TERMINAL_FONTS.map((f) => f.family);

  it('applies straight away when the font is already installed', () => {
    const plan = planCjkFontSelection({
      family: 'Sarasa Term TC',
      installedFamilies: installedAll,
      offlineMode: false,
    });
    expect(plan.action).toBe('apply');
  });

  // Offline mode is about outbound requests. Applying a font that is already on
  // disk makes none, so the switch must not block it.
  it('applies an installed font even in offline mode — no request is involved', () => {
    const plan = planCjkFontSelection({
      family: 'Sarasa Term TC',
      installedFamilies: installedAll,
      offlineMode: true,
    });
    expect(plan.action).toBe('apply');
  });

  it('applies an unmanaged font untouched, so the existing font picker still works', () => {
    const plan = planCjkFontSelection({
      family: 'JetBrains Mono',
      installedFamilies: [],
      offlineMode: false,
    });
    expect(plan.action).toBe('apply');
  });

  it('asks before downloading anything — consent is never assumed', () => {
    const font = directFonts[0];
    if (font.delivery.kind !== 'direct') throw new Error('filtered wrong');
    const plan = planCjkFontSelection({
      family: font.family,
      installedFamilies: [],
      offlineMode: false,
    });
    expect(plan.action).toBe('confirm-download');
    if (plan.action !== 'confirm-download') throw new Error('unreachable');
    expect(plan.url).toBe(font.delivery.url);
    expect(plan.bytes).toBe(font.delivery.bytes);
  });

  it('shows licence, source and size in the consent prompt', () => {
    const font = directFonts[0];
    if (font.delivery.kind !== 'direct') throw new Error('filtered wrong');
    const plan = planCjkFontSelection({
      family: font.family,
      installedFamilies: [],
      offlineMode: false,
    });
    if (plan.action !== 'confirm-download') throw new Error('expected a consent prompt');
    expect(plan.message.params.licence).toBe(font.licence.name);
    expect(plan.message.params.size).toBe(formatFontSize(font.delivery.bytes));
    expect(plan.message.params.source).toBe(font.delivery.url);
    expect(plan.message.params.font).toBe(font.family);
  });

  // THE offline-mode assertion for this feature. `blocked-offline` is the only
  // outcome that can occur here, and it carries no URL — there is nothing for a
  // caller to accidentally fetch.
  it('refuses to download while offline mode is on, and says why', () => {
    for (const font of directFonts) {
      const plan = planCjkFontSelection({
        family: font.family,
        installedFamilies: [],
        offlineMode: true,
      });
      expect(plan.action, `${font.family} should be blocked offline`).toBe('blocked-offline');
      expect(JSON.stringify(plan)).not.toContain('https://');
      if (plan.action !== 'blocked-offline') throw new Error('unreachable');
      expect(plan.message.text).toContain('Offline mode is on');
      // A blocked action with no remedy is a dead end — same rule the rest of
      // the offline surfaces follow.
      expect(plan.message.text).toContain('Turn it off in Settings');
    }
  });

  it('routes an archive-only font to manual install, naming the archive and its size', () => {
    const font = archiveFonts[0];
    if (font.delivery.kind !== 'archive') throw new Error('filtered wrong');
    const plan = planCjkFontSelection({
      family: font.family,
      installedFamilies: [],
      offlineMode: false,
    });
    expect(plan.action).toBe('manual-install');
    if (plan.action !== 'manual-install') throw new Error('unreachable');
    expect(plan.releasePageUrl).toBe(font.releasePageUrl);
    expect(plan.message.params.archive).toBe(font.delivery.archiveName);
    expect(plan.message.params.size).toBe(formatFontSize(font.delivery.bytes));
  });

  // Reporting "offline mode blocked this" for a path that never makes a request
  // would be a false statement. Archive fonts are checked first for that reason.
  it('still offers manual install in offline mode, because that path makes no request', () => {
    const font = archiveFonts[0];
    const plan = planCjkFontSelection({
      family: font.family,
      installedFamilies: [],
      offlineMode: true,
    });
    expect(plan.action).toBe('manual-install');
  });
});

// The i18n catalogue is keyed on the exact English source string, so an edit to
// a message here silently orphans its translation. This derives the strings
// from the planner rather than restating them, which is the only way the check
// keeps meaning something after the next edit. The audience for a Traditional
// Chinese font picker is precisely the audience that reads zh-TW.
describe('every sentence this feature can produce is translated', () => {
  const zhTW = catalogueFor('zh-TW');

  const everyMessage = () => {
    const messages: string[] = [];
    for (const font of CJK_TERMINAL_FONTS) {
      messages.push(font.note);
      for (const offlineMode of [false, true]) {
        const plan = planCjkFontSelection({
          family: font.family,
          installedFamilies: [],
          offlineMode,
        });
        if (plan.action !== 'apply') messages.push(plan.message.text);
      }
    }
    return [...new Set(messages)];
  };

  it('has a non-empty zh-TW entry for every message and every font note', () => {
    for (const text of everyMessage()) {
      expect(zhTW[text], `untranslated: ${text}`).toBeTruthy();
    }
  });

  it('keeps every placeholder the English sentence uses, or a value would vanish', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const text of everyMessage()) {
      const translated = zhTW[text];
      if (!translated) continue;
      expect(placeholders(translated), `placeholders drifted for: ${text}`).toEqual(
        placeholders(text),
      );
    }
  });
});

describe('fontAfterInstallAttempt', () => {
  // The defined behaviour for "user picked an uninstalled font and said no".
  // Applying it anyway would drop xterm to its `monospace` fallback, which is
  // indistinguishable from the feature being broken.
  it('keeps the previous font when the user declines the download', () => {
    expect(fontAfterInstallAttempt('Menlo', 'Sarasa Term TC', 'declined')).toBe('Menlo');
  });

  it('keeps the previous font when the download fails', () => {
    expect(fontAfterInstallAttempt('Menlo', 'Sarasa Term TC', 'failed')).toBe('Menlo');
  });

  it('switches to the requested font once it is installed', () => {
    expect(fontAfterInstallAttempt('Menlo', 'Sarasa Term TC', 'installed')).toBe('Sarasa Term TC');
  });
});

describe('formatFontSize', () => {
  it('reports megabytes to one decimal, which is the scale these fonts live at', () => {
    expect(formatFontSize(15_277_228)).toBe('15.3 MB');
    expect(formatFontSize(159_498_447)).toBe('159.5 MB');
  });

  it('drops to kilobytes below a megabyte rather than printing 0.0 MB', () => {
    expect(formatFontSize(51_200)).toBe('51 kB');
  });

  it('never renders a nonsense size for a nonsense input', () => {
    expect(formatFontSize(Number.NaN)).toBe('unknown size');
    expect(formatFontSize(-1)).toBe('unknown size');
  });
});

describe('familiesFromFontFiles', () => {
  // macOS ships no fontconfig, so `fc-list` is usually absent and the system
  // enumerator returns nothing. Reading the font directory is what makes a
  // font we just wrote detectable on the next check.
  it('recognises a font we installed ourselves by its file name', () => {
    expect(familiesFromFontFiles(['LXGWWenKaiMonoTC-Regular.ttf'])).toEqual([
      'LXGW WenKai Mono TC',
    ]);
  });

  it('ignores files it did not put there', () => {
    expect(familiesFromFontFiles(['Menlo.ttc', 'notes.txt', ''])).toEqual([]);
  });

  it('reports each family once even if the directory holds duplicates', () => {
    const files = ['LXGWWenKaiMonoTC-Regular.ttf', 'LXGWWenKaiMonoTC-Regular.ttf'];
    expect(familiesFromFontFiles(files)).toEqual(['LXGW WenKai Mono TC']);
  });

  it('covers every direct download, or a just-installed font would go unnoticed', () => {
    const fileNames = directFonts.map((f) =>
      f.delivery.kind === 'direct' ? f.delivery.fileName : '',
    );
    expect(familiesFromFontFiles(fileNames).sort()).toEqual(
      directFonts.map((f) => f.family).sort(),
    );
  });
});
