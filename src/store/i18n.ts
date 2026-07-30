import { store, setStore } from './core';
import { translate, type Locale } from '../lib/i18n';

/**
 * Translate a UI string into the active locale.
 *
 * Reads `store.locale`, so calling this inside JSX makes the text re-render
 * when the locale changes — no reload, no provider component.
 *
 * Mirrors the existing split where `lib/look.ts` holds pure theme data and
 * `store/ui.ts` holds the reactive state around it: `lib/i18n.ts` is the pure
 * catalogue, this file is the reactive read.
 */
export function t(text: string): string {
  return translate(store.locale, text);
}

export function setLocale(locale: Locale): void {
  setStore('locale', locale);
}
