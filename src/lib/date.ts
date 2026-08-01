import type { Locale } from './i18n';

/**
 * How a stored timestamp is written out for a user to read.
 *
 * Month and day without a year: everything shown with this is recent enough
 * that the year is noise, and dropping it keeps the line short enough to sit
 * beside a row's other metadata.
 */
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Constructing an `Intl.DateTimeFormat` is the expensive part — resolving the
 * locale and loading its CLDR patterns costs far more than formatting a date
 * with the result. This runs once per history row and again for every row when
 * the language changes, so the formatters are built once and kept. The map
 * cannot grow past the number of locales the app offers.
 */
const formatters = new Map<Locale, Intl.DateTimeFormat>();

function formatterFor(locale: Locale): Intl.DateTimeFormat {
  const cached = formatters.get(locale);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, DATE_TIME_FORMAT);
  formatters.set(locale, created);
  return created;
}

/**
 * Write an ISO timestamp the way `locale` writes dates.
 *
 * The locale is a parameter rather than a read of `store.locale`, so this stays
 * pure and testable — vitest runs `environment: 'node'`, and a function living
 * in a `.tsx` component cannot be imported by a test at all. `store/i18n.ts`
 * wraps this in `trDate`, which is what components call; that wrapper is what
 * makes the text re-render when the language changes.
 *
 * Passing the locale explicitly is also the whole fix. This used to pass
 * `undefined`, which means "whatever locale the operating system is set to" —
 * so choosing 繁體中文 in the app's settings left every date in the OS's
 * language.
 */
export function formatDateTime(locale: Locale, iso: string): string {
  const value = new Date(iso);
  // `Intl` throws a RangeError on an invalid Date, where the older
  // `toLocaleDateString` returned the string 'Invalid Date'. Arena history is
  // JSON on disk written by older builds, and this is called inside a rendered
  // row, so a timestamp that no longer parses must cost that one row's text
  // rather than throwing the whole screen away.
  if (Number.isNaN(value.getTime())) return iso;
  return formatterFor(locale).format(value);
}

export function getLocalDateKey(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
