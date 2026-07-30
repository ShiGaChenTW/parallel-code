# Parallel Code 產品需求文件（PRD）

> 文件性質：依目前 `v1.13.0` 程式碼、測試、README 與隱私政策逆向整理的現況型 PRD  
> 基準版本：commit `fd77bd2`，2026-07-30  
> 支援平台：macOS、Linux  
> 狀態：Draft for review

## 1. 產品摘要

Parallel Code 是一套本機優先、開源的桌面開發工作台。使用者可以在同一介面同時啟動多個 AI coding CLI，讓每項工作在獨立 Git branch 與 worktree 中執行，集中監控終端輸出、檢視變更、提供回饋、比較方案，最後合併有價值的成果。

產品不提供自有模型或雲端代理服務，而是協調使用者已安裝並自行授權的 CLI。內建支援 Claude Code、Codex CLI、Gemini CLI、OpenCode、Copilot CLI 與 Antigravity CLI，也允許自訂 agent command。

核心價值主張：

- 將「一次操作一個 agent」提升為可控的平行開發流程。
- 以 Git worktree 隔離每個任務，降低檔案互相覆寫與上下文污染。
- 將終端、任務狀態、diff、review、merge 與 CI 回饋整合在同一工作台。
- 保留本機工具鏈、供應商選擇與原始碼控制權，不收取額外平台費用。

## 2. 問題與機會

### 2.1 使用者問題

使用多個 AI coding agent 時，開發者通常需要手動管理：

- 多個 terminal/tmux session 的位置、狀態與上下文。
- branch、worktree、工作目錄與 gitignored 依賴目錄。
- 每個 agent 做了什麼、是否等待輸入、是否已完成。
- 多個實作的 diff、測試結果、review 意見與合併順序。
- 遠離電腦時的進度確認與簡短介入。

上述操作成本會抵銷平行化的效益，並增加誤改主分支、遺漏未提交內容、錯誤合併或任務失聯的風險。

### 2.2 產品機會

Parallel Code 應成為「本機 AI 軟體團隊的控制台」：開發者保有最後決策權，agent 可以平行工作，協調器可以拆解與推進工作，而所有成果仍以可檢視、可撤銷的 Git 變更交付。

## 3. 目標與非目標

### 3.1 產品目標

1. 使用者可在數分鐘內為既有 repo 建立多個互相隔離的 AI 任務。
2. 使用者不必切換應用程式，即可判斷每個任務目前是工作中、需輸入、錯誤、可 review 或已完成。
3. 每個任務的程式變更都可追溯、比較、review、commit、push、rebase、merge 或捨棄。
4. 進階使用者可由一個 coordinator agent 建立、控制、驗證與落地多個子任務。
5. 使用者可選擇原生、本地 Docker 或直接在目前 branch 上工作。
6. 應用程式重啟後，專案、任務、偏好與可恢復的 session 狀態仍可延續。

### 3.2 非目標

- 不訓練、託管或代理任何 AI 模型。
- 不提供雲端 repo、雲端 IDE、帳號系統或跨使用者協作平台。
- 不取代 GitHub/GitLab 的正式 code review 與權限治理。
- 不承諾 Docker 模式是安全沙箱或網路隔離邊界。
- 目前不發行 Windows 版本（暫緩，非永久排除；見第 13 節 Q5）。
- 不保證第三方 CLI 的可用性、費用、輸出品質或資料處理方式。

## 4. 目標使用者

### P1：高頻 AI 輔助開發者

已使用 Claude Code、Codex 或其他 CLI，希望同時處理多個功能、修 bug 或研究任務；熟悉 Git，但不想手動維護大量 worktree 與 terminal。

### P2：技術負責人／獨立開發者

希望把大型需求拆成多個子任務，監督 agent 進度，要求驗證後再合併，並保留人工接管能力。

### P3：模型與 agent 工具評估者

需要讓 2–4 個 agent 對同一 prompt 競賽，比較完成時間、輸出、diff 與品質，再選擇要合併的版本。

## 5. 核心使用流程

### 5.1 建立並完成一般任務

1. 使用者加入本機專案資料夾。
2. 選擇 agent、基準 branch、Git 隔離模式與任務選項。
3. 輸入 prompt；系統建立 branch/worktree、連結選定的 gitignored 目錄並啟動 agent PTY。
4. 使用者從 tiled overview 或 focus mode 監控狀態，必要時輸入 prompt、開 shell、編輯 notes 或查看 steps。
5. 系統顯示 changed files、行數、commit 與 diff；使用者可加入 inline review comments 並回傳給 agent。
6. 使用者確認 merge readiness，視需要 commit、push、rebase，最後 merge 或關閉任務並清理資源。

### 5.2 Coordinator 工作流

1. 使用者建立 coordinator task，設定最大並行子任務數與權限傳播方式。
2. 系統在 coordinator agent 啟動前建立具 scope 與 token 保護的本機 MCP server。
3. Coordinator 建立子任務、送出 prompt、讀取輸出與 diff、等待完成信號並要求驗證。
4. 子任務預設由 coordinator 控制；人工輸入時系統暫停自動寫入，使用者亦可明確接管或交還控制。
5. 子任務提交驗證結果並 land；系統保留待人工 review 的落地狀態與來源資訊。
6. 使用者 review coordinator 的整體成果並決定最終合併。

### 5.3 手機遠端流程

1. 桌面端啟動 Remote Access，產生含 session token 的連線 URL／QR code。
2. 手機先以 mobile token 連線，可查看 agent 列表、狀態、scrollback 並輸入 terminal。
3. 建立任務等較高權限操作須再輸入桌面端產生的 6 位 PIN，取得 paired token。
4. Remote Access 重啟後，舊 token 失效。

### 5.4 Arena 比較流程

1. 使用者設定 2–4 個 competitor、command template、共用 prompt 與選用專案。
2. 系統為 competitor 建立隔離 worktree 並同步啟動。
3. 使用者比較執行時間、exit code、terminal output 與程式變更。
4. 使用者以 1–5 星評分，可選擇合併其中一個或多個結果。
5. 系統保存 match history；刪除紀錄時清理尚未合併的 worktree。

## 6. 功能需求

優先級定義：P0 為產品核心且不可缺少；P1 為重要完整體驗；P2 為進階或輔助能力。

### 6.1 專案與任務管理

| ID         | 優先級 | 需求                                                                                                                   |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| FR-PROJ-01 | P0     | 使用者可加入、編輯、移除本機專案；移除專案前須處理其關聯任務。                                                         |
| FR-PROJ-02 | P0     | 系統須辨識 Git repo 與一般資料夾，並提供相符的 isolation 選項。                                                        |
| FR-PROJ-03 | P1     | 每個專案可設定顏色、branch prefix、預設 base branch、關閉時是否刪 branch、coverage report path 與 terminal bookmarks。 |
| FR-TASK-01 | P0     | Git repo 任務支援 `worktree` 與 `direct`；非 Git 資料夾支援 `none`。                                                   |
| FR-TASK-02 | P0     | Worktree 任務須由指定 base branch 建立唯一 branch 與獨立工作目錄。                                                     |
| FR-TASK-03 | P0     | 同一專案同時間僅可存在一個 direct-mode task。                                                                          |
| FR-TASK-04 | P1     | 使用者可匯入既有 worktree，且同一路徑不可重複追蹤。                                                                    |
| FR-TASK-05 | P1     | 新任務可設定自動產生名稱、初始 prompt、GitHub URL、權限、Docker、steps 與 coordinator 選項。                           |
| FR-TASK-06 | P0     | 關閉或合併任務時，系統須呈現未提交內容、未 push commit、衝突、子任務與資源清理風險。                                   |
| FR-TASK-07 | P1     | 使用者可拖曳排序、收合一般任務、切換 focus mode；coordinator 管理中的子任務不可任意收合而脫離群組。                    |

### 6.2 Agent 與終端

| ID          | 優先級 | 需求                                                                                                    |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------- |
| FR-AGENT-01 | P0     | 系統須偵測內建 agent command 是否存在，並在 UI 標示可用性。                                             |
| FR-AGENT-02 | P0     | 使用者可啟動、暫停、恢復、終止、重啟或切換 agent。                                                      |
| FR-AGENT-03 | P1     | 單一任務可加入多個 agent terminal，並以 side-by-side 或 tabs 顯示。                                     |
| FR-AGENT-04 | P1     | 使用者可建立與移除自訂 agent definition，包含 command、args、resume args、skip-permission args 與說明。 |
| FR-TERM-01  | P0     | Terminal 須支援互動輸入、resize、scrollback、搜尋、連結、選取複製與 XTerm 相容控制序列。                |
| FR-TERM-02  | P1     | 使用者可為任務新增獨立 shell、執行 bookmark command，或建立不屬於任務的 standalone terminal。           |
| FR-TERM-03  | P1     | Prompt input 支援多行文字、貼上與拖放檔案／圖片、草稿保留及指定 agent 發送。                            |
| FR-TERM-04  | P0     | 自動送 prompt 前須等待 agent ready；長文字應使用 bracketed paste 並依內容調整輸入延遲。                 |
| FR-TERM-05  | P1     | 任務狀態至少區分 idle、active、needs input、error、ready/review，並以文字、顏色與非純動畫線索呈現。     |

### 6.3 Git、diff 與交付

| ID        | 優先級 | 需求                                                                                             |
| --------- | ------ | ------------------------------------------------------------------------------------------------ |
| FR-GIT-01 | P0     | 系統須同時呈現 committed 與 uncommitted changes，以及每檔案新增／刪除行數。                      |
| FR-GIT-02 | P0     | Branch diff 應以適當 merge-base 比較 working tree，並處理 local/remote base ref 差異。           |
| FR-GIT-03 | P0     | 使用者可查看單檔與全檔 unified diff、commit tree、各 commit changed files 與 diff。              |
| FR-GIT-04 | P1     | Diff viewer 支援 syntax highlighting、context gap 展開、選取範圍與 inline review comment。       |
| FR-GIT-05 | P0     | 使用者可 commit all、push、rebase、checkout branch、merge 與捨棄未提交變更；危險操作須二次確認。 |
| FR-GIT-06 | P0     | Merge 前須檢查衝突與 readiness，失敗時保留任務及可行動的錯誤資訊。                               |
| FR-GIT-07 | P1     | 系統可偵測 branch 對應的 GitHub PR，監控 check runs，並在成功或失敗 settled 時通知。             |
| FR-GIT-08 | P1     | 若專案設定 coverage artifact，Changed Files 應顯示對應的 coverage summary/badge。                |

### 6.4 任務知識與狀態

| ID            | 優先級 | 需求                                                                                                     |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| FR-CONTEXT-01 | P1     | 每個任務提供持久化 notes，可直接轉成 prompt 傳給 agent。                                                 |
| FR-CONTEXT-02 | P1     | 使用者可開啟 steps tracking；系統將格式要求注入 prompt，監看 `.claude/steps.json` 並顯示工程進度時間線。 |
| FR-CONTEXT-03 | P1     | 系統可監看並呈現 agent 產生的 plan/Markdown，且渲染前須 sanitise。                                       |
| FR-CONTEXT-04 | P2     | 使用者可選取 diff 程式碼，透過 Claude Code 或 MiniMax 詢問程式內容並取消請求。                           |

### 6.5 Coordinator 與子任務

| ID          | 優先級 | 需求                                                                                                                 |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| FR-COORD-01 | P0     | Coordinator 模式啟動時須先完成 MCP server 與 agent launch wiring，再建立可渲染的 task，以避免未連線 agent 提前啟動。 |
| FR-COORD-02 | P0     | Coordinator 可建立、列出、讀取、提示、review、merge、land 與關閉其所屬子任務，但不可存取其他 coordinator 的任務。    |
| FR-COORD-03 | P0     | 子任務 token 只能操作自己的完成／落地流程；mobile token 不得取得 coordinator task API。                              |
| FR-COORD-04 | P0     | 子任務須有 `coordinatedBy` 與 `controlledBy`；控制權切換須等待 backend acknowledgement，失敗時回復原狀態。           |
| FR-COORD-05 | P0     | 使用者打字、編輯草稿或 terminal 尚有 pending input 時，自動寫入須暫停，避免 agent 與人類輸入互相覆蓋。               |
| FR-COORD-06 | P1     | Coordinator 應限制最大並行任務數，並可選擇是否將 skip-permission 傳給子任務。                                        |
| FR-COORD-07 | P0     | 子任務 land 前須提交具名稱、command、passed/blocked/failed 與原因的 verification checks。                            |
| FR-COORD-08 | P0     | Landed result 須保留來源 task、target branch、commit、時間、順序、摘要與驗證資料，等待人工 review。                  |
| FR-COORD-09 | P0     | Coordinator 關閉時須警告尚有子任務；若繼續，子任務應解除 coordinator 關聯並保持可獨立運作。                          |

### 6.6 Docker

| ID           | 優先級 | 需求                                                                                                  |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| FR-DOCKER-01 | P1     | 系統須偵測 Docker 與指定 image 是否可用，並允許建立預設或專案 image。                                 |
| FR-DOCKER-02 | P1     | 若存在 `.parallel-code/Dockerfile`，應優先使用專案設定；否則使用全域 image。                          |
| FR-DOCKER-03 | P0     | UI 須明示 Docker 僅提供檔案系統隔離，不是網路或 credential 安全邊界。                                 |
| FR-DOCKER-04 | P1     | 使用者可選擇將 agent auth 持久化到 `~/.parallel-code/agent-auth/<agent>/` 並跨 Linux container 共用。 |
| FR-DOCKER-05 | P0     | Antigravity 在 OS keyring 限制未解除前，不應被描述為可正常在 Docker 內驗證。                          |

### 6.7 Remote Access

| ID           | 優先級 | 需求                                                                                      |
| ------------ | ------ | ----------------------------------------------------------------------------------------- |
| FR-REMOTE-01 | P1     | 使用者可啟停本機 HTTP/WebSocket server，取得可複製 URL 與 QR code，並看到 listener 狀態。 |
| FR-REMOTE-02 | P0     | 未驗證 client 不得存取 terminal；token 不正確時須拒絕連線。                               |
| FR-REMOTE-03 | P1     | Mobile client 可查看 agent 狀態、terminal scrollback、即時輸出並傳送輸入。                |
| FR-REMOTE-04 | P0     | Mobile token 不可 resize/kill agent 或使用 task/coordinator API。                         |
| FR-REMOTE-05 | P1     | 只有完成 6 位 PIN pairing 的 client 可列出專案與建立任務；錯誤嘗試達門檻後須 lockout。    |
| FR-REMOTE-06 | P1     | 手機可讀寫每個 task 的 notes，單次內容上限 100 KB。                                       |
| FR-REMOTE-07 | P0     | Remote server 重啟時須輪替 token，使舊連線資訊失效。                                      |

### 6.8 Arena

| ID          | 優先級 | 需求                                                                                |
| ----------- | ------ | ----------------------------------------------------------------------------------- |
| FR-ARENA-01 | P2     | 每場比賽允許 2–4 個 competitor，且每個 competitor 須有名稱與含 prompt 的 command。  |
| FR-ARENA-02 | P2     | 有選定專案時，每個 competitor 使用獨立 branch/worktree；無專案時可在指定 cwd 執行。 |
| FR-ARENA-03 | P2     | Results 顯示執行時間、exit code、terminal output 與 merge 狀態，並允許評分。        |
| FR-ARENA-04 | P2     | 使用者可儲存 competitor presets 與 match history。                                  |
| FR-ARENA-05 | P1     | 未保存、未合併或已刪除歷史的 worktree 應安全清理；已合併 branch 不得重複清理。      |

### 6.9 個人化、導覽與系統整合

| ID       | 優先級 | 需求                                                                                                      |
| -------- | ------ | --------------------------------------------------------------------------------------------------------- |
| FR-UI-01 | P1     | 應用程式提供 tiled overview、focus mode、可調整 panel size、sidebar 與 keyboard-first 導覽。              |
| FR-UI-02 | P1     | 所有主要動作應提供可查詢、可覆寫或解除綁定的快捷鍵，並支援 agent-specific presets。                       |
| FR-UI-03 | P1     | 支援 system/light/dark appearance、內建主題、自訂 CSS theme、clone/edit/delete 與對比檢查。               |
| FR-UI-04 | P1     | 使用者可設定 terminal font、global font scale、inactive panel opacity、font smoothing 與 reduced motion。 |
| FR-UI-05 | P1     | 支援 native notifications；視窗重新聚焦、任務移除或狀態恢復時須去重或取消過期通知。                       |
| FR-UI-06 | P1     | Packaged app 可檢查、下載並安裝 GitHub Release 更新，且呈現明確階段與錯誤。                               |

## 7. 非功能需求

### 7.1 隱私

- 預設不含 analytics、telemetry、crash reporting、remote logging、廣告或帳號。
- 原始碼、task metadata、notes、設定與 terminal buffer 預設只存於本機。
- UI 與隱私政策須清楚區分 Parallel Code 自身網路活動與第三方 CLI 的網路活動。
- 渲染 Markdown 允許的外部圖片可能洩漏 IP，須在文件中揭露。
- **Parallel Code 自身的對外連線點共有九個**（此數字先前記為三個，實際盤點後為九個）：
  1. 更新檢查／下載（GitHub Releases，`electron/ipc/updater.ts`）
  2. PR check 狀態輪詢（`gh` CLI，`electron/ipc/pr-checks.ts`）
  3. Ask About Code — Claude CLI（`electron/ipc/ask-code.ts`）
  4. Ask About Code — MiniMax API（`electron/ipc/ask-code-minimax.ts`）
  5. 渲染 Markdown 中的外部圖片（`src/lib/marked-shiki.ts`）
  6. Huly 同步（WebSocket，`electron/ipc/huly.ts`）
  7. `git push`（`electron/ipc/git.ts`）
  8. `git remote set-head origin --auto`（`electron/ipc/git.ts`）——**唯一沒有使用者手勢的隱式連線**，
     只要遠端追蹤 ref 過期，開啟專案即會觸發
  9. `docker build`（`electron/ipc/pty.ts`）
- 上述九個必須全部受單一「離線模式」總開關控制（見 §13 Q3 裁決）。開關關閉時，
  每個連線點都必須回報明確原因，不得靜默逾時或無限等待。
- 離線模式**不涵蓋**第三方 AI CLI 自身的網路活動；文件必須明確寫出這條界線，
  避免使用者誤以為開關能管到 Claude Code 等工具自己的連線。
- 離線模式不得以網路層攔截（`session.webRequest` 之類）實作 —— 那會一併影響第三方 CLI，
  且會把失敗模式變成靜默逾時。
- Remote Access 與 MCP coordinator 是 **inbound** listener，不屬於這九個對外連線點，
  由各自的啟動／停止控制，不受離線模式管轄。

### 7.2 安全

- Renderer 不得直接取得 Node.js 能力；所有 privileged operation 經 allowlisted Electron IPC。
- 路徑、task ID、prompt、WebSocket message 與 request body 必須驗證、限制長度並移除危險控制字元。
- Remote、coordinator、subtask 與 done token 必須分權，且以 task/coordinator scope 驗證。
- MCP config/token file 應以 atomic write 與可行時 `0600` 權限建立。
- 任何 destructive Git/檔案操作必須使用已解析且受限的 target，不接受模糊或越界路徑。

### 7.3 可靠性

- State 寫入須保留 rolling backup，損壞時提供恢復路徑。
- Merge、close、MCP cleanup 或 worktree removal 失敗時，不得靜默移除 UI task。
- PTY、MCP 與 remote server 的啟停須可重試，並清理 orphaned process/listener。
- App restart 後應恢復專案、任務排序、terminal 定義、偏好、視窗與可恢復 agent session。

### 7.4 效能

- **已驗證至五個**同時可見任務：狀態與 terminal output 更新不阻塞 UI 操作（見第 10 節第 2 項）。
  十個是**設計目標**，尚未實測；五個以上的並發行為目前沒有驗證基準。
  Q1 已裁決不設全域上限，因此上限本身不是承諾，「驗證到幾個」才是。
- Terminal scrollback、diff 與 Markdown rendering 應有邊界或虛擬化策略，避免大型輸出耗盡記憶體。
- Agent availability 探測應快取；高頻 Git/PR/coverage polling 應避免重疊請求。
- 使用者輸入到 PTY 的本機互動延遲目標為 p95 < 100 ms（不含 agent/model 回應時間）。

### 7.5 可用性與無障礙

- 所有 dialog 須支援 focus trap、Escape 關閉與合理的 focus restore。
- 所有互動控制須有可見 focus indicator、可理解的 accessible name 與鍵盤操作。
- Status 不得只靠顏色或動畫傳達；啟用 reduced motion 時仍須保留狀態辨識。
- macOS 的 `Cmd` 與其他平台的 `Ctrl` 應一致映射並正確顯示。

### 7.6 相容性

- Node.js 18+ 開發環境。
- macOS 與 Linux packaged build；macOS 同時支援 Intel/Apple Silicon 發行需求。
- Git 為 worktree/direct 功能前提；非 Git 資料夾仍可使用 none mode。

## 8. 資料模型與持久化

主要實體：

- `Project`：路徑、顏色、branch 規則、Git 預設值、coverage 與 bookmarks。
- `Task`：專案、branch/worktree、agent 關聯、prompt/notes、Git isolation、Docker、steps、coordinator 與 landing 狀態。
- `Agent`：agent definition、PTY 狀態、resume 狀態、exit result 與 recent output。
- `Terminal`：獨立 shell 的識別與名稱。
- `ArenaMatch`／`ArenaPreset`：競賽設定、輸出、時間、評分與保留的 worktree。

本機資料位置：

- macOS：`~/Library/Application Support/Parallel Code`
- Linux：`~/.config/Parallel Code`
- 核心檔案：`state.json`、`state.json.bak`、`keybindings.json`、`themes/`、`arena-presets.json`、`arena-history.json`
- Repo 內管理檔：`.claude/steps.json`、`.parallel-code/` 與必要的 `.git/info/exclude` 項目

## 9. 成功指標

目前程式碼未包含 telemetry；以下指標應以 opt-in、匿名且另經隱私評估的研究，或使用者自願回報取得，不應直接加入追蹤。

### 北極星指標

- 每位活躍使用者每週「成功 review 並 merge 的 agent task 數」。

### 效率指標

- 從建立 task 到 agent 首次可輸入的中位時間。
- 每個專案同時活躍任務數。
- 從 agent ready 到使用者完成 merge/reject 的中位時間。
- Coordinator 成功完成且所有子任務有 verification 的比例。

### 品質與可靠性指標

- Worktree 建立、恢復、merge、cleanup 的成功率。
- App crash/restart 後可成功恢復的 task 比例。
- 誤判 ready/needs-input 狀態的回報率。
- 因 branch/worktree 管理導致資料遺失的事件數，目標為 0。

## 10. 驗收標準

發行候選版本至少須符合：

1. macOS 與 Linux 可從乾淨環境加入 repo、建立 worktree task、啟動一個支援的 agent、查看 diff 並完成 merge。
2. 同一 repo 同時啟動至少 5 個 worktree tasks，不互相覆寫檔案或 branch。
3. Direct、none、imported worktree 三條替代流程均可建立、重啟與安全關閉。
4. 未提交變更、merge conflict、worktree cleanup failure 與 MCP startup failure 都有可理解且可恢復的 UI。
5. Coordinator 無法讀寫其他 coordinator 的子任務；subtask/mobile token 無法提升到未授權 API。
6. Remote Access 未驗證、一般 mobile、paired mobile 三種權限符合本文件規格，server restart 使舊 token 失效。
7. State 與 keybindings 的主檔損壞時可由 backup 或安全預設恢復，不造成 app 無法啟動。
8. Keyboard-only 使用者可完成新增任務、切換 panel、輸入 prompt、開 diff、關閉 dialog 與 merge 的主要流程。
9. `typecheck`、lint、format check、unit/integration tests 與 filesystem safety rules 全數通過。
10. 發行文件準確揭露 Docker、credential forwarding、Remote Access、第三方 CLI 與 Markdown external image 的風險。

## 11. 相依與限制

- 使用者需自行安裝並驗證至少一個 AI coding CLI。
- Agent 功能受各 CLI 的 command-line interface、resume 機制、prompt readiness 與 upstream 變更影響。
- GitHub PR/CI 功能依賴本機 `git`／`gh` 設定與 GitHub 可用性。
- Docker coordinator 在 macOS 需讓 container 連回 host MCP listener；即使有 token，LAN exposure 仍是風險。
- Codex coordinator token 可能出現在 process command line，存活期間可被同機程序讀取。
- Remote Access 是本機 server，不提供 NAT traversal、relay、TLS termination 或多人權限模型。

## 12. 風險與緩解

| 風險                                 | 影響                      | 緩解                                                           |
| ------------------------------------ | ------------------------- | -------------------------------------------------------------- |
| 多 agent 同時消耗大量 CPU/RAM        | UI 卡頓、PTY 中斷         | 並行上限、offscreen 降載、output buffer 邊界與資源提示         |
| 第三方 CLI 改版造成啟動／resume 失效 | 任務無法啟動或丟失上下文  | agent definition 可配置、availability check、版本相容測試      |
| 自動 merge/land 帶入錯誤             | 主 branch 品質下降        | verification contract、merge readiness、人工 review gate       |
| Docker 被誤認為完整 sandbox          | credential 或網路資產曝露 | 建立任務時警示、最小化 env/mount、隱私文件持續同步             |
| Remote token 經 clipboard/QR 洩漏    | 區網內未授權存取          | 短生命週期、重啟輪替、PIN elevation、scope 與 rate limit       |
| App state 與真實 Git 狀態漂移        | 誤導使用者或清理錯誤資源  | 啟動 reconciliation、操作前即時 Git 檢查、失敗時不刪 UI record |

## 13. 產品決策

原本六題無法只由程式碼得知，需產品負責人裁決。Scott 於 2026-07-31 裁決其中五題。

| #   | 問題                                            | 裁決                                                                                                                   |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Q1  | 「Ten agents」是敘述、建議上限，還是強制上限？  | **行銷敘述，實際不設全域上限**                                                                                         |
| Q2  | Coordinator／Arena 要不要成為 onboarding 主路徑 | **維持進階功能**，onboarding 走三階段漸進揭露                                                                          |
| Q3  | 要不要正式承諾完全離線模式                      | **要**。已實作總開關（Settings → Privacy → Offline mode）。本題原先只列三個連線點，實際盤點為**九個**，清單見第 7.1 節 |
| Q4  | Remote Access 是否只服務單一使用者              | **是**。不做裝置管理、撤銷與 audit log                                                                                 |
| Q5  | Windows 是永久非目標，或僅為目前 release gap？  | **目前暫緩，非永久排除**（第 3.2 節措辭已同步）                                                                        |
| Q6  | 是否接受 opt-in diagnostics                     | **待決議** —— 未來是否開放他人使用尚未確定，故暫不承諾                                                                 |

### 尚未解決

1. **Q6 待決議。** 在解決之前，第 9 節的成功指標維持純本機 dashboard 或使用者研究，不得加入追蹤。
2. ~~**Q1 與第 7.4 節的效能承諾不一致。**~~ **已於 2026-07-31 處理。**
   第 7.4 節原本承諾「十個同時可見任務時不阻塞 UI」，但查證後**沒有任何實測支撐十這個數字** ——
   第 10 節第 2 項的驗收門檻是五個，程式碼裡也沒有併發任務數的測試。
   已改寫為「已驗證至五個，十個是設計目標」。
   **若要把承諾提高到十，需要先補一次實測**，不能只改文字。
3. **Q4 與 Q6 共用同一個未定假設。** Q4 裁決單一使用者，而 Q6 猶豫的理由正是
   「未來可能開放他人使用」。若該假設翻轉，Q4、Q6 與看板否決（見 `docs/ROADMAP.md` 第 4 節）
   會一起翻，不會單獨翻。

> 裁決的落地工作項追蹤於 `docs/ROADMAP.md`。

## 14. 需求來源與追溯

本文件以以下 repo 內材料為準：

- 產品定位與操作：`README.md`
- 技術邊界與指令：`CLAUDE.md`、`package.json`
- 隱私、安全與本機資料：`PRIVACY.md`
- 實際功能：`src/`、`electron/`、`scripts/`
- 行為邊界與回歸條件：對應的 `*.test.ts`／`*.test.tsx`
- IPC 能力清單：`electron/ipc/channel-manifest.json`

若本文件與程式行為衝突，現階段應視為「文件與實作待校準」，不可直接假設任一方自動正確。
