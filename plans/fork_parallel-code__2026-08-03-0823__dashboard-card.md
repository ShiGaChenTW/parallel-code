# Dashboard 卡片 — 跨任務彙總 ＋ 專案概況

**建立時間：** 2026-08-03 08:23
**最後更新：** 2026-08-03 09:29
**狀態：** 已完成（未 commit）

## 目標

新增一張 Dashboard 卡片，把目前散在各處、或根本沒有出口的資訊集中成一個畫面：
上半是**跨任務彙總**（每個 task 的狀態、分支、git 髒/淨、agent 數），下半是**專案概況**
（累計完成任務數、合併行數、尖峰併發、目前開啟任務數）。沒有開任何 task 時，它就是
首頁；有 task 時可用快捷鍵／Session 選單叫出來。

資料全部來自既有 store，不新增 IPC。`completedTaskCount`、`mergedLinesAdded/Removed`、
`mergedTaskTotal`、`peakConcurrentTasks` 目前只餵 onboarding，沒有任何 UI 顯示 —— 這張卡
是它們第一個出口。

## Plan Steps

- [x] Step 1 — 盤點資料來源：`AppStore.tasks` / `taskOrder` / `taskGitStatus` / `agents` / 四個累計統計欄位
- [x] Step 2 — 決定範圍與擺放位置（見決策紀錄）
- [x] Step 3 — 寫實作規格並派 agent（Forge / GPT-5.4）
- [x] Step 4 — 實作 `dashboard-stats.ts`(174) ＋ `DashboardCard.tsx`(416) ＋ 測試(326, 14 cases)
- [x] Step 5 — 接進 `TilingLayout` 空狀態（+2 行），OnboardingChecklist 之上
- [x] Step 6 — typecheck / lint / vitest / format 全綠（我獨立重跑確認）
- [x] Step 7 — 人工驗收：以獨立 user-data-dir 起兩個無任務實例（ember / workbench），截圖確認不破版

## 決策紀錄

- 08:20 — 解除 2026-08-10 封鎖期（Scott 明確指示），刪除對應記憶檔
- 08:22 — 範圍取「全域彙總 ＋ 專案概況」合一，不做單一任務總覽卡；理由：後者的資料
  已經散在 branch info bar 與各 section，再做一張是重複
- 08:23 — 純計算邏輯抽成 `dashboard-stats.ts`，與 SolidJS 元件分離，讓測試不需要掛載元件
  （沿用專案既有慣例：`merge-readiness.ts`、`sidebar-tree.ts`）
- 08:24 — 不新增 IPC；`taskGitStatus` 快照已由既有輪詢維護，dashboard 只讀
- 08:47 — Agent 決定 task 狀態與 agent 數一律由 `store.agents` 依 `taskId` 反查，不信
  `task.agentIds`（兩者可能不同步，record 才是真相）
- 08:47 — git 狀態做成 5 member discriminated union（unknown / error / dirty / committed /
  clean），`error` 不併入 clean 或 dirty，訊息原樣帶出
- 08:48 — `+X −Y` 不走 `tr()`：純數字符號沒有語言成分，送進去會在 i18n 目錄產生
  self-mapping 條目、打爆 `i18n.test.ts` 的既有守則。Agent 發現後自行修掉
- 09:25 — 驗收方式：不動 Scott 正在用的 dev profile（裡面有真實 worktree task，關掉會刪
  worktree）。改用 `--user-data-dir=<scratch>/profile-*` 起臨時實例，state.json 只保留專案、
  清空 tasks，直接落在空狀態畫面；驗完即殺

## 阻塞 / 待決議

無

## 結束摘要

Dashboard 卡片完成並目視驗收通過，**尚未 commit**。

畫面（空狀態，`{mod}+N` 提示下方、第一次使用清單上方）：

- 「開啟中的 TASK」＋摘要行「N 個執行中 · M 個閒置 · K 個 tasks」，無任務時顯示引導句
- 「專案總覽」四格：已完成 task 數 / 已合併行數 `+X −Y` / 累計已合併 task 數 / 最高同時 task 數

驗收結果：ember 與 workbench 兩個 look 都不破版，卡片置中、無溢出、OnboardingChecklist
行為未變。四格統計在 workbench 的中性灰盤也讀得清楚。

已知取捨：卡片保留 12px 圓角，不掛 `.task-column`，所以在 workbench（該 look 把 task 欄位
圓角全部歸零）底下會比周邊圓一點。這是刻意的 —— 掛上去會被 `!important` 連坐。若要完全
貼合 workbench，另外加一條 `html[data-look='workbench'] .dashboard-card { border-radius: 0 }`
即可，一行的事。

後續建議：有 task 開著時也想看 dashboard 的話，加快捷鍵 ＋ overlay 即可，元件本身不用改。
