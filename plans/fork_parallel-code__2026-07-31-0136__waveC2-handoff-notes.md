# C2：Notes Handoff 一層（`.claude/handoff.md`）

**建立時間：** 2026-07-31 01:36
**最後更新：** 2026-07-31 01:36
**狀態：** 進行中
**分支：** `feat/handoff-notes`（從 `main @ 92b17b2` 分出）
**worktree：** `/Users/scottchen/Documents/20_Projects/pc-feat-handoff-notes`

## 目標

命題 2 原提案是 Notes 四層（Scratchpad / Decision / Context / Handoff）。
研究報告 §二.2 判定**只做 Handoff 一層**，理由有證據：

> Decision 與 Context 的持久化**已經有家**（`notes` 本身、或 `landingSummary`），
> 而提案自己陳述的動機用例明確是 Handoff 流。
> Scratchpad／Decision／Context 三層**目前沒有任何程式碼會讀它們**。

**決議 5 進一步改了儲存形式**：不是 `Task.handoffContent?: string` 欄位，
而是 worktree 裡的 `.claude/handoff.md` **檔案**。理由是決議 7 選了 agent 之間直接傳遞，
handoff 就是 agent 寫的，而 **agent 寫檔案不需要學新工具**。

要達成的結果：一個 agent 的結構化交棒輸出，成為下一個 agent 的輸入。

## 可完整照抄的既有 pattern（不要重造）

研究報告點名 `electron/ipc/steps.ts` 是最接近的結構化類比：

| 機制                      | 位置                                     |
| ------------------------- | ---------------------------------------- |
| 目錄監看 + 200ms debounce | `steps.ts:149-209`                       |
| host-clock 時戳補印       | `applyTimestamps`, `steps.ts:51-77`      |
| 容忍多種輸入形狀          | `parseStepsContent`, `steps.ts:88-107`   |
| 自動註冊 gitignore        | `ensureStepsIgnored`, `steps.ts:130-134` |
| 等目錄出現的 poll         | `plans.ts:20,140-166`                    |
| renderer 側欄位先例       | `planContent?: string`, `types.ts:130`   |

`steps.json` 與 `plans/` 都已經是「檔案而非 app state」，這條路徑是走過的。

## 範圍

做：

- `.claude/handoff.md` 的監看與讀取（照 `steps.ts` 的 pattern）
- 自動註冊 gitignore（比照 `ensureStepsIgnored`）
- UI 呈現（Plans 已有「在筆記旁邊的分頁顯示」的先例）
- Markdown 渲染前 sanitise（PRD `FR-CONTEXT-03` 已要求）

不做：

- **不做四層**，不加 `decisionLog` / `contextNotes` / scratchpad
- **不動 `Task.notes` 的形狀**。研究報告 §二.2 的相容性風險寫明：
  `GET/PUT /api/mobile/notes/:taskId` 必須對既有手機 client 繼續可用，
  最安全是加兄弟欄位／route，不動 `notes`
- 不做「`land_self` 的 `summary` 自動寫進 handoff」（研究報告列為選配，額外 0.5–1 天）
- 不做 MCP 工具讓 agent 寫 handoff —— 決議 5 的重點正是「用檔案，不用新工具」

## 已知的設計自由度

研究報告留了「誰在何時寫」為未決。決議 5 已經回答儲存形式（檔案），
所以寫入者就是 **agent 用檔案慣例寫**，跟它已經在寫 `steps.json` 一樣。
本波不需要再發明寫入機制，只需要讀、監看、呈現。

`PersistedState` 沒有 schema version 欄位，migration 走存在性／形狀檢查
（`persistence.ts:333-390`）。**新增欄位對舊資料就是 `undefined`，零 migration。**

## Plan Steps

- [x] Step 1 — 讀 `steps.ts` 與 `plans.ts`，決定照抄哪些、為什麼（2026-07-31 01:45）
- [x] Step 2 — watcher + 解析（純函式部分要可單測）（2026-07-31 01:52）
- [x] Step 3 — gitignore 自動註冊（2026-07-31 01:52）
- [x] Step 4 — UI 呈現 + sanitise（2026-07-31 01:56）
- [x] Step 5 — 測試（2026-07-31 01:58）
- [x] Step 6 — 四道 gate（2026-07-31 02:00）

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1717，entry bundle 不得超過 90%
2. 有測試證明 `notes` 的既有行為未變（手機 route 相容性）
3. 解析邏輯是純函式且有單測 —— vitest 是 node 環境，component 層測不到
4. 說明照抄了 `steps.ts` 的哪些部分、哪些刻意不抄
5. commit 列明確路徑

## 決策紀錄

### D1 — 照抄 `steps.ts` 的哪些部分（Step 1）

**照抄（幾乎逐行）：**

| 機制                                                 | 為什麼抄                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 監看目錄而非檔案（`fs.watch(.claude)`）              | 註解寫得很清楚：atomic write（temp-file-then-rename）在 macOS 上對單檔 `fs.watch` 不可靠。handoff.md 由 agent 寫，完全同一種寫入模式 |
| 200ms debounce                                       | 同一個抖動來源（一次寫入觸發多個 fs 事件）                                                                                           |
| `filename !== 'handoff.md'` 過濾                     | 與 steps 共用同一個 `.claude/` 目錄，不過濾會被 `steps.json`／`settings.local.json` 的事件打到                                       |
| `.claude/` 不存在時先監看 worktree root，出現後 swap | 見 D2，這是我選它而不選 `plans.ts` poll 的理由                                                                                       |
| watcher 建立後補一次 initial read                    | 同一個 race：agent 可能在 watcher 掛上前就寫完了                                                                                     |
| `ensureStepsIgnored` → `ensureHandoffIgnored`        | 直接用同一個 `appendGitInfoExcludeBlock`，marker 換成 `.claude/handoff.md`。決議 5 明講「用同款」                                    |
| `stopXWatcher` / `stopAllXWatchers` 的生命週期形狀   | FSWatcher 洩漏是既有踩過的坑（`tasks.ts:577` 註解），照同一個收斂點掛上                                                              |

**刻意不抄：**

| 不抄的東西                                                       | 理由                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `applyTimestamps`（host-clock 時戳補印，`steps.ts:51-77`）       | 它存在的理由是「AI 寫的時戳不可信，而 steps 是事件序列，時間軸就是它的意義」。handoff 是散文（決議 5 明示），沒有 entry 也沒有時間軸，補印無物可補                                                                                                                                   |
| **回寫檔案**（`fs.writeFileSync` 於 `applyTimestamps` 內）       | 更重要的理由：handoff.md 的唯一寫者是 agent。app 回寫會在 agent 還在寫的時候覆蓋它。steps 敢回寫是因為它回寫的是自己剛加的欄位；我們沒有這個需求，就不要拿風險                                                                                                                       |
| `processedCount` Map                                             | 只服務 timestamp 補印，一起消失                                                                                                                                                                                                                                                      |
| `parseStepsContent` 的多形狀容忍（JSON 陣列／單物件／JSONL）     | 那是為了「append-oriented agent 會產生三種 JSON 形狀」。markdown 只有一種形狀，抄過來就是無中生有的分支                                                                                                                                                                              |
| `plans.ts` 的 3 秒 `DIR_POLL_INTERVAL`（`:20,140-166`）          | **明確選了 `steps.ts` 的做法而非 `plans.ts` 的**。plans 需要 poll 是因為它要等**兩個**目錄（`.claude/plans`、`docs/plans`），其中 `docs/plans` 不在我們控制下。handoff 只等 `.claude/` 一個目錄，`steps.ts` 的 parent-watch 已經覆蓋，而且零 timer。少一個每 task 每 3 秒的 interval |
| `plans.ts` 的 `ensurePlansDirectory`（寫 `settings.local.json`） | 那是去設定 Claude Code 的 `plansDirectory`。handoff 是我們自己定的檔案慣例，沒有要設定的東西                                                                                                                                                                                         |
| `PlanViewerDialog` 全螢幕檢視                                    | 範圍控制。先給分頁，全螢幕等有人要                                                                                                                                                                                                                                                   |

### D2 — 新增 `parseHandoffContent` 這個純函式，儘管 markdown「不需要解析」

驗收條件 3 要求解析邏輯是純函式且可單測（vitest 是 node 環境）。markdown 沒有語法可解析，
但「檔案內容 → 可渲染字串」這條路上仍有四個真實的判斷，全部值得被測：
BOM、CRLF、空白檔視同不存在、以及大小上限。把它們收在一個純函式裡，
watcher 就只剩 IO，component 就只剩渲染。

### D3 — 加大小上限，儘管 `steps.ts` 與 `plans.ts` 都沒加

這是**唯一一處我沒有照抄既有 pattern 的地方**，要說清楚為什麼。
handoff.md 會經過 marked → shiki → DOMPurify 三段同步／半同步處理再進 DOM。
plans 有同樣的曝險而團隊沒擋，但那不構成「所以也不用擋」——那是既有風險，不是先例。
上限 256 KB（`notes` 的 remote route 用 100 KB，handoff 是散文交棒，給寬一點但仍有界）。
超過就截斷並在內容尾端補一行 markdown blockquote 告知，**不新增 IPC 欄位、不新增 UI 狀態**。

### D4 — 不碰 `Task.notes`，也不碰 persistence

- `handoffContent?: string` 是 `planContent?: string`（`types.ts:130`）的兄弟欄位，
  `notes: string` 完全沒動 → `GET/PUT /api/mobile/notes/:taskId` 的形狀不變。
- **不進 `PersistedTask`、不進 `autosave.ts`**。理由：handoff 的真實來源是 worktree 裡的檔案，
  持久化只會製造第二份可能過期的真相。重啟後照 plans/steps 的做法從磁碟一次性重讀。
  副作用是連「新增欄位零 migration」都不用討論——persistence 根本沒被碰。
- 重讀時**不像 plans 需要 `planFileName`、也不像 steps 需要 `stepsEnabled` 當 gate**：
  handoff 路徑固定，直接對每個有 worktreePath 的 task 試讀，ENOENT 就是沒有。

### D5 — tab 切換邏輯抽成純函式 `task-notes-tabs.ts`

`TaskNotesBody.tsx` 原本用一個 `hadPlan` 閉包變數 + `createEffect` 做「plan 首次出現時自動切過去」。
加上 handoff 後這個狀態機有三個 tab、兩個可用性來源，塞在 component 裡就測不到（node 環境）。
抽成 `nextNotesTab({ current, previous, next })`，component 只負責把 `store.showPlans && !!planContent`
折算成 availability 再餵進去。**既有行為逐條保留**：plan 首次出現 → 切 plan；plan 消失 → 回 notes。
兩者同時首次出現時 plan 優先，純粹為了讓既有行為在新程式碼下逐字不變。

### D6 — tab 標籤不進 i18n catalogue

`'Notes'` 與 `'Plan'` 這兩個 tab 標籤**本來就不在 `ZH_TW` catalogue 裡**（只有 `'Notes...'`
與 `'Review Plan'` 有）。`translate()` 對未收錄字串是回傳原文，不是空字串。
所以 `'Handoff'` 照樣包 `tr()`（未來 i18n wave 掃得到），但不單獨加 zh-TW 條目——
只翻譯三個 tab 的其中一個，畫面上反而是壞的。

### D7 — watcher 生命週期：跟 steps 對齊，不跟 plans 對齊

FSWatcher 洩漏是這個 codebase 已經被咬過的坑（`tasks.ts:578-581` 那段註解就是傷疤）。
三個 stop 點的現況與我的處理：

| 位置                                 | 現況                              | handoff 的處理                                   |
| ------------------------------------ | --------------------------------- | ------------------------------------------------ |
| `tasks.ts:499`（標記 closing）       | 只停 plan watcher，**steps 沒停** | **不加**。跟 steps 對齊                          |
| `tasks.ts:582` `removeTaskFromStore` | plan + steps                      | **加**。註解已宣告這裡是所有移除路徑的唯一收斂點 |
| `tasks.ts:943` collapse              | plan + steps                      | **加**。collapse 會 unmount + kill agent         |

在 499 早停沒有必要：它之後一定會走到 `removeTaskFromStore`，而 handoff watcher 在那之前
繼續讀一個即將消失的檔案是無害的。**反而是不對稱比較危險**——若只在 499 停、之後又不停，
respawn 時會留下孤兒。除此之外還有兩層保險，兩層都是抄來的：
`startHandoffWatcher` 開頭先呼叫 `stopHandoffWatcher`（重啟冪等，不疊 watcher），
以及 `main.ts` 的 `before-quit` 加上 `stopAllHandoffWatchers()`。

### D8 — 重啟後行為：實測，不是推論

D4 說不碰 persistence，那就欠一個交代：重啟後 Handoff 分頁還在嗎？
在 `handoff.test.ts` 補了七個打真實檔案系統的案例（`mkdtempSync` 建臨時 worktree），
直接測 `readHandoffForWorktree`——**這正是 `IPC.ReadHandoffContent` 呼叫的那個函式，
也就是 `App.tsx` 重啟還原迴圈走的唯一路徑**。結論：檔案還在就讀得回來，分頁重新出現；
檔案不在／空的／`.claude/` 整個不存在，一律回 `null`，不出現分頁、不丟例外。

## 結束摘要

### 做了什麼

一個 agent 寫 `.claude/handoff.md`，app 監看它、渲染它、並讓它不進 git。
**沒有新增 MCP 工具**（決議 5 的重點就是不用新工具），**沒有動 `Task.notes`**，
**沒有動 persistence**。

| 檔案                                                         | 動作                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `electron/ipc/handoff.ts`                                    | 新增。watcher + `parseHandoffContent` + gitignore 註冊  |
| `electron/ipc/handoff.test.ts`                               | 新增。17 案例（10 純解析 + 7 打真實檔案系統的重啟路徑） |
| `src/components/task-notes-tabs.ts`                          | 新增。分頁狀態機純函式                                  |
| `src/components/task-notes-tabs.test.ts`                     | 新增。12 案例                                           |
| `electron/ipc/channel-manifest.json`、`electron/preload.cjs` | 三個 channel 鎖步新增                                   |
| `electron/ipc/register.ts`                                   | 起 watcher（隨 spawn）＋ 兩個 handler                   |
| `electron/main.ts`                                           | `before-quit` 收所有 handoff watcher                    |
| `src/store/{types,tasks,store}.ts`                           | `handoffContent?: string` + setter + 兩處 stop          |
| `src/App.tsx`                                                | 重啟還原迴圈 + IPC 監聽 + cleanup                       |
| `src/components/TaskNotesBody.tsx`                           | 第三個分頁；分頁列改為資料驅動                          |
| `src/store/autosave.test.ts`                                 | +3 案例：證明 `notes` 未變、`handoffContent` 不落盤     |

### 四道 gate（實際輸出）

| Gate                   | 結果                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `npm run check`        | `All matched files use Prettier code style!`                                |
| `npm run check:static` | `✔ no dependency violations found (416 modules, 1373 dependencies cruised)` |
| `npm test`             | `Tests 1749 passed \| 24 skipped (1773)`（基準 1717/24，+32，skipped 未變） |
| `npm run check:bundle` | entry `87.2%`、total `85.0%`，皆 ok                                         |

entry bundle 從 87.1% → 87.2%（+1,380 B），**沒有新增任何依賴**。
markdown 渲染是重用既有的 `createHighlightedMarkdown`（內含 DOMPurify），所以只多了自己的程式碼。

### 三種異常狀況的行為

| 狀況                   | 行為                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 檔案不存在             | `readHandoffFile` 吞掉 ENOENT 回 `null`，`handoffContent` 是 `undefined`，**分頁不出現**                                                                            |
| 檔案空白／只有空白字元 | `parseHandoffContent` 回 `null`，同上不出現分頁。這是刻意的：agent 常先 touch 再寫                                                                                  |
| 內容畸形               | markdown 沒有「語法錯誤」。實際的畸形是三種：含 NUL 的二進位檔 → 視同不存在；超過 256 KB → 在行邊界截斷並附註記；內嵌 HTML/script → DOMPurify 清掉（FR-CONTEXT-03） |
| 檔案被刪掉             | watcher 事件 → 讀到 `null` → 分頁消失，若當時正停在 Handoff 分頁會自動退回 Notes                                                                                    |

### 刻意沒做

1. **不自動把 `land_self` 的 `summary` 寫進 handoff** —— 研究報告列為選配（+0.5–1 天）。
2. **沒有 remote/mobile route** —— 本波的驗證消費者是桌面 UI。加 route 會擴大
   `remote/server.ts` 的授權面，而決議 7 已經把安全前置條件排在前面了。
3. **沒有全螢幕檢視**（plan 有 `PlanViewerDialog`）—— 分頁足以驗證這條路走得通。
4. **沒有 Settings 開關**（steps 有 `defaultStepsEnabled`）—— 檔案在就顯示，檔案不在就沒有，
   不需要使用者預先決定。
5. **`tasks.ts:499` 沒有早停 watcher** —— 理由見 D7。
