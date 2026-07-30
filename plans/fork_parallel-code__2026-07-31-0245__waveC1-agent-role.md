# C1：Agent role（自由文字，不做 enum）

**建立時間：** 2026-07-31 02:45
**狀態：** 完成（commit `8c15cc1`，未 push）
**分支：** `feat/agent-role`（從 `main @ 649d609` 分出）

## 目標

讓 coordinator 建立 sub-task 時能指定角色（Planner / Researcher / Coder / Reviewer 之類），
但**用自由文字，不做 enum**。

## 決議 2 已定案，不要重新辯論

> **決定點不是 enum vs 文字，是「要不要工具層強制」。**
> 固定 enum 唯一有意義的實作是綁工具權限（Reviewer 真的拿不到寫檔案的工具），
> 那要改 `selectTools(taskId, coordinatorId)` 加第三個維度 —— 目前只有
> sub-task / coordinator 兩種身分。約額外 3–5 天。
>
> **沒有工具權限映射時，enum 只是字串別名。** 而自由文字更彈性，
> 且不必猜哪四個角色是對的四個。enum 一旦定了就是 API。
>
> **定案**：自由文字 `role?: string` + `roleInstructions?: string`。

## 真正的缺口（研究報告 §二.1）

`coordinator.createTask()` **已經支援** per-subtask 的 `agentCommand?` / `agentArgs?`
（`coordinator.ts:773-780`、`:869`），但 `create_task` 的 MCP schema
（`mcp-tool-list.ts:54-74`）只開了 `name` / `prompt` / `baseBranch`，
`server.ts:51-56` 硬寫沒轉出去。**這是純接線，不是架構。**

## 這不是 IPC channel

`create_task` 是 **MCP tool schema**（`mcp-tool-list.ts` 的 JSON + `server.ts` 一個參數轉發），
不是 Electron IPC channel。所以：

- **不需要**改 `channel-manifest.json` 或 `preload.cjs`
- `preload-allowlist.test.ts` 不適用
- 也不碰 dependency-cruiser 邊界

`environment: 'node'` 在這裡是**優勢** —— schema、preamble 文字、coordinator dispatch
本來就用純 vitest 測。

## 範圍

做：

1. `create_task` schema 加 optional `role?: string` + `roleInstructions?: string`，
   **不要 enum**，描述寫自由文字（例：`"Reviewer — read-only, do not edit files"`）
2. `server.ts` 的 `create_task` case 把參數轉進 `client.createTask({...})`
3. `coordinator.createTask` 在有 role 時把它前置到 `SUB_TASK_PREAMBLE` 之前，
   存成 `initialPrompt`（`coordinator.ts:852`）—— **重用既有字串串接，不要新注入機制**

不做（研究報告明列）：

- **per-role 工具限制** —— 要動 `selectTools`，明顯更大（+3–5 天）
- **`AgentDef` 上的 role 欄位** —— role 是 **per-task-instance** 概念，
  不是 per-agent-binary 概念
- **`NewTaskDialog` UI 改動** —— role 只在 coordinator 生成的 sub-task 有意義
- 不走 `preamble.ts` 的檔案注入路徑（會寫 `AGENTS.md`/`GEMINI.md`/`.agent.md`
  進 worktree 並被 diff 掃到）。MVP 走 prompt 前置可完全避開

## 已知的未驗證假設

研究報告誠實記錄：**coordinator LLM 是否真的會有意義地使用 role 欄位，未經驗證，
純屬建議性。** 不要在回報裡宣稱它有效，除非你真的測到。

## Plan Steps

- [x] Step 1 — schema 加欄位（`mcp-tool-list.ts`）
- [x] Step 2 — `electron/mcp/server.ts` 轉發（另加計畫未列出的 `client.ts`、`electron/remote/server.ts` 兩段接線，見 D1）
- [x] Step 3 — `coordinator.createTask` 前置 role
- [x] Step 4 — 測試：新增 `sub-task-preamble.test.ts`、`coordinator-role.test.ts`；擴充 `mcp-tool-list.test.ts`、`server.test.ts`、`coordinator-scoping.test.ts`
- [x] Step 5 — 四道 gate 全跑，輸出見結束摘要

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1888
2. 有測試證明沒帶 role 時行為與現在完全相同（既有 sub-task 不受影響）
3. 前端零改動
4. commit 列明確路徑

## 決策紀錄

### D1 — 實際接線是五段，不是計畫寫的三段（判斷修正）

計畫（與研究報告 §二.1）說「schema ＋ `server.ts` ＋ `coordinator.createTask`」三處。
追程式碼後發現**中間還隔著一層 HTTP**：

```
MCP create_task
  → electron/mcp/server.ts（tool case）
  → electron/mcp/client.ts   createTask()  → POST /api/tasks
  → electron/remote/server.ts handleCreateTask()  ← REST 入場檢查在這裡
  → coordinator.createTask()
```

MCP server 是**獨立的 Node 行程**，透過 REST 跟 Electron app 對話（`client.ts:56`
`this.request('POST', '/api/tasks', opts)`）。`handleCreateTask` 是逐欄位手寫轉發
（`remote/server.ts:420-427`），**沒讀到的 body 欄位就直接消失**。

**這一段同時修正了本計畫書與研究報告 §二.1，不只是修正實作。** 兩份文件都說「三處」。
若真的只改那三處，會發生下面這件事：

> role 從 MCP schema 出發，經 `server.ts` 正確轉進 `client.createTask`，被 JSON 化送出，
> 然後在 `handleCreateTask` 這一層**因為沒人讀 `body.role` 而消失**。
> coordinator 永遠收不到 role，sub-agent 的 prompt 完全沒變。
> 而 **四道 gate 依然全綠** —— 沒有任何 gate 會抓到這件事：
> 型別過（欄位只是沒被讀）、lint 過、dependency-cruiser 過、
> 測試也過（除非有人特地寫一條跨 REST 邊界的測試，而原計畫沒要求）。

結果會是**一個看起來已交付、實際什麼都不做的功能**。這是最糟的失敗形狀：
不是紅燈，是綠燈說謊。所以 §二.1 那句「這是純接線，不是架構」在**範圍**上是對的
（確實沒有新架構），但在**接線點的數量**上是錯的 —— 下一個讀 §二.1 的人必須知道這件事。

因此多動兩個檔：

- `electron/mcp/client.ts`：`createTask` opts 型別加 `role?` / `roleInstructions?`（body 是整個 opts 直接 JSON 化，加型別即通）
- `electron/remote/server.ts`：加 `validateRestRoleField` 入場檢查並轉進 `orch.createTask`

**這不是 scope creep，是計畫漏列的必要接線。** 前端（`src/`）零改動，已用 `git status` 確認。

### D2 — role 文字走現有 `sanitisePromptBody`，與 prompt 同級待遇

role 跟 prompt 一樣是 coordinator LLM 產生、會進到另一個 agent PTY 的文字，
而 coordinator 可能是從 `get_task_output` 讀來的髒資料（wave P 修的正是這條）。
沒有理由讓 role 繞過內容清洗 —— 否則等於在剛補好的洞旁邊開一個新的。
REST 層另外用既有的 `sanitizePromptText` ＋ 16KB 上限把關（與 prompt 同一組規則）。

### D3 — role 洗完變空字串 → 視為「沒帶 role」，不報錯（與 prompt 相反）

prompt 洗完是空的會 throw（`Prompt is empty after sanitisation`），因為 prompt 就是酬載本體。
role 不是 —— 它是 prompt 的裝飾。空 role 報錯只會讓 coordinator 因為一個無關緊要的欄位
整個建 task 失敗。所以 `buildRolePreamble` 對空輸入回傳 `''`，
上層無條件字串串接，**沒帶 role 的路徑因此逐位元組不變**（見驗收 2）。

### D4 — `buildRolePreamble` 放在 `sub-task-preamble.ts`，不放 `preamble.ts`

`preamble.ts` 是**檔案注入**路徑（寫 `AGENTS.md` / `GEMINI.md` / `.agent.md` 進 worktree，
會被 diff 掃到）。role 是純 prompt 文字，跟 `SUB_TASK_PREAMBLE` 是同一類東西，
放在同一個模組，coordinator 只多一行 import。計畫明列不走檔案注入，這個放法自然滿足。

### D5 — 沒有在 prompt 裡告訴 sub-agent「這個 role 沒有強制力」

一度想在 role 區塊寫明「本角色純建議、未綁工具權限」以求誠實。**推翻了**：
那段文字的讀者是 sub-agent，等於主動邀請它忽略角色。
「未強制」這件事該講給**呼叫端**聽，所以寫在 `create_task` 的 schema description
（`not enforced at the tool layer`）與本文件，而不是寫進 sub-agent 的 prompt。
prompt 裡改放一句可操作的指示：角色與任務衝突時**說出來**，不要默默照做。

### D6 — coordinator 測試另開新檔，不塞進 `coordinator.test.ts`

`coordinator.test.ts` 已 1000+ 行且 mock 很重；前一個 wave 有「合跑過、單跑掛」的教訓
（`vi.clearAllMocks()` 清呼叫紀錄但不清 implementation，前一測的 `mockResolvedValue` 被後面借用）。
新開 `coordinator-role.test.ts`，用既有的 `coordinator-test-harness.ts`，
每個 `beforeEach` 自己 `resetCoordinatorMocks()` ＋ `mockNextTask()`。
所有動到的測試檔都**單跑與合跑各驗一次**。

### D7 — byte 上限把 role 區塊一起算進去

`MAX_PROMPT_BYTES` 檢查原本只算 `SUB_TASK_PREAMBLE + body`。role 區塊也會進 PTY，
不算就等於偷偷放寬上限。已改成算 `rolePreamble + SUB_TASK_PREAMBLE + body`，
且維持在 `createBackendTask` 之前檢查 —— 被擋下時不會留下孤兒 worktree（有測試）。

## 結束摘要

**狀態：完成，已 commit 在 `feat/agent-role`，未 push。**

### 改動面

| 檔案                                          | 行數       | 內容                                                                   |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `electron/mcp/mcp-tool-list.ts`               | +10        | `create_task` schema 加 `role` / `roleInstructions`，free text 無 enum |
| `electron/mcp/server.ts`                      | +19        | tool case 轉發 ＋ `optionalString` 型別守衛                            |
| `electron/mcp/client.ts`                      | +4         | `createTask` opts 型別加兩欄（D1）                                     |
| `electron/remote/server.ts`                   | +27        | `validateRestRoleField` 入場檢查 ＋ 轉進 `orch.createTask`（D1）       |
| `electron/mcp/sub-task-preamble.ts`           | +32        | `buildRolePreamble()`                                                  |
| `electron/mcp/coordinator.ts`                 | +28 −3     | opts 加兩欄、role 清洗、byte 上限含 role、`initialPrompt` 前置         |
| `electron/mcp/sub-task-preamble.test.ts`      | +52（新）  | `buildRolePreamble` 單元測試 9 個                                      |
| `electron/mcp/coordinator-role.test.ts`       | +146（新） | coordinator 組裝測試 9 個                                              |
| `electron/mcp/server.test.ts`                 | +68        | MCP 轉發 4 個                                                          |
| `electron/mcp/mcp-tool-list.test.ts`          | +34        | schema 3 個                                                            |
| `electron/remote/coordinator-scoping.test.ts` | +86        | REST 6 個                                                              |

合計：既有檔 305 insertions / 3 deletions，新檔 198 行。**`src/` 零改動**（前端未觸碰）。

### 四道 gate（實際輸出尾行）

- `npm run check` → `All matched files use Prettier code style!`（compile / typecheck / lint / format 皆過）
- `npm run check:static` → `✔ no dependency violations found (433 modules, 1444 dependencies cruised)`
- `npm test` → `Test Files 118 passed | 2 skipped (120)` ／ `Tests 1919 passed | 24 skipped (1943)`（baseline 1888 → +31）
- `npm run check:bundle` → `ok renderer entry chunk: 1,315,701 B / 1,500,000 B budget — 87.7% used` ／ `ok dist total: 15,311,306 B / 18,000,000 B budget — 85.1% used`

動到的測試檔**單跑也全綠**（sub-task-preamble 9、coordinator-role 9、server＋mcp-tool-list 38、
coordinator-scoping 75、coordinator 三個既有檔 276）。

### 「沒帶 role 行為完全相同」怎麼證的

三層各一個證據，最強的是第一個：

1. **逐位元組相等**（`coordinator-role.test.ts`）：不帶 role 建 task，
   斷言 `initialPrompt` **恰等於** `` `${SUB_TASK_PREAMBLE}implement the parser` `` ——
   用 `toBe`，不是 `toContain`。這是 wave P 既有測試（`coordinator-prompt-sanitise.test.ts:162`）
   的同一個字串常數，等於同時證明「跟 wave P 之後的現況相同」。
   另有一個測試斷言 prompt 裡不出現 `[ROLE]`。
2. **結構上不可能不同**：`buildRolePreamble` 對空／空白輸入回傳 `''`，
   有專門測試釘住；上層是無條件 `rolePreamble + SUB_TASK_PREAMBLE + body`，
   `'' + x === x`。連「洗完變空的 role」也走同一條（D3，有測試）。
3. **payload 不長出新 key**：MCP 層與 REST 層各有一個測試斷言未帶 role 時
   `arg.role` / `arg.roleInstructions` 皆為 `undefined`。

### 刻意不做

- **per-role 工具限制** —— 要給 `selectTools(taskId, coordinatorId)` 加第三個維度，決議 2 估 3–5 天。
- **`AgentDef` 的 role 欄位** —— role 是 per-task-instance，不是 per-agent-binary。
- **`NewTaskDialog` UI** —— role 只對 coordinator 生成的 sub-task 有意義。
- **`preamble.ts` 檔案注入** —— 會把 `AGENTS.md` / `GEMINI.md` / `.agent.md` 寫進 worktree 並被 diff 掃到。
- **role 的持久化／回顯** —— role 已融進 `initialPrompt`，沒有另存欄位，`persistedSnapshot` 不動。

### ⚠️ 未驗證（誠實記錄）

**coordinator LLM 是否真的會有意義地使用這個 role 欄位，本次沒有驗證。**
本 wave 證明的是接線正確：role 從 MCP schema 一路正確抵達 sub-agent 的 initial prompt，
並照設計組裝。至於真實 coordinator 會不會主動填、sub-agent 會不會照著做 ——
需要跑真實 CLI 的端對端觀察（`coordinator-real-agents.integration.test.ts` 那條路），本次未做。
維持研究報告的原判：**純建議性，未驗證**。
