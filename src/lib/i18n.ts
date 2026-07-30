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

  // Sidebar
  'Add project': '新增專案',
  'Remove project': '移除專案',
  'Click to restore': '點擊以復原',
  'Expand projects': '展開專案',
  'Collapse projects': '收合專案',
  'Folder not found': '找不到資料夾',
  'Connect Phone': '連接手機',
  'Phone Connected': '手機已連接',

  // New task dialog
  Project: '專案',
  'Git Isolation': 'Git 隔離',
  'Run in Docker container': '在 Docker 容器中執行',
  'Coordinator mode': 'Coordinator 模式',
  'Propagate skip-permissions to sub-tasks': '將 skip-permissions 傳遞給子任務',
  'Steps tracking': '步驟追蹤',
  'Dangerously skip all confirms': '危險：略過所有確認',
  'Discard draft?': '要捨棄草稿嗎？',
  "Couldn't load branches.": '無法載入 branch。',
  'Image not found locally.': '本機找不到此 image。',

  // Window and dialog controls
  Minimize: '最小化',
  'Minimize window': '最小化視窗',
  'Close window': '關閉視窗',
  'Close dialog': '關閉對話框',
  'Cancel (Esc)': '取消（Esc）',
  'Close (Esc)': '關閉（Esc）',
  'Close help': '關閉說明',
  'Close search': '關閉搜尋',
  'Close settings': '關閉設定',
  Dismiss: '關閉',
  Next: '下一個',
  Previous: '上一個',
  'Next match': '下一個相符',
  'Previous match': '上一個相符',
  'Next match (Enter)': '下一個相符（Enter）',
  'Previous match (Shift+Enter)': '上一個相符（Shift+Enter）',

  // Agents and terminals
  'Add AI agent': '新增 AI agent',
  'Close AI agent': '關閉 AI agent',
  'New terminal': '新增終端機',
  'Close terminal': '關閉終端機',
  'Close terminal (Ctrl+Shift+Q)': '關閉終端機（Ctrl+Shift+Q）',
  'New task': '新增任務',
  'Close task': '關閉任務',
  'Close Task': '關閉任務',
  'Collapse task': '收合任務',
  // 'Coordinator' is deliberately absent: it stays English, and translate()
  // already falls back to the source text. A self-mapping entry would be a
  // no-op that reads like a translation.
  'View MCP logs': '檢視 MCP 記錄',
  Diagnostics: '診斷',

  // Changes and review
  'All changes (including uncommitted)': '所有變更（含未 commit）',
  'Uncommitted changes only': '僅未 commit 的變更',
  'Commit tree': 'Commit 樹',
  'Has commits': '有 commit',
  'Ready to merge summary': '可合併摘要',
  'Close dialog and ask the AI agent to rebase': '關閉對話框並請 AI agent 執行 rebase',
  'Open in editor': '在編輯器中開啟',
  'Click to copy': '點擊以複製',

  // Bookmarks
  'Bookmark selection': '將選取加入書籤',
  'Remove bookmark': '移除書籤',
  'Jump to terminal moment': '跳至該終端時刻',

  // Prompt and notes
  'Send prompt': '送出 prompt',
  'Send notes as a prompt to the agent': '將筆記當作 prompt 送給 agent',

  // Project and settings
  'Project settings': '專案設定',
  'Remove project?': '要移除專案嗎？',
  'New Task Defaults': '新增任務預設值',
  Behavior: '行為',
  Branches: 'Branch',
  'Reset to default': '重設為預設值',
  'Clone as custom theme': '複製為自訂主題',
  'Edit custom theme': '編輯自訂主題',
  'Auto-trust folders': '自動信任資料夾',
  'Desktop notifications': '桌面通知',
  'Font smoothing': '字型平滑',
  'Dangerously skip all confirms by default': '危險：預設略過所有確認',

  // Placeholders
  'Search...': '搜尋…',
  Find: '尋找',
  'Notes...': '筆記…',
  'Commit message...': 'Commit 訊息…',
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
