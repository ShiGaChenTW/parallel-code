# R2：離線模式總開關

**建立時間：** 2026-07-31 01:36
**最後更新：** 2026-07-31 01:36
**狀態：** 進行中
**分支：** `feat/offline-mode`（從 `main @ 92b17b2` 分出）
**worktree：** `/Users/scottchen/Documents/20_Projects/pc-feat-offline-mode`

## 目標

PRD §13 Q3 已裁決「**要**正式承諾完全離線模式」。目前沒有任何總開關 ——
使用者無法一次關掉這個 app 自己的所有對外連線。

## 前置事實（已盤點，非推論）

PRD §7.1 只列了三個連線點，實際是**六個**：

| 模組                               | 對外行為                                      |
| ---------------------------------- | --------------------------------------------- |
| `electron/ipc/updater.ts`          | GitHub Release 更新檢查                       |
| `electron/ipc/pr-checks.ts`        | GitHub PR / check runs 輪詢                   |
| `electron/ipc/ask-code.ts`         | Ask About Code（Claude CLI）                  |
| `electron/ipc/ask-code-minimax.ts` | MiniMax API                                   |
| `src/lib/marked-shiki.ts`          | Markdown 外部圖片（PRD §7.1 已記載會洩漏 IP） |
| `electron/ipc/huly.ts`             | Huly 同步                                     |

**這份清單是起點不是終點。** 第一步要自己重新盤一次確認沒有遺漏，
發現新的就補進表裡並在決策紀錄說明怎麼找到的。

## 範圍

做：

- 一個總開關（Settings），關閉時上述全部不發出請求
- 開關狀態持久化（`state.json` 已有 rolling backup 機制，沿用）
- `PRIVACY.md` 與 PRD §7.1 同步更新為實際盤點的數量

不做：

- **不管第三方 CLI 自身的網路活動** —— 那是使用者授權的工具，PC 不攔也攔不住。
  文件要把這條界線寫清楚，不要讓使用者誤以為開關能管到 Claude Code 自己連網
- 不做 per-surface 的細粒度開關（YAGNI；若之後真的需要再拆）
- 不做網路層攔截（`session.webRequest` 之類）—— 那會連第三方 CLI 一起影響，
  且會讓失敗模式變成靜默逾時而非明確訊息

## 設計要求

- **關閉時的行為要明確而非靜默失敗。** 使用者按「檢查更新」應該看到
  「離線模式已啟用」，不是無限轉圈或逾時
- 判斷邏輯放 `src/lib` 或 `src/store` 當純函式 —— vitest 是 node 環境，
  component 層測不到
- 若需要新增 IPC channel，`electron/ipc/channel-manifest.json` 與
  `electron/preload.cjs` 的 `ALLOWED_CHANNELS` **兩處都要改**，
  `preload-allowlist.test.ts` 斷言三者是精確集合

## 重新盤點結果（Step 1 產出）

實際是 **九個**，比交辦的六個多三個。

| #   | 模組                                               | 對外行為                                           | 來源     |
| --- | -------------------------------------------------- | -------------------------------------------------- | -------- |
| 1   | `electron/ipc/updater.ts`                          | GitHub Releases 更新檢查／下載                     | PM 清單  |
| 2   | `electron/ipc/pr-checks.ts`                        | `gh` CLI 輪詢 PR / check runs                      | PM 清單  |
| 3   | `electron/ipc/ask-code.ts`                         | Ask About Code（spawn `claude -p`）                | PM 清單  |
| 4   | `electron/ipc/ask-code-minimax.ts`                 | `fetch` → `api.minimax.io`                         | PM 清單  |
| 5   | `src/lib/marked-shiki.ts`                          | Markdown 外部 `<img>`（renderer 直接抓）           | PM 清單  |
| 6   | `electron/ipc/huly.ts`                             | Huly WebSocket 同步                                | PM 清單  |
| 7   | `electron/ipc/git.ts` `pushTask()`                 | `git push -u origin` → 連 remote                   | **新增** |
| 8   | `electron/ipc/git.ts` `detectMainBranchUncached()` | `git remote set-head origin --auto` → 連 remote    | **新增** |
| 9   | `electron/ipc/pty.ts` `buildDockerImage()`         | `docker build` → registry / apt / npm / NodeSource | **新增** |

### 多出來的三個怎麼找到的

前六個都是用「HTTP client」的形狀去 grep 出來的（`fetch(`、`net.request`、`https://`、
`WebSocket`）。這個 grep 有一個系統性盲點：**由 app 自己決定去 spawn 的 CLI，
其連線行為在原始碼裡完全沒有 URL 或 HTTP 的字樣。**

所以第二輪改用「子命令語意」去掃：
`rg -e "'(fetch|push|pull|ls-remote|clone|remote)'"` → 撈出 7 與 8；
`rg -e "spawn\(" -e "execFile\("` 逐一判讀 → 撈出 9（`cpSpawn('docker', ['build', …])`）。

第三輪反向核對：把 `PRIVACY.md` 既有的「Network activity initiated by Parallel Code itself」
九個 bullet 逐條回推到程式碼。這一輪沒有再撈出新的，兩邊收斂，才停手。

8 是這三個裡面最值得補的：它**沒有使用者手勢**——只要
`refs/remotes/origin/HEAD` 過期，光是開一個專案就會去連 remote。
以「離線模式」的承諾而言，隱式連線比顯式連線更該被關掉。

### 盤點後判定為「不在範圍內」的（附理由）

- `electron/mcp/client.ts` 的 `fetch` —— baseUrl 是本機 app 的 loopback listener，
  不是對外連線。
- `electron/remote/server.ts`、MCP listener —— 是 **inbound** listener，不是 outbound
  request。且本來就預設關閉、由使用者明確啟動。屬於另一個議題。
- `src/remote/ws.ts`、`src/remote/api.ts` —— 跑在手機瀏覽器裡的 mobile SPA，
  連回本機 app。不是桌面 app 自己發的請求。
- `shell.openExternal` —— 把 URL 交給 OS 預設瀏覽器，app 自己沒發請求。
- Agent terminal 裡第三方 CLI 自己的流量 —— 依交辦裁決明確不管。

## Plan Steps

- [x] Step 1 — 重新盤點對外連線點，確認六個是否完整（結果：九個）
- [x] Step 2 — 開關狀態與純函式判斷邏輯
- [x] Step 3 — 九個連線點全部接上開關
- [x] Step 4 — Settings UI（Privacy 區塊）
- [x] Step 5 — `PRIVACY.md` 與 PRD §7.1 同步為九
- [x] Step 6 — 四道 gate 全綠

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1717，entry bundle 不得超過 90%
2. 每一個連線點都有測試斷言「開關關閉時不發出請求」
3. 若最終盤點數量不是六，說明多／少的是哪些、怎麼發現的
4. `PRIVACY.md` 與 PRD §7.1 的數字與實作一致
5. commit 列明確路徑

## 決策紀錄

### D1 — 開關放在呼叫點，不做網路層攔截

依交辦裁決。補充實作上的理由：`session.webRequest` 只看得到 renderer 的流量，
九個連線點裡有七個在 main process（其中三個還是 spawn 出去的 CLI），攔截層根本蓋不到。
就算蓋得到，失敗會變成靜默逾時 —— 正好是這個功能要消滅的東西。

### D2 — main 自己讀 `state.json`，不等 renderer 推

開關是 renderer 的 store 欄位（跟其他設定一起持久化），但九個連線點有七個在 main。
自然作法是 renderer 載入後透過 IPC 推給 main。問題：updater 的靜默檢查是
**啟動後 10 秒**的 timer，renderer 通常能在 10 秒內完成 round-trip —— 但「通常」
不足以拿來擔保一個隱私承諾。

所以 `registerAllHandlers` 一開頭就直接 `parsePersistedOfflineMode(loadAppState())`，
在 `initPrChecks` / `initAutoUpdater` 之前把值設好。renderer 的推送仍保留，
負責兩件事：使用者切換時同步、以及首次啟動（沒有 state 檔）時的一致性。

### D3 — 兩個獨立模組，不共用一份 pure module

`electron/ipc/offline.ts` 與 `src/lib/offline-mode.ts` 各自獨立。
一度想合成一個共用模組，但：depcruise 禁止 renderer import main（白名單只有
`channels.ts` 與 `prompt-detect.ts`）；反向讓 electron import `src/lib` 則會炸掉
`npm run compile` —— electron tsconfig 的 `rootDir` 是 `.`，src 不在底下。
兩邊實際共用的只有一個 boolean，複製一個 boolean 比在架構規則上開洞便宜。

### D4 — updater 新增 `offline` phase，而不是塞進 `error`

`error` phase 的語意是「出事了」，離線模式沒有出事。獨立 phase 讓 UI 能講
「離線模式已啟用」而不是紅字報錯，同時把 `offline` 放進 `canCheckForUpdates`
白名單 —— 使用者關掉開關後按鈕還在，一鍵就能重試。塞進 `error` 會兩者皆失。

### D5 — pr-checks 不沿用既有的 `disabled` latch

`disabled` 是「這個 session 沒有 gh / gh 沒登入」的**永久**閂鎖，設了就不會回頭。
離線模式是可逆的，語意完全不同，混用會導致關掉開關後輪詢再也不會恢復。
改成每次呼叫查 `isOfflineMode()`，另外加一個 `applyOfflineMode()` 讓 register.ts
在開關變動時停掉／重新啟動 timer —— 輪詢是 timer 驅動的，是九個裡唯一需要
「被通知」的，其餘八個查詢即可。task 訂閱刻意保留，關掉開關就自動恢復。

### D6 — `git remote set-head` 靜默略過，不報訊息

其餘八個都給明確訊息，這個刻意不給：它背後沒有使用者動作（是 `detectMainBranch`
內部的隱式行為），沒有「動作」可以解釋。略過後直接走既有的 local ref fallback ——
那條路徑本來就存在（無網路／無 remote 時走的就是它），且已有測試覆蓋。
只記 debug log。

### D7 — Markdown 圖片：決策邏輯抽到 pure function

原本把判斷寫在 DOMPurify hook 裡，但 vitest 是 `environment: 'node'`，
實測 `DOMPurify.sanitize is not a function` —— 在 node 下根本載不起來，測不到。
於是把決策抽成 `blockExternalImage(node)`，參數型別用結構型 `AttributeBearingNode`
（四個方法）而非 `Element`，marked-shiki 只留一層 adapter。真正的 `Element`
結構上滿足這個介面，測試則用一個 Map-backed 的假節點。

順帶：`isExternalResourceUrl` 解析 scheme 而不是 `startsWith('http')`，
因為 protocol-relative `//host/x.png` 會繼承頁面 scheme 真的發請求，前綴比對會漏。
`srcset` 也要清掉，否則 responsive image 還是會連到同一台主機。

### D8 — 連線點數量只留一份真實來源

`OUTBOUND_SURFACES` 陣列是唯一來源。原本在 `src/lib` 也放了一個
`OUTBOUND_SURFACE_COUNT = 9`，等於把同一個宣稱抄兩份 —— 常數改了測試還是綠的，
測試就不再證明任何事。改成測試從 `OUTBOUND_SURFACES.length` 推導，
並實際讀 `PRIVACY.md` 與 `docs/PRD.md` 比對，把驗收條件 4 變成機器檢查。

### D9 — Remote Access / MCP listener 判定為 inbound，不納入

兩者都是 listener，接受連線而非發出連線，跟「app 自己發請求」不是同一件事。
且都已預設關閉、由使用者明確啟動／停止 —— 已經有控制手段。
文件裡明講這條界線，避免被讀成漏掉。

### D10 — `persistence.test.ts` 的 mock 需要補 `fireAndForget`

`vi.mock('../lib/ipc')` 是整個模組替換，`loadState` 現在會呼叫
`fireAndForget` 推送開關，mock 沒列到就是 `undefined is not a function`（48 個測試掛掉）。
考慮過改用 `invoke().catch()` 繞開，但那是為了遷就測試而讓 production 用比較差的寫法。
補 mock 才是誠實的修法。

## 結束摘要

**做完了什麼**

PRD §13 Q3 裁決的「完全離線模式」總開關已實作並全綠。單一開關
（Settings → Privacy → Offline mode），持久化在 `state.json` 的 `offlineMode`
（沿用既有 rolling backup 機制，未新增檔案）。

**盤點結果：九個，不是六個**

交辦清單六個、PRD §13 Q3 只提三個，實際九個。多出來的是
`git push`、`git remote set-head origin --auto`、`docker build`。
關鍵在於換了搜尋方式：前六個是用 HTTP 形狀（`fetch(`、`https://`、`WebSocket`）grep 到的，
但**由 app spawn 出去的 CLI，其連線行為在原始碼裡沒有任何 URL 或 HTTP 字樣**，
這類 grep 系統性地看不到。改用子命令語意掃 `push|pull|fetch|ls-remote|remote`
與逐一判讀 `spawn(` / `execFile(` 才撈出來。

其中 `git remote set-head origin --auto` 最值得補：它是九個裡**唯一沒有使用者手勢**的，
只要遠端追蹤 ref 過期，光是開一個專案就會連 remote。

**四道 gate**

| Gate                   | 結果                                                    |
| ---------------------- | ------------------------------------------------------- |
| `npm run check`        | 綠（compile + typecheck + lint + format:check）         |
| `npm run check:static` | 綠（419 modules / 1392 deps，no dependency violations） |
| `npm test`             | 1786 passed / 24 skipped（baseline 1717，+69）          |
| `npm run check:bundle` | entry 87.3%（1,309,507 B / 1,500,000 B），dist 85.0%    |

entry 從 87.1% 升到 87.3%，增量來自 `src/lib/offline-mode.ts` 與
`src/store/offline.ts`（都是小型純模組），未新增任何依賴。

**測試**

九個連線點各有測試斷言「開關開啟時不發出請求」，全部可獨立執行
（每個 describe 都有 `beforeEach(() => setOfflineMode(false))`，
不依賴前一個測試留下的 module-level 狀態）。
另有文件一致性測試：從 `OUTBOUND_SURFACES.length` 推導，實際讀
`PRIVACY.md` 與 `docs/PRD.md` 比對數字與清單，數字漂移會直接讓測試紅。

**刻意沒做**

- 第三方 CLI 自身流量：依裁決不管，文件明講這條界線
- per-surface 細粒度開關：YAGNI
- 網路層攔截：見 D1
- Remote Access / MCP listener：inbound，見 D9

## 結束摘要

（完成時補）
