import { describe, expect, it } from 'vitest';
import { formatDateTime, getLocalDateKey } from './date';

/**
 * These assertions deliberately never spell out a formatted date.
 *
 * The exact output of `Intl` is ICU data, not a contract: CLDR moves separators
 * and spaces between releases, and Node ships whatever ICU it was built
 * against. A test pinned to `'Jan 1, 08:00 AM'` fails on a Node upgrade that
 * broke nothing. The output is also rendered in the machine's timezone, so the
 * clock digits and even the calendar day shift with `TZ`.
 *
 * So each test asserts a property that holds across ICU versions and
 * timezones: that the two locales disagree, that each one carries its own
 * script, and that a time survives at all.
 */

// Midday UTC, so no reasonable `TZ` pushes it across a date boundary and makes
// the day-number assertions ambiguous.
const ISO = '2026-03-05T12:00:00.000Z';

describe('formatDateTime', () => {
  it('has the ICU data for every locale the app offers', () => {
    // If Node were built with a trimmed ICU, `Intl` would silently fall back to
    // English for zh-TW and the locale test below would fail with no clue why.
    expect(Intl.DateTimeFormat.supportedLocalesOf(['en', 'zh-TW'])).toEqual(['en', 'zh-TW']);
  });

  it('formats the same instant differently in each locale', () => {
    // The bug this function exists to fix: the formatted date used to follow
    // the operating system and ignore the app's language setting entirely.
    expect(formatDateTime('en', ISO)).not.toBe(formatDateTime('zh-TW', ISO));
  });

  it('writes the date in the script of the requested locale', () => {
    expect(formatDateTime('zh-TW', ISO)).toContain('月'); // 月
    expect(formatDateTime('zh-TW', ISO)).toContain('日'); // 日
    // An English month abbreviation, in Latin letters, with no CJK anywhere.
    expect(formatDateTime('en', ISO)).toMatch(/[A-Za-z]{3}/);
    expect(formatDateTime('en', ISO)).not.toMatch(/[一-鿿]/);
  });

  it('keeps a clock time in both locales', () => {
    // Hour and minute, whatever separator and hour cycle the locale picks.
    expect(formatDateTime('en', ISO)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatDateTime('zh-TW', ISO)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('is stable for the same instant written two ways', () => {
    expect(formatDateTime('en', '2026-03-05T12:00:00.000Z')).toBe(
      formatDateTime('en', '2026-03-05T14:00:00.000+02:00'),
    );
  });

  it('falls back to the raw value rather than throwing on an unparseable date', () => {
    // Arena history is JSON on disk from older builds. `Intl` throws a
    // RangeError on an invalid Date, and this runs inside a `<For>` row — an
    // unreadable timestamp must cost one row, not the whole history screen.
    expect(formatDateTime('en', 'not-a-date')).toBe('not-a-date');
    expect(formatDateTime('zh-TW', '')).toBe('');
  });
});

describe('getLocalDateKey', () => {
  it('renders a zero-padded local calendar day', () => {
    expect(getLocalDateKey(new Date(2026, 2, 5, 12, 0, 0))).toBe('2026-03-05');
  });
});
