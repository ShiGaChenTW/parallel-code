# 第五波：Huly 讀取路徑 + 一鍵開工（FK_PC-6）

**建立時間：** 2026-07-30 22:23
**最後更新：** 2026-07-30 22:23
**狀態：** 已完成

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

- [x] Step 1 — 加依賴並 pin 精確版本（`--save-exact`），bundle gate 未受影響
- [x] Step 2 — `electron/ipc/huly.ts`：連線 + 列 issue，model 警告收斂
- [x] Step 3 — 憑證：`safeStorage`，加密不可用時**拒絕儲存**而非降級寫明文
- [x] Step 4 — IPC 5 個 channel 兩處鎖步 + handler
- [x] Step 5 — store：`hulyIssueId` 連結欄位、離線快取、純 reducer
- [x] Step 6 — 測試：`huly.test.ts` 11 個 + `huly-issues.test.ts` 18 個
- [x] Step 7 — `HulyIssuePicker` + `HulySettings` + 一鍵開工
- [x] Step 8 — `PRIVACY.md` egress 條款
- [x] Step 9 — 全套驗證通過

## 成果

| gate                       | 結果                               |
| -------------------------- | ---------------------------------- |
| compile / typecheck / lint | PASS                               |
| check / check:static       | PASS                               |
| check:bundle               | entry 1,281,996 B（85.5%），未超支 |
| lint:arch                  | 412 modules、1344 deps，零違規     |
| test                       | **1690 passed**（本波新增 29）     |

renderer 對 `@hcengineering` 零引用 —— 依賴完全留在 main process。

### 一鍵開工的實際形狀

`NewTaskDialog` 頂端出現 issue picker（只在設定了 Huly 專案時顯示）：先渲染快取、背景刷新、
可搜尋、**已有任務的 issue 不列出**（避免重複開 worktree）。點一張 issue → 帶入任務名稱 →
建立時把 `hulyIssueId` / `hulyIssueIdentifier` 存進 Task。

### 過程中 knip 兩次擋下半成品

第一次：`huly.ts` 的 5 個 export 沒有消費者 → 補完 IPC handler。
第二次：`store/huly.ts` 的憑證動作沒有消費者 → 補完 `HulySettings`。
兩次都是在說「這個模組還沒被接起來」，而不是「這個 export 多餘」。沒有它，我會提交兩次半成品。

### i18n 目錄完整性測試也擋了兩次

`Coordinator`、`Workspace`、`Token` 各自對應到自己 —— 全部改成不列入目錄（`translate()` 本來就
fallback 到原文）。Workspace/Token 保持英文另有理由：那是 Huly 自己 UI 用的字，翻了兩邊會對不上。

## 決策紀錄

- 22:23 — 版本落差選擇「pin 0.7.423 並繼續」而非「等 0.7.426 發佈」。原因：實測讀寫全部可用，
  且等待沒有明確時程。風險已記錄在 FK_PC-6。

## 阻塞 / 待決議

- **對話紀錄中的 token 仍需撤銷**，然後從 Settings → Huly 重新輸入一次（走 `safeStorage`）。
- 0.7.423 / 0.7.426 的版本落差仍在。讀取不受影響，但寫入路徑（FK_PC-7）開工前要重新評估。

## 結束摘要

**做了什麼**：Huly 讀取路徑完整可用 —— 主程序客戶端、加密憑證、5 個 IPC channel、離線快取、
issue picker、設定 UI、隱私條款。29 個新測試，全部 gate 通過。

**未做什麼**：寫入 Huly（FK_PC-7）。看板（FK_PC-8 已否決）。通用 adapter（單人單目標，YAGNI）。

**後續建議**：實際跑一次 —— 在 Settings 填入憑證與 `FK_PC`，開新任務對話框，從 issue 開一個 task。
那是唯一能證明端到端可用的方式，而它需要真實憑證，只有 Scott 能做。
