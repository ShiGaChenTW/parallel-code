# 第三波：bundle size gate + 啟動量測

**建立時間：** 2026-07-30 21:10
**最後更新：** 2026-07-30 22:02
**狀態：** 已完成

## 目標

前兩波拿到 3.7 MB 的 entry chunk 減量與 33% 的 IPC payload 減量，但**沒有任何東西防止它長回去**。
先補這道防線（成本低、確定性高、保護已有成果），再做啟動量測。

順序理由：gate 是保護，量測是探索。保護先做，因為它便宜且防止回歸。

## Plan Steps

- [x] Step 1 — 寫 `scripts/check-bundle-size.mjs`：純函式 + `pathToFileURL` main-guard
- [x] Step 2 — 寫 `scripts/check-bundle-size.test.mjs`：8 個測試，合成輸入，不依賴真實 dist
- [x] Step 3 — 加 `check:bundle` npm script
- [x] Step 4 — 接進 CI（`check:static` 之後）
- [x] Step 5 — 設定預算並記錄理由
- [x] Step 6 — 反向驗證：真的把 monaco import 加回去，gate 確實紅
- [x] Step 7 — 全套驗證
- [x] Step 8 — idle RSS 量測（cold start / TTI 無法量，理由見下）

## 成果

### Bundle gate（已上線）

`scripts/check-bundle-size.mjs` + 8 個單元測試 + `npm run check:bundle` + CI step。

| 預算項               | 現況         | 預算         | 已用  |
| -------------------- | ------------ | ------------ | ----- |
| renderer entry chunk | 1,266,514 B  | 1,500,000 B  | 84.4% |
| dist total           | 15,262,119 B | 18,000,000 B | 84.8% |

**反向驗證（不是推論）**：把 monaco import 加回去實際重建，entry chunk 變 5,004,337 B，
gate exit 1 並印出 `over by 3,504,337 B`。這道 gate 真的擋得住當初那個回歸。

測試裡另有兩道 meta 防線：預算不得低於導入時的實測值（防止有人靠調低預算「修好」失敗），
且 entry 預算必須低於 monaco 回歸後的實測 5,004,337 B（否則就不算 gate）。

### idle RSS：量到了，但結論是「這個 harness 不夠力」

零改動外部量測（唯一 `--user-data-dir` 當選擇器，跨 5 個 Electron 行程加總 RSS）：

| 狀態                | n   | median     | range      |
| ------------------- | --- | ---------- | ---------- |
| before（含 monaco） | 7   | 490 MB     | 346–523 MB |
| after（已移除）     | 7   | **405 MB** | 382–465 MB |

median 差 85 MB（−17.3%），**方向與預期一致，但兩組分布重疊嚴重**（before 最低 346 < after 最高 465）。
U = 37/49（虛無假設期望 24.5）—— 只能說 suggestive，**不能宣稱已證實**。

誠實結論：**這個 harness 解析不了 100 MB 以下的差異。** 噪音來源是固定 `sleep` 之後 app 仍在
做啟動工作（git 輪詢、window state 還原）且 V8 heap 成長非決定性。要更準必須等 app 發出真正的
quiescence 訊號 —— 那需要 instrumentation。

### cold start / TTI：沒有量，因為量不到

`electron/main.ts` 與 renderer **完全沒有任何啟動計時**（`rg 'performance\.(now|mark|measure)' src`
只在 `terminalFitManager.ts` 命中，與啟動無關）。從外部無法觀測「可互動」這個時間點。

最小方案：在 `app.whenReady`、`did-finish-load`、renderer `render()` 後各記一個 `performance.now()`，
走既有的 `log.ts` 以 `debug` 等級輸出，再照 `check-coordinator-run.mjs` 的慣例寫 parser。
production 的 `minLevel` 是 `warn`，出貨成本為零。**但這是往 app 裡加機制，屬產品決定，本波不擅自加。**

## 決策紀錄

- 21:10 — gate 先於量測。原因：前兩波的收益毫無保護，而 gate 便宜且確定；量測是探索性的、有噪音，
  且沒有 gate 的話量了也守不住。
- 21:25 — 預算用**原始 bytes 而非 gzip**。原因：Electron 從本機磁碟載入，成本是 parse/compile 原始
  bytes，不是傳輸量。
- 21:25 — 預算給約 18% headroom。原因：gate 是擋「依賴等級的回歸」，不是緊身衣。一般功能成長
  （數十到一兩百 KB）應該過得去，monaco 等級（+3.7 MB）必須擋下。
- 21:30 — 反向驗證用**真的把 monaco 裝回去重建**，而不是調低預算來假造失敗。原因：後者只證明比較
  運算子能動，前者才證明這道 gate 擋得住它被設計來擋的東西。
- 21:38 — 第一版 RSS harness 用 awk 追 process 樹，回報 759 行程 / 19 GB —— **明顯是垃圾數字，沒有
  拿去報告**。改用唯一 `--user-data-dir` 字串當選擇器後得到合理的 5 行程。
  教訓：量測工具本身也要先過 sanity check。
- 21:52 — **不宣稱 monaco 移除降低了 idle 記憶體。** 雖然 median 差 85 MB 且方向正確，但分布重疊、
  n 小、before 組有一個 346 MB 樣本直接壓過 after 組中位數。排除「報 −17% 當成果」一案。
- 21:55 — **不擅自為了量 TTI 而在 app 裡加 instrumentation。** 那是往產品加機制，屬 Scott 的決定；
  本波職責是量測與保護，不是擴充。

## 阻塞 / 待決議

- **cold start / TTI 需要 instrumentation 才能量** —— 要不要加，等 Scott 決定（方案見上）。
- 承接前兩波：lockfile 既存漂移、`.codex/`+`openspec/` 的 format 失敗、「imported but inert」無工具可抓。
- `npm ls` 有 6 個 extraneous 套件（`@emnapi/*`、`@napi-rs/wasm-runtime` 等）。已查證是**既存狀況**：
  HEAD 的 lockfile 下有 10 個，我的改動後剩 6 個 —— 不是本次造成，且略有改善。

## 結束摘要

**做了什麼**：補上 bundle size gate（腳本 + 8 測試 + npm script + CI step），並用真實的 monaco 回歸
反向驗證它會紅。量到 idle RSS 的可重複基準（after 中位數 405 MB）。

**未做什麼**：沒有宣稱 monaco 移除降低了記憶體（數據不支撐）。沒有為了量 TTI 而在 app 裡加
instrumentation（留給 Scott 決定）。

**後續建議**：

1. 決定要不要加啟動 instrumentation。不加就接受 cold start 無法量化；加了才能把「開得比較快」
   從感覺變成數字。
2. 三波的未決事項（lockfile 漂移、format 失敗）建議在第一個 commit 前處理掉，否則 pre-commit 會紅。
3. gate 的預算之後若要調高，請在 commit message 寫明原因 —— 腳本註解已經這樣要求了。
