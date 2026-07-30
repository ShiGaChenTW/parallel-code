# R1：Onboarding 三階段漸進揭露

**建立時間：** 2026-07-31 01:36
**最後更新：** 2026-07-31 02:00
**狀態：** 已完成（未 push）
**分支：** `feat/onboarding`（從 `main @ 92b17b2` 分出）
**worktree：** `/Users/scottchen/Documents/20_Projects/pc-feat-onboarding`

## 目標

PRD §13 Q2 已於 2026-07-31 裁決：**Coordinator 與 Arena 維持進階功能，
不成為 onboarding 主路徑。**

**現況**：這個 app 沒有 onboarding，只有空狀態。全部就是：

| 位置                   | 文案                                       |
| ---------------------- | ------------------------------------------ |
| `TilingLayout.tsx:482` | Link your first project to get started     |
| `TilingLayout.tsx:485` | A project is a local folder with your code |
| `TilingLayout.tsx:543` | No tasks yet                               |
| `Sidebar.tsx:698`      | No projects linked yet.                    |

Coordinator 是 `NewTaskDialog` 裡的一個 checkbox，Arena 在 `SidebarFooter`。

## 裁決理由（不要推翻，這是已定案的）

1. PRD 自己把 Arena 全部標為 **P2**；Coordinator 的 `FR-COORD-01`～`09` 幾乎都是 P0
   且大半在講失敗處理（MCP server 起不來、控制權切換失敗、token 越權）。
   把最難的失敗模式擺在新使用者面前是最容易流失的地方。
2. 產品核心價值（PRD §5.1）是「單一任務的 worktree 隔離」，第一次使用要成立的是這件事。
3. Coordinator 需要 MCP server + token wiring 才能啟動，是唯一會因環境問題整段失敗的路徑。

## 三階段

| 階段       | 觸發                     | 揭露什麼                                                 |
| ---------- | ------------------------ | -------------------------------------------------------- |
| 1 首次成功 | 尚未 merge 過任何 task   | 連結專案 → 建立一個 task → 看 diff → merge。其餘入口收起 |
| 2 平行     | 已完成第一次 merge       | 提示可以同時開多個 task（這才是產品名字的意思）          |
| 3 進階     | 已同時跑過 2 個以上 task | 才顯示 Coordinator 與 Arena 的說明入口                   |

## 範圍

做：

- 階段判定邏輯（**純函式**，放 `src/lib` 或 `src/store`）
- 進度狀態持久化（`state.json` 已有 rolling backup，沿用）
- 把既有空狀態串成序列

不做：

- **不引入 wizard 框架**，不加新依賴。entry bundle 只剩 13% 餘裕
- 不做互動式導覽（tooltip tour、遮罩、highlight ring 之類）
- **不移除任何既有入口** —— 「收起」是指不主動推薦，不是讓進階使用者找不到。
  已經在用 Coordinator／Arena 的人不該因為這個功能而失去入口
- 不改 `NewTaskDialog` 裡 coordinator checkbox 的行為本身

## 必須處理的既有使用者情境

這個 app 已經在用了，`state.json` 裡沒有階段欄位。**既有使用者不該被降級回階段 1。**
`PersistedState` 沒有 schema version，migration 走存在性／形狀檢查
（`persistence.ts:333-390`），新欄位對舊資料是 `undefined`。
所以階段判定要能從既有資料推得（例如已有專案／已有 task／已有 merge 計數，
`completion.ts` 有 merge 計數），而不是單純看一個新 flag 的預設值。

## Plan Steps

- [x] Step 1 — 盤既有訊號：專案數、task 數、merge 計數各在哪
- [x] Step 2 — 階段判定純函式 + 單測（含既有使用者不被降級的案例）
- [x] Step 3 — 持久化
- [x] Step 4 — 空狀態串接與階段 2／3 的提示
- [x] Step 5 — 四道 gate

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1717，entry bundle 不得超過 90%
2. 階段判定是純函式且有單測 —— vitest 是 node 環境，component 層測不到
3. 有測試證明「既有使用者（已有專案與 merge 紀錄）不會被判成階段 1」
4. 沒有任何既有入口被移除，只是不主動推薦
5. commit 列明確路徑

## 訊號盤點（Step 1 結果）

| 訊號                                       | 位置                                                      | 是否既有             | 用途                                         |
| ------------------------------------------ | --------------------------------------------------------- | -------------------- | -------------------------------------------- |
| `projects.length`                          | `store.projects`（`core.ts`）                             | 既有                 | 「有沒有連過專案」                           |
| task 數                                    | `Object.keys(store.tasks).length`                         | 既有                 | 現行同時開著幾個 task                        |
| `mergedLinesAdded` / `mergedLinesRemoved`  | `PersistedState`、`completion.ts:recordMergedLines`       | **既有且累計不重置** | 「有沒有 merge 過」的主要舊資料證據          |
| `completedTaskCount` + `completedTaskDate` | `PersistedState`、`completion.ts:recordTaskMerged`        | 既有但**每日重置**   | 只能證明「今天 merge 過」                    |
| `mergedTaskTotal`（新增）                  | `PersistedState`、`recordTaskMerged`                      | 新                   | 終身 merge 次數，補上零行 merge 與跨日的缺口 |
| `peakConcurrentTasks`（新增）              | `PersistedState`、`tasks.ts:initTaskInStore`、`loadState` | 新                   | 同時開過幾個 task 的高水位                   |
| `diffReviewed`（新增）                     | `PersistedState`、`DiffViewerDialog`                      | 新                   | 有沒有看過 diff（只餵 checklist 第 3 步）    |

被否決的候選訊號：

- **`completedTaskCount` 單獨當「有沒有 merge 過」** —— 每日重置，昨天 merge 的人今早會被判成階段 1。只當補充證據用。
- **`coordinatorModeEnabled` / `showArena`** —— 是偏好設定不是成就，而且預設 false 對舊資料同樣是 `undefined`，無法區分「沒用過」與「舊資料」。
- **`taskOrder.length`** —— 裡面混著 terminal（`persistence.ts` 的 filter 是 `s.tasks[id] || s.terminals[id]`），會把純終端機算成 task。改用 `store.tasks` 的 key 數，active 與 collapsed 都在裡面。
- **新增一個 `onboardingStage` 欄位直接存階段** —— 這正是 PM 點名的地雷：舊資料讀到 `undefined` 就會退回階段 1。

## 決策紀錄

1. **階段用推導、不用存欄位。** `PersistedState` 沒有 schema version，migration 靠存在性檢查，任何新欄位對舊資料都是 `undefined`。所以 `deriveOnboardingStage()` 的輸入全部是「既有欄位」或「即時 store 讀值」，三個新欄位只會往上抬階段、不會往下拉。舊使用者是被他自己的歷史判定的，不是被新欄位的預設值判定的。

2. **「有沒有 merge 過」用四個證人的聯集。** 沒有任何單一訊號是完整的：`mergedTaskTotal` 準但這版才開始寫；`mergedLines*` 是既有累計值，但 `recordMergedLines` 對零行 merge 會 early return；`completedTaskCount` 是既有值但跨日歸零。任一個成立就算數 —— 這個聯集就是「舊使用者不被降級」的實作核心。

3. **並行高水位取 `max(已存高水位, 現行 task 數)`。** 兩個理由：舊使用者的高水位欄位不存在，但他螢幕上開著三個 task 本身就是證據，升級後第一次啟動就能直接到階段 3；反過來，關掉一個 task 不該把人從階段 3 打回階段 2，所以高水位只增不減（`nextPeakConcurrentTasks`）。

4. **階段 3 額外要求「merge 過」。** 這是我一度想反過來的判斷 —— 原本想「開過 2 個 task 就給階段 3」，後來改掉：Coordinator 與 Arena 都是建立在「task 產出 diff → review → merge」這個迴圈之上，對還沒走完一次迴圈的人推薦它們，正是這個功能要防的流失點。代價是「開了 2 個 task 但從沒 merge 過」的人會停在階段 1，我接受，因為對他來說「先 merge 一次」確實才是下一步。階梯因此是有序的：所有階段 3 的人都同時滿足階段 2 的條件。

5. **checklist 第 3 步「看過 diff」需要新訊號，因此掛在 `DiffViewerDialog` 而不是三個呼叫端。** 從變更檔案清單、commit 檢視、Arena 進來的 diff 都算同一件事，寫在 dialog 本體只有一處、也不會漏。只在第一次轉換時寫入，不吵醒 autosave。

6. **不移除任何入口，階段只做加法。** Arena 按鈕在 `SidebarFooter` 的位置、樣式、行為完全沒動，任何階段都在；`NewTaskDialog` 的 coordinator checkbox 一行都沒改。階段 3 唯一做的事，是在 Arena 按鈕上方**多加**一段說明文字。所以「收起」在這裡的實作是「在階段 3 之前不解說、不推薦」，而不是「藏起來」。

7. **不做 wizard、不加依賴。** entry chunk 只剩 13% 餘裕，`check:bundle` 會擋。實際成本是純函式 + 一個 dumb component + 8 條翻譯，entry 從 87.1% 到 87.5%。

8. **`saveState` 對三個新欄位用 `|| undefined`。** 沿用檔案裡既有慣例，值還是 0／false 時整個欄位不寫進 `state.json`，新安裝的檔案內容維持不變。

9. **測試踩到的坑（記下來免得下次再踩）：** `persistence.test.ts` 的 `beforeEach` 用 `setStore('tasks', {})` 清 task，但 solid store 對物件是 merge 不是 replace，key 其實沒被清掉，導致跨測試殘留 3 個 task 汙染階段判定。新的 describe 自帶一個用 `produce` 硬清的 `beforeEach`。

## 結束摘要

**做完了什麼**

- `src/lib/onboarding.ts`：純函式階段判定（`deriveOnboardingStage`、`onboardingSteps`、`nextPeakConcurrentTasks`），零 import，node 環境可測。
- `src/store/onboarding.ts`：把 store 投影成 `OnboardingSignals` 的反應式讀取層，外加 `recordDiffReviewed`。
- 持久化：`PersistedState` / `AppStore` 各加三個欄位（`mergedTaskTotal`、`peakConcurrentTasks`、`diffReviewed`），`loadState` 解析＋以還原的 task 數補種高水位，`saveState` 回寫。
- UI：`OnboardingChecklist` 新元件；`TilingLayout` 兩個空狀態接上階段 1 checklist 與階段 2 平行提示；`SidebarFooter` 階段 3 加 Coordinator／Arena 說明。
- 測試 +34：`src/lib/onboarding.test.ts`（24）、`src/store/completion.test.ts`（3）、`persistence.test.ts` 新增 7 條走真實 `loadState` 的舊資料案例。

**四道 gate**

| Gate                   | 結果                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm run check`        | `All matched files use Prettier code style!`（compile／typecheck／lint 皆過） |
| `npm run check:static` | `✔ no dependency violations found (417 modules, 1379 dependencies cruised)`   |
| `npm test`             | `Tests  1751 passed \| 24 skipped (1775)`（基準 1717／24）                    |
| `npm run check:bundle` | entry `87.5%`、dist total `85.0%`（上限 90%）                                 |

**沒做的事**

- 沒有互動式導覽、沒有遮罩或 highlight ring —— 明確在範圍外。
- 沒有把 Coordinator／Arena 從任何地方拿掉，也沒改 coordinator checkbox 行為。
- 沒有加 IPC channel，所以 `channel-manifest.json`、`preload.cjs` 的 `ALLOWED_CHANNELS` 都沒動。
- 沒動 `src/App.tsx` 的 `.css` import 區塊。
- 沒有「重新開始 onboarding」的設定開關 —— 需要一個新的重置動作與 UI 位置，超出這次範圍。
