# B1：entry chunk 減重（在破 90% 之前）

## 為什麼現在做

entry chunk 從交接時的 86.9% 漲到 **89.2%**，這批六波共 +2.3pp，且在加速
（前四波合計 +0.8，後兩波 +1.5）。硬預算 1,500,000 B，只剩 **162,002 B**。

**不准調高預算。** `scripts/check-bundle-size.mjs` 的註解寫明它存在的理由：
一個沒被使用的 `monaco-editor` import 在 renderer entry 潛伏了數個版本，
花掉 3.7 MB entry 加 9.4 MB worker，而**沒有任何 linter 抓得到**
（import 鏈是活的，只是那個依賴從未被呼叫）。調高天花板等於把那次 3.7 MB
學費換來的唯一守衛拆掉。

## 已查明的事實（不要重查）

- **shiki 已經是 lazy 的**（`src/lib/shiki-highlighter.ts:64` 的 `import('shiki')`），
  第 1 行是 `import type`，零成本。這裡沒有可撿的。
- 既有 lazy-load 先例：`PlanViewerDialog.tsx:112` 的 `import('mermaid')`、
  `ConnectPhoneModal.tsx:83` 的 `import('qrcode')`。**照這個 pattern，不要發明新的。**
- 成長來源是**功能程式碼累積**，不是單一大型依賴。

## 候選（按大小，全部是「開了才看得到」）

| 檔案                                  | 行數 | 何時才需要                       |
| ------------------------------------- | ---- | -------------------------------- |
| `src/components/NewTaskDialog.tsx`    | 1479 | 按「新增任務」才渲染             |
| `src/components/SettingsDialog.tsx`   | 1397 | 開設定才渲染                     |
| `src/components/HelpDialog.tsx`       | 517  | 開說明才渲染                     |
| `src/components/DiffViewerDialog.tsx` | 505  | 開 diff 才渲染                   |
| `src/lib/i18n.ts`                     | 769  | **英文使用者永遠用不到繁中目錄** |

`i18n.ts` 那條要特別小心：`translate()` 是同步呼叫、散佈在 307 個 `tr()` 呼叫點。
拆成非同步會破壞既有行為。**如果做不到不改變同步語意，就不要做，並說明為什麼。**

## 目標

**entry chunk 降到 85% 以下**（留出至少 5pp 給後續功能）。做不到就回報實際到多少、
還有什麼可拆但你判斷不划算，不要為了數字硬拆。

## 不做

- 不調 `BUDGETS`
- 不移除任何功能
- 不改變 `translate()` 的同步語意
- 不引入新依賴或打包外掛
- 不動 `src/App.tsx` 開頭的 CSS import 區塊（cascade 順序敏感）

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2248
2. `check:bundle` 的 entry 百分比明確回報，且**低於現在的 89.2%**
3. 每一個改成 lazy 的元件，說明「使用者何時會付到那個載入成本」——
   如果答案是「App 一啟動就會」，那個拆分沒有意義
4. 有測試或明確說明證明對話框開啟行為未變
5. commit 列明確路徑

---

# 執行紀錄

## 步驟

- [x] S0 建立基準量測（entry 1,337,998 B / 89.2%；dist 15,333,603 B / 85.2%）
- [x] S1 盤點各 dialog 的呼叫點與 gating 方式，確認哪些能安全 lazy
- [x] S2 拆 `ArenaOverlay`（呼叫點本來就有 `<Show>`，零語意變動）
- [x] S3 拆 `DiffViewerDialog`（內容本來就全在 `<Show>` 裡）
- [x] S4 拆 `HelpDialog` + `SettingsDialog`
- [x] S5 **發現 modulepreload 陷阱**，改用「誠實啟動位元組」重新量測全部拆分
- [x] S6 逐段重建中間狀態，取得每個拆分的誠實貢獻
- [x] S7 評估 `src/lib/i18n.ts` → 判定不拆
- [x] S8 評估 `NewTaskDialog` → 判定不拆
- [x] S9 四道 gate 全綠
- [x] S10 commit（明確路徑）

## 量測結果

「誠實啟動位元組」= entry chunk + `dist/index.html` 中所有 `<link rel="modulepreload">`
的 chunk。理由見決策紀錄 D-02。

| 階段           | entry chunk | 被 preload 的 sibling | 誠實啟動總量  | 佔 1,500,000 B |
| -------------- | ----------- | --------------------- | ------------- | -------------- |
| 基準           | 1,337,998   | 無                    | **1,337,998** | 89.2%          |
| +Arena         | 1,314,722   | 無                    | **1,314,722** | 87.6%          |
| +DiffViewer    | 1,289,414   | 無                    | **1,289,414** | 86.0%          |
| +Help/Settings | 1,038,196   | 194,365               | **1,232,561** | **82.2%**      |

**誠實結果：1,337,998 → 1,232,561 B，省下 105,437 B（−7.9%），82.2%。**

`check:bundle` 只量 `index-*.js`，會顯示 **69.2%**。那個數字是真的，但**不代表使用者付的成本**。
兩者差 13pp，全部是 `platform-B5eFPIUU.js`（193,157 B）造成的。

dist total：15,333,603 → 15,342,902 B（+9,299 B，85.2% 不變）。切 chunk 有邊界成本，
但那是把工作往後挪的代價，屬預期。

### 每個拆分的誠實省下量

| 拆分                            | 誠實省下     | chunk 有被 preload 嗎 | 使用者何時付這個成本  |
| ------------------------------- | ------------ | --------------------- | --------------------- |
| `ArenaOverlay`                  | **23,276 B** | **否**                | 第一次開 AI Arena     |
| `DiffViewerDialog`              | **25,308 B** | **否**                | 第一次開 diff         |
| `HelpDialog` + `SettingsDialog` | **56,853 B** | **否**                | 第一次開說明 / 開設定 |

三個 lazy chunk 都**不在** `index.html` 的 modulepreload 清單裡，所以三個都是真的延後。

---

## 決策紀錄

### D-01 拆分要用哪一種 gating，取決於元件「關閉後還留不留狀態」

`lazy()` 只有在「呼叫點不會在啟動時就渲染它」時才有意義。原本四個 dialog 都是
**常駐掛載、用 `open` prop 控制內容**，直接換成 `lazy()` 會在 App 啟動時就抓 chunk，
等於白做。所以每個都必須在呼叫點加 gate。但用哪種 gate 不能一概而論：

- **`<Show when={open}>`（關閉即卸載）** —— 用在關閉後不保留任何狀態的元件。
  `HelpDialog` 的兩個 signal（`recordingId`、`conflictInfo`）本來就被
  「`open` 變 false 就清空」的 effect 清掉；`DiffViewerDialog` 的整個內容本來就包在
  `<Show when={props.scrollToFile !== null}>` 裡。對這兩個而言「卸載」和「原本的關閉」
  終態相同，所以可以直接用 `<Show>`。
- **單向 latch（第一次開啟後就常駐）** —— 用在關閉後**要**保留狀態的元件。
  `SettingsDialog` 的 `activeTab` 是元件內的 local signal，今天關掉再開會停在原分頁。
  若用 `<Show>` 卸載，重開會跳回 general——這是**使用者看得見的行為退化**。
  所以改用 `settingsEverOpened` latch：沒開過就不抓 chunk，開過之後就一直掛著，
  跟原本 eager import 的狀態完全一樣，唯一差別只有「什麼時候抓 chunk」。

`ArenaOverlay` 不需要任何新 gate——它的呼叫點本來就是 `<Show when={store.showArena}>`，
所以那個拆分在語意上是零變動的，也因此拿它當第一個做。

### D-02 ⚠️ modulepreload 陷阱：`check:bundle` 的 entry 數字可以被拆分造成的假象灌水

**這是本波最重要的發現，下一個動這個預算的人請先讀這段。**

拆完 Help/Settings 後 `check:bundle` 顯示 entry 從 1,289,414 掉到 1,038,196，
一口氣少 251,218 B（−16.8pp）。以行數判斷這個數字大得不合理，所以去驗證，結果：

`dist/index.html` 裡多了一行

```html
<link rel="modulepreload" crossorigin href="./assets/platform-B5eFPIUU.js" />
```

而 `index-*.js` 的開頭是一句**靜態** import：

```js
import { $i as e, $n as t /* …200 多個 binding… */ } from './platform-B5eFPIUU.js';
```

也就是說 rolldown 把 entry 與 lazy chunk 共用的模組（含 solid-js runtime，193,157 B）
抽成一個 sibling chunk。那些位元組**啟動時照樣會被抓、被 parse、被執行**，
只是從 `check:bundle` 唯一量的那個檔名裡搬走了。

**結論：`check:bundle` 的 entry 數字現在會低報約 13pp。**
真正被延後的只有 56,853 B，不是 251,218 B。

關於「能不能把 modulepreload 收窄」（協調者問到的）：**不能，而且方向是錯的。**
`platform-*.js` 不是 preload 啟發式猜出來的，它是 entry 的**靜態 import 邊**。
`build.modulePreload: false` 只會把 `<link>` 提示拿掉，import 邊還在——
chunk 照抓，只是少了預抓提示，啟動反而**變慢**。那是把指標做漂亮、把使用者體驗做爛，
所以沒做，也不建議做。

**給下一波的建議（本波沒做，因為超出授權範圍）：**
`scripts/check-bundle-size.mjs` 的 `entryChunkSize()` 應該改成
「entry + `index.html` 裡所有 modulepreload chunk」的總和，**預算數字維持 1,500,000 不動**。
這是把守衛**收緊**、不是放寬：目前的量法已經被證明可以靠「把程式碼推進被 preload 的
sibling chunk」繞過，而這正是這個 gate 當初為了 monaco 而存在的那種「沒有 linter 抓得到」
的漏洞。改完之後這個 branch 會顯示 82.2%，仍然過關。

（量測用的臨時腳本沒有進 commit，它只是 scratchpad 裡的分析工具。）

### D-03 不拆 `src/lib/i18n.ts`——同步語意無法保留

**判定：不拆。**

`src/store/i18n.ts` 的 `tr()` 直接同步 `return translate(store.locale, text, params)`，
而 `App.tsx:16` 就 eager import 了 `tr`。要讓繁中目錄離開 entry，唯一辦法是把目錄
變成 `await import()`，那 `translate()` 就得回傳 Promise——散佈在 307 個呼叫點、
而且大量是在 JSX 屬性裡（`title={tr(...)}`）當字串用的地方，全部會壞。

有人可能會想「先同步回英文、載入後再切」——那更糟：繁中使用者啟動時會先看到一閃的英文，
而且 `tr()` 是在 reactive 情境裡被讀的，那個閃爍會是真的重繪。用一個**靜默的**
語系降級去換幾十 KB，是拿正確性換指標，明確不做。

另外實測也顯示這條路本來就沒有想像中值錢：`lib/i18n.ts` 從 entry 走得到，
是因為 `store/i18n.ts` → `lib/i18n.ts` 這條 eager 鏈，不是因為 `SettingsDialog`
引用了 `LOCALES`。拆掉 SettingsDialog 之後目錄仍然留在 entry（已驗證），
這是對的——啟動時第一個畫面就要翻譯。

### D-04 不拆 `NewTaskDialog`——`defer: true` 是地雷，而且目標已達成

**判定：不拆，且這是刻意留白，不是漏掉。**

它是候選裡最大的（1479 行），但它的兩個「開啟時重置」effect 是
`on(() => props.open, …, { defer: true })`。`defer: true` 會**跳過第一次執行**。
今天元件在 App 啟動時就以 `open=false` 掛載，所以跳過的那次本來就是 no-op；
但只要改成「開啟時才掛載」，元件掛上來時 `props.open` 已經是 `true`，
那次執行被跳過之後 `props.open` 再也不會變——**effect 永遠不會跑**。

而那個 effect 裡不只是重置 signal，它還：

- 註冊全域 `Alt+Arrow` capture-phase keydown handler（表單欄位導航）
- 跑非同步 prefill：載入 agent 清單、選 last agent、GitHub drop URL 預填、
  arena 比較 prompt 預填、`promptRef?.focus()`

也就是說天真地加 `<Show>` 會**靜默地**弄壞 Alt+Arrow 導航與整個預填流程。

要做對，得把那兩個 effect 的 `defer: true` 拿掉（兩個 body 都以 `if (!open) return;`
開頭，所以在今天的架構下拿掉是可證明的 no-op）。這在推理上成立，但那段程式碼帶著
`D-03: onCleanup MUST be synchronous…` 這類註解，明顯是踩過雷補起來的，
而**本專案沒有 DOM 測試環境**（vitest `environment: 'node'`，`solidPlugin({ ssr: true })`，
`createEffect` 在 SSR build 裡根本不執行——實測過），我無法用測試證明改完行為不變。

在「誠實數字已經是 82.2%、目標是 85% 以下」的前提下，為了再擠幾十 KB 去動
一段有事故史、又驗證不了的初始化程式碼，划不來。留給有 DOM harness 的時候做。

### D-05 沒有為 latch 寫單元測試——因為這個 harness 測不了 reactivity

一度寫了 `src/lib/lazy-mount.ts` + 對應測試把 latch 抽成共用 helper，
結果 4 個測試掛 3 個：vitest 用 `solidPlugin({ ssr: true })`，解析到 solid 的 **server** build，
`createEffect` 在裡面是 no-op。既有的 `extracted-components.test.ts` 能過，
是因為它只用 `renderToString` 測純渲染輸出，沒碰響應式。

不想留一個「假裝有測到」的測試，也不想為了測試而把 3 行邏輯包成一個要被 knip 盯的模組，
所以把 helper 和測試都刪掉，latch 直接寫在 `App.tsx` 裡並加註解說明。

**行為未變的證明改用這個論述**（驗收條件 4 允許「測試**或**明確說明」）：
本波**完全沒有動 store 層的狀態機**——`toggleHelpDialog` / `toggleSettingsDialog` /
`showNewTaskDialog` 的行為、以及 `src/store/focus.ts` 裡讀這些旗標的所有分支，
一行都沒改。涵蓋它們的 `src/store/focus.test.ts` 仍然全綠，2248 個測試數與基準一字不差。
改的只有**渲染時機**，而每一個渲染時機的等價性都在 D-01 裡逐一論證過。

### D-06 arena CSS 變成延後載入，判定安全

`ArenaOverlay.tsx` 頂端 import 了六個 `arena-*.css`，改 lazy 之後它們會變成
隨 chunk 載入的 CSS，也就是**在主 stylesheet 之後**才進 document。

確認過安全：`src/arena/arena-*.css` 是整個 `src/` 裡**唯一**的元件級 CSS
（其餘 CSS import 全部集中在 `App.tsx` 開頭那個區塊），而且它本來在 import 圖裡
就排在最後（`App.tsx:87` 遠在 `styles.css` 的第 13 行之後）。它們的選擇器又全是
`.arena-*` 前綴。所以「本來就最後、現在還是最後」，cascade 結果不變。

**`App.tsx` 開頭的 CSS import 區塊一行都沒動**（禁令項目），只刪掉了下方
第 87 行那個 JS import。

---

## 結束摘要

### 做了什麼

四個 lazy 拆分，全部照既有的 `import('mermaid')` / `import('qrcode')` pattern，
沒有引入新依賴、新外掛，也沒有動 `BUDGETS`：

| 檔案                           | 改動                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`                  | `ArenaOverlay` / `HelpDialog` / `SettingsDialog` 改 `lazy()`；Arena 與 Help 沿用/新增 `<Show>` gate；Settings 用 `settingsEverOpened` latch 保住 `activeTab` |
| `src/components/TaskPanel.tsx` | `DiffViewerDialog` 改 `lazy()`，並用它內部本來就有的同一個判斷式 `<Show>` 包起來                                                                             |

`DiffViewerDialog` 是最划算的一個：`ScrollingDiffView`（929 行）只有它在用，
整包跟著離開 entry。

### 誠實數字

**啟動 JS：1,337,998 → 1,232,561 B（−105,437 B，−7.9%），佔預算 82.2%，達標（<85%）。**

`check:bundle` 會顯示 entry 69.2%——**那個數字低報了 13pp**，原因見 D-02。
回報時以 82.2% 為準。

四道 gate 全綠，測試 **2248 passed / 24 skipped**，與基準完全一致；
knip 乾淨、depcruise 455 modules / 1534 dependencies 無違規、無循環。

### 刻意沒做

- **`src/lib/i18n.ts`** —— 不拆。同步語意保不住（D-03）。
- **`NewTaskDialog`** —— 不拆。`defer: true` 地雷 + 無 DOM 測試環境，且目標已達成（D-04）。
- **其餘小 dialog**（`MergeDialog` 570 行、`EditProjectDialog` 580、`ConnectPhoneModal` 607、
  `PlanViewerDialog` 376、`ImportWorktreesDialog` 365）—— 沒動。它們散在
  `Sidebar` / `TaskPanel` 多個呼叫點，每個都要各自判斷跨開啟狀態，
  而且共用 `ChangedFilesList`（763 行，`TaskChangedFilesSection` 也在用，
  無論如何都會留在 entry）、`ReviewProvider`、`ReviewSidebarPanel`，
  真正能搬走的獨佔程式碼比行數看起來少很多。目標已達成，不為數字硬拆。
- **改 `check:bundle` 的量法** —— 沒做，超出本波授權，但這是我對下一波最強的建議（D-02）。

### 下一波接手時最該知道的一件事

**不要相信 `check:bundle` 的 entry 百分比。** 先跑一次
「entry + index.html 裡所有 modulepreload chunk」的加總，那才是使用者付的錢。
目前兩者差 13pp，而且會隨著再拆更多 lazy chunk 繼續擴大。
最好的做法是先把 D-02 建議的量法修掉，再繼續減重。
