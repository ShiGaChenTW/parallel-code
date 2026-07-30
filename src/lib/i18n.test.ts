import { describe, expect, it } from 'vitest';
import {
  catalogueFor,
  COLON_LABEL_KEYS,
  interpolate,
  isLocale,
  LOCALES,
  LOCALE_LABELS,
  parseTemplate,
  translate,
  translateParts,
} from './i18n';

describe('translate', () => {
  it('returns the Traditional Chinese entry when one exists', () => {
    expect(translate('zh-TW', 'Appearance')).toBe('外觀');
  });

  it('returns the source text unchanged for English', () => {
    expect(translate('en', 'Appearance')).toBe('Appearance');
  });

  it('falls back to readable English rather than a blank for an unknown string', () => {
    expect(translate('zh-TW', 'Some string nobody has translated yet')).toBe(
      'Some string nobody has translated yet',
    );
  });

  it('is case sensitive, so a near-miss key does not silently resolve', () => {
    expect(translate('zh-TW', 'appearance')).toBe('appearance');
  });

  it('handles the empty string without throwing', () => {
    expect(translate('zh-TW', '')).toBe('');
  });
});

describe('parseTemplate', () => {
  it('returns a single text segment when there is no placeholder', () => {
    expect(parseTemplate('Merge into main')).toEqual([{ kind: 'text', value: 'Merge into main' }]);
  });

  it('splits text and slots in source order', () => {
    expect(parseTemplate('Merge into {branch} now')).toEqual([
      { kind: 'text', value: 'Merge into ' },
      { kind: 'slot', name: 'branch' },
      { kind: 'text', value: ' now' },
    ]);
  });

  it('emits no empty text segment when a placeholder starts or ends the template', () => {
    expect(parseTemplate('{count} stars')).toEqual([
      { kind: 'slot', name: 'count' },
      { kind: 'text', value: ' stars' },
    ]);
    expect(parseTemplate('Hue {hue}')).toEqual([
      { kind: 'text', value: 'Hue ' },
      { kind: 'slot', name: 'hue' },
    ]);
  });

  it('emits adjacent slots without a text segment between them', () => {
    expect(parseTemplate('{a}{b}')).toEqual([
      { kind: 'slot', name: 'a' },
      { kind: 'slot', name: 'b' },
    ]);
  });

  it('returns nothing for the empty string', () => {
    expect(parseTemplate('')).toEqual([]);
  });

  it('treats braces that are not a well-formed placeholder as literal text', () => {
    // Catalogue copy may legitimately contain braces (a JSON snippet, a shell
    // expansion). Only `{name}` with an identifier inside is a placeholder.
    for (const literal of ['{}', '{ branch }', '{1st}', '{a-b}', 'a { b']) {
      expect(parseTemplate(literal), literal).toEqual([{ kind: 'text', value: literal }]);
    }
  });

  it('gives `$` no special meaning, so `${x}` is a literal dollar plus a slot', () => {
    // Worth pinning: these templates are migrated out of JS template literals,
    // and a stray `$` left behind should render as a `$`, not silently disable
    // the placeholder next to it.
    expect(parseTemplate('${branch}')).toEqual([
      { kind: 'text', value: '$' },
      { kind: 'slot', name: 'branch' },
    ]);
  });
});

describe('interpolate', () => {
  it('substitutes a named placeholder', () => {
    expect(interpolate('Merge into {branch}', { branch: 'main' })).toBe('Merge into main');
  });

  it('stringifies number parameters', () => {
    expect(interpolate('{count} added lines', { count: 12 })).toBe('12 added lines');
    expect(interpolate('{count} added lines', { count: 0 })).toBe('0 added lines');
  });

  it('substitutes a parameter referenced more than once at every occurrence', () => {
    // A translator may need to repeat a value that English states once. Replacing
    // only the first occurrence would silently drop information from the sentence.
    expect(
      interpolate('{branch} rebases onto {base}, then {branch} is pushed', {
        branch: 'feat/x',
        base: 'main',
      }),
    ).toBe('feat/x rebases onto main, then feat/x is pushed');
  });

  it('leaves a missing parameter visible as its own placeholder', () => {
    // Deliberate: blanking would silently lose information and throwing would
    // blank a whole panel through the error boundary for what is a copy bug.
    // A literal `{branch}` in the UI is loud enough to be caught in review.
    expect(interpolate('Merge into {branch}', {})).toBe('Merge into {branch}');
    expect(interpolate('Merge into {branch}', { other: 'x' })).toBe('Merge into {branch}');
  });

  it('ignores an extra parameter the template does not reference', () => {
    // Catalogues and call sites drift; an unused parameter is not a user-facing
    // defect, so it is dropped rather than reported.
    expect(interpolate('Merge into {branch}', { branch: 'main', unused: 'noise' })).toBe(
      'Merge into main',
    );
  });

  it('never re-scans a substituted value for placeholders', () => {
    // A branch literally named `{base}` must not pull in another parameter.
    expect(interpolate('Merge into {branch}', { branch: '{base}', base: 'main' })).toBe(
      'Merge into {base}',
    );
  });

  it('returns the template untouched when no parameters are given', () => {
    expect(interpolate('Merge into {branch}')).toBe('Merge into {branch}');
  });
});

describe('translate with parameters', () => {
  it('interpolates into the Traditional Chinese template, so word order is the translator’s', () => {
    // The zh-TW entry puts the count after the noun; English puts it before.
    expect(translate('zh-TW', '{count} added lines', { count: 3 })).toBe('新增 3 行');
  });

  it('interpolates into the English source text for an unknown catalogue key', () => {
    expect(translate('zh-TW', 'Nobody translated {thing} yet', { thing: 'this' })).toBe(
      'Nobody translated this yet',
    );
  });

  it('leaves a template alone when called without parameters', () => {
    expect(translate('en', 'Merge into {branch}')).toBe('Merge into {branch}');
  });
});

describe('translateParts', () => {
  it('returns the translated template split into segments', () => {
    expect(translateParts('zh-TW', '{count} added lines')).toEqual([
      { kind: 'text', value: '新增 ' },
      { kind: 'slot', name: 'count' },
      { kind: 'text', value: ' 行' },
    ]);
  });

  it('falls back to segmenting the English source for an unknown key', () => {
    expect(translateParts('zh-TW', 'Untranslated {slot}')).toEqual([
      { kind: 'text', value: 'Untranslated ' },
      { kind: 'slot', name: 'slot' },
    ]);
  });
});

describe('isLocale', () => {
  it('accepts every declared locale', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
  });

  it('rejects anything else, so persisted junk cannot become the locale', () => {
    expect(isLocale('zh-CN')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe('catalogue integrity', () => {
  it('gives every locale a display label', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
  });

  it('keeps the English catalogue empty — English is the source, not a translation', () => {
    expect(Object.keys(catalogueFor('en'))).toHaveLength(0);
  });

  it('has no blank translations, which would render as an empty UI string', () => {
    for (const [key, value] of Object.entries(catalogueFor('zh-TW'))) {
      expect(value.trim(), `empty translation for "${key}"`).not.toBe('');
    }
  });

  it('has no entry that merely repeats its English key', () => {
    // A key mapping to itself is either an oversight or a term that should have
    // been left out of the catalogue entirely.
    for (const [key, value] of Object.entries(catalogueFor('zh-TW'))) {
      expect(value, `"${key}" maps to itself`).not.toBe(key);
    }
  });

  it('has no key with surrounding whitespace, which never matches JSX text', () => {
    for (const key of Object.keys(catalogueFor('zh-TW'))) {
      expect(key, `"${key}" has surrounding whitespace`).toBe(key.trim());
    }
  });

  it('gives every translation the same placeholder set as its English key', () => {
    // A translation that drops `{count}` renders a sentence with a hole in it,
    // and one that invents `{cout}` renders the typo verbatim. Both are caught
    // here rather than in the UI.
    for (const [key, value] of Object.entries(catalogueFor('zh-TW'))) {
      expect(slotNames(value), `placeholders differ for "${key}"`).toEqual(slotNames(key));
    }
  });

  it('ends a key with a colon only for the declared label entries', () => {
    // A trailing colon used to mean "the code concatenates the value after
    // this", which pins word order to English. The only survivors are labels
    // whose value is a sibling DOM node (a form input, a list, a styled PIN),
    // where label-first is correct in both languages and there is no string
    // concatenation to unpin.
    const colonKeys = Object.keys(catalogueFor('zh-TW')).filter((key) => key.endsWith(':'));
    expect(colonKeys.sort()).toEqual([...COLON_LABEL_KEYS].sort());
  });

  it('translates every declared colon label, so the allowlist cannot rot', () => {
    for (const key of COLON_LABEL_KEYS) {
      expect(catalogueFor('zh-TW')[key], `"${key}" is allowlisted but absent`).toBeTruthy();
    }
  });
});

/** Placeholder names in a template, deduplicated and sorted. */
function slotNames(template: string): string[] {
  const names = parseTemplate(template)
    .filter((segment) => segment.kind === 'slot')
    .map((segment) => segment.name);
  return [...new Set(names)].sort();
}
