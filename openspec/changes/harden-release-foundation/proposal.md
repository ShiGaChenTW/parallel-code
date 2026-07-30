## Why

Parallel Code v1.13.0 已具備 PRD 所列的大部分核心能力，但「功能存在」尚未等於「可重複、安全地發行」：目前缺少把重啟恢復、Git／process 真實狀態對帳、失敗後重試、十任務負載，以及 macOS／Linux 關鍵流程整合成單一發行門檻的契約。下一階段應先封閉這些 P0 可靠性與驗收缺口，再擴張 Arena、多人遠端或其他產品面，以降低資料遺失、孤兒程序、錯誤清理與回歸風險。

## What Changes

- 建立啟動時的 runtime reconciliation：逐一比對持久化 task、project path、Git branch/worktree、agent/PTY、coordinator MCP 與 watcher 狀態，產生可理解且可操作的恢復結果。
- 將 close、merge、land、worktree cleanup 與 server/process teardown 定義成可重試、冪等的生命週期；失敗時保留 UI record、錯誤階段與下一步，不把部分成功誤報為完成。
- 為大型 terminal output、diff、Markdown 與高頻 Git／PR／coverage polling 建立有界資源與去重／背壓行為，並以十個同時可見任務驗證 UI 可回應性。
- 建立 macOS／Linux release-readiness gate，涵蓋 PRD 驗收流程、權限邊界、狀態損壞恢復、跨平台鍵盤操作與 filesystem safety。
- 產出可由本機執行且可在 CI 重複的驗證報告；不新增預設 telemetry，也不改變本機優先與人工 review gate。

## Capabilities

### New Capabilities

- `runtime-reconciliation`: 定義應用程式啟動與生命週期失敗後，持久化狀態如何與 Git、PTY、MCP、watcher 及 remote listener 的真實狀態收斂。
- `bounded-workload`: 定義多任務、大輸出與 polling 情境下的資源邊界、背壓、去重與可回應性要求。
- `release-readiness`: 定義發行候選版本必須通過的跨平台、端到端、安全與恢復驗證契約及報告。

### Modified Capabilities

<!-- 目前 openspec/specs/ 尚無既有 capability；本 change 不修改既有 spec。 -->

## Impact

- 主要影響 `src/store/` 的 hydration／task lifecycle、`electron/ipc/` 的 persistence／Git／PTY／watcher 管理、`electron/mcp/`、`electron/remote/` 與發行驗證 scripts。
- 需要新增故障注入、重啟恢復、負載與 packaged smoke tests，並把既有 unit/integration/security checks 納入一致的 release gate。
- 持久化 task schema 可能新增 reconciliation／cleanup 診斷欄位；必須向後相容，且不可因未知或舊欄位阻止啟動。
- 不新增外部服務或 runtime dependency；驗證結果保留本機／CI artifact，不包含 prompt、terminal 內容、token 或原始碼。
