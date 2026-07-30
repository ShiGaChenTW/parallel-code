# 第一波：效能 baseline + transcript MVP

**建立時間：** 2026-07-30 20:11
**最後更新：** 2026-07-30 20:48
**狀態：** 已完成（transcript MVP 兩項經查證後取消，理由見決策紀錄）

## 目標

執行研究報告第四節「第一波」：① 建立效能基準線；② 命題 6 MVP（persist `stepsContent` +
`GetScrollback` channel）。結果：①達成且收益遠超預期，②**兩項都被證明不存在缺口，取消**。

## Plan Steps

- [x] Step 1 — 記錄 baseline：production build，量 bundle 組成與各 chunk 大小
- [x] Step 2 — 確認 monaco 在 entry chunk，且**確認它根本沒被使用**
- [x] Step 3 — 移除 monaco 死碼：`index.tsx` 兩個 import、兩個 lib 檔、6 條死 CSS
- [x] Step 4 — 重建並比對 before/after
- [x] Step 5 — 移除 `monaco-editor` dependency（knip 轉為必做，見決策）
- [x] Step 6 — 移除 `--max-old-space-size=4096`（已實測不需要）
- [x] Step 7 — 全套驗證：compile / typecheck / lint / test / lint:dead / lint:arch 全通過
- ~~persist `stepsContent`~~ — 取消：已經有還原路徑
- ~~`GetScrollback` channel~~ — 取消：桌面端無缺口
- ~~contextBridge typed-array spike~~ — 延後到第二批，與 monaco 分開歸因

## 成果

| 指標             | Before          | After       | 改善                 |
| ---------------- | --------------- | ----------- | -------------------- |
| entry chunk      | 4,964,057 B     | 1,266,862 B | **−74.5%**（−3.7MB） |
| entry chunk gzip | 1,292 kB        | 348 kB      | **−73%**             |
| `dist` 總量      | 29 MB           | 15 MB       | **−48%**             |
| js chunks        | 476             | 384         | −92                  |
| monaco worker 檔 | 5 個 / 9.36 MB  | **0**       | 全消                 |
| build 峰值 RSS   | 1.88 GB         | 1.15 GB     | −39%                 |
| build 時間       | 3.01s           | 1.24s       | −59%                 |
| `node_modules`   | 含 74 MB monaco | 已移除      | −74 MB               |

程式碼淨變化：5 檔案，+1 / −210 行。測試 1627 passed（與改動前完全相同）。

## 決策紀錄

- 20:11 — 先做 baseline 才動效能程式碼。原因：報告已認定「沒有 before/after 數字的效能 PR 不該進」。
- 20:24 — 原計畫「monaco lazy-load」改為「**刪除**」。證據：`rg monaco src` 只命中 `index.tsx` 與兩個
  lib 檔；無任何 `editor.create` / `createModel` / `IStandaloneCodeEditor`；`monacoThemeName()` 匯出後
  從未被呼叫；實際 highlighter 是 shiki。git 歷史：`ad987c7` 引入 Monaco diff view →
  `3755e60 chore: remove unused files...` 移除用法但留下依賴與註冊。排除 lazy-load 與 manualChunks 兩案。
- 20:24 — 原本決定不動 `package.json`（lockfile 有既存漂移）。**20:40 推翻**：移除 import 後 `knip` 把
  `monaco-editor` 標為 unused dependency 並 **exit 1**，會讓 CI 的 `check:static` 紅掉 → 移除 dependency
  從「可延後」變成「必做」。既存漂移經查是 7.29.0→7.29.7 版本更新加 dedup（淨 −741 行），與本次同類不衝突。
- 20:44 — 既然已動 `package.json`，一併移除 `--max-old-space-size=4096`。已實測不帶此 flag 可正常 build。
- 20:35 — **取消 persist `stepsContent`**。原因：`App.tsx:504-517` 已對每個 `stepsEnabled` 的 task 重讀
  `.claude/steps.json`（註解字面寫 "Restore steps content for tasks that had steps before restart"）。
  磁碟是 source of truth，持久化會是重複狀態且會走味。**研究報告此處的推論有誤，已修正。**
- 20:38 — **取消 `GetScrollback` channel**。原因：`TaskAITerminal.tsx:124-126` 說明終端以
  `visibility:hidden` 常駐「so their pty sessions and scrollback survive」，且 `pty.ts:437-439` 在
  reattach 時主動 replay scrollback。桌面端是 push replay，不需要 pull API。加沒有消費者的 channel
  就是剛刪掉的那種死重量。**研究報告此處把「事實」誤判為「缺口」，已修正。**
- 20:30 — 修正：IPC channel 新增其實是**兩處**（manifest + `preload.cjs`），不是三處 ——
  `channels.ts` 是 `export const IPC = channelManifest`，自動推導。

## 阻塞 / 待決議

- `package-lock.json` 的 diff 同時含本次移除與**既存的未提交漂移**（7.29.x 版本更新 + dedup）。
  建議 review lockfile 時分辨兩者，或先單獨提交既存漂移。
- `npm run format:check` 在 `.codex/`、`openspec/` 等**既存未追蹤檔案**上失敗（非本次造成）。
  本次只格式化自己的檔案，未動他人檔案以免污染 diff。
- ~~`knip.config.ts` 的 `entry` 缺 `src/index.tsx`，renderer 死碼偵測實質是盲的~~ ——
  **20:56 這個診斷是錯的，已撤回。** 實測加入 `src/index.tsx` 與 `src/remote/index.tsx` 後，knip 回報
  「Remove redundant entry pattern」，證明它本來就能從 `index.html` 抵達 renderer。config 已還原。
  monaco 能潛伏的真正原因更根本：**import 鏈是活的，所以 knip 是對的** —— 沒有任何檔案或匯出「未被使用」。
  死角是「已匯入但功能上惰性」（imported but inert），這類問題**沒有任何 linter 抓得到**，只能靠
  「這個依賴實際上被誰呼叫」的人工追問。這也是本次唯一真正的方法論教訓。

## 結束摘要

**做了什麼**：刪掉 monaco-editor 死碼（import、兩個 lib 檔、32 行死 CSS、dependency 條目）與已不需要的
heap flag。entry chunk 減 74.5%，dist 減 48%，9.36 MB 的 worker bundle 全消，build 快 59%。

**未做什麼**：transcript MVP 的兩項在查證後都被證明不存在缺口，取消而非硬做。PTY base64 移除留待第二批
（需先過 contextBridge typed-array spike，且應與 monaco 分開歸因）。

**後續建議**：

1. ~~補 `knip.config.ts` 的 `entry`~~ —— 已試，knip 說冗餘，config 已還原。改為：**接受沒有工具能抓
   「imported but inert」**，靠 review 時追問「這個 import 實際上被誰呼叫」。
2. 清掉 `package-lock.json` 的既存漂移，讓後續 diff 乾淨。
3. 第二批做 contextBridge spike → PTY base64 移除（穩態收益，與本次一次性收益互補）。
4. 命題 6 若要做，範圍是完整的 per-task JSONL transcript 系統（5–8 天），沒有 1–2 天的 MVP 捷徑。
5. 研究報告與 HTML 需修正命題 6 那一節的兩處推論錯誤。
