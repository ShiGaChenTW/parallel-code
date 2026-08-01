# C3：Task 單一依賴（不做 DAG）

**分支：** `feat/task-dependency`（從 `main @ be824e6` 分出）

## 決議已定，不要重新設計

研究報告 §二.3 與決議 3、4 都已裁決：

- **只做單一依賴 `dependsOnTaskId?: string`，不是陣列，不做 DAG。**
  對齊 `coordinatedBy` 的單親形狀，繞開環檢測 —— 只需要一個 O(depth) 的鏈走訪守衛，
  類比 `getCoordinatorChildren`。
- **完整 DAG 明確不做。** 多親、環檢測、跨 coordinator 是與現行嚴格樹**本質不同**的資料模型，
  約 8–12 天，換一個目前**沒有證據需要**的用例。

## 最重要的區分：排程 vs git 祖先

一條依賴邊在 worktree-per-task 的 app 裡有**兩種意義，絕不可混用**：

| 意義                                    | 現狀                                                                        | 成本     |
| --------------------------------------- | --------------------------------------------------------------------------- | -------- |
| **(a) 排程** —— A 沒好前不要開始 B      | 大致已有（`waitForIdle`／`signalDone`），但只在 coordinator↔直屬 child 之間 | 便宜     |
| **(b) git 祖先** —— B 從 A 的 branch 開 | **完全已有**，`baseBranch` 是純字串欄位，已貫穿 `createWorktree` 與多處 UI  | 幾乎為零 |

**MVP 的依賴意義是 (b) git 祖先。**

## 決議 4：gate 在 `landingState`，不是「真的 merge 進 base」

|          | `landingState`                                     | 真的 merge 進 base           |
| -------- | -------------------------------------------------- | ---------------------------- |
| 保證     | task 工作已落地並通過 review                       | commit 真的在 base branch 上 |
| 對應意義 | **git 祖先**（B 要的 code 就在 A 的 branch 上）    | 純排程                       |
| 成本     | 重用既有 `isLandedTaskState()`（`landing.ts:3-7`） | 新 git 查詢 + 輪詢           |

理由：B 要的 code **就在 A 的 branch 上**，不需要等它進 main。
若 gate 在「真的 merge」，A 的 PR 卡 review 三天，B 白等三天。

## 決議 3：依賴被刪除 → 保持 blocked，**不採 detach**

**不採** `closeTask`（`tasks.ts:527-541`）的 detach 先例。

blocked 狀態必須帶**可讀原因**（「依賴的 task 已被移除」）與**明確的解除動作**。
理由：靜默 blocked 是這個領域的招牌失敗（對照 Vibe Kanban #3329 卡片無聲消失）——
一個永遠不啟動又不說為什麼的 task，比自動 detach 更糟。

## 四件要做的（研究報告原文）

1. `Task` 加 `dependsOnTaskId?: string`
2. 建立 task 時若有 `dependsOnTaskId`，`baseBranch` 預設為該 task 的 `branchName`
   （同 `coordinator.ts` 的 `?? coordinatorBranch` 模式）→ **`git.ts` 完全不動**
3. **agent 自動啟動**（不是 worktree 建立）gate 在依賴到達 `isLandedTaskState()`
4. Sidebar 顯示 blocked badge（仿 `SubTaskStrip.tsx:140-149` 的 landing-state badge），
   **不做新的樹狀嵌套**

## 環路

現況 `coordinatedBy` 是嚴格一層單親指標，**結構上不可能有環**。
`computeSidebarTaskOrder()`（`sidebar-order.ts:79-99`）只做一次有界深度查詢、
**沒有遞迴防護** —— 安全純粹因為深度上限是 1。

加了 `dependsOnTaskId` 之後鏈可以變長，**所以要有走訪守衛**。
`sidebar-order.test.ts:49-83` 是純圖邏輯 node 測試的現成範本。

## migration

`PersistedState` 沒有 schema version，migration 走存在性／形狀檢查
（`persistence.ts:333-390`）。**新增欄位對舊資料就是 `undefined`，零 migration。**

## 不做

- 完整 DAG、多親、環檢測引擎
- 跨專案依賴
- A 的 branch 在 B 已分支後才變動的 rebase／衝突自動處理
  （`git.ts:1867` 的 `rebaseTask` 存在但沒接自動觸發，維持現狀）
- 讀 Huly 關聯（那要 H7，而 H7 卡在 Huly 實測）

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2382，啟動 JS 不得超過 90%（目前 82.2%）
2. 圖走訪有守衛，且有測試證明長鏈不會無限遞迴
3. 有測試證明「依賴被刪除 → 保持 blocked 且帶可讀原因」，**不是 detach**
4. 有測試證明沒帶 `dependsOnTaskId` 時行為與現在完全相同
5. `git.ts` 未被修改
6. commit 列明確路徑

## 決策紀錄

### D1 — blocked 是**推導值**，不是存起來的欄位

只在 `Task` 上加 `dependsOnTaskId?: string` 一個欄位，blocked 狀態每次由
`getDependencyBlock(taskId, tasks)` 從 task map 現場算出來。

理由：blocked 是 `dependsOnTaskId` + 依賴的 `landingState` 的函數，兩個輸入都已經在 store 裡。
存第二份就會有兩個真相來源，而且依賴 land 的那一刻要有人負責去改寫它 —— 那是新的失效模式。
推導值同時讓 migration 真的是零：舊資料沒有 `dependsOnTaskId` 就永遠 `null`。

### D2 — 純邏輯放 `src/lib/task-dependency.ts`，不 import store

vitest 是 `environment: 'node'`、沒有 DOM harness，所以圖走訪與 gating 必須是純函數。
模組簽名一律吃 `tasks: Record<string, DependencyTask>` 這個明確參數，不去讀 `store`。
對照 `sidebar-order.ts` —— 它 import 活的 store，測試因此要整包 mock `./core`。
新模組不需要那層 mock，測試就是純資料進、純資料出。

`DependencyTask` 只宣告這段邏輯真的會讀的欄位（`name`/`branchName`/`landingState`/
`dependsOnTaskId`/`projectId`/`gitIsolation`），`Task` 結構上可指派過去。

### D3 — 走訪守衛：**迭代 + visited Set**，不用深度上限

`collectDependencyChain()` 用 `while` 迴圈而不是遞迴，並帶一個 `visited: Set<string>`。

- 迭代 → 不管鏈多長都不會爆 call stack（這是「不會無限遞迴」最強的保證形式）。
- visited Set → 環一定在第二次踩到同一個 node 時停，上界是 task 總數。

**刻意不加深度上限常數。** 深度上限會把一條合法的長鏈誤判成 truncated，
而 visited Set 已經給了 O(n) 的硬上界，深度上限只是多一個要調的魔術數字。

### D4 — 環：只做一個 `wouldCreateDependencyCycle()` 前置檢查，不做環檢測引擎 ⚠️ 後被 D10 推翻

依賴只在建立 task 時宣告、且必須指向一個**已存在**的 task，所以邊永遠指向較舊的 task，
結構上今天就不可能有環 —— 和 `coordinatedBy` 同一個論證。

但 `computeSidebarTaskOrder()` 的前例正是「安全純屬巧合」（深度上限是 1 才沒事）。
所以還是留一個 O(depth) 的前置檢查，以及一個 `'cycle'` blocked 原因，
讓壞掉的 persisted state 顯示可讀訊息而不是靜默卡住。這是一個函數，不是引擎。

### D5 — gate 在 **agent terminal spawn**，shell terminal 不 gate

`TerminalView.startSpawn()` 是現成的節流點，本來就有 `isLandedTaskState()` 的 early return，
把依賴 gate 放同一個地方。

**shell terminal（`props.isShell`）不 gate**：worktree 已經建好了，
使用者必須還能開 shell 進去看。gate 的是「agent 自動開跑」，不是「不能碰這個 task」。

### D6 — blocked 的解除動作放在被擋住的終端機上，不是藏在選單裡

TerminalView 疊一層 overlay（仿 `mcpStartupStatus === 'error'` 那層），寫出可讀原因
＋一顆 `Clear dependency` 按鈕呼叫 `clearTaskDependency(taskId)`。

理由：被擋住的 agent 終端機本來就是一片空白的黑框 —— 那正是使用者會盯著看、
會問「為什麼沒動」的地方。原因和解除動作必須出現在同一個畫面上，
否則就退回研究報告點名的「靜默 blocked」。
Sidebar badge 只負責在列表層級讓人看見，tooltip 帶完整原因。

### D7 — 訊息文案回傳 `{ text, params }`，不在純模組裡呼叫 `tr`

`tr()` 讀 `store.locale`，不是純函數。純模組回傳英文原文（就是 i18n 的 key）
加上參數物件，元件端再 `tr(msg.text, msg.params)`。
純測試因此可以直接斷言文案可讀，同時 zh-TW 仍然翻得到。

### D8 — MCP `createTask` tool 的參數表不動

Coordinator 建 sub-task 走的是 `electron/mcp/coordinator.ts`，它已經有 `baseBranch`
參數而且 LLM 已經在用。這一波的宣告點是使用者建 task 的路徑（NewTaskDialog → store `createTask`）。
在 MCP tool schema 上再開一個 `dependsOnTaskId` 是另一個表面，
而且 coordinator 的 `?? coordinatorBranch` 已經覆蓋了它的祖先需求。刻意不做。

### D9 — `closeTask` 一行都不改

`closeTask`（`tasks.ts:527-541`）的 detach 只碰 `coordinatedBy`/`controlledBy`/mcp 欄位。
要滿足決議 3（依賴被刪 → 保持 blocked），**正確的動作是什麼都不加**：
不去把 dependent 的 `dependsOnTaskId` 清掉。
但「靠沒寫程式碼來保證」是最容易在未來被人順手補上的那種保證，
所以補一個 store 層測試把它釘住。

### D10 — 刪掉 `wouldCreateDependencyCycle()`，環守衛留在走訪本身

原本寫了一個建立前的環檢查，後來刪掉。

依賴只能在建立 task 時宣告、之後只能解除，**沒有「改依賴」的入口**，
所以那個檢查對任何真實輸入都恆為 false —— 是佈景，不是防護。
永遠不會為真的檢查比不留更糟（也會被 knip 抓成死碼）。

環守衛因此留在真正需要它的地方：`collectDependencyChain()` 的 visited Set，
以及 `getDependencyBlock()` 的 `'cycle'` 原因。壞掉的 persisted state 會顯示可讀訊息，
而不是靜默卡住或無限迴圈。

## 結束摘要

### 做了什麼

一個 task 可以宣告一條依賴邊，這條邊同時餵給兩件事：**推導 base branch**（git 祖先）
與**擋住 agent 自動啟動**（排程）。

| #   | 東西                                     | 位置                                              |
| --- | ---------------------------------------- | ------------------------------------------------- |
| 1   | `dependsOnTaskId?: string`               | `src/store/types.ts` 的 `Task` 與 `PersistedTask` |
| 2   | 純圖／gating 邏輯（不 import store）     | `src/lib/task-dependency.ts`                      |
| 3   | 宣告點 + `resolveDependencyBaseBranch()` | `src/store/tasks.ts`                              |
| 4   | 解除動作 `clearTaskDependency()`         | `src/store/tasks.ts`                              |
| 5   | spawn gate + blocked overlay             | `src/components/TerminalView.tsx`                 |
| 6   | Sidebar blocked badge                    | `src/components/Sidebar.tsx`                      |
| 7   | 依賴選擇器                               | `src/components/NewTaskDialog.tsx`                |
| 8   | persist / hydrate                        | `src/store/persistence.ts`                        |
| 9   | zh-TW 文案 9 條                          | `src/lib/i18n.ts`                                 |

### 四道 gate

| Gate                   | 結果                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `npm run check`        | compile / typecheck / lint（`--max-warnings 0`）/ format:check 全綠                         |
| `npm run check:static` | knip 無死碼；`✔ no dependency violations found (461 modules, 1557 dependencies cruised)`    |
| `npm test`             | `Tests 2431 passed \| 26 skipped (2457)` —— base `be824e6` 是 2382／26，+49                 |
| `npm run check:bundle` | `renderer entry chunk: 1,237,838 B / 1,500,000 B budget — 82.5% used`（上限 90%，原 82.2%） |

`electron/ipc/git.ts` 對 base `be824e6` 的 diff 是空的 —— 一行都沒動。
git 祖先完全由「把依賴的 `branchName` 當字串塞進既有的 `baseBranch`」達成。

### 驗收對照

1. ✅ 四道 gate 全綠，2431 ≥ 2382，啟動 JS 82.5% < 90%
2. ✅ `collectDependencyChain()` 迭代 + visited Set；5000 節點長鏈測試不爆 stack，
   兩節點環／自環／1000 節點環都會終止
3. ✅ 依賴被刪 → 保持 blocked，`reason: 'missing'`，文案
   「Blocked — the task this one depends on was removed.」；
   store 層測試釘住「`closeTask` 之後 dependent 的 `dependsOnTaskId` 仍在」
4. ✅ 沒帶 `dependsOnTaskId` → `IPC.CreateTask` 收到的還是呼叫方選的 baseBranch，
   欄位維持 `undefined`，`getDependencyBlock()` 回 `null`
5. ✅ `git.ts` 未修改
6. ✅ commit 列明確路徑

### 使用者看到什麼

- Sidebar：task 名稱旁一顆橘色 `blocked` pill，`title` 帶完整句子。
- 被擋住的 agent 終端機：疊一層 overlay，寫原因 ＋「一旦落地，agent 會自己開始」
  （只在 `unlanded` 顯示）＋ 一顆「解除依賴並立即開始」。
- 三種原因：等待落地（帶依賴名字）／依賴已被移除／依賴鏈繞回自己。

### 刻意沒做

- 完整 DAG、多親、環檢測引擎（決議已排除）
- MCP `createTask` tool 不加 `dependsOnTaskId` 參數（見 D8）
- 「改依賴」UI —— 只能在建立時宣告、之後只能解除（見 D10）
- `gitIsolation: 'direct' / 'none'` 不做 base branch 代換（排程 gate 仍然生效）
- A 的 branch 在 B 分支後才變動的自動 rebase
- 跨專案依賴、讀 Huly 關聯
