# 第二波：移除 PTY 的 base64 來回

**建立時間：** 2026-07-30 20:27
**最後更新：** 2026-07-30 20:27
**狀態：** 已完成

## 目標

桌面終端資料路徑目前把 PTY bytes 在 main 端 base64 編碼、在 renderer 端解回 `Uint8Array`，
而 `term.write()` 本來就吃 `Uint8Array` —— 這對編解碼是純浪費：+33% payload、每批 64KB 的字串
配置 churn，且是乘以 N 個併發 agent 的**穩態**成本（與第一波 monaco 的一次性收益互補）。

## 前置條件：contextBridge spike（已通過）

在 scratchpad 建可丟棄 Electron 專案，複製 `electron/main.ts` 的 webPreferences
（`contextIsolation: true`、`nodeIntegration: false`、sandbox 保持預設）與 `preload.cjs` 的
contextBridge wrapper，送 64KB 涵蓋全 byte range（含 0x00、0xFF）的 payload：

| 案例                   | renderer 收到         | `instanceof Uint8Array` | size | checksum |
| ---------------------- | --------------------- | ----------------------- | ---- | -------- |
| 現況 base64 string     | `[object String]`     | false                   | ✓    | ✓        |
| Node `Buffer` 直送     | `[object Uint8Array]` | **true**                | ✓    | ✓        |
| 明確 `Uint8Array` view | `[object Uint8Array]` | **true**                | ✓    | ✓        |

**帶與不帶 `--no-sandbox` 都全數通過**（後者才是打包後的實際條件）。結論：base64 那一對可以刪。

## 範圍界定：哪些 base64 要保留

改（桌面 channel 路徑，push 到 renderer）：

- `electron/ipc/pty.ts:342` banner
- `electron/ipc/pty.ts:347-349` `flush()` 熱路徑
- `electron/ipc/pty.ts:437-439` reattach 時的 scrollback replay
- `src/components/TerminalView.tsx:839` 唯一的消費端
- `electron/ipc/shared-types.ts:2` 型別 `data: string // base64-encoded` → `Uint8Array`

**不動**（這些 base64 是正確的，走 HTTP/WS JSON 或 MCP）：

- `getAgentScrollback()`（`pty.ts:590`）→ `remote/server.ts:939,1232`、`mcp/coordinator.ts:307,1300`
- `RingBuffer.toBase64()`
- `src/remote/AgentDetail.tsx:242,264` 與 `base64ToUint8Array`（remote WebSocket 路徑）
- `pty.ts:1012` docker build 輸出（是文字，無關）

## Plan Steps

- [x] Step 1 — contextBridge typed-array spike（含 sandbox 開啟的嚴格條件）
- [x] Step 2 — 盤點 base64 消費者，界定改與不改的邊界
- [x] Step 3 — 改型別 `shared-types.ts`：`data: Uint8Array`
- [x] Step 4 — 改 main 三個 send 點（banner、`flush()`、reattach replay）
- [x] Step 5 — 改 renderer 唯一消費點，並移除變成未使用的 import
- [x] Step 6 — 更新 `pty.test.ts` 的 base64 斷言
- [x] Step 7 — 新增測試守住 encoding-split 契約（+1 test）
- [x] Step 8 — 全套驗證 + 實測收益

## 成果（實測，非估算）

| 項目                        | 數值                                  |
| --------------------------- | ------------------------------------- |
| 每批 64KB 的 IPC payload    | 87,384 B → **65,536 B（−33.3%）**     |
| 單 agent 滿載省下的 payload | 2.6 MB/s                              |
| 4 / 8 agents 滿載           | 10.4 / **20.8 MB/s**                  |
| base64 編解碼 CPU（每批）   | 0.019 ms —— 8ms flush 預算的 **0.2%** |
| 測試                        | 1628 passed（原 1627，+1 新測試）     |

**誠實修正**：我先前把 base64 排在 monaco 之前、稱它「更可能是真熱點」，那個說法在 **CPU 軸上是誇大的**
—— 實測編解碼只佔 flush 預算 0.2%。真正的收益是 **IPC payload 減 33.3%** 與少掉的字串／陣列配置
（GC 壓力），屬穩態；而 monaco 是 3.7MB 的一次性 bundle 收益。兩者互補，但排序理由不成立。
上面的 MB/s 是**滿載上限**，不是典型值。

## 決策紀錄

- 20:27 — spike 用可丟棄的獨立 Electron 專案，不寫進 repo。原因：一次性驗證，不該留在專案裡當測試負債。
- 20:27 — spike 必須測「不帶 `--no-sandbox`」。原因：`npm run dev` 帶這個 flag，但**打包後的 app 沒有**，
  只測寬鬆條件會漏掉 packaged 才出現的差異。三案在兩種模式下皆 byte-identical。
- 20:27 — 只改桌面 channel 路徑，`getAgentScrollback()` 保持 base64。原因：它的消費者是 HTTP/WS JSON
  與 MCP，那裡 base64 是正確選擇；一起改會擴大 blast radius 且沒有收益。
- 20:35 — 發現 `flush()` 還會把同一份 base64 餵給 `session.subscribers`（remote WS + MCP coordinator）。
  改為**只在 `subscribers.size > 0` 時才編碼** —— 沒有遠端連線也沒有 coordinator 時完全不付這個成本。
  排除「連 subscriber 契約一起改成 bytes」一案（要動 5882 行的 `coordinator.test.ts`，blast radius 過大）。
- 20:38 — reattach 的 `if (scrollback)` 改成 `if (scrollback.length > 0)`。原因：空字串 falsy，
  但**空 Buffer 是 truthy** —— 型別變更把這個潛在 bug 逼了出來。
- 20:44 — **反向驗證（mutation）發現新測試守不住 `subscribers.size > 0` 分支**：把條件強制為 `true`，
  測試依然全綠，因為沒有訂閱者時多算的 base64 沒有可觀察後果。已把測試註解改成不誇大 ——
  它守的是 encoding-split 契約，不是那個 fast path。該分支是純效能選擇，行為測試抓不到，這樣就對了。
- 20:47 — `npm run typecheck` 沒抓到測試檔的 `Array.push` 回傳 number vs `: void` 型別錯，
  `npm run compile` 抓到了。原因：root `tsconfig.json` 的 `include` 只有 `["src", "electron/ipc/channels.ts"]`，
  electron 測試檔不在該 project 裡。**兩個都要跑，不能只跑 typecheck。**

## 阻塞 / 待決議

無（承接第一波的三項未決事項：lockfile 漂移、`.codex/`+`openspec/` 的 format 失敗、無工具可抓
「imported but inert」）。

## 結束摘要

**做了什麼**：把桌面終端資料路徑從 base64 改成原始 bytes。main 端三個 send 點直送 `Buffer`，
renderer 端直接把 `msg.data` 交給 xterm，型別由 `data: string // base64-encoded` 改為 `Uint8Array`。
subscriber 的 base64 改成延遲計算（僅在 remote 或 coordinator 附著時）。IPC payload 減 33.3%。

**未做什麼**：`getAgentScrollback()` 與 remote WebSocket 路徑刻意保持 base64。沒有把 subscriber
契約改成 bytes（blast radius 不值得）。

**驗證**：compile / typecheck / lint / check:static 全過，1628 tests passed。spike 在 sandbox
開與關兩種模式下都證明 byte-identical。新增一個守住 encoding-split 契約的測試，並用 mutation
驗證過它的實際涵蓋範圍（誠實記錄它守不住那個 perf 分支）。

**後續建議**：

1. 前兩波的一次性收益（bundle）與穩態收益（IPC）都拿到了。下一個效能項應該**先量再做** ——
   目前沒有 cold start / TTI / idle RSS 的數字，這三個是使用者真正感受到的。
2. CI 沒有 bundle size gate。剛減下來的 3.7MB 沒有東西防止它長回去。
3. 承接第一波的三項未決：lockfile 既存漂移、`.codex/`+`openspec/` 的 format 失敗、
   「imported but inert」無工具可抓。
