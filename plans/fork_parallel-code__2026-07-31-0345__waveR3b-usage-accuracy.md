# R3b：token 計算正確性修正

這一波**不是新功能**，是修正 R3（已合併於 `6eb6ddb`）的計算正確性。
來源是對 `github.com/steipete/CodexBar`（MIT，Swift）的研究 —— 那個專案解過同一組問題。
**能移植的是演算法不是程式碼。**

## 修正一（最重要）：改用 watermark 差分，不要「最後一筆累計值」

R3 的 D4 決定「取檔案最後一筆 `total_token_usage`」。**那對這個產品是錯的。**

理由不是它算錯總數 —— 對「整個 session 的總量」它是對的。錯在**它無法拆分**：

- 拆不到「哪一天」
- 拆不到「哪一個 worktree」（session 的 `cwd` 中途改變時尤其）

而各 worktree 分開統計是這個功能存在的**唯一理由**。

CodexBar 的做法（`CostUsageScanner.swift:222-232`、`:2679-2711`）：
取累計計數器的**逐事件差分**，並用 `min(last_token_usage, Δtotal_token_usage)` 封頂。

```
guard !sawDivergentTotals, let rawBaseline else { return false }
return codexTotalsAtLeast(currentTotal, rawBaseline)
    && codexTotalsAtMost(totalDelta, lastDelta)   // 總量較小時優先採總量
```

重試會讓 `last_token_usage` 重複出現，但累計計數器不會前進那麼多，
於是差分較小、勝出 —— **這正是消掉我們量到那 1.9% 超算的機制，同時保住逐事件歸屬。**
我們現在是二選一，這個做法兩者兼得。

## 修正二：單調計數器下降不一定是 reset

R3 目前把「累計值變小」當成計數器重置，把重置前的值累進 carried base。

CodexBar 指出：**下降也可能是同一個檔案裡的第二條 fork 血脈**（ultra mode 會把
多條血脈的累計快照寫進同一個 rollout）。當成 reset 把基準歸零，會把血脈之間的落差**重算一次**。

它的做法是 monotonic high-watermark，任何一個分量下降就 latch 成 interleaved
（`latchIfBelowWatermark`），之後改用 containment 算術。

## 修正三：Vertex AI 的 Claude log 混在同一批檔案裡

要分離。偵測方式：`message.id` / `requestId` 裡的 `_vrtx_`，
或 model 名稱裡的 `@` 版本分隔符（`CostUsageScanner+Claude.swift:411-432`）。

## 修正四：Codex subagent 的 copied-prefix 重複

subagent 的 rollout 檔會**嵌入母 session 記錄的複製前綴**。
CodexBar 用 `CodexSubagentRolloutShape.classify` 判定 `independent` vs `copiedPrefix`，
只計算「自己擁有的後綴」。這是 Codex 側的重複類別，跟 Claude 的 `message.id` 重複完全不同。

## 修正五：worktree 被刪除時不可以往上找父 repo

`CodexLocalProjectRootResolver.swift:33-37` 的註解：
「缺席的 CWD 是歷史證據。不要往上走到存在的父 repo，那會把已刪除的 worktree
或資料夾**併進另一個專案的身份**。」

## 修正六（低優先）：dedup 改成 last-wins

CodexBar 在檔案內用 last-wins，因為它那邊的重複是**串流累計片段**，最後一筆才完整。

**我已實測過你的資料：這個顧慮在這裡不成立。**
兩個樣本（818 與 3418 個 unique key）**每一筆重複的 usage 值都完全相同**，
first-wins 與 last-wins 差異 0.00%。所以這不是 bug，只是對兩種寫入行為都正確的防禦。
改動極小，順手做，但不要為它花時間。

## 明確不做

- **不加 quota／rate-limit**（CodexBar 從供應商 API 取得，我們目前零網路，
  加了會變成第 11 個對外連線點，要另外裁決）
- **不加成本換算**（定價來源、快取、poison-response 防護是另一整塊）
- **不處理 `usage.iterations[]`** —— R3 的 D3 已證實它與上層 usage 完全相等，
  只讀上層就不會踩到，維持現狀
- **不要用目錄 mtime 跳過掃描** —— POSIX 的目錄 mtime 只在直接子項變動時更新，
  子目錄裡的新 log 偵測不到。CodexBar 試過然後移除了（`+Claude.swift:614-620`）

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2248
2. **`OUTBOUND_SURFACES` 的數量未變**（這一波仍然零網路）
3. 修正一要有測試證明「同一 session 跨兩個 worktree 時，用量能正確拆分」——
   這是整個修正的理由，沒有這個測試就沒有證明
4. 修正二要有測試證明「同檔案兩條血脈不會被當成 reset 而重算」
5. 每一項修正說明它改變了哪些實際數字（用真實 log 量，不要只跑合成資料）
6. commit 列明確路徑

## Plan Steps

- [x] Step 1 — 讀 R3 的 D1–D8，弄懂每個決定的理由再動手
- [x] Step 2 — 先量真實 log，再決定實作（261 個 codex rollout、90 個 claude 專案目錄）
- [x] Step 3 — 修正一：codex 改逐事件差分 + `min(last, Δtotal)` 封頂
- [x] Step 4 — 修正二：下降改 latch interleaved，不再 re-baseline
- [x] Step 5 — 修正三：Vertex 記錄分離成獨立 provider
- [x] Step 6 — 修正四：subagent／fork 的 copied prefix 不計
- [x] Step 7 — 修正五：cwd 不存在時不往上找父 repo
- [x] Step 8 — 修正六：dedup 改 last-wins
- [x] Step 9 — 兩個關鍵測試（跨 worktree 拆分、兩條血脈不重算）
- [x] Step 10 — 四道 gate + 對真實 log 量測前後差異

## 決策紀錄

### D1 — 修正一與修正四是同一個機制的兩半，必須一起做

原始 brief 把它們列成兩項。實作時發現**只做修正一會讓數字更糟**。

差分法把「檔案第一筆事件」當基準不計入，這本來就是為了避免 fork 繼承的前綴被重算。
但實測發現 codex 的 subagent rollout **不是只繼承一個基準值，而是把母 session 的
整條 token_count 序列重播進自己的檔案**：

```
檔案                              事件數  與母檔共享的前導事件數
019f8453-feb…                      770          761
019fa876-83d…                      614          568
019fa876-720…                      606          567
```

770 筆事件裡有 761 筆是母 session 的。只做修正一的話這 761 筆的差分照算，
等於把母 session 整個算第二次。**所以修正四不是「另一項改善」，是修正一的前提。**

實測 49 個有 `forked_from_id` 且能找到母檔的 rollout，全部都是這個形狀。

### D2 — copied prefix 的邊界用「重播突發窗」判定，不跨檔比對

理想做法是拿 `forked_from_id` 去讀母檔比對序列。但那要跨檔協調，
而且母檔不一定在我們會讀的集合裡（母 session 的 cwd 可能不是已知 worktree）。

找純檔內訊號時試了兩個假設，**兩個都用跨檔比對當 ground truth 驗證**：

| 規則                                  | 49 個 fork 中完全命中 |
| ------------------------------------- | --------------------- |
| A：第一筆 `turn_context` 之前的事件   | 11 / 49 ❌            |
| B：時間戳落在 session 建立後 N 毫秒內 | 見下表 ✅             |

規則 B 的物理理由：fork 把繼承的歷史**一次同步寫完**，真實 turn 每筆要好幾秒。
（原本猜「複製的記錄會保留母檔的舊時間戳」——**這個猜測是錯的**，實測
`byTimestamp` 全是 0，codex 會把時間戳改寫成 fork 當下。所以是「太新」不是「太舊」。）

門檻掃描：

```
   50 ms  完全命中 42/49   偏小 7   偏大 0
  100 ms  完全命中 45/49   偏小 4   偏大 0
  250 ms  完全命中 47/49   偏小 2   偏大 0
 1000 ms  完全命中 48/49   偏小 1   偏大 0
 2000 ms  完全命中 49/49   偏小 0   偏大 0   ← 採用
 5000 ms  完全命中 49/49   偏小 0   偏大 0
10000 ms  完全命中 22/49   偏小 0   偏大 27  ← 開始吃掉真實的第一個 turn
```

取 **2000 ms**：是完全命中的最小值，所以萬一 drift 也是往「偏小」倒
（多算一兩筆複製的），而不是往「偏大」倒（丟掉真實用量）。
這跟 claude 那邊「沒有 id 的記錄寧可算也不要丟」是同一個取向。

另外實測：212 個非 fork 的 rollout 裡，就算無條件套用這條規則也是 0 筆受影響。
規則仍然只在檔案自己宣告 fork／subagent 時才啟用。

### D3 — ⚠️ 我第一版寫錯了：母檔的 `session_meta` 也在重播裡

這是**只有真實資料抓得到、合成 fixture 抓不到**的錯。

第一版的 `foldCodexLines` 對每一筆 `session_meta` 都覆寫 `sessionStartMs` 與 `inherited`。
但 fork 重播母檔記錄時，**母檔自己的 `session_meta` 也被重播進來**。那筆記錄
沒有 `forked_from_id`，時間戳是幾小時前 —— 於是 `inherited` 被改回 `false`、
`sessionStartMs` 被改成母檔的開始時間，重播規則就**剛好在最需要它的檔案上失效**。

合成測試全綠（152 個），對真實 log 一跑才發現差分只少了 88 M 而不是預期的 784 M。
追下去才看到 fold 結束時 `state.inherited === false`。

修法：加 `identified` 旗標，**只有第一筆 `session_meta` 定義這個檔案的身份**，
之後的只更新 cwd。head probe 也一併標記 `identified`，
避免增量重讀（offset > 0，讀不到第 0 行）時被後面那筆母檔記錄搶走身份。

**代價**：這一個 bug 值 784,610,389 tokens 的重複計算。
已補測試 `does not let the parent session_meta inside the replay steal the identity`。

### D4 — 順手抓到的 R3 latent bug：8 KB head 讀不完 `session_meta`

R3 的 D5 假設 codex rollout 第一行「幾百 bytes」，取 8 KB「是它的好幾倍」。
**實測 261 個檔案的第一行是 6,330 – 43,851 bytes**，因為 `base_instructions`
整段嵌在裡面。

```
head probe 解析出 cwd：  R3 的 8 KB → 29 / 262
                        本波 64 KB → 262 / 262
```

**232 個檔案（89%）的第一行被從中間截斷，JSON 解析失敗，cwd 完全拿不到。**
也就是說 R3 上線後 codex 這一路實質上幾乎沒有在計數 —— 這不是精度問題，是沒作用。

改成 64 KB 起跳、找到換行就停、最多到 1 MB。實測所有檔案第一次就命中。

### D5 — 修正一逼我放棄 R3 的 D5「只讀頭尾」，這是有代價的

R3 只讀檔尾 256 KB，因為累計值代表最後一筆就是答案。**逐事件歸屬讓這個前提消失**：
cwd 和日期是個別事件的屬性，不走過事件就切不開。

所以 codex 改成跟 claude 一樣的增量 append 讀取。緩解措施：

1. 只有 head probe 命中已知 worktree 的 rollout 才整檔讀
2. append-only，第一次之後只讀新增的 bytes

**明講代價**：一個 session 若「開始時不在任何已知 worktree、中途才移進來」，
我們永遠不會讀到它 —— 那個檔案只會被讀第一行。要接住它就得每次掃 555 MB。
而 PC 自己派發的 agent 一定是在自己的 worktree 起手的，所以這個缺口是可接受的收斂，
但它是**縮窄**了 D5 而不是消滅它，寫在這裡免得下一個人以為已經全解決。

冷啟成本實測：整棵 555 MB／262 檔全部讀完是 49 秒；
但實際上只有命中已知 worktree 的檔案會被讀，這台機器上是 0 個。

### D6 — 修正二的「containment 算術」具體是什麼

CodexBar 的 `latchIfBelowWatermark` + containment 在我們這邊落成：

- watermark 是**逐分量**的 high-water mark，不是「上一筆讀數」
- 任一分量低於 watermark → latch `interleaved`，**永不解除**
- latch 之後每筆一律採自己的 `last_token_usage`（自足值，不管屬於哪條血脈都對）
- 未 latch 時：`Δtotal = total − watermark`，再用 `last` 逐分量封頂

關鍵是**不再把下降前的值累進 carried base**。R3 那樣做會把兩條血脈之間的落差重算一次。

**實測這台機器上沒有任何 rollout 出現累計值下降（0 / 262）**，也沒有任何 session
中途換過 cwd（0 / 262）。所以修正一的跨 worktree 拆分與修正二的血脈情境
在這台機器的資料裡**都沒有實例** —— 這兩項是靠合成測試證明的，
真實資料只能證明「沒有回歸」。這點必須誠實講，不能拿 −47% 去暗示它們有貢獻。

### D7 — Vertex 用獨立 provider id，不併進 claude

`claude-vertex` 加進 `ProviderId`。它**不進 provider 狀態列**（沒有獨立的安裝目錄，
不存在「沒裝」這回事），只在有貢獻時多一個欄位。

**實測這台機器 36,573 筆 usage 記錄裡 Vertex 是 0 筆**（`_vrtx_` 與 model 名的 `@`
兩個偵測器都沒中）。所以這一項純粹是防禦，對現有數字 0 影響，UI 也不會多出欄位。

### D8 — 修正五：cwd 不存在時只認完全相等

`matchKnownPath` 加 `candidateExists` 選項；`false` 時關掉前綴比對。
存在性檢查在 reader 端做，每次 snapshot 內快取（同一批記錄反覆出現同幾個目錄）。

實測：173 個被記錄過的 cwd 裡 **76 個已經不在磁碟上**。
拿「還存在的 cwd」當已知路徑集合去模擬，
**75 個已刪除目錄會被 R3 前綴比對捲進某個還活著的已知路徑，帶著 1,461,705,676 tokens。**

這在 PC 自己的版面上尤其危險：worktree 就住在專案目錄底下
（`/repo/.worktrees/feature` 之於 `/repo`），刪掉 worktree 之後它的用量會
悄悄灌進母專案那一列。

代價講清楚：**已刪除的「子目錄」也會一起被丟掉**（例如 `/known/worktree/build-tmp`）。
少算一點好過把 A worktree 的用量算到 B worktree 頭上 —— 各 worktree 分開統計
是這個功能存在的理由，一個歸錯的數字比一個缺的數字更糟。

### D9 — 修正六確認 0.00%，但實作成本不是「極小」

PM 說改動極小。實際上為了 last-wins 必須**把 claude 的累加從 per-file 改成
per-directory 的 `Map<key, record>`** —— 因為要「後蓋前」就得留住值本身，
而重複是跨檔的，per-file 累加沒辦法回頭扣掉前一筆。

順帶好處：per-file 的 `byPath` 整個拿掉，程式反而變短。

**獨立複驗 PM 的量測**：90 個專案目錄、36,573 筆 usage 記錄、18,532 個 unique key，
first-wins 與 last-wins 差 **0.0000%**，所有重複的 usage 值完全相同。結論一致。

### D10 — R3 的 D1–D8 哪些保留不動

| 決定                                | 處置                        | 理由                                               |
| ----------------------------------- | --------------------------- | -------------------------------------------------- |
| D1 目錄名是 slug、歸屬用檔內 cwd    | **保留**                    | slug 有損這件事沒變                                |
| D2 claude 跨檔去重                  | **保留**，只把 Set 換成 Map | 去重本身是對的，46–48% 重複率複驗一致              |
| D3 不加 `usage.iterations[]`        | **保留**                    | 明確不做；只讀上層就不會踩到                       |
| D4 codex 取最後累計值               | **推翻**                    | 修正一。單一累計值切不開 worktree 與日期           |
| D5 codex 只讀頭尾                   | **部分推翻**                | 頭 8 KB→64 KB 起跳；尾 256 KB→整檔增量。見 D5      |
| D6 grok sid→cwd 對照表              | **保留**                    | 完全沒動，形狀正確                                 |
| D7 各家 input／cache 語意各自正規化 | **保留**                    | 差分是線性的，對正規化後的值取差分等於對差分正規化 |
| D8 零網路                           | **保留且再確認**            | `OUTBOUND_SURFACES` 一字未動                       |

## 結束摘要

### 做了什麼

把 R3 的 codex 計數從「取檔案最後一筆累計值」改成「逐事件差分並用 `min(last, Δtotal)` 封頂」，
因為單一累計值**切不開 worktree 也切不開日期**，而各 worktree 分開統計是這功能存在的理由。
過程中發現這件事沒辦法單獨做：codex 的 subagent rollout 會把母 session 的整條事件序列
重播進自己的檔案，不先把重播段扣掉，差分法會比原本更糟。

### 真實資料上的效果（262 個 rollout，555 MB）

```
R3（每檔最後一筆累計值 + reset carry）    1,906,380,987
  + 修正一（逐事件差分）                  1,795,020,795    −5.84%
  + 修正四（重播前綴不計）                1,010,410,406   −47.00%
```

head probe：R3 的 8 KB 只解得出 29/262 個 cwd，64 KB 解得出 262/262。

### 檔案

修改：

- `electron/ipc/token-usage-parse.ts` —— 差分／watermark／重播判定、Vertex、last-wins、存在性比對
- `electron/ipc/token-usage.ts` —— codex 改增量整檔讀、head probe 加大、cwd 存在性快取
- `electron/ipc/shared-types.ts` —— `ProviderId` 加 `claude-vertex`
- `src/lib/token-usage-format.ts` —— 新欄位標籤
- 三個測試檔

沒有新增依賴。`offline.ts`／`PRIVACY.md`／`docs/PRD.md` 一字未動。

### 沒做的

- **不加 quota／rate-limit、不加成本換算** —— 依 brief，另外裁決
- **不動 `usage.iterations[]`** —— R3 的 D3 已證實只讀上層就安全
- **沒有用目錄 mtime 跳過掃描** —— POSIX 目錄 mtime 只反映直接子項，子目錄新 log 偵測不到
- **沒有把「中途才移進已知 worktree 的 session」接住** —— 見 D5，代價是每次掃 555 MB
- **沒有做日期切分的 UI** —— 差分法已經讓它可行（每筆事件都有時間戳），但 R3 的
  「先把數字弄對、不做歷史圖表」仍然成立，這一波只負責讓數字對
