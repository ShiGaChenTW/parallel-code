# 文件歸檔報告 — 2026-08-01

> 分支 `docs/archive`，基於 main `c975b32`。只搬位置與加索引，**沒有刪除任何檔案或任何內容**。

## 一句話

29 份波次追蹤文檔從 `plans/` 根目錄移進 `plans/archive/2026-07/`，兩個目錄各加一份索引，
`.gitignore` 的 `docs/` 允許清單同步補上兩條規則並加註警告。
被追蹤的檔案 **597 → 600**（+3 全是新增的索引與本報告），29 個 rename 全數 100% 相似度，**零刪除**。
四道 gate 全綠，**測試 2999**，與基準完全相同。

## 1. 整理前後

```
整理前                                   整理後
────────────────────────────────────    ────────────────────────────────────
docs/                                    docs/
  architecture-overview.html               README.md                    ← 新增（索引）
  HANDOFF-2026-07-31.md                    archive-report-2026-08-01.md ← 新增（本檔）
  PRD.md                                   architecture-overview.html
  research-2026-07-30-….md                 HANDOFF-2026-07-31.md
  ROADMAP.md                               PRD.md
                                           research-2026-07-30-….md
plans/                                     ROADMAP.md
  fork_parallel-code__…__wave1-….md
  …（共 29 個平鋪）                      plans/
                                           README.md                    ← 新增（索引）
                                           archive/2026-07/
                                             …（29 個，內容未動）
```

`docs/` 五個檔案**一個都沒搬**。理由見 §3。

## 2. 歸檔結構的理由

### 為什麼是 `plans/archive/`，不是 `docs/archive/`

三個理由，由強到弱：

1. **`docs/` 是 `.gitignore` 的地雷區，`plans/` 不是。** `docs/*` 全忽略再逐檔 `!` 放行，
   而**子目錄無法逐檔放行** —— git 不會走進被排除的目錄。實測：

   ```
   .gitignore:26:docs/*	docs/archive/x.md      ← 被忽略
   （plans/archive/2026-07/wave1.md 無輸出）    ← 不被忽略
   ```

   把 29 個檔案搬進 `docs/archive/` 需要先 `!docs/archive/` 才談得上裡面的規則。
   **能不把 29 份檔案的生死押在一條容易寫錯的規則上，就不要押。**

2. **`docs/plans/` 會被 app 讀走。** `electron/ipc/plans.ts:17` 的
   `PLAN_DIRS = ['.claude/plans', 'docs/plans']` 在每個 worktree 監看這兩個目錄，
   而 `plans.ts:184` 的註解明講它防的就是「繼承到被 commit 的 `docs/plans/` 檔案」。
   一個被追蹤的 `docs/plans/` 會讓這 29 份文檔出現在 app 的 plan viewer 裡。
   **repo 根目錄的 `plans/` 不在監看清單內，是安全的。**

3. **`plans/` 這個命名空間要維持完整。** `ROADMAP.md:6-7` 與 §6 都指向 `plans/`
   （「決策理由寫在 `plans/`」），`HANDOFF-2026-07-31.md:133` 也是。
   留在 `plans/` 底下，這些指標全部不用改。

### 為什麼分月而不是分主題

29 份全部落在 2026-07，所以 `2026-07/` 現在只有一個桶。分月的價值不在今天：
**它是唯一不需要判斷就能執行的規則。** 分主題要求歸檔的人先讀懂內容再分類，
那個成本會讓下一次歸檔不發生。日期是檔名裡就有的事實。

### 為什麼保留平鋪而不重新命名

檔名 `fork_parallel-code__2026-07-31-0345__waveC4-agent-relay.md` 又長又醜，
但它是 `agent_task_RTY_TUI` skill 產生的既有慣例，而且 `plans/` 內部有互相引用
（`…waveS2-docker-run-offline.md:27` 引用 `…waveR2-offline-mode.md:80`）。
改名要動被引用的歷史紀錄，**代價遠大於美觀的收益**。索引解決可讀性，改名不解決。

### `plans/` 根目錄現在是空的 —— 這是刻意的

它是新波次的落點。`agent_task_RTY_TUI` skill 會往 `plans/` 根寫新檔，
現在「根目錄 = 進行中，`archive/` = 已收掉」一眼就分得出來。
整理前 29 個平鋪時，這個區別不存在。

## 3. `docs/` 為什麼一個都沒搬

| 檔案                         | 判定            | 理由                                                                      |
| ---------------------------- | --------------- | ------------------------------------------------------------------------- |
| `ROADMAP.md`                 | 現行主檔        | PM 的工作主檔，§1 是完成狀態與 hash 的唯一真相來源                        |
| `PRD.md`                     | 現行 + **釘死** | 是測試夾具，見下                                                          |
| `research-2026-07-30-….md`   | 現行參考        | 七項決議已定案並持續被引用（ROADMAP §4 的看板否決全靠它），是依據不是紀錄 |
| `architecture-overview.html` | 現行            | 單檔自包含，無外部相依                                                    |
| `HANDOFF-2026-07-31.md`      | **部分過期**    | §5／§6／§8 已被 ROADMAP 取代，但 §2 約束、§3 踩過的坑仍然有效             |

**五個檔案不構成「太複雜」。** 雜訊來源是 `plans/` 的 29 個，那裡才是要動的地方。
在 `docs/` 開一個 archive 目錄只為了讓「歸檔」這個詞看起來有被執行，
會平白引入一條高風險的 `.gitignore` 規則，換不到任何可讀性。**沒做。**

`HANDOFF-2026-07-31.md` 特別說明：它不是死文件。把一份**部分現行**的文件搬進 archive，
等於對讀者宣稱「這裡面的東西都過去了」，而那是假的 —— 過期的是其中三節，不是整份。
真要處理應該是把 §2／§3 併進 ROADMAP 再退役整份，**那是內容編輯，不在歸檔的範圍內。**

### 🔴 `docs/PRD.md` 是測試夾具，路徑被釘死

```
electron/ipc/offline.test.ts:110  readFileSync(join(repoRoot, 'docs', 'PRD.md'), 'utf8')
electron/ipc/offline.test.ts:119  readFileSync(join(repoRoot, 'docs', 'PRD.md'), 'utf8')
```

兩個測試讀它，斷言 §7.1 列出的對外連線點數量與 `OUTBOUND_SURFACES` 一致。
同一支測試也用同樣方式讀根目錄的 `PRIVACY.md`（`:97,102`）。
**搬動或改名 `docs/PRD.md` 會讓測試變紅** —— 這是刻意的設計，文件與程式碼對不上時 CI 會擋。
規格裡沒有提到這條約束，是這次掃描才發現的。

## 4. `.gitignore` 改了什麼

```diff
 # Generated docs content stays ignored; authored documents are tracked by name.
+#
+# ⚠️ This is an allowlist. A new file under docs/ is INVISIBLE to git until it is
+# named below, and `git status` will not warn you — it stays silent about ignored
+# paths. Adding or renaming anything here means adding a rule here in the same
+# commit. Verify with `git check-ignore -v docs/<file>`: no output means tracked.
+#
+# Subdirectories cannot be re-included file-by-file: `docs/*` excludes the
+# directory itself, and git does not descend into an excluded directory. A
+# `docs/sub/` would need `!docs/sub/` before any rule inside it can apply. This is
+# why the wave logs are archived under plans/, which carries no allowlist at all.
 docs/*
 !docs/architecture-overview.html
 !docs/PRD.md
 !docs/research-*.md
 !docs/HANDOFF-*.md
 !docs/ROADMAP.md
+!docs/README.md
+!docs/archive-report-*.md
```

**只加規則，沒有改結構。** 這條允許清單是 `22bbce4` 刻意建立的
（commit 訊息：「PRD.md 與研究報告都對 git 隱形 —— 寫了、審過、卻靜靜地沒被追蹤」），
它的作用是擋掉生成內容。改成黑名單會讓下一批生成檔案靜靜地混進 commit，
**那是用一個沉默的失敗換掉另一個沉默的失敗。** 代價是每加一份文件要多寫一行 —— 接受。

註解是這次唯一的結構性補強：這個坑已經害過一次（`ROADMAP.md` 當初漏加規則），
**把警告寫在會出錯的地方**比寫在報告裡有用。

### 驗證輸出（`git check-ignore --no-index -v`）

```
.gitignore:32:!docs/README.md	docs/README.md
.gitignore:33:!docs/archive-report-*.md	docs/archive-report-2026-08-01.md
.gitignore:28:!docs/PRD.md	docs/PRD.md
.gitignore:31:!docs/ROADMAP.md	docs/ROADMAP.md
.gitignore:30:!docs/HANDOFF-*.md	docs/HANDOFF-2026-07-31.md
.gitignore:29:!docs/research-*.md	docs/research-2026-07-30-personal-workstation.md
.gitignore:27:!docs/architecture-overview.html	docs/architecture-overview.html
.gitignore:26:docs/*	docs/generated-thing.md
.gitignore:26:docs/*	docs/archive/x.md
（plans/README.md 與 plans/archive/2026-07/wave1.md 無輸出）
```

規則以 `!` 開頭 = 被放行 = 進版控。所以：

- **七個 `docs/` 檔案全部放行**（含兩個新檔）。
- `docs/generated-thing.md` 仍被 `docs/*` 擋下 —— **允許清單的保護性質沒有被破壞**。
- `docs/archive/x.md` 仍被擋下 —— 子目錄的坑還在，所以沒往那裡放東西。
- `plans/` 底下無輸出 —— 完全不受清單管轄。

> 用 `--no-index`：沒有它，`git check-ignore` 會跳過已被追蹤的檔案而印不出任何東西，
> 很容易誤讀成「沒有規則命中」。

## 5. 檔案追蹤驗證（驗收重點）

```
git ls-files 整理前   597
git ls-files 整理後   600   （+3 = docs/README.md、plans/README.md、本報告）

git diff --cached --name-status -M：
  M   .gitignore
  A   docs/README.md
  A   docs/archive-report-2026-08-01.md
  A   plans/README.md
  R100 × 29                              ← 全部是 100% 相似度的 rename

純刪除（--diff-filter=D）   0
```

29 個 rename **全部是 100% 相似度**（`git diff --cached -M --summary`，
`grep -c 100%` = 29，非 100% 的 = 0）。git 認得是移動而非重寫，內容逐位元組相同。

`plans/` 的 shortstat 是「30 files changed, 70 insertions(+)」——
70 行全部來自新增的 `plans/README.md`，**29 個被移動的檔案貢獻 0 行增減**。

**沒有任何原本被追蹤的檔案在整理後失去追蹤。**

## 6. 連結檢查

掃了六種形式，不只 markdown 連結：

| 形式                        | 方法                                                    | 結果                                                   |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| markdown 連結 `](...)`      | `rg '\]\(' docs/*.md`                                   | `docs/`、`plans/` 相對連結 **0 個**，全是外部網址      |
| 反引號路徑字串              | `rg 'docs/\|plans/'` 全 repo（排除 lock file）          | **7 處命中**，見下                                     |
| HTML `href` / `src`         | `rg -o 'href="[^"]*"\|src="[^"]*"' docs/*.html`         | 只有頁內錨點 `#...` 與一個 `data:` URI，**零外部路徑** |
| 裸檔名（不含目錄）          | `rg 'ROADMAP\|PRD\.md\|HANDOFF\|architecture-overview'` | 命中皆為程式碼常數（`MAX_HANDOFF_BYTES` 等），非路徑   |
| 程式碼／設定檔路徑          | 同上，涵蓋 `.github/`、`package.json`、`scripts/`       | **`electron/ipc/plans.ts` 與 `offline.test.ts` 兩處**  |
| `plans/` 檔案之間的互相引用 | `rg -l 'plans/' plans/`                                 | **3 個檔案**，見下                                     |

> 全部加 `-a`。ROADMAP §驗收 #7 記過這一課：含 NUL byte 的檔案會被 `rg` 判成 binary
> 而靜默跳過（`token-usage-parse.ts` 就是），不加 `-a` 的搜尋結果不可信。

### 命中明細與處置

**指向 `docs/`（全部沒搬，零影響）**

- `docs/PRD.md:390,393` → `docs/ROADMAP.md`
- `docs/ROADMAP.md:274-276` → `docs/HANDOFF-…`、`docs/research-…`、`docs/PRD.md`
- `docs/HANDOFF-2026-07-31.md:141` → `docs/research-…`

**指向 `plans/`（指向目錄本身，不指向個別檔案 → 仍然正確）**

- `docs/ROADMAP.md:6,7,277`：「決策理由寫在 `plans/`」
- `docs/HANDOFF-2026-07-31.md:11,133`：「每一波都有對應的追蹤文檔在 `plans/`」

這是**把 29 個檔案留在 `plans/` 命名空間底下的直接回報** ——
這五處一個字都不用改。搬到 `docs/archive/` 的話全部要改。

**`plans/` 內部互相引用（3 處，未修改）**

- `…waveS3-store-timer-leak.md:42` → `` `plans/…wave4-startup-timing.md` ``
- `…waveS2-docker-run-offline.md:27` → `` `plans/…waveR2-offline-mode.md:80` ``
- `…waveS2-docker-run-offline.md:213` → 自我引用（完整路徑）

前兩處用省略號形式（`plans/…`），本來就不是可點的連結而是人讀的指標，
搬動後仍然指得到（同在 `plans/` 底下）。第三處是「（本檔）」的自我標註。
**刻意不改**：這些是歷史紀錄，改路徑等於竄改當時寫下的東西，
而收益只有字面精確度。索引（`plans/README.md`）解決找檔案的問題。

**程式碼（2 處，未修改，但改變了決策）**

- `electron/ipc/plans.ts:17,27,170-184` → `docs/plans/`（**app 監看的路徑**，見 §2 理由 2）
- `electron/ipc/offline.test.ts:110,119` → `docs/PRD.md`（**測試夾具**，見 §3）

兩處都不是指向本次搬動的檔案，但都直接影響了結構決策。

**結論：沒有任何連結因為這次整理而失效，零連結修正。**

## 7. 我認為可以刪、但沒有刪的

**沒有。** 29 份波次文檔全部保留，理由是它們的價值不在結論而在**被推翻的診斷**
（S3 的機制、S7 的同義反覆、S8 的架構限制，三個都是先猜錯再實測推翻）。
ROADMAP §驗收那八條，每一條都是從這些文檔裡熬出來的。刪掉就只剩結論，
下次再踩同一個坑時沒有東西可以回頭讀。

一個**可以考慮但需要 Scott 裁決**的項目：

> `docs/ROADMAP.md` §3 有兩個標題都是「### 兩條仍然卡死的前置」的區段
> （第 178-188 行與第 190-199 行），內容重複且**細節互相矛盾** ——
> 前者說 Huly 有「四項檢查」，後者說「五項檢查」；前者說決議 7 卡在產品裁決，
> 後者說卡在真實 CLI 驗證。看起來是編輯時的重複貼上。
>
> **這是內容問題不是歸檔問題，我沒有動。** 要修的話是 ROADMAP 的維護者該做的決定：
> 保留哪一版、或合併成一段。

## 8. 規格的兩處補正

規格（`docs-archive.md`）說得大致準確，兩點要更正：

1. **「沒有找到指向 `docs/` 或 `plans/` 的相對路徑連結」不完整。**
   markdown 連結語法（`](...)`）確實是零，這部分對。但**反引號路徑字串有 7 處**，
   其中 `ROADMAP.md:6,7,277` 與 `HANDOFF:11,133` 指向 `plans/`。
   它們碰巧因為結構選擇而不受影響，**但不是因為它們不存在。**
   如果當初照規格的暗示搬到 `docs/archive/`，這五處全部會變成錯的。

2. **規格沒有提到 `docs/PRD.md` 是測試夾具。**
   「`docs/` 的四個 md 分類」這句話暗示它們都可以自由分類，實際上 `PRD.md`
   的路徑被 `offline.test.ts` 釘死，搬了測試就紅。這條約束在動手前必須知道。

其餘（`.gitignore` 是最大陷阱、`git status` 看不出來、必須用 `git check-ignore` 驗證、
29 個全被追蹤、`ROADMAP.md` 要先讀）**全部正確且關鍵**。
`.gitignore` 那條警告尤其準 —— 實測 `docs/archive/x.md` 確實被 `docs/*` 吃掉。

## 9. 四道 gate

這一波沒有動任何程式碼，四道全綠，數字與基準完全相同。

| Gate                   | 結果                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run check`        | compile／typecheck／lint 全過；`prettier --check .` → All matched files use Prettier code style!           |
| `npm run check:static` | knip 無 dead code；depcruise → `✔ no dependency violations found (496 modules, 1687 dependencies cruised)` |
| `npm test`             | **Tests 2999 passed \| 26 skipped (3025)**；Test Files 149 passed \| 2 skipped                             |
| `npm run check:bundle` | entry 1,284,079 B → 85.6%／CSS 79,511 B → 66.3%／dist 15,403,162 B → 85.6%，三項皆 `ok`                    |

**測試數 2999，與基準一致。** 新增的三份 markdown 不含可執行程式碼，
`format:check` 是唯一會被它們影響的關卡（已先跑 `prettier --write` 對齊）。
