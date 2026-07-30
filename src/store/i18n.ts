import { store, setStore } from './core';
import {
  translate,
  translateParts,
  type Locale,
  type TemplateSegment,
  type TranslationParams,
} from '../lib/i18n';

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
/**
 * Named `tr`, not the conventional `t`: this codebase already binds `t` to a
 * Task in Solid accessor callbacks (`<Show>{(t) => …}` appears three times in
 * Sidebar.tsx alone), and a shadowed translator fails as a confusing type error
 * rather than an obvious one.
 */
export function tr(text: string, params?: TranslationParams): string {
  return translate(store.locale, text, params);
}

/**
 * `tr` for a sentence whose value is a JSX element rather than a string — a
 * styled `<kbd>` shortcut, a `<strong>` branch name. Returns the translated
 * sentence as segments; the component renders `text` verbatim and decides what
 * each `slot` looks like, so the translation still owns the word order.
 *
 * Separate from `tr` rather than an option on it because the return type
 * differs: components that want a plain string (a `title` attribute) must not
 * be handed segments.
 */
export function trParts(text: string): TemplateSegment[] {
  return translateParts(store.locale, text);
}

export function setLocale(locale: Locale): void {
  setStore('locale', locale);
}
