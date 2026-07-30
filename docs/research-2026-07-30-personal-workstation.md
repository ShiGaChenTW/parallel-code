# 研究報告：把 Parallel Code 改造成「更好的個人平行開發工作站」

> 研究日期：2026-07-30 ｜ 基準：`v1.13.0`，branch `custom/theme-system`，commit `fd77bd2`
> 方法：六隻子 agent 平行研究六個命題，全部要求 file:line 證據；主 agent 逐項抽查驗證後彙整
> 狀態：研究完成，可行性評估已附，**尚未實作任何程式碼**

---

## 摘要：一句話結論

**這六個提案裡有五個的底層機制已經存在，缺的是「接出來」，不是「造出來」；一個應該直接砍掉。**

最極端的例子：終端輸出的 scrollback ring buffer 已經實作、已經在跑、而且**已經透過 remote server 給手機看了**（`electron/remote/server.ts:939`）——但桌面 app 自己看不到，因為 `electron/ipc/channel-manifest.json` 裡沒有對應的 channel。這不是功能缺口，是接線缺口。

因此本報告的核心建議是：**按「已建成度」排序，而不是按提案順序排序。** 先把已經付過成本的東西接出來，再考慮新建。

---

## 一、總表

| #   | 命題                                               | 已存在程度   | 可行性     | MVP 成本                   | 完整版成本 | 判斷                                          |
| --- | -------------------------------------------------- | ------------ | ---------- | -------------------------- | ---------- | --------------------------------------------- |
| 6   | Session transcript + 事件 timeline                 | **高**       | Medium     | **1–2 天**                 | 5–8 天     | ✅ **先做，ROI 最高**                         |
| 1   | Agent profile（Planner/Researcher/Coder/Reviewer） | **高**       | Medium→Low | **1–2 天**                 | —          | ✅ 做，但**不要**做成 enum                    |
| 3   | Task dependency graph                              | **高**       | Medium     | 4–6 天                     | 8–12 天    | ⚠️ 只做「單一依賴」，**不要 DAG**             |
| 4   | Agent-to-Agent message                             | 中（不對稱） | Medium     | 2–4 天                     | 4–8 天     | ⚠️ 做 relay，**不要** mailbox；有既存安全問題 |
| 2   | Notes 分層（4 層）                                 | 中           | Medium     | 1.5–2.5 天（只做 Handoff） | 4–6 天     | ⚠️ **只做 Handoff 一層**                      |
| 5   | 可選 shared workspace                              | **已 ship**  | Low        | 3–5 天但無淨價值           | —          | ❌ **不要做**                                 |

---

## 二、逐項評估

### 6. Session transcript 與事件 timeline — ROI 最高，優先做

**已存在（驚人地多）**

- `electron/ipc/trace.ts`（114 行）已經 patch `ipcMain.handle`，記錄每一次 IPC dispatch 的 channel 與 ok/err。設計是 **default-deny**：`SAFE_FOR_TRACE` 是空集合（`trace.ts:17`），另有 `NEVER_SAFE` 白名單反向斷言（`trace.ts:24`，含 `WriteToAgent`、`AskAboutCode`、`SaveAppState`、`SetMinimaxApiKey`），module init 時就 assert。production 下 `minLevel = 'warn'`，所以這個 tracer 實質是 no-op。
- `electron/remote/ring-buffer.ts`：固定 64KB ring buffer（`capacity = 64 * 1024`），`pty.ts:350` 每批寫入，`getAgentScrollback()` 於 `pty.ts:590` 讀出。**已被 coordinator（`coordinator.ts:307,1300`）和 remote server（REST `/api/agents/:id`、WS on-connect）消費，但桌面 renderer 完全拿不到** — manifest 裡沒有 scrollback channel（已驗證）。
- `StepEntry`（`electron/ipc/shared-types.ts:124`）已經是**結構化、帶時戳的事件陣列**：`{summary, detail?, next?, status, files_touched?, agent_id?, timestamp}`，status 有 6 個階段。存在 `task.stepsContent`，但**沒有進 `persistedSnapshot()`**（已驗證：`autosave.ts` 查無 `stepsContent`）→ 重啟即失。
- `scripts/check-coordinator-run.mjs` + `npm run check:coordinator-log`：**不是 app 功能**，是 dev 分析腳本，regex 解析 console log 找 spawn/prompt 順序 bug。但它證明 console 流裡**本來就有 timeline 形狀的事件**。
- **既有落地先例**：`PRIVACY.md:27` — Arena 的每場終端輸出已持久化到 `arena-history.json`（app data dir，使用者可刪）。這正是本功能需要的先例形狀。

**既有事件詞彙**（timeline 可直接消費，不必新造）：`StepEntry` 六階段、attention 轉換（`desktopNotifications.ts:15-21` ready/needs_input/error）、merge 計數（`completion.ts`）、PR/CI 輪詢（`pr-changes.ts`/`pr-checks.ts`）、commit 狀態（`task-commit-polling.test.ts`）。

**真正的缺口**：沒有任何元件把「帶時戳、可重播的生命週期序列」落到磁碟；agent 輸出除了那 64KB 記憶體 ring 之外沒有留存。零件都在，只是全都是 live/ephemeral。

**儲存設計**：**不要**用 `persistence.ts` 那個 blob — 它是單一 JSON 文件、每次 debounce（1s）整份 temp+rename 重寫；把無界 transcript 塞進去會讓每次 autosave 膨脹並在 crash 時有損毀風險。正解是 **per-task JSONL**：`<userData>/transcripts/<taskId>.jsonl`，append-only（便宜、crash-safe、可串流給 remote client），配 rotation（事件數上限或時間窗）。**絕不寫進使用者的 worktree** — 留在 `userData` 就完全不必處理 gitignore。

**隱私要求（硬性）**：opt-in、預設關閉（跟隨 `trace.ts` 的 default-deny 姿態）；`PRIVACY.md` 必須新增條目（照 Arena 那條的形狀）；transcript 含原始碼與可能的密鑰 → 要嘛做 redaction pass、要嘛明文聲明未 redact；要有 Settings 的「清除 transcript」動作。

**MVP（1–2 天）**：不要先造 transcript 系統，先**把已有的接出來** —

1. 把 `task.stepsContent` 加進 `persistedSnapshot()`（`autosave.ts` 一行）＋ restore 路徑
2. 新增 `GetScrollback` IPC channel（manifest + enum + `preload.cjs` 三處鎖步），把已存在的 `getAgentScrollback()` 開給桌面 renderer

這樣就同時得到「發生了什麼」（StepEntry 敘事）和「輸出了什麼」（scrollback），幾乎沒有新機制。

**完整版 5–8 天**：6 個偵測模組的事件發射點、JSONL writer/reader、retention、PRIVACY.md、Settings 開關、remote endpoint、timeline UI。

**測試**：`electron/ipc/transcript.test.ts`（JSONL round-trip、rotation、壞行容錯，仿 `log.test.ts` 的純函式風格）；`persistence.test.ts` 擴充 `stepsContent` round-trip；`preload-allowlist.test.ts` 自動守住三處鎖步。

**未決問題**：rotation 政策（事件數 vs 時間窗）；redaction 時機（寫入前 vs 匯出時）；worktree 被刪後 transcript 是否保留（Arena 的答案是保留）；opt-in 粒度（全域 vs per-task）。

---

### 1. Agent profile：Planner / Researcher / Coder / Reviewer — 做，但不要做成 enum

**已存在**

- `AgentDef`（`electron/ipc/shared-types.ts:8-22`，已驗證）：`id / name / command / args / resume_args / skip_permissions_args / description / available? / prompt_ready_delay_ms? / mcp_config_flag?`。沒有 role 欄位，**但 `args: string[]` 是一個自由的 flag 袋子**。
- args 直達 spawn，零額外接線：`pty.ts:250-256`（`buildPtySpawnSpec`）把 `args.args` 原樣當 `spawnArgs`。而 `electron/ipc/ask-code.ts:73` **已經在 production 用 `--append-system-prompt`**（已驗證）→ 用 CLI flag 注入角色 system prompt 的機制**已被驗證可行且有先例**。
- **使用者自訂 agent 已是 shipped 功能**：`CustomAgentEditor.tsx:22-30` → `addCustomAgent`（`agents.ts:143-150`）→ `store.customAgents`（持久化，`types.ts:267`）→ 併入 `availableAgents`（`agents.ts:14,162-167`）。
- **通用 preamble 注入機制已在 production 運作**：`electron/mcp/preamble.ts:82` `injectSubTaskPreamble` 依 agent command 選策略 — codex/opencode 用 `AGENTS.md`、gemini 用 `GEMINI.md`、copilot 用 `.agent.md`、Claude 用 `.claude/settings.local.json` 的 systemPrompt 欄位。**這正是角色 system prompt 需要的注入點，而且已經 agent-command-aware。**
- **coordinator 內部 `createTask` 已接受 per-subtask agent override**：`coordinator.ts:773-780`（`agentCommand?`、`agentArgs?`）、`:869`（`opts.agentCommand ?? spawnDefaults.command`）。**能力在後端已存在，只是沒從 MCP tool 接出來。**
- 多 agent per task 已是資料模型：`Task.agentIds: string[]` + `selectedAgentId`（`types.ts:101-102`）、`savedAgentDefs?: AgentDef[]`（`:127`）。
- **「角色決定工具面」已有先例**：`mcp-tool-list.ts:185` `selectTools(taskId, coordinatorId)` 依呼叫者身分給不同工具集 — 但這個 role 是結構性的（sub-task vs coordinator），不是 Planner/Coder 這種類型學。

**真正的缺口**：`create_task` 的 MCP schema（`mcp-tool-list.ts:54-74`）只開了 `name`/`prompt`/`baseBranch`，沒把 `coordinator.createTask()` 已支援的 `agentCommand`/`agentArgs` 轉出去（`server.ts:51-56` 硬寫）。**這是純接線，不是架構。** 另外沒有 role→指令 的映射，`SUB_TASK_PREAMBLE` 對所有 sub-task 都是同一段文字。

**可行性 Medium 偏 Low**。關鍵：這**不需要新增 IPC channel** — `create_task` 是 MCP tool schema（`mcp-tool-list.ts` 的 JSON + `server.ts` 一個參數轉發），不是 Electron IPC channel，所以三處鎖步與 `preload-allowlist.test.ts` 都不適用。也不碰 dependency-cruiser 邊界。`environment: 'node'` 在這裡是**優勢** — 所有實質邏輯（schema、preamble 文字、coordinator dispatch）本來就用純 vitest 測。

**MVP（1–2 天）**：**跳過正式的 role 型別。**

1. 在 `create_task` schema 加 optional `role?: string` + `roleInstructions?: string`，**不要 enum**，描述寫成自由文字（例：`"Reviewer — read-only, do not edit files"`）
2. `server.ts` 的 `create_task` case 把參數轉進 `client.createTask({...})`
3. `coordinator.createTask` 在有 role 時把它前置到 `SUB_TASK_PREAMBLE` 之前，存成 `initialPrompt`（`coordinator.ts:852`）— 重用既有字串串接，不需要新注入機制

刻意不做：per-role 工具限制（要動 `selectTools`，明顯更大）、`AgentDef` 上的 role 欄位（**role 是 per-task-instance 概念，不是 per-agent-binary 概念**）、`NewTaskDialog` UI 改動（role 只在 coordinator 生成的 sub-task 有意義）。

**成本 1–2 天**：`mcp-tool-list.ts`、`server.ts`（~5 行）、`coordinator.ts`（~10 行）、`coordinator.test.ts` 與 `mcp-tool-list.test.ts` 加案例。前端零改動。

**需要你決定**：role 要是固定 enum（Planner/Researcher/Coder/Reviewer，出現在 UI/設定）還是 coordinator 即興的自由文字（MVP）？提案標題暗示固定類型學，但**固定 enum 意味著要做 role→工具權限 映射，那會動到 `selectTools`，範圍大得多**。

**其他風險**：非 Claude agent 的 preamble 注入會寫 `AGENTS.md`/`GEMINI.md`/`.agent.md` 進 worktree 並被 diff/strip（`preamble.ts:186-334`）；MVP 走 prompt 前置可完全避開這條檔案路徑。另外 coordinator LLM 是否真的會有意義地使用 role 欄位，**未經驗證，純屬建議性**。

---

### 3. Task dependency graph — 只做「單一依賴」，不要 DAG

**已存在（比想像的多）**

- `coordinatedBy?: string` + `controlledBy?: 'coordinator' | 'human'`（`types.ts:143-144`）已是**可用的一層依賴樹**（單親指標，無多親、無任意邊）。
- `sidebar-order.ts:13-41` `getCoordinatorChildren()` / `isCoordinatedChild()` 是既有的樹遍歷；`sidebar-order.test.ts:49-83` 是**純圖邏輯 node 測試的現成範本**。
- **排程已有**：`coordinator.ts:1186-1230` `waitForIdle(taskId)`、`:2390-2430` `waitForSignalDone()`，配 `signalDoneAt`/`signalDoneConsumed`（`types.ts:149-151`）。`coordinator-sequence.test.ts:26-54` 展示完整生命週期：create → wait_for_idle → signal_done → wait_for_signal_done → close。
- **git 祖先已有**：`coordinator.createTask()` 的 `baseBranch = opts.baseBranch ?? coordinatorBranch` — sub-task 預設從 coordinator 的 branch 開，而 `opts.baseBranch` 是呼叫方可指定的、只過 `validateBranchName`。**這意味著把任何既有 task 的 `branchName` 當 `baseBranch` 傳進去，今天就能產生「B 從 A 分支」的祖先關係，零 schema 變更。** 機制在 `git.ts:762-793`（`git worktree add -b <branch> <path> <baseBranch>`）。
- **刪除語意已有先例**：`tasks.ts:458-467` `getCoordinatorCloseWarning`、`:527-541` `closeTask` — 關掉 coordinator **不 cascade 刪除也不阻擋**，而是把 children **detach**（`coordinatedBy` 設 undefined），讓它們變獨立 task。

**最重要的區分：排程 vs git 祖先**

一條依賴邊在 worktree-per-task 的 app 裡有**兩種意義，絕不可混用**：

| 意義                                                | 現狀                                                                                                            | 成本     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| **(a) 排程** — A 沒好前不要開始 B                   | 大致已有（`waitForIdle`/`signalDone`），但只在 coordinator↔直屬 child 之間，不能跨 sibling 或跨 coordinator     | 便宜     |
| **(b) git 祖先** — B 從 A 的 branch 開，不是從 base | **完全已有**，`baseBranch` 是純字串欄位，已貫穿 `createWorktree`、`NewTaskDialog.tsx:975/1285`、`tasks.ts` 多處 | 幾乎為零 |

真正缺的是**在 `Task` 上「宣告」這條邊**，並讓 UI/排程器自動執行 — 今天這件事是**靠 coordinator LLM 用自然語言 prompt 工程手動排序**（`NewTaskDialog.tsx:1101-1102` 的提示文字字面寫著 "Use `<branch>` as the baseBranch for all sub-tasks"）。是 agent 即興，不是資料模型。

**真正的缺口**：`rg dependsOn|blockedBy` 在 `src/`+`electron/` **零命中**（已驗證）。缺：peer 依賴欄位、依賴未完成即不可啟動的強制、非 coordinated task 間的宣告/視覺化 UI、依賴完成與 `LandingState` 的 gate。

**環路處理**：現況 `coordinatedBy` 是嚴格一層單親指標，**結構上不可能有環**。`computeSidebarTaskOrder()`（`sidebar-order.ts:79-99`）只做一次有界深度查詢、**沒有遞迴防護** — 安全純粹因為深度上限是 1。一旦改成真正的 DAG，就要引入拓撲排序/環檢測，那是**全新邏輯、全新測試、全新失敗模式**（建立時拒絕環），codebase 目前任何地方都沒有。

**可行性 Medium**。原語（`baseBranch`、`waitForIdle`、完成訊號、detach-on-delete）全都在且經過實戰，風險低；但**通用 DAG**（多親、環檢測、跨 coordinator）是與現行嚴格樹**本質不同**的資料模型。

**MVP（4–6 天）**：**不要做完整 DAG。**

1. `Task` 加 `dependsOnTaskId?: string`（**單一依賴，不是陣列**）— 對齊 `coordinatedBy` 的單親形狀，繞開環檢測（只需一個 O(depth) 的鏈走訪守衛，類比 `getCoordinatorChildren`）
2. 建立 task 時若有 `dependsOnTaskId`，`baseBranch` 預設為該 task 的 `branchName`（同 `coordinator.ts` 的 `?? coordinatorBranch` 模式）→ `git.ts` 完全不動
3. agent 自動啟動（**不是** worktree 建立）gate 在依賴到達 `isLandedTaskState()`（`landing.ts:3-7`）— 重用既有 helper
4. Sidebar 顯示 "blocked" badge（仿 `SubTaskStrip.tsx:140-149` 的 landing-state badge），**不做新的樹狀嵌套**

這拿到約 80% 價值（排序 + 正確祖先），重用四個已測子系統，而不是自造 DAG 引擎。完整 DAG 約 8–12 天，換一個目前**沒有證據需要**的用例。

**需要你決定**：依賴的 task 被刪除時，dependent 該自動 detach（立刻從 base 開始）還是保持 blocked/orphaned？（既有先例 `tasks.ts:458-467` 是 detach。）另外：gate 在 `landingState`（task 內部 review pipeline）還是「目標 branch 真的 merge 進 base」？這是**兩種不同的保證**，而 `Task` 目前只追蹤前者。

**未決風險**：A 的 branch 在 B 已分支後才變動時的 rebase/衝突語意（`git.ts:1867` `rebaseTask` 存在但沒接自動觸發）；跨專案依賴是否允許。

---

### 4. Agent-to-Agent message — 做 relay，不做 mailbox；**並且有既存安全問題要處理**

**已存在（不對稱）**

MCP 工具面（`mcp-tool-list.ts`，已驗證工具名清單）分兩組，由 `selectTools(taskId, coordinatorId)`（`:185`）選擇：

- **`SUBTASK_TOOLS`**（`:9-51`）：跑著的 sub-agent **只有兩個工具** — `land_self`、`signal_done`。雙重強制：tool-list 層 + `server.ts:26-36` `handleMCPToolCall` 對 taskId-scoped 呼叫者拒絕任何其他 tool name。
- **`COORDINATOR_TOOLS`**（`:53-178`）：`create_task`、`list_tasks`、`get_task_status`、`send_prompt`、`wait_for_idle`、`get_task_diff`、`get_task_output`、`merge_task`、`close_task`、`wait_for_signal_done`。

`send_prompt`（`coordinator.ts:1037-1070`）是實際投遞機制：把文字寫進目標 sub-agent 的 PTY，經 `pty.ts:506-510` 的 `writeToAgent`（`session.proc.write(data)`）——**與人類 UI 用的同一個底層原語**（`PromptInput.tsx:736`、`tasks.ts:185`）。`writeToAgent` 本身**沒有呼叫者身分檢查**。

**是否已經 ship？部分，且不對稱 —— 不是提案描述的對稱式 agent↔agent。**

現存的是嚴格的 **hub-and-spoke coordinator→sub-task 單向通道**。證據：`SUBTASK_TOOLS` 裡沒有任何 `send_prompt` 等價物，`handleMCPToolCall` 硬擋 sub-task 呼叫其他工具。跑著的 sub-agent **在 MCP 層完全無法**用自由文字訊息另一個 sub-agent 甚至自己的 coordinator ——它唯一的對外訊號是二元的「我完成了」（`signal_done`）或「我落地了，這是驗證」（`land_self`）。

所以：**coordinator→單一 task 訊息約 90% 已 ship**（投遞、排隊、就緒 gate、測試全在）；**真正的 agent↔agent 在 MCP 層 0% 已 ship**。

**投遞時機（這塊最接近完成）**

契約：**絕不寫入非靜止狀態的 PTY**，因為生成中的輸入會弄壞狀態或被 CLI 默默吞掉。既有原語：

- `getAgentPromptReadiness()`（`electron/shared/prompt-detect.ts:73-98`）→ `ready | startup_or_dialog | busy | no_prompt`，tail-pattern 判定，`tryDeliverInitialPrompt` 與 `sendPrompt` 都用它
- coordinator 側：`writingPromptTaskIds` mutex（`coordinator.ts:1055,1062`）、`pendingPrompts` FIFO（上限 32，`MAX_PENDING_PROMPTS`）、64KB 上限（`MAX_PROMPT_BYTES`）、以及 `controlMap.get(taskId) === 'human'` 讓位 —— **人類正在打字時自動化 prompt 會排隊而非碰撞**
- renderer 側對應物：`PromptInput.tsx` 的 autofire（`QUIESCENCE_POLL_MS = 500`、`PROMPT_VERIFY_POLL_MS = 250`）

**任何 agent-to-agent 功能都應重用這套，不要另造時序邏輯。**

**安全評估（本報告最重要的單一發現）**

已防護：header 注入（`server.ts:256-263`，`--task-id`/`--coordinator-id` 拒絕換行）、coordinator 冒充（`remote/server.ts:407-415`，body 的 `coordinatorTaskId` 必須與已驗證的 `X-Coordinator-Id` header 相符）、branch name 的 shell metacharacter（`validation.ts` 完整 `check-ref-format` 子集）、per-task-class bearer token。

**未防護：`prompt` 的內容本身。** `send_prompt`/`create_task` 只驗長度與非空，**沒有**對 shell metacharacter、ANSI escape、注入指令做任何掃描，文字原樣寫進另一個 process 的 stdin。後果：若 Task A（coordinator）吃進了不可信內容 —— 例如在自己 repo 讀到惡意檔案，或透過 `get_task_output`/`get_task_diff` 從被污染的 Task B 拿到攻擊者可控文字 —— **沒有任何東西阻止那段內容經 `send_prompt` 原樣轉進 Task C 的終端，在那裡被當作對 CLI 的字面按鍵解讀**（可能觸發工具呼叫、shell 指令，或在 Task C 設定寬鬆時自動接受核准對話框）。

**bracketed-paste 不是安全邊界**：`bracketedPasteAgentIds` 包裹（`coordinator.ts:1126-1128`）的目的是阻止**目標的行編輯器**把貼上的換行當成立即 Enter，防的是誤送多行，**不是惡意控制序列注入** —— 原始 bytes 仍然寫進 PTY。

**權限提升向量**：`writeToAgent`（`pty.ts:506`）**完全沒有 per-caller 授權**，它信任任何持有有效 coordinator bearer token 的人。若擴充成讓 sub-task 指定任意 `taskId`，就等於讓一個 task 能驅動**工作區內任何其他 task**。

必要緩解：(1) 對轉發文字做內容層清理 —— 至少 strip ANSI/控制序列，**重用 `prompt-detect.ts:2` 的 `stripAnsi`，coordinator.ts 已經 import 它**；(2) 明確 provenance 標記，讓接收 agent 的 transcript 顯示「來自 Task B」而非與人類輸入無從區分；(3) 任何新 send 能力都必須 scope 在既有 coordinator/child 所有權圖內，**絕不 task→任意 task**；(4) 既有的 `MAX_PENDING_PROMPTS`/`MAX_PROMPT_BYTES` 要延伸到新路徑。

> ⚠️ **注意：上述「未防護」是現行程式的既存狀態，不是新功能引入的。**
>
> 📌 **決議 7 把它變成前置條件。** 原本的判斷是「即使不做這個提案，也值得單獨評估」。但 Scott 決定開放 sub-task 上行請求 relay，代表 sub-task 讀到的任何內容都能往上送、再被 coordinator 轉給第三個 agent。因此補 `stripAnsi` + provenance 標記**必須在 `relay_to_task` 與 `ask_coordinator` 之前完成**，不是選配。

**可行性**：擴充 coordinator→child = High（近乎免費）；真正 peer-to-peer = Low–Medium，因為要解跨 task 授權與內容 provenance，而那在今天完全不存在。

**MVP（2–4 天）**：不要造 message bus。

1. 加一個 `relay_to_task` **coordinator** 工具（或給 `send_prompt` 加 optional `fromTaskId`），讓 coordinator 一次呼叫就把一個 child 的 `get_task_output`/`get_task_diff` 推進另一個 child，payload 經 `stripAnsi` 清理並前置固定 provenance 標記（如 `[relayed from task:<name>]`）
2. 100% 重用既有就緒/排隊/鎖定機制
3. **明確不要**把新工具加進 `SUBTASK_TOOLS`

> 📌 **決議 7 推翻了第 3 點**：Scott 決定 sub-task **可以**請求 relay，但必須是**間接**的 `ask_coordinator(text)`（只能往上，不能橫向）。因此 `stripAnsi` + provenance 從建議升級為**前置條件**，成本從 2–4 天升為 **5–8 天**並分兩步。詳見第五節決議 7。

**成本 2–4 天**：`mcp-tool-list.ts`（schema）、`server.ts`（新 case）、`coordinator.ts`（`relayToTask`）、`client.ts` + `remote/server.ts`（REST route + token-class scoping）、測試約 1–1.5 天。**不需要新 IPC channel** → 三處鎖步不適用。完整 peer-to-peer mailbox 約兩倍，成本由授權/provenance 設計主導，不是接線。

**需要你決定**：sub-task 是否該能**請求** relay（例如 `ask_coordinator`，由 coordinator 路由）？MVP 假設不行，以避開授權問題。另：provenance 格式對接收 CLI 是否安全 —— 純文字前綴本身可能被目標 agent 誤讀為指令，要用 `coordinator-real-agents.integration.test.ts` 對真實 CLI 驗證。

**未驗證**：`.semgrep/` 是否有「原始 PTY 寫入不可信內容」這類規則。建議出貨前用 security-review 確認。

---

### 2. Notes 分層：Scratchpad / Decision / Context / Handoff — 只做 Handoff 一層

**已存在**

- `Task.notes: string`（`types.ts:108`）+ `PersistedTask.notes`（`:176`），每次 autosave 持久化（`autosave.ts:57`），`persistence.ts:126,655,759` 還原。
- **notes 的 remote/mobile 存取已端到端可用**：`remote/server.ts:848-897` 的 `GET/PUT /api/mobile/notes/:taskId`，有 token class 守衛（僅 mobile/paired，coordinator/subtask 403）、100KB 上限（`MAX_NOTES_BYTES`）、對畸形 percent-escape 與 `__proto__`/`constructor`/`prototype` task ID 的防禦（`:855-866`）。它呼叫 `opts.getTaskNotes/setTaskNotes`（`:672-675`），由 `register.ts:1217-1226` 接到 **renderer round-trip**（`IPC.Remote_GetNotesRequest`/`Remote_SetNotesRequest`）—— **notes 只活在 renderer store，main process 不直接讀寫**。`notes-route.test.ts` 227 行 / 15 案例。
- **Steps 是最接近的結構化類比，而且是可完整照抄的 pattern**：`StepEntry` 存在 worktree 的 `.claude/steps.json`（**檔案，不是 app state**），`electron/ipc/steps.ts` 目錄監看 + 200ms debounce（`:149-209`）、host-clock 時戳補印（`applyTimestamps`, `:51-77`）、容忍 JSON 陣列/單物件/JSONL 三種形式（`parseStepsContent`, `:88-107`）、自動註冊 gitignore（`ensureStepsIgnored`, `:130-134`）。但 `steps.test.ts` 只有 43 行，僅單測 `parseStepsContent`。
- Plans 也是檔案而非 app state，監看 `.claude/plans/` 與 `docs/plans/`，3s poll 等目錄出現（`plans.ts:20,140-166`）。`PlanViewerDialog.tsx:105-119` 只在真的有 `.mermaid-block` 時才 lazy import mermaid —— **這是「重物只在需要時載入」的好先例**。
- **coordinator 已在非正式地傳遞自由文字**：`create_task` 的 `prompt`、`send_prompt` 的 `prompt`（`mcp-tool-list.ts:61-100`）；`land_self` 的 optional `summary`（`:37-40`）被存成 `task.landingSummary`/`landedMetadata.summary`（`coordinator.ts:1595,1631,1649`）—— **這已經就是一則 handoff note**，只是由 LLM 編排、綁在 landing 事件上，不是下一個 agent 會自動讀的持久欄位。

**真正的缺口**：沒有結構化多層 note 儲存（無 `handoffContent`/`decisionLog`/`contextNotes` 的型別/channel/持久化/UI），也沒有「一個 task 的文字自動成為另一個 task 的輸入」的機制 —— `send_prompt`/`create_task` 要 coordinator（LLM）手動複製。

**Migration 成本：低（只要是純新增）**。已驗證：`PersistedState`/`LegacyPersistedState` **完全沒有 schema version 欄位**（`persistence.ts:333-390`），migration 走「存在性/形狀檢查」（如 `showSteps → defaultStepsEnabled`，`persistence.test.ts:804-826`；`panelSizes → panelUserSize` v2 flag，`persistence.ts:275-296`）。**新增欄位對舊資料就是 `undefined`，零 migration。** 只有把 `notes` 本身改成物件才要付錢（`loadState()` 加一個 string→object 強制分支，~20–30 LOC，仿 `defaultDirectMode → defaultGitIsolation`，`persistence.ts:430-435`）。

**可行性 Medium**，成本來自廣度而非深度：四層 ×（型別 + IPC 三處鎖步 + 持久化 + UI + remote route）在一個強制 `no-explicit-any`、dependency-cruiser、allowlist 測試的 codebase 裡會乘出很大的面積。

**MVP（1.5–2.5 天）：只做一層 Handoff。四層不划算。**

> 📌 **決議 5 修正了儲存形式**：不是 `handoffContent?: string` 欄位，而是 `.claude/handoff.md` 檔案 —— 因為決議 7 選了「agent 之間直接傳遞」，handoff 就是 agent 寫的，而 agent 寫檔案不需要學新工具。詳見第五節決議 5。

理由有證據：Decision 與 Context 的持久化**已經有家**（`notes` 本身、或 `landingSummary`），而提案自己陳述的動機用例明確是 Handoff 流。單一 `Task.handoffContent?: string`（完全對齊 `planContent?: string`，`types.ts:130`）加一個 remote route 加一個持久化欄位，就把「一個 agent 的結構化輸出」變成「下一個 agent 的輸入」—— **今天唯一被驗證的消費者**。Scratchpad/Decision/Context 三層**目前沒有任何程式碼會讀它們**。

**成本**：`types.ts`（×2）、IPC 三處鎖步、`persistence.ts` + `autosave.ts`（各 ~10 LOC，無 migration）、新 UI（最大一塊）、`remote/server.ts` 擴充或複製 notes route（~40 LOC + 測試）。選配：把 `land_self` 的 `summary` 自動寫進 `handoffContent`，額外 0.5–1 天。四層完整版 4–6 天。

**未決問題**：誰在何時寫 handoff（agent 用檔案慣例如 steps.json？MCP tool？手動 UI？）—— 目前**沒有任何程式碼**會從 agent 完成事件自動寫入新欄位。以及儲存位置：檔案（agent 可寫、git 可見、跨 clone 持久，代價是 watcher）還是 app state（僅 renderer，像 `notes`）—— 這個選擇會顯著改變設計。

**相容性風險**：任何 notes 形狀變更都必須讓 `GET/PUT /api/mobile/notes/:taskId` 對既有手機 client 繼續可用 → 最安全是**不動 `notes`，加兄弟欄位/route**。

---

### 5. 可選 shared workspace — 不要做（已 ship，且團隊刻意限制過）

**已存在：三種模式，不是一種**

`GitIsolationMode`（`types.ts:10`，已驗證）= `'worktree' | 'direct' | 'none'`：

| 模式                 | 行為                                                                                                                                                                                                                                                                 | 出處                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `'worktree'`（預設） | 完整隔離，自己的 branch + worktree 目錄                                                                                                                                                                                                                              | `tasks.ts:260-271`                                       |
| `'direct'`           | **無 worktree**，`worktreePath = projectRoot`、`branchName = baseBranch`，agent 直接在主 checkout 當前 branch 工作。UI 標籤 "Current Branch"（`NewTaskDialog.tsx:1203-1206`），`README.md:88-89` 記為 "Direct mode for working on the main branch without isolation" | `tasks.ts:272-278`                                       |
| `'none'`             | 非 git 資料夾用：`worktreePath = projectRoot`、`branchName = ''`、完全不做 git 操作                                                                                                                                                                                  | `tasks.ts:279-283`；`taskStatus.ts:888,950` 跳過狀態邏輯 |

**關鍵：`'direct'` 模式被明確限制為每專案一個 task** —— `hasDirectTask()`（`tasks.ts:914-925`，已逐行驗證），建立時強制（`:273-275`），UI 選項被停用並顯示 "This project already has a task on the current branch"（`NewTaskDialog.tsx:1212-1215`）。**這是針對本提案的一道刻意防線。**

對比：`'none'` 沒有這道守衛，多個 `'none'` task 可同時指向同一個非 git `projectRoot`。但 app 的補償方式是**把整個 diff/changed-files 介面關掉**：`isGitUnavailable()`（`TaskPanel.tsx:379`）隱藏 changed-files（`:591`），`taskStatus.ts:950` 完全跳過 git 狀態輪詢。

**結論：共享目錄模式今天已經為非 git 資料夾出貨，做法是關掉 review/diff UI，而不是解決歸屬問題。對 git repo，共享是被刻意封鎖的。**

**提案實際新增的**：把 `hasDirectTask()` 的一個上限拿掉，允許 N 個 `'direct'` task 指向同一個 git-tracked path，而 review UI 仍然開著。機制其實都在；delta 只是移除一個 guard clause，以及決定移除後 UI 該顯示什麼。

**共享之下會壞掉的東西（逐項）**

- **per-task diff/status 變成共享而非 per-task**：`refreshTaskGitStatus`（`taskStatus.ts:945-982`）呼叫 `IPC.GetWorktreeStatus({ worktreePath, baseBranch })` —— store 裡按 `taskId` 存，但**由共享的 path 計算**。N 個 task 各自輪詢、顯示**同一份狀態**，無法區分「我的 agent 改的」與別的 task 改的。
- **`ChangedFilesList` 把變更歸給錯的 task**：它按 `props.worktreePath` 索引（`ChangedFilesList.tsx:163,167,334,445,632`），**不是 task 身分** → 共享 path 的每個 task 渲染出相同、無法歸屬的檔案清單。
- **commit 導覽/diff review 假設一 branch = 一 task**：`TaskChangedFilesSection.tsx:29` 在 `worktree`/`direct` 下才開 commit 歷史；共享寫入後 commit 交錯，無從判斷哪個 task 產生哪個 commit。
- **`mergeTask` 只支援 `'worktree'`**（`tasks.ts:615`）→ `'direct'`/共享 task **沒有 merge/land 流程**，也就沒有 per-task 落地 review 可以補。
- **並發寫同一檔案 = 資料遺失向量**：兩個 CLI 在同一 checkout 改同一檔案，`git.ts`/`pty.ts` 裡**沒有任何鎖或衝突偵測**，last-write-wins。
- **Docker 模式讓風險加倍**：docker 直接把 `cwd`（= `worktreePath`）掛進容器（`pty.ts:280-282`）→ 多個容器 bind-mount 同一個 host 目錄，並發寫同一 inode。

**可行性 Low**。這個 codebase 的核心價值主張（per-task diff、review、land）在結構上綁定 worktree path 的唯一性。**團隊已經建過最接近的類比（`'direct'`）並刻意把它限制成 1/project —— 這是「已經想過並否決」的強訊號。**

**MVP：不要建。** 最窄的可辯護版本（放寬上限 + 對第 2 個以上的並發 `'direct'` task 關掉 changed-files/merge UI，仿 `'none'` 的處理）**不提供任何超出「使用者自己在一個資料夾裡手動跑兩個 CLI」的能力**，卻侵蝕 app 的核心差異點。若仍要做：3–5 天（`tasks.ts`、`NewTaskDialog.tsx`、`TaskPanel.tsx`、`taskStatus.ts`、`ChangedFilesList.tsx` + 測試）。

**若真要開，需明確的使用者警告**（並發寫入的資料遺失風險目前完全沒有任何程式碼路徑緩解），以及決定共享時是否完全封鎖 Docker 模式（掛載碰撞）。

---

## 三、與 Huly 雙向 CRUD 的交叉影響（重要）

這六個提案不是獨立的。在「Huly 成為 issue 的意圖來源、且雙向 CRUD」的前提下，**三個提案的成本大幅下降甚至消失**，因為 Huly 已經有這些概念：

| 提案                               | Huly 已有的對應物                                                                | 影響                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notes 分層**（Decision/Context） | Huly issue 的 description（markdown，經 `uploadMarkup`/`fetchMarkup`）+ comments | **不要在本地造 Decision/Context 層** —— 寫成 Huly comment，跨 session、跨機器自然持久。本地只留 Handoff（因為它要餵給 agent，需要低延遲讀取）。                                                          |
| **Task dependency graph**          | Huly Tracker 原生就有 sub-issues、milestone、以及 issue 間關聯                   | **不要在本地重造依賴模型。** 讀 Huly 的關聯，本地只保留 `baseBranch` 推導（提案 3 的 MVP 第 2 點）。這可能把 4–6 天砍到 1–2 天。                                                                         |
| **Session transcript / timeline**  | Huly 的 activity feed                                                            | **不要推 transcript 到 Huly**（隱私 + 量太大）。但 timeline 的**里程碑級事件**（landed、PR opened、merged）可以寫成 Huly comment，正好對應先前定的「PC 擁有 PR 連結/commit 摘要，寫向 Huly」欄位擁有權。 |
| **Agent profile**                  | 無對應                                                                           | 不受影響，獨立進行。                                                                                                                                                                                     |
| **Agent-to-Agent**                 | 無對應                                                                           | 不受影響，獨立進行。                                                                                                                                                                                     |
| **Shared workspace**               | 無對應                                                                           | 不做。                                                                                                                                                                                                   |

**這是本報告第二個重要結論：先定 Huly 整合，再定這幾個功能的範圍，可以避免在本地重造 Huly 已有的東西。** 反過來先做本地版本，之後會有兩套並存的依賴模型與註記模型。

---

## 四、建議執行順序

```
第一波（獨立、低風險、立即有感）
├─ 效能：baseline → PTY base64 移除 → monaco lazy      〔先前評估，1–3 天〕
└─ 提案 6 MVP：persist stepsContent + GetScrollback channel   〔1–2 天〕
      └─ 這兩件事都是「把已付過成本的東西接出來」

第二波（Huly 基座）
├─ Step 0：Huly 連線 spike（可丟棄，不要先 npm install）     〔0.5–1 天〕
├─ 讀取路徑 + 離線快取 + issue picker + 一鍵開工            〔2–3 天〕
└─ 寫入路徑：新增 / 更新 / 移除（欄位擁有權模型）           〔4–6 天〕

前置條件（因決議 7 升級 —— 不再是「單獨評估」）
└─ send_prompt 內容清理 stripAnsi + provenance 標記         〔必做〕
     └─ 必須在 relay_to_task 與 ask_coordinator 之前完成

第三波（Huly 定案後才決定範圍）
├─ 提案 1 MVP：create_task 加 role 自由文字                 〔1–2 天〕
├─ 提案 3 MVP：dependsOnTaskId + baseBranch 推導            〔1–2 天，若讀 Huly 關聯〕
├─ 提案 2 MVP：.claude/handoff.md + watcher                 〔1.5–2.5 天〕
└─ 提案 4：分兩步，需前置條件完成                           〔5–8 天〕
     ├─ A：coordinator→child relay_to_task + 真實 CLI 驗證 provenance
     └─ B：驗證通過後才開 ask_coordinator（只能往上，不能橫向）

不做
└─ 提案 5 shared workspace
```

> 決議後的三處修正：提案 2 從 `handoffContent` 欄位改為 `.claude/handoff.md` 檔案（決議 5）；提案 4 從 2–4 天升為 5–8 天並分兩步（決議 7）；安全補強從選配升為前置條件（決議 7）。詳見第五節。

## 五、七項決議（已定案 2026-07-30）

由 Scott 逐項裁決。四項直接定案，三項在說明後定案。

### 決議 1 — Huly「移除」語意：兩邊都走 Cancelled

**兩邊的「移除」都走 Cancelled，不走 delete。**

| 動作            | 行為                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| PC 移除 task    | 本地 worktree 照原流程清掉（PC 自己的領域）；**Huly 那側設 Cancelled**，不 delete |
| Huly 刪除 issue | PC 卡片標 `orphaned`；**task／worktree／branch 全部保留**，不動任何本地狀態       |
| 永久刪除 issue  | 只能在 Huly 手動做，PC 不提供這個按鈕                                             |

理由：把「移除」直譯成 delete 會永久丟掉 issue 歷史，或刪掉含未 commit 內容的 worktree。這是七項裡唯一有資料遺失風險的。

### 決議 2 — Agent role：先做自由文字

**決定點不是 enum vs 文字，是「要不要工具層強制」。**

固定 enum 唯一有意義的實作是綁工具權限（Reviewer 真的拿不到寫檔案的工具），那要改 `selectTools(taskId, coordinatorId)` 加第三個維度 —— 目前只有 sub-task / coordinator 兩種身分。約額外 3–5 天。

**沒有工具權限映射時，enum 只是字串別名。**「Reviewer 請不要改檔案」寫在 enum 或自由文字裡，對 agent 的約束力完全相同（都是純建議性）。而自由文字更彈性，且不必猜哪四個角色是對的四個。enum 一旦定了就是 API，加第五個角色要動 schema。

**定案**：自由文字 `role?: string` + `roleInstructions?: string`（1–2 天）。若觀察到 Reviewer 角色的 agent 實際亂改檔案，那才是需要工具層強制的證據。

### 決議 3 — 依賴被刪除：保持 blocked，並補上說明

不採 `closeTask`（`tasks.ts:527-541`）的 detach 先例。

blocked 狀態必須帶**可讀原因**（「依賴的 task 已被移除」）與**明確的解除動作**。理由：靜默 blocked 是這個領域的招牌失敗（對照 Vibe Kanban #3329 卡片無聲消失）—— 一個永遠不啟動又不說為什麼的 task 比自動 detach 更糟。

### 決議 4 — 依賴 gate 在 `landingState`

這兩個選項對應的是第三節提過的**兩種依賴意義**，不是同一件事的兩種嚴格度：

|                | `landingState`                                     | 真的 merge 進 base                            |
| -------------- | -------------------------------------------------- | --------------------------------------------- |
| 保證           | task 工作已落地並通過 review                       | commit 真的在 base branch 上                  |
| 對應的依賴意義 | **git 祖先**（B 從 A 的 branch 開）                | **純排程**（B 從 base 開但要等 A 進 base）    |
| 成本           | 重用既有 `isLandedTaskState()`（`landing.ts:3-7`） | 新 git 查詢 + 輪詢（merge 可能發生在 app 外） |

MVP 的依賴意義是 git 祖先 → B 要的 code **就在 A 的 branch 上**，不需要等它進 main。若 gate 在「真的 merge」，A 的 PR 卡 review 三天，B 白等三天。

反面情境確實存在（「A 改完 schema 我才能改 API」且兩邊都從 main 開），但那是**第二種 gate 型別，不是覆蓋第一種**，等實際遇到再加。

**定案**：gate 在 `landingState`。

### 決議 5 — Handoff 存檔案

關鍵問題是「誰寫 handoff」，其餘皆次要。

|                      | 檔案 `.claude/handoff.md`                          | app state（像 `notes`）                       |
| -------------------- | -------------------------------------------------- | --------------------------------------------- |
| **agent 能自己寫？** | **可以，且不需要學新工具**                         | 不行，得開新 MCP tool 或人工貼                |
| 持久性               | 跨 session／跨 clone／git 可見可 review            | worktree 刪除後仍在（可能是優點也可能是垃圾） |
| 成本                 | 需要 watcher，但 `steps.ts` 有完整可照抄的 pattern | 無檔案 IO，`notes` 的 remote round-trip 可抄  |

**決議 7 幫這題定了案**：選了「sub-task 可請求 relay」，意味著要 agent 之間直接傳遞 → handoff 是 agent 寫的 → 檔案。agent 已經非常會寫檔案。

**定案**：`.claude/handoff.md`，**單檔 markdown**（handoff 是散文，不是結構化事件陣列，不需要 JSONL），照 `steps.ts` 的目錄監看 + 200ms debounce pattern，用同款 `ensureStepsIgnored`（`steps.ts:130-134`）自動 gitignore。

### 決議 6 — Transcript：需要 redaction（另兩子項採預設值）

redaction 確定要做。但必須誠實：**完美 redaction 不可能** —— transcript 本身就是原始碼與指令。

務實版本：借 `.gitleaks.toml` 已有的規則集掃已知密鑰形狀，命中就遮蔽並留標記，**且必須在寫入前**（寫入後再掃等於已經落地過）。+1–2 天。

實作限制：transcript 是 append-only 高頻寫入，redaction 在熱路徑上 → 用便宜的 regex 集或跑 worker，**不能整套 gitleaks**（行程級工具，太慢）。

另兩個子項 Scott 未答，採以下預設值（可覆寫）：

| 子項        | 預設                                          | 理由                                                                                           |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| opt-in 粒度 | **全域開關**（Settings 一個 toggle）          | per-task 會讓「這次有沒有錄」變成要記的事；transcript 的價值在事後回顧，事後才發現沒錄就沒用了 |
| retention   | **per-task 5000 事件 + 全域 30 天，先到為準** | 對照 Vibe Kanban #765：兩天 26GB，就是沒上限的後果                                             |

### 決議 7 — sub-task 可以請求 relay，但要間接，且分兩步

**唯一安全的形狀是間接。** sub-task 拿到的**不能**是 `send_to_task(targetId, text)`，而是 `ask_coordinator(text)` —— **只能往上，不能橫向**。

理由：`writeToAgent`（`pty.ts:506`）沒有 per-caller 授權，橫向會讓一個 task 能驅動工作區內**任何** task。維持 hub-and-spoke 讓授權圖不變，而 coordinator 是 LLM，能判斷要不要轉、轉給誰。

⚠️ **這一項提高了風險，也是唯一改變執行順序的。** sub-task 現在能把它讀到的任何東西往上送，coordinator 可能再轉給第三個 agent。因此第四節那個「既存安全問題」**從『建議單獨評估』升級為『必做前置條件』**：

1. 先補 `stripAnsi`（已在 `prompt-detect.ts:2`，`coordinator.ts` 已 import）+ provenance 標記
2. 做 coordinator→child 的 `relay_to_task`，用 `coordinator-real-agents.integration.test.ts` 對**真實 CLI** 驗證 provenance 標記不會被目標 agent 誤讀成指令
3. **驗證通過後**才開 `ask_coordinator`

**成本從 2–4 天升到 5–8 天。** 先開 sub-task 端只會放大問題。

### 兩個決議互相加強

決議 5 選檔案、決議 7 開上行通道 —— 合起來是「**agent 寫檔案交棒，需要即時協調時往上問 coordinator**」。這比原先設想的任一單一機制都更貼合這個 app 的既有形狀（agent 已在寫 `steps.json`，coordinator 已在 hub-and-spoke 中心）。

而決議 7 讓內容清理問題從「順手發現」變成「必做前置」。這是本次裁決唯一提高風險、也唯一改變執行順序的一項。

## 六、方法與可信度說明

- 六隻子 agent 平行研究，每隻被要求以 `file:line` 為證據，並對無法確認者標記 "unverified"。
- 主 agent 抽查驗證了以下高風險主張，**全部成立**：`AgentDef` 在 `electron/ipc/shared-types.ts:8-22`；`--append-system-prompt` 確實在 `ask-code.ts:73`；`dependsOn`/`blockedBy` 全 repo 零命中；`GitIsolationMode` 三值；`hasDirectTask` 的 1/project 上限；`SUBTASK_TOOLS` 僅 `land_self`/`signal_done`；`SAFE_FOR_TRACE` 為空集合；ring buffer 64KB；manifest 中無 scrollback channel；`autosave.ts` 中無 `stepsContent`。
- 基準測試狀態：`npm test` 全綠，1627 passed / 24 skipped，3.44s。
- 未驗證項目已在各節明確標示，未當作結論使用。
- 第七隻 agent 研究 clauboard.dev 與「看板作為 agent 控制面」，見下節。外部主張全部附 URL。

---

## 七、看板作為 agent 控制面：不要做（第七隻 agent，2026-07-30 追加）

**`clauboard.dev` 實質不是看板工具，也不是可用的證據。** 它是 node-graph 畫布（拖 agent 節點、畫依賴邊組流水線），四欄任務板是次要功能。Next.js 15 / React 19 / Express / SQLite，**AGPL-3.0**。**6 顆星、0 個 issue**，README 自承 local-only、無認證、檔案偵測「best-effort，可能漏掉 bash 造成的變更」。當設計草圖看，不是證據。研究重心因此移往有實際採用的工具。

### 三個發現

1. **欄位幾乎都是「人的意圖」，不是「機器狀態」。** Vibe Kanban（Apache-2.0，27.6k ★，此類別的參考實作）原始碼證明：`handleDragEnd` 只寫 `status_id` + `sort_order`，後端**從不建構** `TaskStatus::InProgress`。agent 生死在另一個 `execution_processes` 物件。唯一讓欄位真正機器推導的工具（kanban-code）因此**必須禁止拖拉** → 它自己的 issue #52：紅框拒絕、無解釋，是研究中最糟的互動。
2. **拖拉是記錄，不是指令。** 所有能讀到原始碼或文件的工具，拖拉只寫一個狀態欄位。**沒有任何工具用拖拉啟動 agent。**
3. **唯一明確共識：卡片是一個綁定包。** kanban-code 明確把 session + worktree + tmux + PR + issue 綁在一張卡以避免「三重記帳」。Vibe Kanban 拆開它們，代價是 #1571（幽靈執行）與 #3329（worktree GC 後**卡片無聲消失**）。**Parallel Code 已經有這個綁定包**（`task.id`）—— 要採納的不是看板，是「別把它拆開」。

### 這個類別正在死掉

| 工具         | 規模    | 現況                                    |
| ------------ | ------- | --------------------------------------- |
| Vibe Kanban  | 27.6k ★ | 已 sunset（理由是商業模式，非產品失敗） |
| Claude Squad | 8.2k ★  | 已棄置                                  |
| Crystal      | —       | issue #235：「是的，這個專案死了」      |
| Terragon     | —       | 已關閉                                  |
| ClauBoard    | 6 ★     | 0 issue，實質未採用                     |

主要失敗模式是**欄位與行程狀態脫節**，兩個方向都會壞：`#2495` PTY 不結束 → session 永停 running（有人累積約 40 個 claude 行程，各 200MB）；`#2783` 反方向 —— stop hook 在 agent 說 "Waiting for completion" 後 **183ms** 觸發，任務標記完成但子 agent 還在跑；`#3329` worktree GC → 卡片無聲消失；`#879` 開了約一年：In Review 混淆「我在讀 diff」與「PR 等 CI」；`#765` 兩天 26GB；`#1897` branch 已在別處 checkout → merge 無聲失敗。

最傷這個前提的證言來自一位**為對沖基金 fork 過 Vibe Kanban 的使用者**：「它沒有提供任何幾個終端視窗加 git worktree 給不了的東西。」而 Simon Willison（平行 agent 的主要倡議者）：「這一切的天然瓶頸是我 review 結果的速度。」**瓶頸是 review 佇列，不是啟動器 —— 而看板賣的正是啟動器。**

### 值得採納 vs 明確拒絕

|     | 項目                          | 理由                                                                                                                                                        |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅  | 綁定卡片                      | 已經有了。只要別破壞它。                                                                                                                                    |
| ✅  | 專屬「等待中」介面 + 頻外通知 | kanban-code 把 `Waiting` 欄配推播 —— 承認靜態格線傳達不了急迫性。你已有 `TaskAttentionState = 'needs_input'` 與桌面通知。**投資在注意力路由，不需要看板。** |
| ✅  | 人工 review 作為明確停止點    | Kanboard 堅持 agent 不能自己走到 Done。對應 `LandingState`。                                                                                                |
| ❌  | agent 經 MCP 自己寫欄位       | sub-agent 刻意只有兩個工具。讓 agent 寫 Huly 狀態會讓板子變成**會說謊的產物** —— 正是 #2783。                                                               |
| ❌  | node-graph 流水線畫布         | 6 顆星，且 coordinator 已用程式表達依賴。                                                                                                                   |
| ❌  | 阻擋非法拖拉                  | kanban-code #52。                                                                                                                                           |
| ❌  | 看板作為 N 個平行任務的啟動器 | 瓶頸是 review 佇列。                                                                                                                                        |

### 若仍要做：拖拉語意

拖拉只能有一個意思 —— **「寫入這個 Huly 狀態」**。永不啟動／停止／殺掉 agent。

- **樂觀更新**：記錄 `{issueId, fromStatus, toStatus, mutationId}` 的 pending mutation
- **失敗**：彈回原位 + toast 指名該 issue。**絕不留在樂觀位置** —— 無聲說謊的板子是這領域的招牌失敗
- **離線**：**不要排隊**。排隊的寫入會在數分鐘後把過時意圖重播到可能已被改過的 store。立即拒絕
- **per-issue in-flight 鎖**：寫入未完成時的第二次拖拉直接拒絕

### 借用還是自建：自建

授權即否決借用 —— ClauBoard 與 kanban-code 都是 **AGPL-3.0**，對要發行的 Electron binary 是致命的。Vibe Kanban 是 Apache-2.0（授權可以）但 Rust + React，無可移植物。而且不需要借：`src/lib/dragReorder.ts` 已用約 115 行、**零依賴**實作閾值偵測、drop index 計算、指示器定位。加 dnd 套件會是依賴樹裡的第一個。**借概念，不借程式碼。**

### 結論

**不要做看板。** Sidebar（1286 行）已按專案分組、嵌套 coordinator 子任務、渲染四態狀態點。看板會用更寬版面複述同一件事，同時引入這領域最有文獻記載的失敗模式 —— 一個與現實不符的格線。

| 方案                                      | 成本       | 風險集中處                   |
| ----------------------------------------- | ---------- | ---------------------------- |
| 唯讀 Huly issue 清單 + 一鍵開工按鈕       | **2–3 天** | 大部分在 `src/store`（可測） |
| 拖拉看板 + 樂觀寫入 + 失敗處理 + 欄位推導 | 8–12 天    | **大部分在不可測的那層**     |

**什麼會改變這個結論**：① 走向多人／團隊使用；② 典型併發任務數超過約 8 個；③ Huly 同步上線後你**反覆離開 app 去 Huly 自己的 UI 改狀態** —— 那是雙向狀態編輯需求真實存在的直接證據。三者之一出現前，看板是視覺復述。

### 本節已驗證

```
src/lib/dragReorder.ts          存在，115 行，零依賴
src/lib/dragReorder.test.ts     不存在 ← 手寫 DOM 拖拉的既有先例就是「不測」
vitest.config.ts:8              include: ['src/**/*.test.ts', ...] ← .tsx 根本不匹配
package.json                    零個 dnd / sortable 套件
rg -i huly src electron         零命中 ← Huly 程式碼目前完全不存在
src/components/Sidebar.tsx      1286 行
```

### 對第四節執行順序的修正

第二波的「看板 UI（2–3 天）」刪除，Huly 整合合計從 10–15 人日降為 **8–12 人日**。「讀取路徑 + issue picker + 一鍵開工」不變 —— 它本來就是清單加按鈕，不是看板。
