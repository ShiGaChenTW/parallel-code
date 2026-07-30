## Context

Parallel Code 的 renderer store 保存 product state，Electron main process 管理 Git、PTY、watchers、Remote server 與 coordinator MCP。現有實作已具備 atomic state write、單一 backup、部分 coordinator hydration、cleanup retry UI 與多項 security tests，但恢復與關閉邏輯分散在 `src/App.tsx`、`src/store/tasks.ts`、`electron/ipc/`、`electron/mcp/` 和 `electron/remote/`。當 app crash、Git 狀態被外部修改，或 multi-step cleanup 只完成一部分時，缺少一個統一、可測試的收斂模型。

PRD 同時要求十個可見任務仍可操作、有界的 terminal/diff/Markdown 資源、polling 不重疊，以及 macOS/Linux 發行候選流程可重複驗證。現有 unit tests 數量充足，但尚未形成從 PRD requirement 到 release evidence 的單一門檻。本設計把下一階段定位為 release foundation，而不是功能擴張。

## Goals / Non-Goals

**Goals:**

- 以可重入 reconciliation pipeline 將 persisted intent 與 runtime truth 收斂，並向 UI 回報逐 task 結果。
- 以明確 lifecycle phase 與冪等 operation 支援 close、merge、land、cleanup、MCP/PTY/watcher teardown 的安全重試。
- 對 output buffers、render payload 與 polling 設定集中式邊界，並提供十任務負載測試。
- 產生可追溯至 PRD 驗收條目的 macOS/Linux release report。
- 維持 local-first、無預設 telemetry、token 分權與人工 merge/review gate。

**Non-Goals:**

- 不新增雲端帳號、同步、多人協作、NAT traversal 或 hosted diagnostics。
- 不重做 store framework、Git engine、terminal emulator 或 coordinator protocol。
- 不在本階段擴張 Arena、Remote Access 權限模型、Windows 支援或新的 agent provider。
- 不以單一固定數值作為所有硬體的效能承諾；測試採可重複的 fixture 與明確 budget。

## Decisions

### 1. Reconciliation 採「觀察、規劃、執行、回報」四階段

啟動時先建立只讀 runtime snapshot，再由純函式產生 action plan。執行器逐項套用具 operation key 的 action，最後回傳 task-level report；不允許在尚未完成觀察時直接刪除 branch、worktree 或 state record。

```
persisted state + runtime snapshot
              |
              v
       reconciliation plan
              |
      safe repair actions
              |
              v
       per-task final report
```

Snapshot 至少包含 project path、repo identity、branch/worktree existence、agent/PTY presence、MCP registration、watcher registration 與 remote listener session。結果分類為 `healthy`、`repaired`、`action-required`、`unrecoverable`；後兩者保留 task record 與診斷資訊。

替代方案是沿用各模組在 hydration 時自行修補。此方式改動較小，但無法保證操作順序、跨模組冪等性與一致的錯誤呈現，因此不採用。

### 2. Lifecycle 使用持久化 operation journal，而非只保存最終 task 狀態

對會跨越多個不可原子化資源的操作，保存最小 journal：operation id、type、task id、phase、已完成 checkpoints、last error 與 timestamp。每個 phase 必須可重跑；成功後才清除 journal。Token、prompt、terminal output 與原始碼不得寫入 journal。

這允許 restart 後判斷「已 merge 但 worktree 尚未清理」與「尚未 merge」，避免重複 destructive action。既有 `closingStatus`／landing state 可作 UI projection，但不再是唯一真相。

替代方案是 rollback 所有部分成功操作。Git merge、process exit 與 filesystem delete 不一定可安全逆轉，故採 roll-forward／人工處置。

### 3. 所有高成本資料流共用 budget 與 single-flight policy

建立集中式 workload limits，涵蓋：

- 每 agent 與 remote replay 的 terminal byte/line budget。
- diff/Markdown 單次 payload、解析與 render budget；超限時提供截斷、分段或明確拒絕。
- Git、PR 與 coverage probe 以 resource key 做 single-flight、結果快取與取消 stale request。
- offscreen task 降低 render/polling 頻率，但不丟失狀態轉移或 needs-input/error 通知。

背壓應發生在 producer/IPC boundary，而非只靠 DOM virtualisation。限制值集中定義並可由測試覆寫，避免散落 magic numbers。

替代方案是只新增 frontend virtualisation；它無法限制 main-process buffer、IPC payload 或重疊 subprocess，故不足。

### 4. Release gate 以 requirement matrix 驅動，分成 fast 與 packaged lanes

`release:verify`（名稱可在實作時依現有 script convention 調整）輸出 machine-readable JSON 與人類可讀 Markdown，逐項標示 PRD AC-1 至 AC-10 的 evidence、platform、command、result、duration 與 artifact path。

- Fast lane：typecheck、lint、format、unit/integration、security rules、state corruption、reconciliation fixtures 與 deterministic load tests。
- Packaged lane：macOS 與 Linux 各自執行 add repo → create task → agent fixture → diff → merge、keyboard-only smoke、remote auth boundaries 與 restart recovery。
- 缺少必要工具或平台時標示 `not-run` 並使 release gate 失敗；一般開發 fast lane 可明確排除 packaged lane。

驗證報告先做 secret scanning/redaction，再保存為 CI artifact。報告不自動上傳到產品服務。

替代方案是維護人工 checklist。人工驗證仍可補充，但不能提供一致、可回歸的 release evidence。

### 5. 漸進導入且 persistence schema 向後相容

新增 journal 與 reconciliation metadata 時採 optional/versioned fields；舊 state 能直接載入，新版遇到未知欄位不得失敗。先以 report-only reconciliation 比對現行 hydration，再啟用 safe repairs，最後才把 release gate 設為發行必要條件。

## Risks / Trade-offs

- [錯誤 reconciliation plan 可能清理使用者資源] → 規劃階段預設 non-destructive；任何 delete/branch mutation 均需確認 repo identity、resolved target 與 operation checkpoint，模糊狀態轉為 `action-required`。
- [Operation journal 增加 state model 複雜度] → 僅記錄跨資源 lifecycle 操作，使用有限 phase enum，並以 fixture 覆蓋每個 crash point。
- [資源上限截斷使用者需要的內容] → UI 顯示截斷原因與原始大小，提供分段載入或開啟原始檔案的安全路徑。
- [負載測試在共享 CI runner 不穩定] → 使用固定 fake agent/output fixture、寬鬆但明確的 event-loop budget，區分 correctness hard gate 與 performance trend。
- [跨平台 packaged tests 成本高] → fast lane 供每個 change 執行，packaged lane 在 release candidate 與 nightly 執行；兩者 evidence 都由同一 matrix 管理。
- [既有測試套件執行時間或不穩定] → 先建立測試 inventory、timeout ownership 與 isolation 規則，再將 flaky test 隔離並設期限，不允許無限期忽略。

## Migration Plan

1. 建立 PRD requirement matrix、測試 inventory 與 workload baseline，不改 runtime 行為。
2. 加入 reconciliation snapshot/planner/report，先以 report-only 模式與現有 hydration 結果比對。
3. 加入 versioned operation journal，將 close/merge/land/cleanup 逐條遷移為冪等 phase。
4. 啟用低風險自動修復（重建 watcher/MCP registration、清理已確認 orphan listener）；destructive ambiguity 仍要求人工處理。
5. 導入 centralized budgets、single-flight polling 與 deterministic ten-task load suite。
6. 建立 fast/package release lanes；完成 macOS/Linux baseline 後將其列為 release candidate hard gate。

Rollback 時可關閉自動 repair，回到 report-only；optional journal 欄位可由舊版忽略。若新 lifecycle executor 有問題，保留 journal 與 UI record，禁止以降版流程自動刪除資源。

## Open Questions

- PRD 中「Ten agents」應作為正式支援上限，或只作為本階段的標準負載 fixture？
- Packaged Linux lane 的最低支援基線應選 Ubuntu LTS、Debian stable，或兩者皆需？
- 效能 hard gate 應只約束 event-loop responsiveness，還是也納入 process RSS／CPU budget？
- 對 `action-required` 的 recovery UI，本階段要提供逐項 repair action，或先提供診斷與安全的「保留 task」選項？
