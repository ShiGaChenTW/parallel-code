# R3：AI 用量監控 + 各 worktree token 統計表

**建立時間：** 2026-07-31 02:45
**狀態：** 完成
**分支：** `feat/token-usage`（從 `main @ 649d609` 分出）

## 目標

即時顯示各 AI CLI 的用量，並**針對每個 worktree 分開統計 token**。

## 🟢 最重要的事實：這個功能不需要連網

四家 CLI **都已經在本機寫用量記錄**。PC 只要讀出來加總，不需要打任何供應商 API。

這代表它**不會成為離線模式的第 10 個對外連線點**。R2（`649d609`）剛把
`OUTBOUND_SURFACES` 做成單一真相來源並有機器檢查 —— **本波不應該動那個數字**。
若你發現自己想加網路請求，那是走錯方向了：停下來說明為什麼本機資料不夠。

（對照：打供應商 API 查帳戶用量需要 app 根本沒有的 API key，
且會直接違反 PRD §13 Q3 剛裁決的完全離線承諾。）

## 已查證的資料來源

| 供應商               | 路徑                                           | token 欄位                                                                                  | worktree 歸屬        |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------- |
| **claude**           | `~/.claude/projects/<路徑slug>/*.jsonl`        | `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` | **目錄名即專案路徑** |
| **chatgpt**（Codex） | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `cached_input_tokens`、`cache_write_input_tokens` 等                                        | 檔內 `"cwd"`         |
| **grok**             | `~/.grok/logs/unified.jsonl`                   | `cached_prompt_tokens` 等                                                                   | 檔內 `"cwd"`         |

實例（已實際讀到）：

```
~/.claude/projects/-Users-scottchen-Documents-20-Projects-fork-parallel-code/<session>.jsonl
"usage":{"input_tokens":2,"cache_creation_input_tokens":43107,
         "cache_read_input_tokens":20433,"output_tokens":566, ...}
```

**這些路徑是我在這台機器上查證的，不是推論。** 但欄位命名可能隨 CLI 版本變動 ——
解析要容錯，遇到不認得的形狀就跳過該行而不是整個壞掉。

## 範圍

做（三家）：

- claude / chatgpt(codex) / grok 的用量讀取與加總
- **各 worktree 分開統計** —— PC 已知 task↔worktree 路徑，對得起來
- 即時更新：照 `electron/ipc/steps.ts` 的目錄監看 + debounce pattern
  （這個 repo 已經用過兩次：steps、handoff）

不做：

- **Antigravity（agy）本波不實作，只查證。** 它的對話存在
  `~/.gemini/antigravity-cli/conversations/*.db`（SQLite），而 `history.jsonl`
  裡找不到 token 欄位。讀 SQLite 要加依賴，dist 預算已在 85.1%。
  **請查證「token 資料到底存不存在」並把結論寫進決策紀錄**，讓 Scott 有依據決定值不值得。
  查證是本波要交的，實作不是。
- 不做成本／金額換算（各家定價不同且會變，另議）
- 不做歷史圖表（先把數字弄對）

## 設計要求

- **解析全部是純函式**（`src/lib` 或 `electron/` 的獨立模組），可單測 ——
  vitest 是 node 環境，component 層測不到
- 這些 log 檔可能很大且持續增長。不要每次都整檔重讀 ——
  說明你怎麼處理增量，以及檔案被輪替／截斷時會怎樣
- 壞行、缺欄位、未知 schema 都要跳過而非整批失敗，且要有測試
- 使用者沒裝某個 CLI（目錄不存在）是正常情況，不是錯誤

## Plan Steps

- [x] Step 1 — 三家的解析器（純函式 + 單測，含壞行案例）
      → `electron/ipc/token-usage-parse.ts` + 82 個測試
- [x] Step 2 — worktree 歸屬對應
      → `matchKnownPath()`：最長前綴 + 路徑邊界，巢狀 worktree 歸自己不歸母專案
- [x] Step 3 — 增量讀取與監看
      → `electron/ipc/token-usage.ts` + 30 個測試（含輪替／截斷）
- [x] Step 4 — UI：總覽 + 各 worktree 統計表
      → `TokenUsageSection.tsx`（Settings → AI Usage）+ `token-usage-format.ts` 24 個測試
- [x] Step 5 — Antigravity 查證並寫結論 → 見 D10
- [x] Step 6 — 四道 gate → 見結束摘要

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1888，entry bundle 不得超過 90%
2. **`OUTBOUND_SURFACES` 的數量未變**（本功能零網路）
3. 三家各有解析測試，含壞行與缺欄位案例
4. Antigravity 的查證結論有明確的「有／沒有 token 資料」答案與依據
5. commit 列明確路徑

## 決策紀錄

### D1 — 用檔案內的 `cwd`，不從 claude 的目錄名反推路徑

目錄名是 slug，**是有損的**：實測

```
/Users/scottchen/Documents/20_Projects/fork_parallel-code
  → -Users-scottchen-Documents-20-Projects-fork-parallel-code
```

`/` 和 `_` 都被換成 `-`，反推時無法分辨。所以 slug 只用在「正向」——
由已知 worktree 路徑算出要讀哪個目錄；歸屬一律以每筆記錄裡的 `cwd` 為準。
實測該目錄 94 個檔案裡 `cwd` 只有一個值，且與真實路徑完全相符。

### D2 — claude 必須去重，否則數字會**多出一倍以上**

resume／fork session 會把同一則 assistant message 重寫進新的 transcript 檔，
所以重複是**跨檔**的（這也是為什麼去重集合必須以「目錄」為單位持有，
而不是每個檔案各自一份）。去重鍵取 `message.id` + `requestId`。

兩份獨立樣本（以 `input_tokens + output_tokens` 計，未含 cache 欄位，
故 D7 正規化後確切百分比會微調，但方向與量級不變）：

```
本專案目錄     1449 筆, 671 筆重複 (46.3%)
              tokens 原始 1,649,854 → 去重後 762,805
              不去重的虛增：+116.3%  (2.16x)

較大的目錄     6545 筆, 3127 筆重複 (47.8%)
（交叉驗證）    tokens 原始 6,285,988 → 去重後 2,810,096
              不去重的虛增：+123.7%  (2.24x)
```

⚠️ **重複「筆數」比例（46–48%）與「token」虛增比例（116–124%）不是同一個數字。**
重複的記錄明顯偏向大筆的那些 —— 會被 resume／fork 的正是長 session，
而長 session 帶著更大的 context 與 cache 數字。所以「重複率 ≈ 虛增率」是錯的直覺，
這裡明講出來，免得下一個人自己套上去。

另外兩份樣本的 `no identity` 都是 0 —— 每一筆都帶 `message.id`。
程式裡「沒有 id 就每次都算」的那條 fallback 目前是**防禦性的，不是實際會走到的路徑**，
不要誤以為它是關鍵邏輯。

### D3 — claude 的 `usage.iterations[]` 不能加總

實測 1359 筆有 `iterations`，其四欄加總與上層 `usage` 四欄**完全相等**
（mismatch = 0）。`iterations` 是明細不是額外用量，加下去等於雙倍計算。
只採上層 `input_tokens / output_tokens / cache_creation_input_tokens /
cache_read_input_tokens`。

### D4 — codex 取「最後一筆累計值」，不是把每筆加總

codex 的 `event_msg/token_count` 同時有 `info.total_token_usage`（session 累計）
與 `info.last_token_usage`（本回合）。實測最大的 rollout（54.6 MB, 929 筆）：

```
sum(last_token_usage.total_tokens) = 129,617,191
final total_token_usage.total_tokens = 127,199,725   (max 相同, 回退次數 0)
```

兩者差 1.9%，代表 `last_token_usage` 會在重試時重複出現。累計值才是權威。
採「檔案最後一筆 `total_token_usage`」，並保留單調計數器的 reset 處理
（若累計值變小，視為重置，把重置前的值累進 carried base）。

**這個選擇同時解決效能問題**：累計值代表我們只需要檔尾，不需要整檔。

### D5 — codex 只讀「檔頭 8 KB + 檔尾 256 KB」

資料量實測：`~/.claude/projects` 592 MB / 3659 檔，`~/.codex/sessions` 531 MB / 261 檔。
全掃 1.1 GB 是不可能的。

- **claude**：只讀「app 已知的 worktree 路徑」對應的 slug 目錄。
  實測 parallel-code 相關三個目錄合計 25 MB，而不是 592 MB。
- **codex**：`cwd` 在檔內所以不能靠檔名過濾 → 兩階段：
  先讀每檔前 8 KB 拿 `session_meta.payload.cwd`（第一行就是），
  **只有 cwd 命中已知路徑的檔案才去讀檔尾 256 KB** 拿累計值。
  261 檔 × 8 KB ≈ 2 MB 的探測成本。
- **grok**：單一 `unified.jsonl`（4.8 MB），走真正的增量 append 讀取。

順帶的隱私效果：不相關專案的 log 我們只碰第一行。

### D6 — grok 需要 sid → cwd 對照表

grok 的 `unified.jsonl` 是**所有 session 共用一個檔**。token 在
`msg: "shell.turn.inference_done"` 的 `ctx.{prompt_tokens, cached_prompt_tokens,
completion_tokens, reasoning_tokens}`，但 `cwd` 在另一種記錄
`msg: "session created"` 的 `ctx.cwd`，兩者靠 `sid` 串起來。
實測 12 筆 token 記錄／2 個 sid，兩個 sid 都能在 5 筆 session-created 裡找到。
所以解析器要跨行維護 sid→cwd map，且增量讀取時要保留這張表。

### D7 — 各家「input 是否已含 cache」語意不同，必須各自正規化

實測驗證：

| 供應商 | 觀察                                               | 正規化                  |
| ------ | -------------------------------------------------- | ----------------------- |
| claude | `input_tokens` 與 cache 欄位互斥（Anthropic 語意） | input 直接用            |
| codex  | `input_tokens >= cached_input_tokens` 恆成立       | input = input − cached  |
| grok   | `prompt_tokens >= cached_prompt_tokens` 恆成立     | input = prompt − cached |

不做這件事的話 codex／grok 的 input 會把 cache 讀取重複算一次。
`reasoning_output_tokens` / `reasoning_tokens` 已含在 output/completion 內
（實測 output >= reasoning 恆成立），不另外加。

### D8 — 零網路，`OUTBOUND_SURFACES` 不動

整個功能只有 `fs.promises.open/stat/readdir` 與 `fs.watch`。
沒有 `fetch`、沒有 spawn 任何 CLI。`electron/ipc/offline.ts`、`PRIVACY.md`、
`docs/PRD.md` 一個字都沒改，`git diff main` 對這三個檔是空的。
`OUTBOUND_SURFACES` 仍為 **9** 項。

### D9 — 對真實資料跑過，不是只有單測綠

拿編譯後的 `buildTokenUsageSnapshot` 對這台機器的真實 log 跑：

```
cold scan: 478 ms   warm rescan: 78 ms
providers: claude present, codex present, grok present, skipped 全部 0
/Users/scottchen/Documents/20_Projects/fork_parallel-code
    in=52,320  out=718,683  cacheR=310,689,843  cacheW=2,131,014
```

三件事因此被證實：

1. **效能可接受** —— 592 MB + 531 MB 的 log，冷啟 478 ms、熱掃 78 ms，
   因為 claude 只讀命中的目錄、codex 只讀頭尾。
2. **去重確實在作用** —— 同一個目錄不去重的四欄原始加總是 527,759,700，
   去重後是 313,591,860，少掉約 40%（此處含 cache 欄位，故與 D2 用
   in+out 算出的百分比不同，但方向一致）。
3. **skipped = 0** —— 真實檔案裡沒有解析不了的行，容錯是備而不用。

codex 在這兩個 worktree 沒有貢獻，因為這裡沒跑過 codex session ——
`present: true` 但沒有列，正是預期行為。

### D10 — Antigravity 查證結論：**token 資料存在**（本波仍不實作）

原始 brief 說「`history.jsonl` 裡找不到 token 欄位」，因此懷疑資料不存在。
**這個懷疑是錯的。** 資料在，只是 grep 不到。

**在哪裡**

```
~/.gemini/antigravity-cli/conversations/<uuid>.db
  table  gen_metadata
  column data   ← protobuf blob（不是 JSON）
```

`data` 裡 field 1 → 4 是一個 `ModelUsageStats`，含
`input_tokens`、`output_tokens`、`cache_read_tokens`、
`response_output_tokens`、`thinking_output_tokens`。

**為什麼 grep 找不到**：protobuf 存的是 **field number 不是欄位名**，
所以 `strings | grep -i token` 必然是空的。這是「查無資料」的假陰性來源，
值得記下來 —— 下次遇到 `.db` 或 binary blob，grep 找不到不等於沒有。

**欄位對應是算術驗證過的**，不是猜的：每一列都滿足 `f9 + f10 == f3`。
但**沒有官方 `.proto`**，對應是推論出來的，所以實作時要把
`f9 + f10 == f3` 當成 schema drift 的哨兵在讀取時 assert，一不成立就跳過該列。

**歸屬做得到**：`trajectory_metadata_blob` 有路徑；更便宜的是
`conversation_summaries.db` 的 `conversation_summaries.workspace_uris`
（純 TEXT，不用解 protobuf），以 `conversation_id` 為 key，
而**檔名就是那個 UUID**。已實際 `.schema` 確認。

**成本：接近零，不是原本以為的「要加依賴」**

| 項目     | 結論                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite   | **不用加依賴。** 本專案 Electron 40.8.5 內建 Node 24.14.0，`require('node:sqlite')` 直接可用（回傳 `DatabaseSync, StatementSync, Session, constants, backup`）。系統 Node 22.22.3 也有。 |
| protobuf | **不用加依賴。** 只需走 varint，約 40 行。                                                                                                                                               |
| 體積     | 約 1 KB 程式碼。**dist 預算 85.1% 不受影響。**                                                                                                                                           |
| 資料量   | 13 個檔、3.7 MB，很小。                                                                                                                                                                  |

**實作時的三個坑**（給接手的人）

1. **有 WAL sidecar**（`.db-shm` / `.db-wal`，已實際看到 2 MB 的 wal）——
   必須 **read-only 開啟**並正確處理 WAL，不能把使用者正在用的 DB 鎖住。
2. **`f9 + f10 == f3` 要在讀取時 assert**，當作 schema drift 的 canary。
3. **`cache_write_tokens` 從未被觀察到有值** —— 不要假設它存在。

**本波仍然不做。** 理由不是成本，是時機：三家已經完成並通過四道 gate，
為了第四家去動已完成的東西是拿三個確定的換一個不確定的。
成本既然這麼低，它值得當成獨立的一小波來做。

## 結束摘要

### 做了什麼

讀三家 AI CLI **已經寫在本機**的用量記錄，按 worktree 分開加總，即時更新。
**零網路** —— `OUTBOUND_SURFACES` 維持 9 項，`offline.ts`／`PRIVACY.md`／
`docs/PRD.md` 完全沒動。

### 檔案

新增：

- `electron/ipc/token-usage-parse.ts` —— 純函式解析（無 fs、無 electron）
- `electron/ipc/token-usage.ts` —— 增量讀取、監看、快照
- `src/lib/token-usage-format.ts` —— 顯示邏輯（純函式，因為 vitest 是 node 環境）
- `src/store/tokenUsage.ts` —— store slice（獨立 signal，不進 `state.json`）
- `src/components/TokenUsageSection.tsx` —— Settings → AI Usage 的表
- 三個測試檔

修改：`channel-manifest.json`（+3 channel）、`preload.cjs`（+3）、
`shared-types.ts`、`register.ts`、`main.ts`、`App.tsx`、
`SettingsDialog.tsx`、`src/ipc/types.ts`。
（`channels.ts` 自己從 manifest 衍生，沒有手改。）

### 四道 gate

```
npm run check         compile + typecheck + lint + format:check 全過
npm run check:static  ✔ no dependency violations found (439 modules, 1469 dependencies cruised)
npm test              Test Files 119 passed | 2 skipped (121)
                      Tests 2024 passed | 24 skipped (2048)      ← baseline 1888，+136
npm run check:bundle  ok  renderer entry chunk: 1,320,459 B / 1,500,000 B — 88.0%
                      ok  dist total: 15,316,064 B / 18,000,000 B — 85.1%
```

entry 從 87.7% → 88.0%（+0.3pp），90% 上限之下。dist total 不變。
三個新測試檔**單獨跑也全過**（82 / 30 / 24），沒有 in-file 才過的問題。

### 沒做的，以及為什麼

- **Antigravity 不實作** —— 見 D10。查證已交付，結論是「有資料且成本極低」。
- **不做成本換算** —— 各家定價不同且會變，錯的金額比沒有金額更糟。
- **不做歷史圖表** —— 先把數字弄對。
- **不統計 app 不認識的路徑** —— 只算 PC 自己的 worktree／專案，
  這同時是隱私上的收斂：不相關專案的 log 只碰第一行。
