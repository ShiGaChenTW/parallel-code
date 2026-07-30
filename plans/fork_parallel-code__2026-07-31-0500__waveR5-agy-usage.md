# R5：Antigravity（agy）token 用量，第四家

**分支：** `feat/agy-usage`（從 `main @ bd753c0` 分出）

## 這一波的資料位置已經查清楚了，不要重查

一個子 agent 已經完整調查過，結論如下 —— **全部是實際 decode 出來的，不是推論**。

| 項目 | 值                                                               |
| ---- | ---------------------------------------------------------------- |
| 檔案 | `~/.gemini/antigravity-cli/conversations/<conversation-uuid>.db` |
| 表   | `gen_metadata`                                                   |
| 欄   | `data`（BLOB，**protobuf**）                                     |
| 路徑 | 欄位 `1` → 欄位 `4` = `ModelUsageStats`                          |
| 粒度 | 每次 LLM 生成一列（50 步的對話有 21 列）                         |

`ModelUsageStats` 的欄位編號：

```
1  model enum
2  input_tokens
3  output_tokens
5  cache_read_tokens
6  常數 24 —— 疑似 api_provider enum，**不是 token 數**
8  response_header map
9  response_output_tokens
10 thinking_output_tokens
11 response id
```

**為什麼 `grep -i token` 找不到**：protobuf 存的是欄位**編號**不是名稱。
欄位名是從 `/Users/scottchen/.local/bin/agy`（154 MB Go binary）的 `strings` 撈 getter 反推的。

**算術證明**：`f9 + f10 == f3` 在每一列都成立（136+84=220、205+63=268、281+88=369）。
**把這個不變式寫成讀取時的斷言，當 schema 漂移的警報。** 欄位編號是推斷的，沒有官方 `.proto`。

## 成本已實測，不需要新依賴

- **SQLite 免費**：`node:sqlite` 是 Node 內建。我實測過 Electron 40.8.5 帶的是
  **Node 24.14.0**，`require('node:sqlite')` 回傳
  `DatabaseSync, StatementSync, Session, constants, backup`。**不需要 `better-sqlite3`。**
- **protobuf 不需要套件**：只要走 varint 到 `1.4.{2,3,5,9,10}`，約 40 行。
  `protobufjs`（約 700 KB）幫不上忙 —— Google 沒有發佈 `.proto`，descriptor 只在那個 Go binary 裡。
- 淨增約 1 KB 程式碼、**0 位元組依賴**。

## per-worktree 歸屬也齊全

`trajectory_metadata_blob`（每個 DB 一列）decode 後有完整的 workspace URI、git remote、branch。
更便宜的次要索引：`conversation_summaries.workspace_uris`（純 TEXT，不用 decode protobuf），
用 `conversation_id` 對應 —— 而**檔名本身就是 conversation UUID**。

## 三個實作時的坑（調查者誠實標的）

1. **WAL**：`.db-wal` / `.db-shm` sidecar 存在（3 個對話裡有 2 個）。
   要**唯讀開啟並處理 WAL**，最近的生成可能還沒 flush。
2. **欄位編號是推斷的**，沒有官方 `.proto` → 用 `f9+f10==f3` 當 canary。
3. **`cache_write_tokens` 從未觀察到有值**。不要假設它存在。

另外：**`gen_metadata.size` 不是 token 數**，它等於 `length(data)`（999/999、1064/1064 實測）。

## 必須套用 R3b 剛學到的教訓

R3b（`bd753c0`）修正了前三家的計算，其中兩條直接適用：

- **已刪除的目錄不可以往上找父 repo。** R3b 實測 173 個 cwd 有 76 個已不存在，
  其中 75 個會被併進一個掛著 14.6 億 tokens 的活路徑。這個 app 的 worktree 就放在專案底下，
  是最容易踩的佈局。
- **不要用目錄 mtime 跳過掃描。** POSIX 的目錄 mtime 只在直接子項變動時更新。

## 範圍

做：讀取、解析、per-worktree 歸屬、接進現有的 provider 架構（第四家）。

不做：

- **不加任何網路請求。** 這一波仍然零網路，`OUTBOUND_SURFACES` 數量**不得改變**
  （目前 10，有機器檢查讀 `PRIVACY.md` 與 `docs/PRD.md` 比對）
- 不做成本換算、不做配額
- 不改前三家的解析邏輯（R3b 剛做完，不要動）

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2306，啟動 JS 不得超過 90%
2. **`OUTBOUND_SURFACES` 數量未變（10）**
3. `f9+f10==f3` 的不變式有斷言，且有測試證明不成立時會被偵測到
4. 有測試證明 WAL 存在時仍能正確讀取
5. **用真實資料量**：這台機器上有 3 個對話 DB（約 940 KB）。
   報告實際讀到多少 token、分到哪些 worktree。
   合成資料只證明程式碼做了你寫的事，真實資料才證明你寫對了事 ——
   R3b 的第一版通過全部 152 個合成測試，卻在真實 log 上只做對了一成。
6. commit 列明確路徑

## Plan Steps

- [x] Step 1 — 讀 R3b 的 D1–D10，弄懂前一波修正了什麼再動手
- [x] Step 2 — 在這台機器上複驗欄位對應與 `f9+f10==f3`，不信任文件
- [x] Step 3 — 實測 WAL：唯讀開啟到底讀不讀得到、以及副作用是什麼
- [x] Step 4 — 決定歸屬來源（`conversation_summaries` vs `trajectory_metadata_blob`）
- [x] Step 5 — `protobuf-scan.ts`：最小 wire-format 讀取器
- [x] Step 6 — `token-usage-parse.ts`：agy 解析 + drift canary
- [x] Step 7 — `token-usage.ts`：`scanAgy` 唯讀 SQLite 讀取
- [x] Step 8 — 三個測試檔（含真 WAL fixture、寫入中交易）
- [x] Step 9 — 四道 gate + 對真實 DB 量測

## 決策紀錄

### D1 — 先複驗，結果資料量比 brief 說的多了 5 倍

Brief 說「3 個對話 DB，約 940 KB」。實際上這台機器現在是
**9 個 DB、5.1 MB、36 個 `gen_metadata` 列**。資料在調查與實作之間長大了。

複驗結論（全部自己跑過，沒有沿用結論）：

| 項目                        | 結果                                          |
| --------------------------- | --------------------------------------------- |
| 欄位對應 `1.4.{2,3,5,9,10}` | ✅ 成立                                       |
| `f9 + f10 == f3`            | ✅ **36 / 36 列成立，0 例外**                 |
| `size == length(data)`      | ✅ 36 / 36 相等（**確認不是 token 數**）      |
| 觀察到的欄位編號            | 1, 2, 3, 5, 6, 8, 9, 10, 11                   |
| `cache_write_tokens`        | ❌ **從未出現**（沒有第 4 或第 7 欄），維持 0 |

### D2 — ⚠️ 推翻 brief 的次要索引建議：`conversation_summaries` 只涵蓋 1/9

Brief 說 `conversation_summaries.workspace_uris` 是「更便宜的次要索引，純 TEXT 不用 decode」。
**實測這台機器上那張表只有 1 列**，涵蓋 9 個對話裡的 1 個。拿它當主要來源會丟掉 8/9 的歸屬。

改用 `trajectory_metadata_blob`（每個 DB 剛好 1 列）。實測欄位結構：

```
7      workspace URI（頂層，最乾淨）      ← 主要
1.1    workspace URI（巢狀，重複一份）    ← 備援
1.3.1  git repo slug     1.3.2  remote URL     1.4  branch
```

另外實測 `executor_metadata` 的 `10.12` 也有同一個值，**兩個來源在 9 個 DB 上完全一致**。
沒有採用它，因為 `executor_metadata` 是逐步驟的資料、blob 大得多（3.3 KB vs 467 B），
而且緊鄰對話內容；`trajectory_metadata_blob` 是 session 層級的中繼資料，讀它比較克制。

**9 個對話裡 5 個根本沒有記錄 workspace**（`trajectory_type=4`，單次生成的隨手提問）。
這不是解析失敗，是真實狀態。這 5 個共 91,265 tokens 記為 skipped，不猜路徑。

### D3 — WAL 不是邊角案例，是這個功能會不會有數字的分水嶺

實測「只開 `.db`、不看 WAL」與「唯讀開啟（SQLite 自己處理 WAL）」的差異：

```
DB              WAL      唯讀開啟      只讀 .db
02efecfa       290K      1 列          0 列
187bbd53       278K      1 列          0 列
95924cbf       278K      1 列          0 列
b060ff6e       290K      1 列          0 列
97e46e8c      2036K      7 列          ERR database disk image is malformed
（其餘 4 個 WAL 為 0，兩者一致）
```

**9 個 DB 裡有 5 個的資料 100% 還在 WAL 裡。** WAL-blind 的讀取器會讓這個 provider
看起來是空的，而且不會報錯 —— 是最糟的那種壞法。

`node:sqlite` 的 `{ readOnly: true }` 會正確讀到 WAL，不需要額外處理。

### D4 — 「唯讀」不等於「什麼都不碰」，這點要誠實講

SQLite 要透過 `-shm` 共享記憶體索引才能讀 WAL，**唯讀連線仍會建立／更新 `-shm`**。
實測一次掃描後的差異：9 個 `-shm` 的 mtime 變了，`.db` 與 `.db-wal` 的
**大小與 SHA-256 完全沒變**。

`-shm` 是 SQLite 隨時可重建的協調檔案，不含使用者資料。付這個代價是必要的：
不碰 `-shm` 就等於放棄 D3 那 5 個 DB。已加測試
`leaves the database and its wal byte-identical after a scan` 鎖住這個界線。

**沒有採用的替代方案**：`?immutable=1` 可以完全不碰任何檔案，但它會**忽略 WAL** ——
換來的是 5/9 的 DB 讀到 0 列。不可接受。

### D5 — 寫入中的 DB 不需要特別處理，這是 WAL 的本職

實測：在另一條連線持有未 commit 的 `BEGIN IMMEDIATE` 交易時掃描，
讀到的是**交易前的最後一個已提交快照**，不是半寫入的狀態。
寫到一半的生成就是還沒出現，下次掃描才會進來。已加測試
`sees committed rows but not an in-flight transaction`。

也因此**沒有加任何重試或鎖等待**：沒有需要等的東西。

### D6 — drift canary 失敗時「丟掉該列」而不是「照算」

欄位編號是從 stripped Go binary 反推的，沒有官方 `.proto`。
`f9 + f10 == f3` 是「欄位 3 真的是 output」的**唯一獨立證據**。

不變式失敗時不計入該列、記為 skipped、寫一次 warn。理由沿用 R3b 的 D8：
**一個歸錯的數字比一個缺的數字更糟**。如果欄位重編號，我們讀到的就不知道是什麼了，
報一個看起來合理的錯數字比報一個偏小的數字危險。

**但 canary 分三態不是兩態**：`true` / `false` / `null`。
只有「至少報了 f9 或 f10 其中一個」的列才檢查；兩個都沒有時回 `null` 照常計入。
否則一個未來不報 thinking 拆解的模型會被整批丟掉 —— 那是把防禦變成 bug。

### D7 — 完全不用 mtime 跳過掃描，連檔案層級都不用

R3b 的教訓是「不要用**目錄** mtime」。這裡更進一步：agy 連檔案 mtime 都不看，每次全讀。

三個理由：

1. `gen_metadata` 以 `idx` 為主鍵，列會被**原地改寫**，不是純 append，沒有 offset 可記
2. 有 WAL 時 `.db` 的 size 與 mtime **根本不動**（資料在 sidecar 裡），拿來當快取鍵是錯的
3. 成本本來就低：整棵樹 5.1 MB（codex 是 555 MB），而且**只有命中已知 worktree 的對話
   才會 decode `gen_metadata`**

誠實的做法剛好也是便宜的做法。

### D8 — 不匹配已知 worktree 的對話，連 `gen_metadata` 都不打開

先讀 `trajectory_metadata_blob` 拿 workspace，用 `matchKnownPath` 原始比對決定要不要繼續。
這是成本考量，**更是隱私界線**：`gen_metadata` 的 blob 就緊鄰使用者的 prompt，
而不相干專案的計數對「各 worktree 分列」的表格本來就沒用。

沒有 workspace 的對話用 `SELECT COUNT(*)` 拿列數記成 skipped —— 這個查詢不讀任何 blob。

### D9 — `input` 不含 cache，直接對映不做減法

其他家的語意各不相同（OpenAI／grok 的 `input` 含 cached prefix，要減掉）。
agy 實測 **36 列裡有 24 列 `cacheRead > input`** —— 如果 input 含 cache 這不可能發生。
所以 agy 跟 Anthropic 一樣四個計數本來就互斥，**直接對映**。

這件事必須實測，猜錯的話那 24 列的 input 會被 `Math.max(0, ...)` 夾成 0。

### D10 — 測試裡的欄位編號故意寫死，不從 production import

一般規則是「測試斷言的常數要 import，不要抄一份」。**這裡刻意反過來。**

欄位編號不是「兩邊要一致的常數」，而是**被測對象本身** —— 它是別人沒公佈的 wire layout，
靠真實資料驗證出來的。如果 fixture 用 production 的常數去組 blob，
那 production 改欄位編號時 fixture 會跟著改，**測試就什麼都證明不了**。
所以測試裡寫的是 bytes。兩個測試檔都有註解說明。

### D11 — 沒有新增 IPC channel，所以沒有兩處要改

既有的 `StartTokenUsageWatcher` / `TokenUsageUpdate` 直接承載第四家，
`channel-manifest.json` 與 `preload.cjs` 的 `ALLOWED_CHANNELS` **一字未動**。

### D12 — `node:sqlite` 用動態 import，失敗只停掉這一家

`node:sqlite` 目前仍標記 experimental。用 top-level import 的話，
未來它改名或被移除會讓整個 `token-usage.ts` 載入失敗，**把另外三家一起帶走**。
改成 lazy dynamic import + cache，失敗時這一家回報 error，其餘照常。

## 結束摘要

### 做了什麼

Antigravity 成為 token 監控的第四家，和前三家一樣有 per-worktree 歸屬。
它是唯一不寫 JSONL 的一家 —— 每個對話一個 SQLite DB，計數在 protobuf blob 裡。
差異全部收在 reader 內部，到達聚合層時就是一樣的四個整數。

**零新依賴**：`node:sqlite` 是 Node 內建（Electron 40.8.5 帶 Node 24.14.0），
protobuf 走 varint 手寫約 150 行含註解。沒有 `better-sqlite3`，沒有 `protobufjs`。

### 真實資料上的數字（9 個 DB、5.1 MB、36 列）

```
全部對話                       887,821 tokens
  ├─ 歸屬到已知 worktree       796,556（31 列、4 個對話）
  └─ 沒有記錄 workspace         91,265（ 5 列、5 個對話）→ skipped=5

540,180  /Users/scottchen/…/Projetc_S.CodingFlow/.worktrees/task/commit-6acc14
170,062  /Users/scottchen/Documents/20_Projects/pc-feat-transcript
 68,163  /Users/scottchen
 18,151  /Users/scottchen/…/Project_Opportunity-Magnet/.worktrees/task/-853c88
```

`f9 + f10 == f3`：**36 / 36 成立，0 違反，0 無法檢查**（用 shipped parser 跑的）。

### 檔案

新增：

- `electron/ipc/protobuf-scan.ts` —— 最小 wire-format 讀取器
- `electron/ipc/protobuf-scan.test.ts`

修改：

- `electron/ipc/token-usage-parse.ts` —— agy 解析、workspace URI、drift canary
- `electron/ipc/token-usage.ts` —— `scanAgy`、唯讀 SQLite、watch target
- `electron/ipc/shared-types.ts` —— `ProviderId` 加 `agy`
- `src/lib/token-usage-format.ts` —— `Antigravity` 欄位標籤
- 兩個既有測試檔（新測試 + 兩處 provider 列舉斷言）

`offline.ts` / `PRIVACY.md` / `docs/PRD.md` / `channel-manifest.json` / `preload.cjs`
**一字未動**，`OUTBOUND_SURFACES` 仍為 10。

### 讀了什麼、留下什麼

每個 DB 只讀兩張表：`trajectory_metadata_blob`（取 workspace URI）與
`gen_metadata`（取 5 個整數計數）。**沒有讀 `steps`、`executor_metadata`、
`parent_references`、`battle_mode_infos`** —— 對話內容所在的表一律沒開。

留下的只有：整數 token 數，加上已經是 app 自己 worktree 的絕對路徑。
protobuf 物件解完就丟，沒有 prompt、沒有程式碼、沒有 git remote、沒有分支名。

### 沒做的

- **不加任何網路請求**，`OUTBOUND_SURFACES` 維持 10
- **不做成本換算、不做配額**
- **不動前三家的解析** —— R3b 剛做完
- **不接住沒有 workspace 的 5 個對話**（91,265 tokens）——
  它們真的沒有記錄目錄，唯一的來源會是從對話 blob 裡刮路徑，
  那要讀我們刻意不讀的表，而且是猜。寧可少算，見 D2/D8
- **沒有做增量讀取** —— 見 D7，這裡全讀才是對的
- **沒有做日期切分** —— 沿用 R3 的範圍，這一波只負責讓第四家的數字對
