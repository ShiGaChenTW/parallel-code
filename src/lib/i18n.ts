/**
 * Minimal translation layer.
 *
 * No i18n library: the renderer entry chunk was just cut from 4.96 MB to
 * 1.27 MB, and pulling in a framework to look up strings in a plain object
 * would spend a meaningful slice of that back. This file is the whole runtime.
 *
 * English source text is the lookup key rather than an invented id
 * (`t('Appearance')`, not `t('settings.appearance')`). For a single app with
 * one translator that means no key vocabulary to maintain, and an untranslated
 * string degrades to readable English instead of a raw id leaking into the UI.
 * The trade-off is that editing English text orphans its translation — the
 * accompanying test asserts every catalogue entry is non-empty so an orphan is
 * at least visible when the catalogue is reviewed.
 */

export type Locale = 'en' | 'zh-TW';

export const LOCALES: readonly Locale[] = ['en', 'zh-TW'];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Traditional Chinese catalogue. Keys are the exact English source strings.
 * Terms deliberately left untranslated: product and vendor names (Parallel
 * Code, Docker, GitHub), git vocabulary that developers here read in English
 * (branch, worktree, commit, rebase, merge), and CLI agent names.
 */
const ZH_TW: Record<string, string> = {
  // Settings — section headings
  Appearance: '外觀',
  Settings: '設定',
  General: '一般',
  Language: '語言',
  Notifications: '通知',
  Terminal: '終端機',
  Advanced: '進階',

  // Appearance modes
  light: '淺色',
  dark: '深色',
  system: '跟隨系統',

  // Common actions
  Cancel: '取消',
  Close: '關閉',
  Save: '儲存',
  Delete: '刪除',
  Remove: '移除',
  Confirm: '確認',
  Retry: '重試',
  Copy: '複製',
  Copied: '已複製',
  Open: '開啟',
  Refresh: '重新整理',
  Search: '搜尋',

  // Task lifecycle
  'New Task': '新增任務',
  Tasks: '任務',
  Projects: '專案',
  Notes: '筆記',
  Plan: '計劃',
  Steps: '步驟',
  Review: '審查',
  'Changed Files': '變更檔案',

  // Status
  Running: '執行中',
  Waiting: '等待中',
  Ready: '就緒',
  Idle: '閒置',
  Error: '錯誤',
  Done: '完成',
  'Needs input': '需要輸入',
};

const CATALOGUES: Record<Locale, Record<string, string>> = {
  en: {},
  'zh-TW': ZH_TW,
};

/**
 * Translate `text` into `locale`. Unknown strings and the `en` locale return
 * `text` unchanged, so a missing translation is a readable English string
 * rather than a blank or an id.
 */
export function translate(locale: Locale, text: string): string {
  return CATALOGUES[locale]?.[text] ?? text;
}

/** Catalogue entries for a locale. Exposed for coverage reporting in tests. */
export function catalogueFor(locale: Locale): Record<string, string> {
  return CATALOGUES[locale] ?? {};
}
