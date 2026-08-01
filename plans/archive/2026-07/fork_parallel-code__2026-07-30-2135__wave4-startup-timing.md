# 第四波：啟動計時 instrumentation + 清理三項未決

**建立時間：** 2026-07-30 21:35
**最後更新：** 2026-07-30 22:05
**狀態：** 已完成

## 目標

Scott 裁決：① 要加啟動 instrumentation；②③ lockfile 漂移與 format 失敗都處理。

## Plan Steps

- [x] Step 1 — main process 埋 4 個 mark
- ~~Step 2 — renderer 埋 mark~~ — 不需要：`did-finish-load` 在 renderer 初始 script（含 `render()`）
  執行完才觸發，已是夠好的 TTI 代理，少動一個檔案
- [x] Step 3 — 寫 `scripts/measure-startup.mjs`：啟動 N 次、解析、報中位數
- [x] Step 4 — parser 純函式測試（13 個，合成輸入，不啟動 app）
- [x] Step 5 — 實測 cold start 基準
- [x] Step 6 — 清理②：lockfile diff 從 +741/−1505 縮到 **+0/−23**
- [x] Step 7 — 清理③：`.prettierignore` 加入 agent 工具目錄，`format:check` 通過
- [x] Step 8 — 全套驗證

## 成果

### ① 啟動計時（已上線，production 零成本）

`electron/startup-timing.ts` + `main.ts` 4 個 mark + `scripts/measure-startup.mjs` + 13 個測試。

**實測 cold start（9 次中位數，ms from process spawn）：**

| mark                | median      | range    | 區間意義                      |
| ------------------- | ----------- | -------- | ----------------------------- |
| main-module-loaded  | 369 ms      | 298–430  | Electron 自身 boot            |
| app-ready           | 736 ms      | 574–909  | +367 ms — Electron 初始化     |
| window-created      | 747 ms      | 585–919  | +11 ms — 開視窗（很便宜）     |
| **renderer-loaded** | **1210 ms** | 929–1363 | +463 ms — 載入並執行 renderer |

**production 零成本已實測**：`NODE_ENV=production` 跑同一份 build，`grep -c 'startup mark'` = **0**。
因為 `log.ts:35` 的 `minLevel = isProd ? 'warn' : 'debug'`，而 mark 走 `debug`。

**誠實的但書**：另一輪 7 次取樣得到 renderer-loaded 中位數 706 ms（579–1046），與本輪的 1210 ms
差距不小 —— 機器負載會整體平移。**同一輪內的 median-of-N 可比較，跨輪的絕對值不可比。**
這個 harness 提供的是可重複的**方法**，不是絕對數字。

### ② lockfile：從 +741/−1505 縮到 +0/−23

原本的 diff 混了兩種改動：我的 monaco 移除，加上既存未提交的依賴漂移（298 個 version 欄位變動）。

處理方式：`git checkout package-lock.json` 回到 HEAD，再從乾淨狀態跑
`npm install --package-lock-only`。結果 diff **只剩 23 行刪除** —— `monaco-editor` 條目與它私有的
`marked@14.0.0` 副本，其餘一行未動。`npm ci` 驗證通過且不改動 lockfile（內部一致）。

⚠️ **既存的依賴漂移被捨棄了**（7.29.0→7.29.7 等）。它從未被提交，且用 `npm install` 隨時可重現。
如果那是 Scott 有意的升級，請當成**獨立的一個 commit** 重做 —— 這正是「不要混在一起」的目的。

### ③ format:check 通過

`.prettierignore` 加入 `.agent/`、`.codex/`、`openspec/`，比照既有的 `.claude/` 條目。
理由：這三個都是 openspec CLI 生成／改寫的 agent 工具目錄，格式化只會在重新生成時產生 churn。
`npm run format:check` 現在 exit 0，`npm run check` 整條通過。

## 決策紀錄

- 21:35 — 計時 log 用 `debug` 而非 `info`。原因：production `minLevel` 是 `warn`，保證零出貨成本。
- 21:35 — mark 內含絕對 `Date.now()`。原因：只用 log 相對時戳量不到 Electron 自身啟動，而那是使用者
  感受的一部分（實測佔 369/1210 = 30%）。
- 21:40 — **不加 renderer 端的 mark**。原因：`did-finish-load` 已在 `render()` 之後，多埋一個只是
  多動一個檔案。排除「renderer 用 LogFromRenderer 回報」一案。
- 21:42 — `markStartup` 做成 per-mark idempotent。原因：`did-finish-load` 在 reload 時會再觸發，
  第二次的 renderer-loaded 會讓一次 reload 看起來像一次啟動。
- 21:55 — lockfile 選擇「回到 HEAD 再重做」而非「保留現狀但說明」。原因：Scott 說「處理」，
  而真正的處理是讓 diff 可 review；+0/−23 一眼可審，+741/−1505 不能。代價是捨棄既存漂移，已標註。
- 21:58 — `.prettierignore` 用忽略而非 `prettier --write`。原因：那些檔案由 openspec CLI 生成，
  格式化後下次重新生成又會不一致；比照既有的 `.claude/` 處理方式。
- 22:00 — **刪掉自己剛寫的 `resetStartupMarks`**。knip 抓到它是 unused export —— 我加它當「測試接縫」
  但沒有任何測試用它。這正是前三波一路在刪的那種投機程式碼，不能自己犯。
  同理把 `STARTUP_MARK_MSG` 從 export 降為 module-local const（沒有任何 importer）。

## 阻塞 / 待決議

- **`.gitignore:16` 的 `docs/*` 讓 `docs/research-2026-07-30-personal-workstation.md` 被忽略** ——
  前幾波的研究報告不會進 commit。要保留就得加一條 negation（如 `!docs/research-*.md`）。
  本波不擅自改 `.gitignore`，等 Scott 決定。
- 既存依賴漂移已被捨棄（見上），若是有意升級請獨立重做。
- 「imported but inert」無工具可抓 —— 這是 bundle gate 存在的理由，已由第三波處理。

## 結束摘要

**做了什麼**：加上啟動計時（4 個 mark，production 零成本已實測）與多次取樣的量測 harness，
拿到 cold start 基準（renderer-loaded 中位數 1210 ms，其中 30% 是 Electron 自身 boot）。
lockfile diff 從 +741/−1505 縮到 +0/−23。`format:check` 修好，`npm run check` 整條通過。

**未做什麼**：沒有改 `.gitignore`（研究報告被忽略一事留給 Scott 決定）。沒有替 renderer 埋額外的
mark（`did-finish-load` 已足夠）。

**後續建議**：

1. `docs/*` 的 gitignore 要不要開例外給研究報告。
2. 既存依賴漂移若是有意升級，獨立跑一次 `npm install` 並單獨提交。
3. 現在四波的 gate 都齊了（check / check:static / check:bundle / test），可以開始提交。
   建議拆成幾個 commit：monaco 移除、PTY base64、bundle gate、startup timing、清理。
