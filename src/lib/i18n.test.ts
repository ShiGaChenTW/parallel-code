import { describe, expect, it } from 'vitest';
import { catalogueFor, isLocale, LOCALES, LOCALE_LABELS, translate } from './i18n';

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
});
