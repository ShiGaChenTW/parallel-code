# 第六波：i18n 動態字串

**建立時間：** 2026-07-31 01:09
**最後更新：** 2026-07-31 01:30
**狀態：** 完成（待 review）
**分支：** `feat/i18n-dynamic`（從 `main @ 3a50af8` 分出）
**worktree：** `/Users/scottchen/Documents/20_Projects/pc-feat-i18n-dynamic`

## 目標

讓帶變數的句子可以被翻譯。目前 `tr()` 只吃完整的靜態字串，
所以「3 個任務執行中」這類句子只能用兩種 workaround：

1. **前綴式**：目錄裡 13 條以冒號結尾的條目（`'Failed to load branches:'`），
   程式碼把值接在後面。語序被鎖死在英文的「標籤在前」。
2. **完全放棄**：52 處 JSX 內含插值的可見句子根本沒進 `tr()`。

兩者都讓繁中 UI 在有變數的地方掉回英文或半英文。

## 前置事實（已量測，非推論）

| 項目                          | 數字 |
| ----------------------------- | ---- |
| `tr()` 呼叫總數               | 307  |
| 目錄條目                      | 423  |
| 以冒號結尾的前綴式 workaround | 13   |
| JSX 內含 `${}` 的可見句子候選 | 52   |

52 是**候選**不是確數 —— 其中含 class name、路徑組合等非可見文字，需人工過濾。

## 範圍

做：

- `src/lib/i18n.ts` 增加插值能力（純函式，可單測）
- `src/store/i18n.ts` 對應的 reactive wrapper
- 把 13 條前綴式條目收斂成完整句子，語序交還給譯者
- 過濾 52 個候選，把真正的可見句子接上

不做：

- 不引入 i18n 套件（entry bundle 只剩 13% 餘裕）
- 不做複數規則機制 —— 繁中沒有複數形，英文是原文語言直接寫死即可。
  ICU MessageFormat 對單一語言對是過度設計
- 不動 `App.tsx` 開頭的 CSS import 區塊（cascade 順序敏感，交接文件 §3）

## Plan Steps

- [x] Step 1 — 插值 API 設計與純函式實作（`src/lib/i18n.ts`）
- [x] Step 2 — 單元測試：未知 key、缺參數、多餘參數、參數出現多次
- [x] Step 3 — 13 條冒號前綴條目改寫為完整句子
- [x] Step 4 — 過濾 52 個候選並接上真正可見的句子
- [x] Step 5 — 四道 gate 全綠 + bundle 數字回報

## 驗收條件（PM 側）

1. `npm run check` / `npm run check:static` / `npm test` / `npm run check:bundle` 全綠
2. 測試數 ≥ 1695（只准增加）
3. `check:bundle` 的 entry / dist 百分比明確回報，entry 不得超過 90%
4. 目錄裡不再有以冒號結尾的殘留前綴條目
5. commit 列明確路徑，不得出現 `.agent/`、`.codex/`、`openspec/`

## 決策紀錄

### D1 — 具名佔位符 `{name}`，不用位置參數 `{0}`

`tr('Merge into {branch}', { branch: 'main' })`。

拒絕位置式 `{0}`：譯者把值搬到句首之後，`{0}` 就失去語意，
而 `{branch}` 搬到哪裡都還讀得出來那是 branch。這正是本波的目的
（語序交還給譯者），位置式會在達成目的的同時破壞可讀性。

也拒絕 ICU MessageFormat / tagged template：前者是套件（entry bundle 沒有餘裕），
後者無法讓「整句」成為單一目錄 key，等於換一種方式把語序釘死。

### D2 — 邊界行為：缺參數留下 `{name}`，不空白也不丟例外

| 情境               | 行為                       | 理由                                                                                                                                   |
| ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 目錄查無此 key     | 用英文原文當模板，照樣插值 | 沿用既有 fallback 哲學，退化成可讀英文                                                                                                 |
| 缺少參數           | 原樣輸出 `{branch}`        | 空白會靜默遺失資訊；丟例外會讓 error boundary 整塊面板變白——為了一個文案 bug 代價太大。畫面上出現 `{branch}` 夠吵，review 時一定看得到 |
| 多餘參數           | 靜默忽略                   | 目錄與呼叫端本來就會漂移，多一個沒用到的值不是使用者看得到的缺陷                                                                       |
| 同一參數出現多次   | 每一處都替換               | 繁中可能需要重複英文只講一次的值；只換第一個會靜默漏字                                                                                 |
| 代入值本身含 `{x}` | 不再掃描                   | 一個真的叫 `{base}` 的 branch 名不該把別的參數拉進來（注入防線）                                                                       |

`interpolate()` 不傳 `params` 時原樣回傳模板，所以既有 307 個靜態
`tr()` 呼叫行為完全不變——這是能安全增量遷移的關鍵。

### D3 — 兩個函式而不是一個：`tr()` 回字串、`trParts()` 回 segment

有些「句中的值」不是字串而是 JSX 元素：SettingsDialog 的 `<kbd>` 快捷鍵、
CloseTaskDialog 的 `<strong>` branch 名。這些如果用 `tr()` 會丟掉樣式。

`trParts()` 回傳 `TemplateSegment[]`，component 用 `<For>` 決定每個 slot
長什麼樣。整句仍是單一目錄條目，語序仍屬譯者。

沒有做成 `tr()` 的 option，因為回傳型別不同——要 `title` 字串的地方
不該拿到 segment 陣列，讓型別系統擋住比註解可靠。

共用同一個 `parseTemplate()` 解析器，`interpolate()` 只是
`parseTemplate` + `join`，所以兩條路徑不可能對佔位符有不同解讀。

### D4 — 【判斷反轉】13 條冒號條目，實際上只有 7 條是真的 workaround

原始假設是「13 條都是把值接在冒號後面」。逐一追查呼叫點後推翻：

- **6 條根本不是使用者可見文字**：`'Failed to load branches:'`、
  `'Failed to add agent:'`、`'Failed to send prompt:'`、
  `'Failed to send notes to prompt:'`、`'Failed to send rebase prompt:'`、
  `'Failed to scan importable worktrees:'` —— 全部只出現在 `console.error()`。
  它們從來沒有經過 `tr()`，翻譯了也沒人看得到。**直接刪除**，
  不是改寫。留著只會讓下一個人以為它們有在用。
- **2 條在目錄裡但呼叫端沒接 `tr()`**：CloseTaskDialog 的兩句
  （`...permanently deleted:` / `...branch will be kept:`）是裸字串直接寫在 JSX，
  目錄條目形同虛設。已補上 `tr()`。
- **1 條完全沒進目錄也沒進 `tr()`**：SettingsDialog 的
  `Customize your workspace. Shortcut:` 是硬編英文。已改成 `{shortcut}` slot 模板。

### D5 —【判斷反轉】保留 6 條冒號結尾條目，並用測試把它鎖住

原本打算「一條冒號都不留」以符合驗收條件 4。實作到一半反轉：
驗收條件寫的是「殘留**前綴**條目」，而剩下這 6 條都不是字串串接。

- **4 條是 label，值是隔壁的 DOM 節點**（number input、text input、
  一排 button、一個放大的 PIN）：`'Max concurrent sub-tasks:'`、`'Image:'`、
  `'Sub-tasks:'`、`'Enter this code on your phone (valid 5 min):'`。
  兩種語言都是 label 在前，譯者不會想改；要把它們變成 slot 模板，
  就得拆掉承載樣式的 `<label>` / `<span>` 元素——那是無聲的樣式變更，
  而且換不到任何翻譯自由度。
- **2 條是引導 `<ul>` 的句子**：冒號是正常標點，字串後面沒有接任何東西。

處理方式不是寫在註解裡就算：匯出 `COLON_LABEL_KEYS` 常數，
並加測試斷言「目錄裡冒號結尾的 key 集合 === 這份清單」。
以後任何人新增一條串接式冒號條目都會直接測試失敗，
而不是靠 code review 抓。

### D6 — 不做複數規則，改用「兩條完整句子 + 呼叫端三元運算」

有 4 個站點英文本來就有 `${n === 1 ? '' : 's'}`。作法是給兩個獨立目錄 key
（`'{count} star'` / `'{count} stars'`），呼叫端用三元運算挑一條。

這不是複數機制：繁中兩條對應同一個譯文，英文保住原有文法，
而且沒有任何一行「規則」程式碼。真做 plural rules 對「英文原文 + 繁中」
這組語言對是純粹的死重量。

沒有為 `'{count} added lines'` / `'{count} removed lines'` 補單複數——
它們本來就沒有做單數變化（`+1 added lines`）。本波處理的是可翻譯性，
不是既有英文文案的文法 bug；順手改會讓 diff 混入無關的行為變更。

### D7 — 兩處「看起來像句子但不是」的判斷

- **TerminalBookmarks 的 title**：`${b.preview}\n\nClick to jump...`。
  preview 是終端機原始輸出，自己一整行；只有下面那句指示需要翻譯。
  拆成 `` `${b.preview}\n\n${tr('Click to jump · Right-click to remove')}` ``，
  不硬把資料塞進模板。
- **4 處 commit title**：`` `${hash.slice(0,7)} ${message}` ``。
  純 git 資料並排，沒有任何散文，沒有語序問題，不動。

### D8 — 額外找到 regex 沒抓到的一處

`filesFooterTitle()`（`ChangedFilesList.tsx:70`）是可見的插值句子，
但因為寫在 helper function 裡而不是 JSX 模板字面量，粗略 regex 抓不到。
已一併接上 `tr()`。它原有的單元測試在 `en` locale 下行為不變，所以照樣通過。

這也說明「52」本來就不是母體的完整計數——它是一個 regex 的視野，
不是「所有可見插值句子」的集合。

## 結束摘要

**做完了什麼**

- `src/lib/i18n.ts` 新增純函式 `parseTemplate()` / `interpolate()`，
  以及 `translate()` / `translateParts()` 的參數化版本。零新依賴。
- `src/store/i18n.ts` 對應加上 `tr(text, params)` 與 `trParts(text)`。
  component 維持笨渲染器，所有邏輯留在 lib（vitest 是 node 環境，
  component 測不了，這個分工是硬性的）。
- 13 條冒號條目：刪 6（死條目）、改寫 1（slot 模板）、
  補接 `tr()` 2、保留 4 + 2 並用測試鎖住。
- 52 個 regex 候選過濾出 **21 個真正可見的插值句子**，全部接上；
  另外補上 regex 漏掉的 `filesFooterTitle()`。
- 測試從 1695 → 1717（+22），涵蓋 PM 指定的四個邊界情境
  外加「不遞迴掃描」「`$` 不具特殊意義」等。

**四道 gate**

| Gate                   | 結果                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `npm run check`        | `All matched files use Prettier code style!`                                |
| `npm run check:static` | `✔ no dependency violations found (412 modules, 1358 dependencies cruised)` |
| `npm test`             | `Tests  1717 passed \| 24 skipped (1741)`                                   |
| `npm run check:bundle` | entry **87.1%**（1,306,758 / 1,500,000 B）、dist **85.0%**                  |

entry 從 86.9% → 87.1%（+0.2pp），距離 90% 上限仍有餘裕。
增加的是目錄條目本身的字串，不是機制——`parseTemplate` 全部加起來約 15 行。

**刻意沒做**

1. **沒把 4 條 label 冒號條目改成 slot 模板**（見 D5）。要動到承載樣式的
   `<label>` / `<span>` 結構，是無聲樣式變更，換不到翻譯自由度。
2. **沒做複數規則**（見 D6）。
3. **沒補 `{count} added lines` 的單複數變化**（見 D6）——那是既有英文文案 bug，
   不屬於本波。
4. **沒動 4 處 commit hash + message 的 title**（見 D7）——純資料。
5. **沒有全域掃描所有非 JSX 的插值句子**。D8 那一處是順手撿到的，
   不是系統性搜查的結果。若要根絕，該做的是 lint rule 而不是再一次人工掃——
   建議列為下一波。
