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
 *
 * Sentences that contain a value use `{name}` placeholders
 * (`'Merge into {branch}'`), so the whole sentence is one catalogue entry and
 * the translator decides where the value lands. The alternative the codebase
 * used before — a catalogue entry ending in a colon with the value concatenated
 * after it — pinned every such sentence to English label-first order.
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
 * Values substituted into a translated sentence. Named rather than positional:
 * `{branch}` still reads as the branch after a translator has moved it to the
 * front of the sentence, where `{0}` would not.
 *
 * Deliberately narrow — `string | number` only. Anything else (a Date, an
 * element) has locale-dependent formatting of its own and belongs at the call
 * site, not inside a string template.
 */
export type TranslationParams = Readonly<Record<string, string | number>>;

/** A translated template cut into literal text and `{name}` placeholders. */
export type TemplateSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'slot'; readonly name: string };

/**
 * A placeholder is `{` + an identifier + `}`. Anything else containing a brace
 * — `{}`, `{ spaced }`, a JSON snippet in help copy — stays literal text, so
 * there is no escape syntax for the translator to get wrong.
 */
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Cut `template` into text and slot segments in source order. Empty text
 * segments are never emitted, so a template that is a bare placeholder yields
 * exactly one slot.
 */
export function parseTemplate(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let cursor = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const start = match.index;
    const name = match[1];
    if (start === undefined || name === undefined) continue;
    if (start > cursor) segments.push({ kind: 'text', value: template.slice(cursor, start) });
    segments.push({ kind: 'slot', name });
    cursor = start + match[0].length;
  }
  if (cursor < template.length) segments.push({ kind: 'text', value: template.slice(cursor) });
  return segments;
}

/**
 * Substitute `params` into `template`.
 *
 * Three deliberate behaviours, each covered by a test:
 * - a missing parameter is left as its own `{name}`, because a visible
 *   placeholder is caught in review while a blank silently loses information
 *   and a throw would blank a panel through the error boundary;
 * - an extra parameter is ignored, because catalogue and call site drift and an
 *   unused value is not a user-facing defect;
 * - substituted values are never re-scanned, so a branch literally named
 *   `{base}` cannot pull in another parameter.
 */
export function interpolate(template: string, params?: TranslationParams): string {
  if (params === undefined) return template;
  return parseTemplate(template)
    .map((segment) => (segment.kind === 'text' ? segment.value : resolveSlot(segment.name, params)))
    .join('');
}

function resolveSlot(name: string, params: TranslationParams): string {
  const value: string | number | undefined = params[name];
  return value === undefined ? `{${name}}` : String(value);
}

/**
 * Traditional Chinese catalogue. Keys are the exact English source strings.
 * Terms deliberately left untranslated: product and vendor names (Parallel
 * Code, Docker, GitHub), git vocabulary that developers here read in English
 * (branch, worktree, commit, rebase, merge), and CLI agent names.
 */
const ZH_TW: Record<string, string> = {
  // Developer vocabulary kept in English — Branch, Agent, Prompt, Push and
  // friends are the words this audience reads. translate() falls back to the
  // source text, so they are absent rather than mapped to themselves.
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

  // Huly
  'Start from a Huly issue': '從 Huly issue 開工',
  'No issues loaded yet.': '尚未載入任何 issue。',
  'Every issue already has a task.': '每一張 issue 都已經有任務了。',
  'Showing cached issues — Huly unreachable.': '顯示快取的 issue —— 目前連不上 Huly。',
  'Huly project': 'Huly 專案',
  'Server URL': '伺服器網址',
  // 'Workspace' and 'Token' stay English — they are the words Huly's own UI
  // uses, so translating them would make the two screens disagree.
  'Test connection': '測試連線',
  'Clear credentials': '清除憑證',
  'Connected.': '已連線。',
  // Settings — checkbox descriptions
  'Automatically accept trust and permission dialogs from agents':
    '自動接受 agent 的信任與權限對話框',
  'Daily completed-task count and merged-line totals at the bottom of the sidebar':
    '在側欄底部顯示每日完成任務數與合併行數總計',
  'Display Claude Code plan files in a tab next to Notes':
    '在筆記旁邊的分頁顯示 Claude Code 的 plan 檔案',
  'Enable antialiasing and geometric text rendering': '啟用反鋸齒與幾何文字算繪',
  'Keyboard shortcut hints at the bottom of the sidebar': '在側欄底部顯示快捷鍵提示',
  'Pre-tick Steps tracking in the New Task dialog': '在新增任務對話框中預先勾選步驟追蹤',
  'Show native notifications when tasks finish or need attention':
    '任務完成或需要處理時顯示系統通知',
  'When hidden, the terminal occupies the full panel and auto-focuses on activation':
    '隱藏時終端機會佔滿整個面板，並在啟用時自動取得焦點',
  'Verbose logging': '詳細記錄',

  // Privacy / offline mode
  Privacy: '隱私',
  'Offline mode': '離線模式',
  'Offline mode is on.': '離線模式已啟用。',
  'Stop Parallel Code making any network request of its own: update checks, PR check polling, Huly sync, inline code Q&A, Docker image builds, starting a Docker task whose image is not on this machine, git push, and external images in rendered markdown. Each one reports that offline mode is on rather than failing silently. This does not cover the AI CLIs you run as agents — those talk to their own vendors under their own configuration, and Parallel Code neither can nor should intercept them.':
    '停止 Parallel Code 自己發出任何網路請求：更新檢查、PR 檢查輪詢、Huly 同步、行內程式碼問答、Docker image 建置、啟動 image 不在本機的 Docker 任務、git push，以及渲染 Markdown 中的外部圖片。每一項都會明確顯示「離線模式已啟用」，而不是無聲失敗。此開關不涵蓋你以 agent 身分執行的 AI CLI —— 那些工具依你自己的設定連向各自的廠商，Parallel Code 不攔也不該攔。',

  // Panel and section headings
  'Branch prefix': 'Branch 前綴',
  'Command Bookmarks': '指令書籤',
  'Commit Tree': 'Commit 樹',
  'Default Git Isolation': '預設 Git 隔離',
  'Theme CSS': '主題 CSS',
  Themes: '主題',
  Experimental: '實驗性功能',
  Updates: '更新',
  Color: '顏色',
  Name: '名稱',
  Source: '來源',
  Imported: '已匯入',

  // Empty and transient states
  'Closing task...': '正在關閉任務…',
  'Starting server...': '正在啟動伺服器…',
  'No files touched.': '沒有動到任何檔案。',
  'No MCP log entries yet.': '尚無 MCP 記錄。',
  'Not detected': '未偵測到',
  'Panel crashed': '面板已當機',
  'This folder no longer exists.': '這個資料夾已不存在。',
  'Merged today': '今日已合併',
  'Merged (total)': '已合併（總計）',
  'No dimming': '不變暗',
  'More dimmed': '更暗',
  'Disconnecting stops the server and revokes every connected and paired device.':
    '中斷連線會停止伺服器，並撤銷所有已連線與已配對的裝置。',
  // Binary states rendered as ternaries
  // 'Delete' already appears under Common actions.
  Comment: '留言',
  Ask: '詢問',
  Connected: '已連線',
  Disconnected: '未連線',
  Dirty: '有未提交變更',
  Clean: '乾淨',
  Hide: '隱藏',
  Show: '顯示',
  Restore: '還原',
  Maximize: '最大化',

  // Bulk pass — settings copy, dialogs, task lifecycle, remote pairing
  'Customize your workspace. Shortcut: {shortcut}': '自訂你的工作區。快捷鍵：{shortcut}',
  'Show plans': '顯示 plan',
  'Show prompt input box below terminal': '在終端機下方顯示 prompt 輸入框',
  'Show progress section in sidebar': '在側欄顯示進度區塊',
  'Show tips section in sidebar': '在側欄顯示提示區塊',
  'Pre-tick skip-permissions for every new task. The agent will run without asking for confirmation. Only honoured when the selected agent supports it.':
    '為每個新任務預先勾選 skip-permissions。agent 將不再詢問確認即執行。僅在所選 agent 支援時生效。',
  Editor: '編輯器',
  'Editor command': '編輯器指令',
  'CLI command to open worktree folders. Click the path bar in a task to open it.':
    '用來開啟 worktree 資料夾的 CLI 指令。點任務裡的路徑列即可開啟。',
  'Ask about Code': '詢問程式碼',
  'LLM provider': 'LLM 供應商',
  'Uses the claude CLI to answer questions about selected code. Requires Claude Code to be installed.':
    '使用 claude CLI 回答關於所選程式碼的問題。需要先安裝 Claude Code。',
  'Uses MiniMax M2.7 (204K context) via the OpenAI-compatible API — no Claude Code CLI required.':
    '透過 OpenAI 相容 API 使用 MiniMax M2.7（204K 上下文）—— 不需要 Claude Code CLI。',
  'MiniMax API key': 'MiniMax API 金鑰',
  'Docker Isolation': 'Docker 隔離',
  'Default image': '預設 image',
  'Docker image used when "Run in Docker container" is enabled for a task. The agent runs inside the container with only the project directory mounted.':
    '任務啟用「在 Docker 容器中執行」時使用的 image。agent 在容器內執行，且只掛載專案目錄。',
  'Share agent auth across Linux containers': '在 Linux 容器間共用 agent 認證',
  'Persist agent credentials in a user-owned host directory so you only need to sign in once per agent type. Auth on first run is saved automatically for future containers.':
    '把 agent 憑證存在你自己的主機目錄，每種 agent 只需登入一次。首次執行的認證會自動保存給之後的容器使用。',
  'Install Docker to enable container isolation for safer skip-permissions mode.':
    '安裝 Docker 以啟用容器隔離，讓 skip-permissions 模式更安全。',
  'Focus Dimming': '焦點變暗',
  'Inactive column opacity': '非作用中欄位的不透明度',
  'Custom Agents': '自訂 agent',
  'Current version': '目前版本',
  'Automatic updates are not available for this build. Download the latest release from GitHub to update.':
    '此組建不支援自動更新。請到 GitHub 下載最新版本。',
  'You are on the latest version.': '你已是最新版本。',
  'Check for updates': '檢查更新',
  'This font includes ligatures which may impact rendering performance.':
    '此字型含連字，可能影響算繪效能。',
  'Terminal Font': '終端機字型',
  'Coordinator notification delay (seconds)': 'Coordinator 通知延遲（秒）',
  'Max concurrent sub-tasks:': '最大同時子任務數：',
  'Sub-tasks:': '子任務：',
  'Only one coordinator per project can be active at a time':
    '每個專案同一時間只能有一個 coordinator 在運作',
  'Pre-tick Propagate to sub-tasks when both coordinator mode and skip-permissions are enabled for a task':
    '當任務同時啟用 coordinator 模式與 skip-permissions 時，預先勾選「傳遞給子任務」',
  'Instructs the agent to append progress entries to .claude/steps.json. Each entry is shown live in the Steps panel as the agent works.':
    '指示 agent 把進度寫進 .claude/steps.json。每一筆都會在 agent 工作時即時顯示於步驟面板。',
  'Light Theme': '淺色主題',
  'Dark Theme': '深色主題',
  'New Custom Theme': '新增自訂主題',
  'Custom theme': '自訂主題',
  'Edit Theme': '編輯主題',
  'Delete Theme': '刪除主題',
  'Update Theme': '更新主題',
  'Save & Apply': '儲存並套用',
  'Contrast warnings (theme will still save)': '對比度警告（主題仍會儲存）',
  'Keyboard Shortcuts': '鍵盤快捷鍵',
  'Keyboard shortcuts update': '鍵盤快捷鍵已更新',
  'Dismiss keyboard shortcuts update': '關閉快捷鍵更新提示',
  'Reset All': '全部重設',
  'Reset all keybindings to defaults for the current preset?':
    '要把所有快捷鍵重設為目前預設組的預設值嗎？',
  'Press shortcut...': '按下快捷鍵…',
  Override: '覆寫',
  'Word Left': '往左一個字',
  'Word Right': '往右一個字',
  'Scroll to start': '捲到開頭',
  'Scroll to end': '捲到結尾',
  'Settings tabs': '設定分頁',
  'A project is a local folder with your code': '專案就是你電腦上放程式碼的資料夾',
  'Link Project': '連結專案',
  'Link your first project to get started': '連結你的第一個專案就能開始',
  'No projects linked yet.': '尚未連結任何專案。',
  'Edit Project': '編輯專案',
  'Project path not found': '找不到專案路徑',
  'Re-link': '重新連結',
  'Select a project': '選擇專案',
  'Are you sure you want to remove this project?': '確定要移除這個專案嗎？',
  'Base branch': '基底 branch',
  'Search branches…': '搜尋 branch…',
  'Loading branches…': '正在載入 branch…',
  'No matching branches': '沒有相符的 branch',
  'Local feature branch {branch}': '本機功能 branch {branch}',
  'Current Branch': '目前 branch',
  'Existing worktree': '既有 worktree',
  Worktrees: 'Worktree',
  'Worktree at {path}': 'Worktree 位於 {path}',
  'Branch {branch} will be kept': 'branch {branch} 會保留',
  'Symlink into worktree': '以 symlink 連進 worktree',
  'Always delete branch and worktree on close': '關閉時一律刪除 branch 與 worktree',
  'Creates a git branch and worktree so the AI agent can work in isolation without affecting your current branch.':
    '建立 git branch 與 worktree，讓 AI agent 能隔離工作而不影響你目前的 branch。',
  'Changes will be made on the selected branch without worktree isolation.':
    '變更會直接發生在所選 branch 上，沒有 worktree 隔離。',
  'The AI agent will work on your current branch in the project root.':
    'AI agent 會在專案根目錄、你目前的 branch 上工作。',
  'This project already has a task on the current branch':
    '這個專案在目前 branch 上已經有一個任務了',
  'Select an agent': '選擇 agent',
  'Pick a preset for your coding agent': '為你的 coding agent 選一個預設組',
  'Add Agent': '新增 agent',
  'Add agent': '新增 agent',
  'Command (e.g. opencode)': '指令（例如 opencode）',
  'Name (e.g. OpenCode)': '名稱（例如 OpenCode）',
  'Resume args (optional, space-separated)': 'Resume 參數（選填，以空白分隔）',
  'Skip permissions args (optional, space-separated)': 'Skip permissions 參數（選填，以空白分隔）',
  'Create Task': '建立任務',
  'Creating...': '正在建立…',
  'Untitled task': '未命名任務',
  'What should the agent work on?': '要讓 agent 做什麼？',
  'Copy Prompt': '複製 prompt',
  'Prompt copied to clipboard': 'Prompt 已複製到剪貼簿',
  'Send a prompt... (Enter to send, Shift+Enter for newline)':
    '輸入 prompt…（Enter 送出，Shift+Enter 換行）',
  'No prompts sent': '尚未送出 prompt',
  'No prompts sent yet': '尚未送出任何 prompt',
  'Waiting to send prompt…': '等待送出 prompt…',
  'Sending when ready…': '就緒後送出…',
  'Sending when coordinator is ready…': 'coordinator 就緒後送出…',
  'Staged for auto-send': '已排入自動送出',
  'Auto delivery enabled': '已啟用自動投遞',
  'Agent exited before prompt was sent': 'prompt 送出前 agent 已結束',
  'Drop GitHub link to create task': '拖入 GitHub 連結即可建立任務',
  'A new task will be created with the link in the prompt': '會建立一個新任務，並把連結放進 prompt',
  'Compare arena results': '比較 arena 結果',
  'No tasks yet': '尚無任務',
  'All tasks are collapsed': '所有任務都已收合',
  'Click a task in the sidebar to restore it': '點側欄裡的任務即可復原',
  'Focus on this task': '聚焦此任務',
  'Exit focus mode': '離開專注模式',
  'Coordinated sub-task': '受 coordinator 管理的子任務',
  'Review this task': '審查此任務',
  'Review Plan': '審查 plan',
  Progress: '進度',
  Tips: '提示',
  Changes: '變更',
  Change: '變更',
  'No changes to display': '沒有可顯示的變更',
  'No commits on this branch yet.': '這個 branch 上還沒有 commit。',
  'Binary file — cannot display diff': '二進位檔案 —— 無法顯示 diff',
  'Loading diffs...': '正在載入 diff…',
  'Loading...': '載入中…',
  'Loading…': '載入中…',
  'Thinking...': '思考中…',
  'Checking…': '檢查中…',
  'No results': '沒有結果',
  'Something went wrong': '發生錯誤',
  Reload: '重新載入',
  Restart: '重新啟動',
  'Restart with…': '以…重新啟動',
  Resume: '繼續',
  Swap: '交換',
  Edit: '編輯',
  Clone: '複製',
  'Remove all': '全部移除',
  'Open item': '開啟項目',
  'Copied!': '已複製！',
  Merge: '合併',
  'Merging...': '正在合併…',
  'Squash Merge': 'Squash 合併',
  'Squash commits': 'Squash commit',
  'Merge safety': '合併安全性',
  'Not ready to merge': '尚未可合併',
  'Ready to merge': '可以合併',
  'Ready for review': '可以審查',
  'Checking merge readiness': '正在檢查合併就緒狀態',
  'Waiting for merge status.': '等待合併狀態。',
  'Known checks passed.': '已知檢查全部通過。',
  'Review these items before merging.': '合併前請先檢視這些項目。',
  'Resolve merge blockers before continuing.': '請先解決合併阻礙再繼續。',
  'Checks the task branch for conflicts with its base branch, branch mismatch, committed changes, and local uncommitted changes.':
    '檢查任務 branch 與基底 branch 是否衝突、branch 是否不符、已 commit 的變更，以及本機未 commit 的變更。',
  'Uses checks reported for a detected GitHub pull request. Pull requests are optional, and unavailable check data is neutral.':
    '使用偵測到的 GitHub pull request 所回報的檢查。PR 為選用，取不到檢查資料時視為中性。',
  'Uses structured verification reported by land_self, such as tests or typechecking. Without a report this needs attention; opening the dialog never runs commands.':
    '使用 land_self 回報的結構化驗證，例如測試或型別檢查。沒有回報時需要人工確認；開啟此對話框不會執行任何指令。',
  'Delete branch and worktree after merge': '合併後刪除 branch 與 worktree',
  'Commit or stash changes before rebasing': 'rebase 前請先 commit 或 stash 變更',
  'Rebase with AI': '用 AI 執行 rebase',
  'Rebasing...': '正在 rebase…',
  'Rebase successful': 'rebase 成功',
  'Push to Remote': 'Push 到遠端',
  'Push to remote': 'Push 到遠端',
  'Pushing...': '正在 push…',
  'Push completed': 'push 完成',
  'Push failed': 'push 失敗',
  'PR checks': 'PR 檢查',
  'Warning: There are uncommitted changes that will be permanently lost.':
    '警告：有未 commit 的變更將被永久遺失。',
  'Warning: This branch has commits that have not been merged into main.':
    '警告：這個 branch 有尚未合併進 main 的 commit。',
  'Warning: You have uncommitted changes that will NOT be included in this merge.':
    '警告：你有未 commit 的變更，這次合併不會包含它們。',
  'This action cannot be undone. The following will be permanently deleted:':
    '這個動作無法復原。以下內容將被永久刪除：',
  'The worktree will be removed but the branch will be kept:':
    'worktree 會被移除，但 branch 會保留：',
  'Close this task? Running agents and shells will be stopped.':
    '要關閉這個任務嗎？執行中的 agent 與 shell 都會被停止。',
  'Close this task? The worktree and branch will be deleted.':
    '要關閉這個任務嗎？worktree 與 branch 都會被刪除。',
  'This will stop all running agents and shells and remove the imported task from Parallel Code. The existing git worktree will be left untouched.':
    '這會停止所有執行中的 agent 與 shell，並把匯入的任務從 Parallel Code 移除。既有的 git worktree 不會被動到。',
  'Close failed': '關閉失敗',
  'Cleanup failed': '清理失敗',
  'Close Terminal': '關閉終端機',
  'Running Terminals': '執行中的終端機',
  'Import Worktrees': '匯入 worktree',
  'Import Existing Worktrees': '匯入既有的 worktree',
  'Import Selected': '匯入所選',
  'Importing...': '正在匯入…',
  'Scanning for existing worktrees...': '正在掃描既有的 worktree…',
  'No importable worktrees were found for this project.': '這個專案找不到可匯入的 worktree。',
  'Build Image': '建置 image',
  'Building image... this may take a few minutes.': '正在建置 image…可能需要幾分鐘。',
  'Build failed': '建置失敗',
  'Image ready.': 'image 已就緒。',
  'Project image ready.': '專案 image 已就緒。',
  'Image:': 'Image：',
  'Starting Docker container…': '正在啟動 Docker 容器…',
  'MCP Logs': 'MCP 記錄',
  'MCP logs': 'MCP 記錄',
  'Showing last 200 entries. Refresh to reload.': '顯示最後 200 筆。重新整理可重載。',
  'MCP server bound to all interfaces (macOS + Docker) — port reachable on local network':
    'MCP 伺服器綁定所有介面（macOS + Docker）—— 連接埠在區域網路上可達',
  'Start automatically on launch': '啟動時自動開始',
  Disconnect: '中斷連線',
  'Failed to disconnect. Please try again.': '中斷連線失敗，請再試一次。',
  'Cannot disconnect while a coordinator is active. Stop the coordinator first.':
    'coordinator 運作中無法中斷連線。請先停止 coordinator。',
  'Failed to start server': '啟動伺服器失敗',
  'Failed to start': '啟動失敗',
  'Waiting for connection...': '等待連線…',
  'Generating QR code...': '正在產生 QR code…',
  'QR code unavailable': 'QR code 無法使用',
  'Could not generate a code': '無法產生代碼',
  'Generate a new code': '產生新的代碼',
  'Enter this code on your phone (valid 5 min):': '在你的手機上輸入這組代碼（5 分鐘內有效）：',
  'Pair a device to create tasks': '配對裝置以建立任務',
  'Your phone and this computer must be on the same WiFi network.':
    '你的手機與這台電腦必須在同一個 WiFi 網路上。',
  'Your phone and this computer must be on the same Tailscale network.':
    '你的手機與這台電腦必須在同一個 Tailscale 網路上。',
  'Leave blank to try': '留白則嘗試',
  'Coverage summary': '覆蓋率摘要',
  'No recent coverage data for this source file. Run npm run test:coverage to populate the radar.':
    '這個原始檔沒有近期的覆蓋率資料。執行 npm run test:coverage 以產生資料。',
  'Run coverage and write either coverage/coverage-summary.json, coverage/lcov.info, or the configured project report path.':
    '執行覆蓋率並輸出 coverage/coverage-summary.json、coverage/lcov.info，或專案設定的報告路徑。',
  'Add review comment...': '新增審查意見…',
  'No agent available to receive review': '沒有可接收審查的 agent',
  'Failed to send review': '送出審查失敗',
  'Ask about this code...': '詢問這段程式碼…',
  Risks: '風險',
  'Show agents side by side': '並排顯示 agent',
  'Show one agent at a time (tabs)': '一次顯示一個 agent（分頁）',
  'Active — agent is working': '運作中 —— agent 正在工作',
  'Busy — agent recently active': '忙碌 —— agent 近期有活動',
  'Waiting — no changes yet': '等待中 —— 尚無變更',
  'Error — agent exited with an error': '錯誤 —— agent 以錯誤結束',
  'Needs attention': '需要處理',
  'Agent is waiting for input in terminal…': 'agent 正在終端機等待輸入…',
  'Agent needs input. Answer in the terminal when ready.':
    'agent 需要輸入。準備好時請在終端機回覆。',
  'Waiting for input': '等待輸入',
  'Waiting for idle': '等待閒置',
  'Waiting for next step': '等待下一步',
  'Waiting for terminal input': '等待終端機輸入',
  'Waiting for your draft': '等待你的草稿',
  'Queued — waiting for idle': '已排隊 —— 等待閒置',
  'Queued — waiting for terminal input': '已排隊 —— 等待終端機輸入',
  'Queued — waiting for your draft': '已排隊 —— 等待你的草稿',
  'Landed — pending review': '已落地 —— 等待審查',
  'Landed, but cleanup failed': '已落地，但清理失敗',
  'Landing blocked': '落地受阻',
  'Landing failed': '落地失敗',
  'Landing needs attention': '落地需要處理',
  'Landing reviewed': '落地已審查',
  'Verification blocked': '驗證受阻',
  'Verification did not pass': '驗證未通過',
  'Verification failed': '驗證失敗',
  'Tasks need attention off-screen to the left — click to scroll':
    '畫面左側有需要處理的任務 —— 點擊捲動',
  'Tasks need attention off-screen to the right — click to scroll':
    '畫面右側有需要處理的任務 —— 點擊捲動',
  'Failed to open external URL': '開啟外部網址失敗',
  'Failed to close window': '關閉視窗失敗',
  'Failed to minimize window': '最小化視窗失敗',
  'Failed to toggle maximize': '切換最大化失敗',
  'Failed to query maximize state': '查詢最大化狀態失敗',
  'Failed to query focus state': '查詢焦點狀態失敗',
  'Maximize window': '最大化視窗',
  'Restore window': '還原視窗',

  // Sentences with an interpolated value. The `{name}` placeholder lets the
  // translation put the value wherever zh-TW wants it; several below move it
  // away from the position English uses.
  //
  // Where English inflects a noun for count, the call site picks between two
  // whole sentences with a ternary. That is not plural machinery: zh-TW has no
  // plural form, so both keys map to the same translation, and English keeps
  // the grammar it already had.
  'Merge into {branch}': '合併進 {branch}',
  'Open {file} in editor': '在編輯器中開啟 {file}',
  'Jump to bookmark: {preview}': '跳至書籤：{preview}',
  'Sub-agent: {agentId}': '子 agent：{agentId}',
  'Copy {label}': '複製{label}',
  'Hue {hue}': '色相 {hue}',
  'Open terminal ({shortcut})': '開啟終端機（{shortcut}）',
  'New task ({shortcut})': '新增任務（{shortcut}）',
  'New terminal ({shortcut})': '新增終端機（{shortcut}）',
  'Show sidebar ({shortcut})': '顯示側欄（{shortcut}）',
  'Collapse sidebar ({shortcut})': '收合側欄（{shortcut}）',
  'Settings ({shortcut})': '設定（{shortcut}）',
  'Click to jump · Right-click to remove': '點擊跳至此處 · 右鍵移除',
  '{count} star': '{count} 顆星',
  '{count} stars': '{count} 顆星',
  '{count} more bookmark {direction} — click to jump': '{direction}還有 {count} 個書籤 —— 點擊跳至',
  '{count} more bookmarks {direction} — click to jump':
    '{direction}還有 {count} 個書籤 —— 點擊跳至',
  above: '上方',
  below: '下方',
  '{count} added lines': '新增 {count} 行',
  '{count} removed lines': '刪除 {count} 行',
  '{count} changed file below 60% line coverage.': '有 {count} 個變更檔案的行覆蓋率低於 60%。',
  '{count} changed files below 60% line coverage.': '有 {count} 個變更檔案的行覆蓋率低於 60%。',
  '{count} changed file missing from the loaded coverage report.':
    '載入的覆蓋率報告中缺少 {count} 個變更檔案。',
  '{count} changed files missing from the loaded coverage report.':
    '載入的覆蓋率報告中缺少 {count} 個變更檔案。',
  '{count} changed files.': '{count} 個變更檔案。',
  '{count} changed files, {uncommitted} uncommitted.':
    '{count} 個變更檔案，{uncommitted} 個未 commit。',

  // Onboarding — progressive disclosure. "worktree", "Coordinator" and "Arena"
  // stay in English: the first is git vocabulary this audience reads
  // untranslated, the other two are feature names shown as-is in the UI.
  'First run': '第一次使用',
  'Link a project': '連結一個專案',
  'Create a task': '建立一個 task',
  'Review the diff': '看過 diff',
  'Merge it back': 'Merge 回主線',
  'Tasks run in parallel — start another while the first one is still working. Each gets its own worktree, so they never collide.':
    'Task 可以平行進行 —— 第一個還在跑的時候就能開下一個。每個都有自己的 worktree，不會互相干擾。',
  'Coordinator — one agent plans the work and drives the other tasks for you.':
    'Coordinator —— 由一個 agent 規劃工作，並替你驅動其他 task。',
  'Arena — run one task on several agents at once and compare the results.':
    'Arena —— 同一個 task 交給多個 agent 同時跑，再比較結果。',

  // Traditional Chinese terminal fonts. The audience for this feature reads
  // zh-TW, so leaving these to fall back to English would miss the point.
  'Chinese Terminal Font': '終端中文字體',
  'Fonts are never bundled or downloaded automatically. Picking one that is not installed asks first.':
    '字體不會內建於安裝檔，也不會自動下載。選到未安裝的字體時會先詢問你。',
  Installed: '已安裝',
  'Not installed — {size}': '未安裝 —— {size}',
  'Downloading {font}…': '正在下載 {font}…',
  '{font} installed.': '{font} 已安裝完成。',
  '{font} was not downloaded, so your terminal font is still {previous}.':
    '{font} 沒有下載，終端字體維持 {previous}。',
  'Could not install {font}: {reason} Your terminal font is still {previous}.':
    '無法安裝 {font}：{reason} 終端字體維持 {previous}。',
  'Offline mode is on, so {font} was not downloaded. Turn it off in Settings to allow this.':
    '離線模式開啟中，因此沒有下載 {font}。要下載請到設定中關閉離線模式。',
  '{font} is not installed. Download {size} from {source} and install it for your user account? Licence: {licence}.':
    '{font} 尚未安裝。要從 {source} 下載 {size} 並安裝到你的使用者帳號嗎？授權：{licence}。',
  '{font} is not installed. Its project publishes it only as {archive} ({size}), which Parallel Code cannot unpack. Open the release page to install it yourself. Licence: {licence}.':
    '{font} 尚未安裝。該專案只發布 {archive}（{size}）這種壓縮檔，Parallel Code 無法解開。' +
    '請開啟 release 頁面自行安裝。授權：{licence}。',
  'Built for terminals; CJK sits at exactly twice the Latin width':
    '專為終端設計，中文寬度正好是英文的兩倍',
  'Stricter monospacing than Sarasa Term, same CJK coverage':
    '比 Sarasa Term 更嚴格的等寬，中文涵蓋範圍相同',
  'Rounded, with ligatures and Nerd Font icons': '圓角字形，含連字與 Nerd Font 圖示',
  'Conservative and broadly compatible': '保守通用，相容性最廣',
  'Calligraphic; easiest on the eyes over long sessions': '楷體風格，長時間閱讀最舒適',

  // Task dependencies. "task" and "branch" stay untranslated inside sentences
  // for the same reason "worktree" does above — this audience reads them as
  // git/app vocabulary, not as English.
  'Depends on': '依賴於',
  'Nothing — start from the base branch': '無 —— 從 base branch 開始',
  'Branches from {branch} instead, and waits for that task to land before starting.':
    '改從 {branch} 分支，並等那個 task 落地後才開始。',
  blocked: '受阻',
  'Blocked — waiting for {task} to land.': '受阻 —— 等待 {task} 落地。',
  'Blocked — the task this one depends on was removed.': '受阻 —— 它依賴的 task 已被移除。',
  "Blocked — this task's dependency chain loops back on itself.":
    '受阻 —— 這個 task 的依賴鏈繞回自己。',
  'The agent starts on its own once it lands.': '一旦落地，agent 會自己開始。',
  'Clear dependency and start now': '解除依賴並立即開始',
  // 'Retry' and 'Dismiss' are already in this catalogue above.

  // Settings explanatory copy. Everything below is a sentence rather than a
  // label, and belongs to a section added after the i18n wave: the transcript
  // switch, the AI usage table, Diagnostics, Updates, Docker and Coordinator.
  // Each one was either wrapped in `tr()` with no entry here, or never wrapped
  // at all, and the English fallback made those two look identical on screen.
  //
  // "transcript" stays English inside these sentences for the same reason
  // "worktree" does: it names an on-disk artefact the user can go and look at
  // (`transcripts/<taskId>.jsonl`), and a translated name would not match the
  // directory. So do `token`, `IPC`, `pty`, `PR` and `commit` — this audience
  // reads them in English, and rendering them in Chinese costs a beat.
  'Record session transcripts': '記錄工作階段 transcript',
  'Write a timestamped record of each task — agent starts and exits, step updates, attention changes, merges, PR check results and commits — to transcripts/<taskId>.jsonl in the application data directory, so a task can be reviewed after a restart. Nothing leaves your machine. Known secret shapes (API keys, tokens, private key headers) are masked before anything is written, but a transcript quotes your source code and instructions, so treat it as sensitive: masking catches shapes, not meaning. Kept for 30 days or 5000 events per task, whichever comes first.':
    '為每個任務寫下附時間戳的記錄 —— agent 的啟動與結束、步驟更新、待處理狀態變化、合併、PR 檢查結果與 commit —— ' +
    '存到應用程式資料目錄下的 transcripts/<taskId>.jsonl，重新啟動後仍然回得去看。所有內容都留在你自己的機器上。' +
    '符合已知格式的機密（API key、token、私鑰標頭）會在寫入前先遮蔽，但 transcript 會引用你的原始碼與指令，' +
    '請當成敏感資料看待：遮蔽擋得住格式，擋不住語意。保留 30 天，或每個任務 5000 筆事件，先到者為準。',
  'Clear transcripts': '清除 transcript',
  'Deletes every recorded transcript from disk. Cannot be undone.':
    '把已經記錄下來的 transcript 全部從磁碟刪掉。此動作無法復原。',
  // English inflects for count, so the call site picks between two whole
  // sentences. zh-TW has no plural form, so both land on the same shape.
  'Deleted 1 transcript': '已刪除 1 份 transcript',
  'Deleted {count} transcripts': '已刪除 {count} 份 transcript',
  'Could not delete transcripts': '無法刪除 transcript',
  'No events recorded for this task yet.': '這個任務還沒有記錄到任何事件。',
  'Session transcripts are off. Turn on Settings → Privacy → Record session transcripts to start recording this task.':
    '工作階段 transcript 目前是關閉的。到「設定 → 隱私 → 記錄工作階段 transcript」打開，才會開始記錄這個任務。',
  'Content matching a known secret shape was masked before this was written':
    '這段內容符合已知的機密格式，寫入前已經遮蔽',
  Handoff: '交接',
  Timeline: '時間軸',
  '{count} event': '{count} 筆事件',
  '{count} events': '{count} 筆事件',
  '{count} event · {masked} with redacted content': '{count} 筆事件 · 其中 {masked} 筆內容被遮蔽',
  '{count} events · {masked} with redacted content': '{count} 筆事件 · 其中 {masked} 筆內容被遮蔽',

  // AI usage. Provider names (Claude, Codex, Grok, Antigravity) are vendor
  // names and stay as they are; only the sentences around them are translated.
  'AI Usage': 'AI 用量',
  'Token counts read from the log files the AI CLIs already write on this machine. No network request is made, so this works with offline mode on.':
    'token 數字直接讀自 AI CLI 本來就會寫在這台機器上的紀錄檔。過程中不發出任何網路請求，所以離線模式開著也能用。',
  Total: '總計',
  'All worktrees': '所有 worktree',
  'No usage logs have been read yet.': '還沒有讀到任何用量紀錄。',
  'Reading {providers}.': '正在讀取 {providers}。',
  'No AI CLI logs found.': '找不到任何 AI CLI 的紀錄檔。',
  '{providers} not installed.': '未安裝 {providers}。',
  'Could not read {providers}.': '無法讀取 {providers}。',

  // Per-task token panel — the same vocabulary as the settings table above,
  // scoped to a single worktree. `worktree` stays English here as it does
  // everywhere else in this catalogue.
  'Show token usage': '顯示 token 用量',
  'Hide token usage': '隱藏 token 用量',
  'Tokens in this worktree': '這個 worktree 的 token 用量',
  'No AI CLI usage has been recorded for this worktree yet.':
    '這個 worktree 還沒有任何 AI CLI 的用量紀錄。',
  'This task has no worktree yet, so no usage can be attributed to it.':
    '這個任務還沒有 worktree，因此沒有可歸屬的用量。',
  'Counts only this task. The Settings table covers every worktree.':
    '只計這個任務。設定裡那張表才是所有 worktree 的總計。',
  Input: '輸入',
  Output: '輸出',
  'Cache read': '快取讀取',
  'Cache write': '快取寫入',

  // Editor and Ask about Code. Both placeholders name real commands and a real
  // environment variable, so only the words around them move.
  'e.g. code, cursor, zed, subl': '例如 code、cursor、zed、subl',
  'Enter your MINIMAX_API_KEY (stored in memory only)':
    '輸入你的 MINIMAX_API_KEY（僅存放在記憶體中）',

  // Docker. The path is a `<code>` element rather than a string, so the
  // sentence is rendered from segments and the slot lands where zh-TW wants it.
  'Projects with a {path} will use a project-specific image instead.':
    '專案裡如果有 {path}，就改用該專案專屬的 image。',

  // Diagnostics.
  'Emit debug-level logs to the developer console. Verbose logs may include file paths, branch names, commit messages, IPC channel activity, and pty lifecycle events. Review the contents before sharing.':
    '把 debug 等級的記錄輸出到開發者主控台。詳細記錄可能包含檔案路徑、branch 名稱、commit 訊息、' +
    'IPC channel 活動，以及 pty 生命週期事件。分享前請先檢查內容。',

  // Updates. Each of these carried its value by concatenation before, which
  // pinned the version number to the front of the sentence in every language.
  'Version {version} is available. Use the update button in the sidebar to install.':
    '{version} 版可以更新了。用側欄的更新按鈕安裝。',
  'Downloading update… {percent}%': '正在下載更新… {percent}%',
  'Version {version} is downloaded. Use the update button in the sidebar to restart & install.':
    '{version} 版已經下載完成。用側欄的更新按鈕重新啟動並安裝。',
  'Update check failed: {error}': '檢查更新失敗：{error}',

  // Themes.
  '+ Create New': '+ 新增',

  // Coordinator. The feature name itself stays English — see the note beside
  // 'View MCP logs' above.
  'Enable the Coordinator option when creating tasks. Coordinators can spawn sub-tasks, send prompts, and merge branches automatically via MCP tools. Requires app restart to fully disable.':
    '在建立任務時顯示 Coordinator 選項。Coordinator 可以透過 MCP 工具自動開子任務、送出 prompt、合併 branch。' +
    '要完全停用需要重新啟動應用程式。',
  'How long the coordinator waits before firing a notification after a sub-task completes. Default: 60s. Failed sub-tasks use max(10s, delay ÷ 4).':
    'coordinator 在子任務完成後要等多久才發出通知。預設 60 秒。失敗的子任務改用 max(10s, delay ÷ 4)。',
};

const CATALOGUES: Record<Locale, Record<string, string>> = {
  en: {},
  'zh-TW': ZH_TW,
};

/**
 * Catalogue keys that are allowed to end in a colon.
 *
 * Every other trailing colon meant "the code concatenates the value after
 * this", which pinned word order to English and is exactly what the placeholder
 * syntax removes. Two categories survive, neither of which concatenates:
 *
 * - labels whose value is a sibling DOM node — a number input, a text input, a
 *   row of buttons, a large styled PIN. Both languages put such a label first,
 *   and dissolving them into slot templates would mean deleting the `<label>`
 *   and `<span>` elements that carry their styling for no translator gain;
 * - sentences that introduce a following `<ul>`, where the colon is ordinary
 *   punctuation and nothing follows it in the same string.
 *
 * The accompanying test asserts this list is exactly the set of colon-ending
 * keys, so a new concatenation-style entry fails rather than creeping in.
 */
export const COLON_LABEL_KEYS: readonly string[] = [
  // Label before a sibling value element
  'Enter this code on your phone (valid 5 min):',
  'Image:',
  'Max concurrent sub-tasks:',
  'Sub-tasks:',
  // Sentence introducing a list
  'The worktree will be removed but the branch will be kept:',
  'This action cannot be undone. The following will be permanently deleted:',
];

/**
 * Translate `text` into `locale`. Unknown strings and the `en` locale return
 * `text` unchanged, so a missing translation is a readable English string
 * rather than a blank or an id.
 *
 * Pass `params` for a sentence with `{name}` placeholders. Without `params` the
 * template is returned verbatim, so an existing static string containing a
 * brace is unaffected.
 */
export function translate(locale: Locale, text: string, params?: TranslationParams): string {
  return interpolate(CATALOGUES[locale]?.[text] ?? text, params);
}

/**
 * Translate `text` and return it as segments, for a sentence whose value is a
 * JSX element rather than a string — a `<kbd>` shortcut, a `<strong>` branch
 * name. The component renders each slot; the translator still owns the order.
 */
export function translateParts(locale: Locale, text: string): TemplateSegment[] {
  return parseTemplate(CATALOGUES[locale]?.[text] ?? text);
}

/** Catalogue entries for a locale. Exposed for coverage reporting in tests. */
export function catalogueFor(locale: Locale): Record<string, string> {
  return CATALOGUES[locale] ?? {};
}
