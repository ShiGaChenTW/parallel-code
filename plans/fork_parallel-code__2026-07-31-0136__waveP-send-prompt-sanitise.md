# P：`send_prompt` 內容清理 + provenance 標記

**建立時間：** 2026-07-31 01:36
**最後更新：** 2026-07-31 02:05
**狀態：** 完成（未 push）
**分支：** `feat/send-prompt-sanitise`（從 `main @ 92b17b2` 分出）
**worktree：** `/Users/scottchen/Documents/20_Projects/pc-feat-send-prompt-sanitise`

## 目標

補上決議 7 的**第 1 步**。這是既存安全問題，非新功能引入，但決議 7 把它從
「建議單獨評估」升級為 C4 relay 的**必做前置**。

研究報告 §二.4「安全評估」的原文結論：

> **未防護：`prompt` 的內容本身。** `send_prompt`／`create_task` 只驗長度與非空，
> 沒有對 shell metacharacter、ANSI escape、注入指令做任何掃描，文字原樣寫進另一個
> process 的 stdin。

攻擊路徑：coordinator 從被污染的 Task B 經 `get_task_output`／`get_task_diff` 讀到
攻擊者可控文字 → 原樣 `send_prompt` 進 Task C 的終端 → 在那裡被當作**對 CLI 的字面按鍵**
解讀，可能觸發工具呼叫、shell 指令，或在 Task C 設定寬鬆時自動接受核准對話框。

**bracketed-paste 不是安全邊界。** `coordinator.ts:1126-1128` 的包裹是防止目標的行編輯器
把換行當 Enter，防的是誤送多行，不是惡意控制序列 —— 原始 bytes 仍然寫進 PTY。

## 範圍

做：

- 自動化投遞路徑（`send_prompt`、`create_task` 的 initial prompt）的內容清理
- provenance 標記：接收端的 transcript 要能區分「來自另一個 task」與「人類輸入」
- 既有的 `MAX_PENDING_PROMPTS`(32) / `MAX_PROMPT_BYTES`(64KB) 延伸到任何新路徑

不做：

- **不做 `relay_to_task`**（那是 C4 的第 2 步）
- **不做 `ask_coordinator`**（C4 第 3 步，且必須等真實 CLI 驗證過 provenance）
- 不改 `writeToAgent` 的授權模型（研究報告記錄它沒有 per-caller 授權，
  但修那個屬 C4 範圍，本波只做內容層）

## 已知的既有材料（不要重造）

| 東西               | 位置                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `stripAnsi`        | `electron/shared/prompt-detect.ts:2`，`coordinator.ts` 已 import |
| `send_prompt` 實作 | `coordinator.ts:1037-1070`                                       |
| 底層寫入原語       | `pty.ts:506-510` `writeToAgent`                                  |
| 就緒判定           | `getAgentPromptReadiness()` `prompt-detect.ts:73-98`             |

## 兩個必須明確裁決的設計點

1. **人類輸入路徑要不要一起清理？** `writeToAgent` 與人類 UI 共用
   （`PromptInput.tsx:736`、`tasks.ts:185`）。對人類貼上的內容 strip 控制字元可能
   破壞正當用途。決定哪一種並寫進決策紀錄，**不要無聲改變人類輸入行為**。
2. **provenance 前綴本身會不會被目標 agent 誤讀成指令？** 研究報告點名這個風險。
   純文字前綴（如 `[relayed from task:<name>]`）可能被接收 CLI 當成命令。
   本波無法對真實 CLI 驗證就要明說，不要宣稱已驗證。

## Plan Steps

- [x] Step 1 — 盤出所有「非人類來源文字寫進 PTY」的路徑，列成清單
- [x] Step 2 — 內容清理（純函式，可單測）
- [x] Step 3 — provenance 標記與格式決定
- [x] Step 4 — 測試：含惡意控制序列的 payload 被中和、正常文字不受損
- [x] Step 5 — 四道 gate

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1717 → **1753 passed / 24 skipped**
2. 有一個測試餵入含 ANSI／控制序列的 payload 並斷言它不會原樣抵達 PTY
   → `coordinator-prompt-sanitise.test.ts`「does not deliver an ANSI + control
   payload to the PTY intact」
3. 兩個設計裁決都寫在決策紀錄，含選擇理由 → 見 D1、D2
4. commit 列明確路徑

## 路徑盤點（Step 1 結果）

寫進 PTY 的**唯一**底層原語是 `pty.ts:517` 的 `session.proc.write(data)`，
只被 `writeToAgent(agentId, data)` 呼叫。從那裡反向追出 **10 個 call site**，
比 brief 點名的 2 個多很多：

| #   | 位置                                               | 內容來源                | 判定             |
| --- | -------------------------------------------------- | ----------------------- | ---------------- |
| 1   | `coordinator.ts` `writePromptToTask` — `FOCUS_IN`  | 常數 `\x1b[I`           | 投遞機制，不清理 |
| 2   | `coordinator.ts` `writePromptToTask` — prompt body | **coordinator agent**   | **本波修這個**   |
| 3   | `coordinator.ts` `writePromptToTask` — `\r`        | 常數                    | 投遞機制，不清理 |
| 4   | `remote/server.ts:1206` WS `input`                 | 遠端（手機）人類按鍵    | 人類，不動       |
| 5   | `ipc/register.ts:481` IPC handler                  | renderer 總匯流口       | 轉發層           |
| 6   | `TerminalView.tsx:870`（`term.onData`）            | 人類原始按鍵            | 人類，不動       |
| 7   | `PromptInput.tsx:737`                              | 常數 `\r`               | 人類觸發         |
| 8   | `tasks.ts:185` `writeToAgentWhenReady`             | 見下方 4 個餵入者       | 人類，不動       |
| 9   | `tasks.ts:881` `runBookmarkInTask`                 | 設定檔書籤 `command+\r` | 人類撰寫         |
| 10  | `taskStatus.ts:608` auto-trust                     | 常數 `\r`（自動 Enter） | 自動但無內容     |

第 8 項的 4 個餵入者：`PromptInput.tsx:430/758`（人類打字／staged autofire）、
`TaskNotesBody.tsx:35`（task notes，也可經 mobile REST route 寫入）、
`ReviewProvider.tsx:153`（compile 過的 review 註記）、
`MergeDialog.tsx:319`（`rebase on ${base} branch`）。

**意外發現：研究報告的「沒有做任何掃描」不完全正確。**
`remote/server.ts:55` 已有 `sanitizePromptText()`，把 `[\x00-\x1f\x7f]` 全換成空白。
而 MCP stdio 的工具呼叫其實是經 `mcp/client.ts` 用 `fetch` 打回本機 REST server 的，
所以 `send_prompt`／`create_task` 兩條路**今天都已經**經過那層。

但那層在**傳輸層**而不是**投遞層**，三個問題：
(a) 漏掉 C1 控制字元（`U+0080`–`U+009F`，含 8-bit CSI `U+009B`）；
(b) 任何 in-process 呼叫 `orch.sendPrompt` 的人完全繞過它 —— 下一波的
`relay_to_task` 正是要寫在 coordinator 上，天生繼承不到；
(c) 它把換行也換成空白，破壞多行 prompt。

因此本波把清理**下移到 coordinator 投遞邊界**，那裡是所有現在與未來自動化呼叫者的匯流點。

## 決策紀錄

### D1 — 人類輸入不清理（`writeToAgent` 不動）

**選擇：** 清理只加在 coordinator 的投遞邊界（`sendPrompt` / `createTask` /
`writePromptToTask`），`writeToAgent` 與整條 renderer 人類路徑**一個字元都不改**。

**理由：**

1. **技術上不可能在 `writeToAgent` 清理。** 它就是原始按鍵通道 ——
   `TerminalView.tsx` 的 `term.onData` 每一次按鍵都走它，方向鍵、Ctrl-C、Esc
   本身**就是**控制序列。在那裡 strip 等於讓終端機失能。
2. coordinator 自己的投遞機制（`FOCUS_IN`、bracketed-paste 包裹、結尾 `\r`）
   也走 `writeToAgent`。在原語層清理會把投遞機制自己砍掉。
3. 人類是信任根。對人類貼上的內容 strip 控制字元會破壞正當用途
   （貼帶色碼的終端輸出、用 Esc 關對話框），而且會是**無聲的行為改變**，brief 明文禁止。

**已檢視但歸類為人類側的邊界案例：** `TaskNotesBody` 會把 task notes 送進 PTY，
而 notes 可經 mobile REST route 寫入。但那個 token 在操作者自己手上，且送出需要
桌面 UI 上一個刻意的點擊，所以仍算人類。這是「檢視後歸類」，不是「沒看到」。

### D2 — provenance 用單行純文字前綴，且**沒有對真實 CLI 驗證過**

**選擇：** `AUTOMATED_PROMPT_PROVENANCE` = 單行陳述句：

> `[parallel-code] Sent by the coordinator agent through send_prompt; not typed by the human operator.`

只加在 `send_prompt`，**不加在 `create_task` 的 initial prompt**（那裡
`SUB_TASK_PREAMBLE` 已經講了「A coordinator agent dispatched you」，比前綴更強）。

**理由：**

1. brief 要的是「transcript 能區分 relay 文字與人類輸入」。真正有訊息量的是
   **前綴不在的時候** —— 這波之後，sub-agent transcript 裡沒有前綴的訊息就是人類打的。
2. 刻意寫成**陳述句、不含祈使語氣**。單元測試斷言它不含
   `run|execute|ignore|you must|please`，也不含換行。理由是接收端 CLI 把它當
   一般 prompt 內容讀，不可能指望它當 metadata。
3. **刻意不用「以下是不可信資料，不要當指令」這種 data-framing 包裹。**
   `send_prompt` 是 coordinator 指揮 child 的正常管道，把每一則都框成「不可信資料」
   會破壞主要用途。傳輸層無法區分「coordinator 自己的話」與「coordinator 轉貼的話」——
   那需要 `relay_to_task` 的 `fromTaskId`，屬下一波。

**⚠️ 未驗證：** 這個環境裡跑不了真實 CLI（沒有互動式 PTY、也沒有可 spawn 的 agent CLI），
所以 `coordinator-real-agents.integration.test.ts` **沒有執行**。
「前綴會不會被接收 CLI 誤讀成指令」這件事**我沒有驗證，也不宣稱驗證過**。
決議 7 要求在開 `ask_coordinator` 之前對真實 CLI 驗證 —— 那個要求仍然掛著。

### D3 — 清理規則：保留 `\n` 與 `\t`，其餘控制字元全移除

`stripAnsi` → 行尾正規化（`\r\n` 與單獨 `\r` 都變 `\n`）→ 移除
`U+0000`–`U+0008`、`U+000B`–`U+001F`、`U+007F`–`U+009F` → `trim()`。

- **CR 一定要移除**：它到 PTY 就是 Enter，是「提前送出」這個攻擊原語本身。
  轉成 `\n` 而不是直接刪，是為了保住行結構。
- **`\n` 必須保留**：`SUB_TASK_PREAMBLE` 本身就是多行，刪掉會毀掉既有功能。
  **殘留風險**：對沒開 bracketed paste 的 agent，`\n` 仍然等於 Enter。這是既存行為
  （人類路徑也一樣，`tasks.test.ts:995` 就在測這個），本波不改。
  下一波做 `relay_to_task` 時，relay 的 body 應該另外處理（要求 bracketed paste，
  或把 relay body 的換行摺掉）。
- **C1 一起移除**：`U+009B` 是 8-bit CSI，`stripAnsi` 已經把它當敵意字元處理。
- **shell metacharacter 不碰**：`&&`、`|`、`$()` 只有在 shell 讀到時才危險，
  而這裡是寫進 agent CLI 的 prompt，不是 shell。過度清理會破壞正當的技術對話。

### D4 — 清理放在「入場」與「寫入」兩個點

入場（`sendPrompt` / `createTask`）清理 + 貼前綴，讓**存進佇列的、拿去比對 echo 的、
最後寫出去的**是同一份 bytes。`writePromptToTask` 再清一次當 backstop。
因為清理是 idempotent，第二次是 no-op。

這第二道不是裝飾：`hydrateTask` 從 state 檔還原的 `initialPrompt` /
`pendingPrompts` **完全不經過入場檢查**，舊版 build 寫的 state 檔可以直接把
惡意 payload 餵進 `tryDeliverInitialPrompt`。有測試覆蓋這條。

### D5 — byte 上限：入場擋原始 prompt，前綴另立預算

`MAX_PROMPT_BYTES`(64KB) 的檢查維持在**呼叫者給的原始 prompt** 上，錯誤訊息不變
（既有測試依賴它）。因為清理只會變短，最終 payload 必然 ≤ 原始 + 前綴，
所以另外導出 `MAX_DELIVERED_PROMPT_BYTES = MAX_PROMPT_BYTES + MAX_PROVENANCE_HEADER_BYTES`
並用測試釘住這個不變式。

`createTask` 原本在 coordinator 層**完全沒有** byte 上限（只靠 REST 層的 16KB），
順手補上，與清理同理：限制要放在投遞邊界。

**刻意沒做：** 沒有在 `writePromptToTask` 加「超過預算就截斷」的機制。
唯一能觸發的情境是被竄改的 state 檔，那已經蘊含本機淪陷；而截斷會引入新的失敗模式
（queue 重試迴圈）。不划算。

### D6 — 改既有測試斷言的方式

19 個既有斷言寫死了舊的投遞 payload。改法是加一個 `relayed()` helper，
**從 production 用的同一個 `AUTOMATED_PROMPT_PROVENANCE` 常數 import**（不是複製一份字串），
並保持 `toBe` / `toEqual` 精確比對，**沒有**放寬成 `toContain`。
放寬會讓這批測試從此擋不住 payload 內容的回歸。

## 結束摘要

**改了什麼**

- 新增 `electron/shared/prompt-sanitise.ts`：純函式 `sanitisePromptBody()`、
  `buildAutomatedPrompt()`、常數 `AUTOMATED_PROMPT_PROVENANCE`、
  `MAX_PROVENANCE_HEADER_BYTES`。重用既有 `stripAnsi`，沒有新依賴。
- `electron/mcp/coordinator.ts`：`sendPrompt` 入場清理 + 貼 provenance +
  清空後拒收 + 清到東西時 `logWarn`；`createTask` 清理 initial prompt 並補 byte 上限
  （在建 worktree 之前擋，失敗不留殘骸）；`writePromptToTask` 加 idempotent backstop。
- 測試：`prompt-sanitise.test.ts`（23）、`coordinator-prompt-sanitise.test.ts`（13），
  並修正 `coordinator.test.ts` 19 個因行為改變而失效的斷言。

**測試數：** 1717 → **1753 passed / 24 skipped**（+36）。

**刻意沒做**

- `relay_to_task`、`ask_coordinator` —— 明文超出範圍。
- `writeToAgent` 的 per-caller 授權 —— 明文超出範圍，仍是既知缺口。
- 沒有放寬 / 移除 `remote/server.ts` 那層 `sanitizePromptText`。它比較激進
  （連換行都吃掉），但移除它會在本波弱化防護，屬另一次決策。
- **沒有對真實 CLI 驗證 provenance 前綴**（見 D2）。決議 7 第 2 步的驗證要求仍然掛著，
  `ask_coordinator` 不得在那之前開。
