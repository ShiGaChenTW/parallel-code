# C6：Session transcript + 事件 timeline（完整版）

**建立時間：** 2026-07-31 03:00
**狀態：** 完成（待 merge）
**分支：** `feat/transcript`（從 `main @ 649d609` 分出）
**實作者：** Engineer（Marcus Webb，Claude 家族）

## 目標

把「帶時戳、可重播的生命週期序列」落到磁碟。今天 agent 的輸出除了記憶體裡
那個 64KB ring buffer 之外**沒有任何留存**，重啟即失。

研究報告 §二.6 的判斷：零件都在，只是全都是 live/ephemeral。

**注意：原本的 1–2 天 MVP 已經被取消。** 第一波查證後發現那兩項（persist
`stepsContent`、`GetScrollback` channel）**根本不存在缺口** —— 磁碟已是 source of
truth，且終端是 push replay 不需要 pull API。所以本波是完整版 5–8 天，**沒有捷徑**。

## 已存在的零件（接出來，不要重造）

| 東西        | 位置                                              | 說明                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPC tracer  | `electron/ipc/trace.ts`（114 行）                 | 已 patch `ipcMain.handle`。**default-deny**：`SAFE_FOR_TRACE` 是空集合（`:17`），`NEVER_SAFE` 反向斷言（`:24`，含 `WriteToAgent`、`AskAboutCode`、`SaveAppState`、`SetMinimaxApiKey`），module init 就 assert |
| ring buffer | `electron/remote/ring-buffer.ts`                  | 固定 64KB，`pty.ts:350` 每批寫入                                                                                                                                                                              |
| 結構化事件  | `StepEntry`（`electron/ipc/shared-types.ts:124`） | `{summary, detail?, next?, status, files_touched?, agent_id?, timestamp}`，status 六階段                                                                                                                      |
| 落地先例    | `PRIVACY.md:27`                                   | Arena 已把每場終端輸出持久化到 `arena-history.json`（app data dir，使用者可刪）。**這正是本功能需要的先例形狀**                                                                                               |

**既有事件詞彙（直接消費，不要新造）**：`StepEntry` 六階段、attention 轉換
（`desktopNotifications.ts:15-21` 的 ready/needs_input/error）、merge 計數
（`completion.ts`）、PR/CI 輪詢（`pr-changes.ts`/`pr-checks.ts`）、commit 狀態。

## 🔴 儲存設計已定，不要改

**用 per-task JSONL**：`<userData>/transcripts/<taskId>.jsonl`，append-only，配 rotation。

**絕對不要用 `persistence.ts` 那個 blob。** 它是單一 JSON 文件、每次 debounce（1s）
整份 temp+rename 重寫。把無界 transcript 塞進去會讓每次 autosave 膨脹，並在 crash 時
有損毀風險。

**絕對不要寫進使用者的 worktree。** 留在 `userData` 就完全不必處理 gitignore。

## 🔴 隱私是硬性要求（決議 6）

1. **opt-in、預設關閉** —— 跟隨 `trace.ts` 的 default-deny 姿態
2. **`PRIVACY.md` 必須新增條目**，照 Arena 那條（`:27`）的形狀
3. **redaction 必做，且必須在寫入前** —— 寫入後再掃等於已經落地過
4. Settings 要有「清除 transcript」動作

**redaction 的務實版本**：借 `.gitleaks.toml` 已有的規則集掃已知密鑰形狀，
命中就遮蔽並留標記。**不能整套跑 gitleaks**（行程級工具，太慢），
transcript 是 append-only 高頻寫入，redaction 在熱路徑上 —— 用便宜的 regex 集或跑 worker。

**誠實前提**：完美 redaction 不可能 —— transcript 本身就是原始碼與指令。
文件要照實說，不要宣稱「已清乾淨」。

## 已採用的預設值（Scott 未答，研究報告設定，可覆寫）

| 子項        | 預設                                          | 理由                                                                                           |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| opt-in 粒度 | **全域開關**（Settings 一個 toggle）          | per-task 會讓「這次有沒有錄」變成要記的事；transcript 的價值在事後回顧，事後才發現沒錄就沒用了 |
| retention   | **per-task 5000 事件 + 全域 30 天，先到為準** | 對照 Vibe Kanban #765：兩天 26GB，就是沒上限的後果                                             |

## 🟢 這個功能不新增對外連線點

全部是本機檔案。R2（`649d609`）把離線模式做成 `OUTBOUND_SURFACES` 單一真相來源，
且有測試讀 `PRIVACY.md` 與 `docs/PRD.md` 比對數量。**本波不應該動那個數字。**

⚠️ 但 `PRIVACY.md` 你**會**改（新增 transcript 條目）。改的時候不要動到
「Network activity initiated by Parallel Code itself」那一節的數量，
否則 R2 的機器檢查會紅。

## 範圍

做（研究報告列的完整版七項）：

1. 六個偵測模組的事件發射點
2. JSONL writer / reader
3. retention（見上方預設值）
4. `PRIVACY.md` 新增條目
5. Settings 開關 + 清除動作
6. remote endpoint
7. timeline UI

不做：

- 不動 `trace.ts` 的 default-deny 姿態與 `NEVER_SAFE` 清單
- 不把 transcript 塞進 `persistence.ts`
- 不寫進使用者 worktree

## 未決問題（要在決策紀錄裡答，不要默默決定）

- rotation 政策的實際實作（事件數 vs 時間窗，兩者都要但先到為準）
- worktree 被刪後 transcript 是否保留 —— **Arena 的答案是保留**，建議一致
- redaction 命中後的標記形狀

## Plan Steps

- [x] Step 0 — 讀 §二.6 與決議 6、盤點既有零件（trace.ts / ring-buffer / StepEntry / offline.ts 姿態）
- [x] Step 1 — JSONL writer/reader + rotation（純函式為主，可單測）
- [x] Step 2 — redaction（寫入前，借 `.gitleaks.toml` 規則）
- [x] Step 3 — 六個事件發射點
- [x] Step 4 — Settings 開關 + 清除動作
- [x] Step 5 — `PRIVACY.md` 條目
- [x] Step 6 — remote endpoint
- [x] Step 7 — timeline UI
- [x] Step 8 — 四道 gate

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1888，entry bundle 不得超過 90%
2. **`OUTBOUND_SURFACES` 的數量未變**，R2 的機器檢查仍過
3. `electron/ipc/transcript.test.ts`：JSONL round-trip、rotation、壞行容錯
   （仿 `log.test.ts` 的純函式風格）
4. 有測試證明**預設關閉時完全不寫檔**
5. 有測試證明 redaction 在寫入前發生（寫入後的檔案裡不含測試用的假密鑰）
6. commit 列明確路徑，不得出現 `.agent/`、`.codex/`、`openspec/`

## 決策紀錄

### D1 — rotation 的實際機制：兩條規則都跑，先到者為準（未決問題 ①）

`applyTranscriptRetention()` 一次套用兩條，**先年齡、後數量**，順序有意義：

1. **年齡窗**先過濾掉 `ts` 早於 `now - 30 天` 的事件；
2. **數量上限**再取剩下的最後 5000 筆。

先年齡再數量，是因為反過來會讓一筆 40 天前的舊事件「佔住」5000 個名額之一，
使實際保留的新事件少於 5000。測試 `applies the age window before the count` 就是釘這件事。

**寫入端不是每次 append 都重寫。** `append()` 是純 `O_APPEND`；每個 task 在記憶體裡
維護行數計數，只有當行數 `> maxEvents + compactionSlack`（5000 + 500）時才觸發
`compact()` 整檔重寫。理由：若一過 5000 就重寫，O(1) 的 append 會永遠變成 O(n)；
有 slack 後重寫成本被攤提到 500 次 append 上。

**但使用者可見的保證仍然精確是 5000**，因為 `read()` 出口也套用同一組 retention。
檔案「暫時」最多 5500 行，讀出來永遠 ≤ 5000。這點寫進 `TranscriptLimits` 註解與測試
（`caps what a reader sees even when the file transiently holds more`），不靠口頭承諾。

**30 天需要額外的 sweep。** 只有「有人再寫入」才會觸發 compaction，所以一個已死的 task
永遠不會被自己的寫入路徑清掉——單靠 count cap，它的最後 5000 筆會留到天荒地老，
「30 天」就會是程式碼不兌現的宣稱。因此 `register.ts` 在啟動時 `setImmediate` 跑
`store.sweep()`，掃過每個檔案；整檔過期就刪檔，部分過期就 compact。

**`compact()` 用 temp+rename，`append()` 不用。** 只有罕見的重寫路徑付原子性的代價，
高頻的 append 保持單純的 O_APPEND 寫入（本身對小寫入即為原子）。

`ts` 一律由 main 蓋章、忽略 renderer 傳來的值。retention 用「位置」修剪，
所以行的時間順序必須單調——否則「最後 5000 筆」就不是一句有意義的話。
StepEntry 自己的時間戳沒有遺失，emitter 把它放進 `detail`。

### D2 — worktree 被刪除後 transcript 保留（未決問題 ②）

**選擇：保留。** 與 Arena 一致（`PRIVACY.md:27`，per-match 輸出留在 app data dir 直到使用者自己刪）。

理由不只是「一致性」。transcript 的價值幾乎全部在**事後**：worktree 還在的時候，
你有 git log、有 diff、有終端還開著；worktree 被刪之後，這份紀錄才是唯一還留著的東西。
「刪 worktree 就連紀錄一起刪」等於在最需要它的那一刻把它銷毀。

實作上這是自然結果而非額外工程——檔案在 `userData/transcripts/`，從來不在 worktree 裡，
所以刪 worktree 本來就碰不到它。程式碼裡唯一與 task 刪除相關的動作是
`removeTaskDraftEntries()` 呼叫 `forgetTranscribedSteps(taskId)`，那只清**記憶體**裡的
去重鍵，不動檔案；該處留了註解說明這個區別。

刪除的路徑是明示的：Settings 的「Clear transcripts」，或使用者自己刪目錄。
30 天 sweep 也仍然適用——保留不等於永久。

### D3 — redaction 命中後的標記形狀（未決問題 ③）

**形狀：`[REDACTED:<rule-id>]`**，就地取代被比中的那一段；同時在事件上記
`redacted: string[]`（觸發的 rule id，去重）。

四個考量：

1. **人看得懂** —— 在 timeline 上一眼就知道這裡有東西被遮了；
2. **grep 得到** —— `[REDACTED:` 是單一字面字串；
3. **自我描述** —— 帶 rule id，「像 Anthropic key」和「像通用賦值」是不同資訊，
   前者幾乎確定是真密鑰，後者可能是誤判，混成同一個 `***` 就丟掉了這個區別；
4. **不會自我觸發** —— id 後面永遠是 `]`，不會是 `=` 或 `:`，所以最後那條
   generic-assignment 規則不可能接在 marker 後面再咬一次。這點有測試釘住
   （`cannot re-trigger the generic assignment rule on a second pass`，
   對**每一條**規則的 marker 都驗證是 fixed point）。

事件層級的 `redacted` 陣列讓 UI 能標出 `[redacted]` 記號、header 能說
「N events · M with redacted content」——遮蔽這件事本身是可見的，不是靜悄悄發生。

### D4 — 為什麼 `electron/ipc/transcript.ts` 不 import `electron`

store 的目錄由 constructor 參數傳入，模組本身零 electron 依賴。
這樣整個模組能在 vitest（`environment: 'node'`，無 DOM）對**真實 temp 目錄**跑，
不需要 mock `app.getPath`。真實路徑跑過的測試，才證明得了「預設關閉時目錄根本不存在」
這種主張。實際路徑由 `register.ts` 用新 export 的 `getStateDir()` 組出來，
因此 dev session 會寫進 `-dev` 後綴目錄，不汙染真實 profile。

### D5 — 兩道開關而非一道

renderer 的 `recordTranscriptEvent()` 檢查一次 `store.transcriptEnabled`，
main 的 `appendTranscriptEvent()` 再檢查一次。不是冗餘：
renderer 那道讓「關閉時完全不發 IPC」（關閉成本為零），
main 那道讓「renderer 有 bug 也錄不起來」（同意必須是明示的）。
兩道擋的是兩種不同的失效。

main 的值在 startup 從 `state.json` 直接讀（`parsePersistedTranscriptEnabled`），
不等 renderer 推——與 `offline.ts` 同一個姿態，理由也一樣：
一個要靠 race 才成立的錄音開關不算開關。且只認字面 `true`，
壞掉的 state 檔不能把錄音打開。

### D6 — 借用事件詞彙，六種 kind，不新造

`agent` / `step` / `attention` / `merge` / `pr-checks` / `commit`，
一一對應到研究報告點名的六個既有偵測模組。`TRANSCRIPT_EVENT_KINDS` 用
`as const satisfies readonly TranscriptEventKind[]`，讓 runtime 白名單與 compile-time
union 不可能各走各的。有測試驗證六個 emitter 剛好覆蓋六種 kind，不多不少。

**merge 的歸屬做過一次反轉。** 一開始打算直接在 `tasks.ts:658` 發射（taskId 與
mergeResult 都在 scope，零改動）。後來改成給 `completion.ts` 的 `recordTaskMerged()`
加一個 optional 參數。原因：若在 tasks.ts 發射，「六個事件類別」對應的就只有五個檔案，
之後沒有人能靠讀 `completion.ts` 知道 merge 會進 transcript。
一個 optional 參數換來 kind ↔ 模組 1:1 可稽核，划算。

### D7 — 每個 poller 都必須先判斷「有沒有變」

PR checks 每 30 秒輪詢、commit 每 5 秒輪詢。若每次輪詢都寫一行，一天就是上萬行，
真正重要的那六行會被埋掉。所以：

- `prChecksEvent()` 在 overall 與三個計數都相同時回 `null`；
- `newCommitEvents()` 第一次觀測（`previous === undefined`）只建立基準、**不發事件**——
  否則每次 panel 捲進視窗都會把整條 branch 歷史重播一次；
- `attentionTransitionEvent()` 在 `previous === undefined`（watcher 掛載時的初次填充）
  回 `null`——否則每次開 app 都會給每個 task 蓋一枚假的轉換事件；
- steps 用**內容鍵**（`timestamp + status + summary`）去重，不用索引。
  agent 會整份重寫 `steps.json`，位置不是身分。

這些判斷全部是 `src/lib/transcript-events.ts` 裡的純函式，六個發射點只剩一行呼叫，
符合「vitest 是 node 環境、元件只能是笨渲染器」的約束。

### D8 — 強化（而非削弱）`trace.ts` 的 default-deny

`AppendTranscriptEvent` 與 `ReadTranscript` **加入** `NEVER_SAFE`。
transcript 事件帶的是 agent 寫的自由文字，與 `WriteToAgent` 同一類。
`SAFE_FOR_TRACE` 仍是空集合，既有清單一字未動。

### D9 — timeline tab 不搶焦點（既有狀態機的例外）

`nextNotesTab` 原本的規則是「新出現的內容搶焦點」。timeline 是唯一的例外：
它出現是因為**使用者改了設定**，不是因為 task 產出了東西。
若照原規則，開關一開就會把所有開著的 task panel 全部拽到 timeline，
等於 app 在對自己的設定變更大呼小叫。它仍遵守第二條規則
（關掉錄音時從 timeline 退回 notes），否則會停在死掉的 tab 上。

`NotesTabAvailability.timeline` 設為 **optional**，是為了讓 Handoff 那一波留下的
12 個既有測試與所有既有呼叫點**一個字都不用改**——那個檔案存在的唯一理由就是
tab 狀態機在元件裡測不到，在那裡造成回歸會是隱形的。實測 diff 純新增，12 個原測試全綠。

### D10 — remote endpoint 的授權分級

`GET /api/transcripts/:taskId`，開放給 mobile/paired token 的唯讀清單。
理由：它就排在 `/api/agents/:id` 旁邊，而後者回傳的是**原始終端位元組**；
transcript 是經過遮蔽的生命週期事件，敏感度嚴格低於它。
且未開啟時回空陣列。回應帶 `enabled` 欄位而不是讓 client 從空陣列去猜——
「沒開錄音」和「還沒發生事情」是兩件事。

**這條完全是本機檔案讀取，沒有任何對外連線**，所以 `OUTBOUND_SURFACES` 數量不變（仍為九）。

### D11 — 不 shell out 到 gitleaks

決議 6 已定，實作上再確認一次：規則集是 14 條正則，全部 quantifier-flat
（無巢狀量詞、重複中無交替），對 adversarial 輸入維持線性。
transcript 是 agent 控制的輸入，一條會災難性回溯的正則就是寫入路徑上的 DoS，
所以有測試對 20,000 字元的惡意輸入設時間上限，當作「有人加了巢狀量詞」的警報器。
實測整組規則跑一則真實事件 2000 次遠低於 2 秒，因此**不需要 worker**。

## 結束摘要

七項全做完，四道 gate 全綠。

**測試：** 1888 → **2014 passed / 24 skipped**（+126）。基準是自己的分支點 `649d609`
（已 checkout 回去實測確認為 1888/24），不是已經前進的 main。
五個新增/修改的測試檔全部**單獨跑也綠**——不是只有在完整套件裡綠。

**Bundle：** entry chunk **88.3%**（1,324,035 B / 1,500,000 B），在 90% 天花板之下；
dist total 85.1%。沒有新增任何 npm 依賴，timeline UI 是純 Solid 原生元素。

**`OUTBOUND_SURFACES` 未變（九）。** `PRIVACY.md` 有改，但只在
「What data Parallel Code handles」新增一條 Session transcripts、
在「Local storage locations」新增一行 `transcripts/`。
「Network activity initiated by Parallel Code itself」那一節與它的
`**nine**` 字樣、八個 `**Offline mode:**` 標記全部原封未動；`offline.test.ts` 的
四項機器檢查仍過（單獨跑 16 passed）。

**刻意沒做的事：**

1. **沒有把終端 scrollback 落地。** 那 64KB ring buffer 仍是純記憶體。
   本波做的是「發生了什麼」（生命週期序列），不是「輸出了什麼」（原始位元組）。
   落地 scrollback 是數量級不同的隱私與體積問題——原始位元組裡的密鑰遠多於事件摘要，
   而 redaction 對原始碼本來就無能為力。若要做，應該是獨立一波、獨立決議。
2. **沒有 export / 分享功能。** 沒有「匯出 transcript」按鈕。刻意：
   目前唯一的出口是本機檔案與唯讀 remote endpoint，加匯出等於鼓勵把一份
   「遮蔽不完全」的檔案往外送。要做的話該先有一份明確的「這份檔案含有什麼」的警告流程。
3. **沒有跨 task 的全域 timeline 視圖。** 只有 per-task 的 Timeline tab。
   儲存是 per-task JSONL，全域視圖要合併排序 N 個檔案，成本與價值不成比例。
4. **沒有做 opt-in 的 per-task 粒度。** 照研究報告設定的預設值：全域單一開關。
5. **沒有把 `stepsContent` 加進 `persistedSnapshot()`。** 那是已取消的 MVP 的第一項，
   第一波查證已證明不是缺口（磁碟是 source of truth）。本波沒有回頭去動它。
6. **`compact()` 的行數計數是 per-process 記憶體狀態。** 重啟後第一次 append 會
   讀檔重數一次（`countLines`），之後才走記憶體。可接受：每個 task 每次 app 啟動一次。
