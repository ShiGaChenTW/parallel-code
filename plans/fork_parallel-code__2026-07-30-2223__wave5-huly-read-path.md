# 第五波：Huly 讀取路徑 + 一鍵開工（FK_PC-6）

**建立時間：** 2026-07-30 22:23
**最後更新：** 2026-07-30 22:23
**狀態：** 進行中

## 目標

實作 FK_PC-6：從 Huly 讀 issue 清單，並把一張 issue 一鍵變成 git worktree + 跑起來的 agent。
**不做看板**（FK_PC-8 已決議否決），**不做寫入路徑**（FK_PC-7，另計 4–6 天）。

## 前置：版本落差（已實測，非推論）

| 項目                                     | 版本    |
| ---------------------------------------- | ------- |
| 伺服器 `MODEL_VERSION`（config.json）    | 0.7.426 |
| npm 上最新的 `@hcengineering/api-client` | 0.7.423 |

**客戶端落後伺服器。** 實測結果：連線成功、`findAll` / `createDoc` / `addCollection` /
`uploadMarkup` / `fetchMarkup` 全部可用，8 張 issue 建立後讀回內容完全正確。
代價是啟動時噴一整排 `no document found, failed to apply model transaction` 警告
（客戶端載入了它無法套用的 model tx）。

判斷：**讀取路徑可以在這個落差下進行**，但必須 pin 版本，且警告要吞掉不能污染 app log。
這正是研究報告標的 pre-1.0 lockstep 風險第一次具體現形。

## 範圍

做：

- `electron/ipc/huly.ts` —— 單一模組，main process 專用（`dependency-cruiser` 會擋 renderer import）
- 憑證走 Electron `safeStorage`，**不進 persisted JSON blob**
- IPC channel（manifest + `preload.cjs` 兩處鎖步）
- 離線快取：最後一次成功的 issue 清單存進 persisted state，開啟時先渲染再更新
- `Task.hulyIssueId` / `hulyIssueIdentifier` 連結欄位
- NewTaskDialog 的 issue picker（清單 + 按鈕，不是拖拉）
- `PRIVACY.md` 新增 egress 條款

不做：

- 寫入 Huly（FK_PC-7）
- 看板 UI（FK_PC-8 已否決）
- 通用多 provider adapter（單人單目標，YAGNI —— 第一波評估已排除）

## Plan Steps

- [ ] Step 1 — 加依賴並 pin 版本，確認 bundle gate 不受影響（main process 專用）
- [ ] Step 2 — `electron/ipc/huly.ts`：連線 + 列 issue，警告收斂
- [ ] Step 3 — 憑證：`safeStorage` 存取，含未加密可用時的降級處理
- [ ] Step 4 — IPC channel 兩處鎖步 + handler
- [ ] Step 5 — store：連結欄位 + 離線快取 + 純 reducer
- [ ] Step 6 — 測試（node 環境，pure reducer + 憑證邏輯）
- [ ] Step 7 — NewTaskDialog issue picker + 一鍵開工
- [ ] Step 8 — `PRIVACY.md` egress 條款
- [ ] Step 9 — 全套驗證

## 決策紀錄

- 22:23 — 版本落差選擇「pin 0.7.423 並繼續」而非「等 0.7.426 發佈」。原因：實測讀寫全部可用，
  且等待沒有明確時程。風險已記錄在 FK_PC-6。

## 阻塞 / 待決議

- token 目前只存在於已刪除的 scratchpad。實作完成後需要 Scott 從 UI 重新輸入（走 `safeStorage`）。
- **對話紀錄中的 token 仍需撤銷。**

## 結束摘要

（待補）
