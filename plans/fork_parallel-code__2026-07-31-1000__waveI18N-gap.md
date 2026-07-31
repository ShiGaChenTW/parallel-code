# i18n 缺口：補翻譯 + 補包裝 + 加守衛

**分支：** `fix/i18n-gap`

## Scott 實際看到的

開發版本跑起來後，Settings 裡大量說明文字還是英文。四張截圖涵蓋：
診斷／詳細記錄、更新、DOCKER 隔離、Record session transcripts、AI USAGE、COORDINATOR。

## 診斷（PM 已量測）

**兩種缺口同時存在，修法不同：**

**全 `src/` 實測：356 個 `tr()` 呼叫，其中 87 個未收錄（24.4%）。**

| 類型                     | 數量                                 | 成因                               |
| ------------------------ | ------------------------------------ | ---------------------------------- |
| 包了 `tr()` 但目錄沒收錄 | **87**（全 src，356 個呼叫的 24.4%） | 後續波次加了 `tr()` 卻沒補繁中條目 |
| 完全沒包 `tr()`          | 光 Settings 就 **31 個候選**         | i18n 那波沒掃到的長句說明文字      |

未收錄最多的檔案：

```
23  src/components/SettingsDialog.tsx
 6  src/components/EditProjectDialog.tsx
 5  src/components/InlineInput.tsx
 5  src/components/SidebarFooter.tsx
 4  src/components/CustomThemeDialog.tsx
 4  src/components/ImportWorktreesDialog.tsx
 4  src/components/WindowTitleBar.tsx
 3  src/components/ConnectPhoneModal.tsx / HelpDialog.tsx / TaskAITerminal.tsx
```

⚠️ **PM 第一次量測用的腳本有 bug**（`walk` 裡誤用 `return` 而非 `continue`），
報成「8 個呼叫、1 個未收錄」。上面是修正後的數字。**你自己也要重量一次確認。**

已抽查確認：

```
Emit debug-level logs…            ❌ 未包 tr()
Record session transcripts        ✅ 有 tr()，目錄沒收
Docker image used when…           ❌ 未包 tr()
Enable the Coordinator option…    ❌ 未包 tr()
Token counts read from…           ❌ 未包 tr()
```

## 🔴 這一波的重點不是補完，是讓它不再長回來

i18n 那波（`92b17b2`）做完之後，**每一波新增 UI 字串都在擴大缺口**，
而**沒有任何 gate 檢查**。C6 加了 transcript 的開關、R3 加了 AI USAGE、
R4 加了字體選單 —— 各自都有 `tr()` 或沒有，但都沒有繁中條目。

**所以第三件事是必做的：加一道守衛。**

形狀由你決定，但它要能回答「有沒有新的 UI 字串沒有繁中翻譯」。
可能方向（不是指定）：一個測試枚舉所有 `tr()` 呼叫並斷言目錄有對應條目、
或一個 lint 規則、或 `check:static` 裡的一步。

**注意既有的設計**：`translate()` 對未收錄字串**回傳原文**，這是刻意的
（`i18n.ts:8-14` 的註解說明理由：未翻譯降級成可讀英文，而不是空白或 raw id）。
**守衛不能改變這個 runtime 行為** —— 它只該在開發期擋住，不是在使用者面前壞掉。

也注意 `i18n.ts` 已有 `COLON_LABEL_KEYS` 這種「刻意不翻譯的允許清單」機制
（wave 6 建立），以及一批刻意保留英文的詞（產品名、git 術語、CLI agent 名稱）。
**新守衛要能容納「刻意不翻」，否則它會逼人翻譯 `Docker`、`branch`、`commit`。**

## 範圍

做：

1. 補齊 `SettingsDialog.tsx` 的 23 個未收錄條目
2. 把該包而沒包 `tr()` 的說明文字包起來並翻譯
3. **加守衛**，讓下一波加字串忘記翻譯時會紅
4. 全 `src/` 掃一次，不只 Settings（PM 的量測會附上）

不做：

- 不改 `translate()` 的 fallback 行為
- 不動 `{name}` 插值機制（wave 6 建立，運作正常）
- 不翻譯刻意保留英文的詞 —— 判斷標準見 `i18n.ts` 檔頭：
  產品與廠商名（Parallel Code、Docker、GitHub）、
  開發者讀英文的 git 詞彙（branch、worktree、commit、rebase、merge）、CLI agent 名稱
- 不碰 `src/App.tsx` 開頭的 CSS import 區塊

## 翻譯品質要求

這批是**說明文字**不是標籤，比 wave 6 的短詞難。原則：

- **對象是開發者**，不是一般使用者。技術詞保留英文（`IPC`、`pty`、`PR`、`token`）
- 不要逐字直譯。例：`Review the contents before sharing.`
  → 「分享前請先檢查內容。」而不是「回顧內容在分享之前。」
- 帶變數的句子用 wave 6 的 `{name}` 插值，不要字串串接
- **`ANTHROPIC_API_KEY=` 這種標籤、程式碼識別字、檔案路徑一律不翻**

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2635，三個 bundle 預算都不得超標
   （啟動 JS 82.5%、啟動 CSS 65.4%、dist 85.3%）
   ⚠️ **繁中目錄會變大，注意 CSS/JS 啟動預算** —— `i18n.ts` 在 entry chunk 裡
2. 守衛要能**證明會失敗**：故意加一個沒翻譯的 `tr()`，證明 gate 紅
3. 回報「刻意不翻」的清單與判斷理由
4. commit 列明確路徑

## 決策紀錄

### D1. 重量測：`87` 這個數字不成立，實際是 `15`

我自己寫了掃描腳本重量一次（`walk` 用 `continue`），結果：

```
掃描檔案             210（src/**/*.ts(x)，排除 *.test.*）
tr()/trParts() 呼叫   358
其中鍵是字面值        337
其中鍵是運算式         21
不重複的鍵            310
目錄條目              482
未收錄（不重複鍵）      15  → 4.8%
未收錄（呼叫點）        15  → 4.2%
```

**呼叫數對得上**（358 vs PM 的 356，差在我把註解裡寫的 `tr()` 和
`store/i18n.ts` 的函式宣告一起算進去了）。**未收錄數對不上**：15 不是 87。

我試著重建 87 是怎麼來的。最可能的成因是**目錄鍵的擷取漏了換行的條目** ——
`i18n.ts` 裡有 60 個條目的值被 prettier 換到下一行：

```ts
'Automatically accept trust and permission dialogs from agents':
  '自動接受 agent 的信任與權限對話框',
```

只認 `'key': 'value'` 同一行的正則會漏掉這 60 個鍵。我實測用這種天真擷取法
重跑，會多報 44 個「未收錄」，44 + 15 = 59，方向對但湊不到 87。剩下的差距
我沒有再往下追 —— **結論是以我的量測為準，兩種缺口的比例反過來了**：

| 類型                 | PM 量測            | 我的量測                                 |
| -------------------- | ------------------ | ---------------------------------------- |
| 包了 `tr()` 但沒收錄 | 87（24.4%）        | **15（4.2%）**                           |
| 完全沒包 `tr()`      | Settings 31 個候選 | Settings **19** 個候選，其中 12 個要處理 |

PM 抽查的五筆，我逐一驗證：

| 字串                             | PM 判斷    | 實際                                                          |
| -------------------------------- | ---------- | ------------------------------------------------------------- |
| `Emit debug-level logs…`         | ❌ 未包    | ✅ 正確，`SettingsDialog.tsx:1059` 是裸 prop                  |
| `Record session transcripts`     | 有包、沒收 | ✅ 正確                                                       |
| `Docker image used when…`        | ❌ 未包    | ⚠️ 半對：JSX 沒包，但**目錄裡已經有翻譯**（`i18n.ts:352`）    |
| `Enable the Coordinator option…` | ❌ 未包    | ✅ 正確                                                       |
| `Token counts read from…`        | ❌ 未包    | ❌ **錯**，`TokenUsageSection.tsx:45` 有包 `tr()`，只是沒收錄 |

`Docker image used when…` 那一筆最有意思：**翻譯早就寫好了，只是 JSX 沒接上**。
這變成守衛第 4 條檢查的直接動機（見 D4）。

### D2. 掃描器的 template literal 失步 —— 這是這一波最花時間的 bug

第一版掃描器在建「全 src 字面值索引」時，逐字元走訪、遇到引號就讀字面值。
`readLiteral` 碰到 `` `1px solid ${theme.border}` `` 的 `${` 就回傳 null
（判定「這是運算式不是鍵」），呼叫端於是 `i += 1` 繼續往前走。

問題是：**它沒有跳過那個 template literal**。往前走到結尾的那個反引號時，
掃描器把它當成**新的開頭反引號**，一路吞掉後面兩百行程式碼，中間所有真正的
字面值全部消失。這個 codebase 有幾百個 `` `1px solid ${…}` `` 內聯樣式，
所以災情是全面的 —— `NewTaskDialog.tsx` 整個檔案只掃出 119 個字面值，
其中一個「字面值」長 8000 字元。

症狀是守衛謊報：`Only one coordinator per project can be active at a time`
被報成「翻譯了但沒人用」，實際上它就在 `NewTaskDialog.tsx:319`。

修法：`readLiteral` 現在回傳 `{ value: string | null, end }`。
帶 `${}` 的 template literal **value 為 null 但 end 照樣回報**，
呼叫端據此跳過整段；`skipSubstitution()` 以大括號配對處理巢狀，
且會遞迴跳過 `${}` 裡面的字串。**跳過，而不是放棄** —— 這是重點。

同時加了兩道防線：

1. `'` 和 `"` 的字面值**不得跨行**（語言本來就這樣規定）。JSX 裡的
   `the task's` 這種撇號因此最多只會污染一行，不會吞掉整個檔案。
2. `skipComment()` 跳過 `//` 與 `/* */`。註解裡的撇號原本會讓
   `task-dependency.ts` 的兩個 key 掃不到。

修好之後守衛才第一次講真話：第 4 條檢查精準指出兩筆真缺陷，零誤報。

### D3. 守衛放在測試裡，不放進 `src/lib/`

`i18n.ts` 在 entry chunk 裡，啟動 JS 預算只剩 262 KB 空間。掃描器有 200 行，
放進 `src/lib/` 就算 rollup 能 tree-shake 也是賭。放在 `*.test.ts` 裡，
vite build 根本不會碰到它，knip 的 `ignoreExportsUsedInFile` 也涵蓋。

而且守衛**讀原始碼文字、不 import 元件**：vitest 是 `environment: 'node'`，
沒有 DOM，`.tsx` 根本 import 不進來。讀文字的副作用是好的 ——
新的呼叫點寫下去當下就被涵蓋，不需要任何註冊步驟。

先例：`reduced-motion-styles.test.ts`、`focus-visible-styles.test.ts`
都是讀原始檔的測試。

### D4. 守衛四條檢查，按「字串逃脫的順序」排

1. **每個字面值 `tr('…')` 都要有繁中條目**，除非在 `KEPT_IN_ENGLISH`。
   這是主檢查，直接回答「有沒有新的 UI 字串沒有繁中翻譯」。
2. **每個運算式 `tr(expr)` 的所在檔案必須登記在 `DYNAMIC_TR_SOURCES`**。
   掃描器看不見的鍵是唯一的逃脫路徑，把它變成一份要人簽名的清單。
3. **登記的鍵必須被翻譯，而且必須還存在於它宣稱的來源模組裡**。
   在資料表裡改個字卻沒回來更新登記，會在這裡紅。
4. **句子長度（≥40 字元）的目錄條目不得「孤立」** —— 沒有任何 `tr()` 讀它、
   也沒有在任何地方以字面值出現。這抓的是 `Docker image used when…` 那一類：
   翻譯寫好了、JSX 沒包，使用者看到英文而翻譯就躺在旁邊。反向也抓得到：
   有人改了英文原文、把舊條目變成孤兒。

**為什麼是 40 字元**：短標籤會撞名。`Copy`、`Open`、`Running` 到處都是
識別字和子字串，用它們做第 4 條檢查會產生 7 個誤報。句子不會撞。
實測門檻設 40 時誤報 0、真陽性 2。

**不動 `translate()` 的 fallback**：守衛只在開發期紅，執行期行為一個字沒改。

### D5. `KEPT_IN_ENGLISH` 只有兩個字

- `Coordinator` —— 功能名稱，UI 到處這樣顯示，MCP 工具名也是。
  `i18n.ts:210` 早就有註解說明「不放自我對映的條目，因為那讀起來像翻譯完了」。
- `Worktree` —— git 詞彙。目錄裡 `'Worktrees': 'Worktree'` 已經是同一個判斷。

清單刻意做得**難以擴張**：每一筆都要寫理由。這樣「刻意不翻」是個決定，
不是偷懶的出口。

沒進 `tr()` 因此也不歸守衛管、但同樣是刻意保留英文的：
`Claude Code (claude CLI)`、`MiniMax (M2.7)`、`Huly`（產品／廠商名）、
`AaBb 0Oo1Il →`（字型樣張，翻了就沒意義）、
`DEFAULT_DOCKER_IMAGE` 與 `.parallel/Dockerfile`（識別字與路徑）。

句子**內部**保留英文的詞：`transcript`（它是磁碟上真的檔名
`transcripts/<taskId>.jsonl`，翻了就對不上目錄）、`token`、`IPC`、`pty`、
`PR`、`commit`、`branch`、`worktree`、`image`、`agent`、`prompt`。

### D6. 順手清掉三個字串串接

`SettingsDialog.tsx` 的 `${tr('Deleted')} ${removed} ${tr('transcripts')}`
是 wave 6 想消滅的那種寫法，把數字釘死在句子中間。改成兩個完整句子
（`Deleted 1 transcript` / `Deleted {count} transcripts`）—— 英文有單複數，
繁中沒有，所以兩個 key 對到同一句翻譯，複雜度留在有文法的那一邊。

`token-usage-format.ts` 的 `describeProviders` 和
`transcript-timeline.ts` 的 `transcriptSummaryLine` 一樣：
兩個都用範本字串拼英文句子，回傳成品字串。改成**回傳 descriptor**
（`{ text, params }`），跟 `dependencyBlockMessage` 同一個模式 ——
純函式不能讀 locale，所以由呼叫端翻譯。

這件事的意義超過美觀：`{providers} not installed.` 讓繁中可以寫
「未安裝 Codex」，英文是「Codex not installed」。字串串接做不到這件事。

### D7. 只修 Scott 截到的畫面，不做全 src 掃蕩

「包了 `tr()` 但沒收錄」這一類我**全 src 補完**（15/15，現在 0）。
「完全沒包 `tr()`」我只做 Scott 截圖的那些區塊
（Settings ＋ AI Usage ＋ Timeline），全 src 還有約 200 個候選字串沒包。
理由寫在 D8。

### D8. 沒有為「未包 tr()」做全面 ratchet

守衛的第 4 條只抓「已經翻譯但沒包」。「從來沒翻譯也沒包」的裸 JSX 英文句子，
全 src 還有約 200 處，我沒有為它加 ratchet：

- 我的粗略偵測器對 `.tsx` 有誤報（TS 泛型 `createSignal<T>(…)` 會被當成
  JSX 文字節點），要做到零誤報得寫真的 JSX parser；
- ratchet 需要一份 baseline 清單，而 baseline 清單會腐爛 ——
  這正是這一波在修的那種東西。

留給下一波，見結束摘要。

## 結束摘要

**做完的三件事：**

1. **補齊「包了 `tr()` 但沒收錄」** —— 全 `src/` 15 個鍵全部補上，現在 0 個。
   不是 PM 說的 87；量測方法與差異分析見 D1。
2. **補上「該包而沒包」** —— Settings（Docker、Diagnostics、Updates、
   Coordinator、Ask about Code、Editor placeholder、主題）、AI Usage、
   Timeline 共 21 處包上 `tr()` 並翻譯，其中 4 處是**翻譯早就寫好、
   只是 JSX 沒接上**。
3. **加了守衛** —— `src/lib/i18n-coverage.test.ts`，6 個測試 4 條檢查。
   已實證會紅（三種逃脫路徑各示範一次），示範後全部還原。

**目錄成長**：482 → 528 條（+46）。

**四道 gate**（全綠）：

```
npm run check          compile / typecheck / lint / format:check 全過
npm run check:static   typecheck / lint / knip / depcruise（466 modules）全過
npm test               2644 passed | 26 skipped（baseline 2635 | 26，+9）
npm run check:bundle   entry chunk  1,243,131 B / 1,500,000 B — 82.9%（baseline 82.5%）
                       startup CSS     78,513 B /   120,000 B — 65.4%（baseline 65.4%）
                       dist total  15,353,958 B / 18,000,000 B — 85.3%（baseline 85.3%）
```

**啟動 JS 是唯一動到的預算**：+5,189 B，+0.4 個百分點。46 條繁中條目
（多為長句）就是這 5 KB。距離上限還有 256,869 B。CSS 一個 byte 沒動，
dist total 進位後仍是 85.3%。

**這一波之後還缺什麼**（給下一波）：

- 全 `src/` 約 200 處裸 JSX 英文句子仍未包 `tr()`（Sidebar、NewTaskDialog、
  MergeDialog、ConnectPhoneModal…）。守衛擋得住「翻了沒接上」，
  擋不住「從來沒翻」。要補這一塊需要真的 JSX parser，見 D8。
- `lib/look.ts` 的主題 preset `label` / `description` 完全沒進 i18n 體系
  （Themes 分頁的卡片說明還是英文）。Scott 沒截到這一頁，這一波沒動。
- `PROVIDER_LABELS`、CJK 字型 `family` 名稱刻意留英文；未來若要翻譯，
  得先決定廠商名的政策。
