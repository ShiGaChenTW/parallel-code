# C：CSS 啟動預算（S9）

**分支：** `fix/css-budget`（從 `main @ d489871` 分出）

## 問題

B2（`df82194`）修好了 JS 的量測盲點 —— `entryChunkSize()` 現在算
entry **加上所有被 `modulepreload` 的 chunk**。修完之後它自己指出**同一種縫還在外面一層**：

`dist/index.html` 有一個 `<link rel="stylesheet" href="./assets/index-*.css">`，
目前 **78,304 B**。那是 **render-blocking** 的 —— 使用者在第一幀之前就付了。

而它**只被寬鬆的 dist total 蓋到**（85.3%，而 CSS 只佔其中 0.43%），
**沒有任何專屬天花板**。dist total 對它的變化幾乎沒有反應能力。

跟 `platform-*.js` 是同一種病：**指標與它要防的東西之間有縫。**

## 要達成什麼

CSS 的啟動成本有自己的預算，並被 `check:bundle` 納管。

## B2 留下的具體建議（它做完 JS 那邊之後寫的）

1. **重用 `preloadedChunkPaths()` 的解析方式，不要再寫第二個 regex。**
   那個函式已經處理了屬性順序、引號風格、href 形狀 —— 而**漏掉一個 `<link>`
   就是靜默少算**，正是 B2 那一波在修的病，不該在擴充它的時候重造一次。
2. **CSS 要跟 JS 分開編預算**，不要合併成一個數字。兩者的成長原因與可接受範圍不同。
3. **反向驗證要用真的胖 stylesheet**，證明新預算擋得住它被設計來擋的東西。

第 3 點是這個 repo 的既定標準：第三波建 JS gate 時**真的把 monaco 裝回去**確認會紅，
而不是調低預算假造失敗；B2 修 gate 時做了**兩個**實驗（純搬移證明不被騙、
真的塞大東西證明會紅），理由是「只做一個都只證明了命題的一半」。

**照同一個標準。**

## 預算怎麼定

目前 78,304 B。**你要提出一個數字並說明理由** —— 太緊會擋住正常的樣式成長，
太鬆等於沒有守衛。B2 當初給 JS 的理由是「gate 是擋依賴等級的回歸，不是緊身衣，
一般功能成長（數十到一兩百 KB）應該過得去」。CSS 的等價推理是什麼，由你論證。

## 要注意的邊界

- **`@import` 進來的 CSS 算不算？** 如果 `index-*.css` 裡有 `@import`，
  那些檔案也是 render-blocking 但不在 `<link>` 清單裡。**先查有沒有，再決定要不要算。**
  這可能讓「CSS 啟動成本」的定義跟 JS 不同 —— 如果是，說清楚。
- **字型檔不算**（`@fontsource/*` 的 woff2 是 CSS 引用的，但瀏覽器對字型有自己的載入策略，
  且 R4 那一波已經確立不內嵌 CJK 字型的原則）。除非你有理由推翻，否則排除並說明。
- **不要改 JS 那邊的量法。** B2 剛修好，不要動。

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2611，JS 啟動預算維持 82.5% 且量法未變
2. `check:bundle` 輸出包含 CSS 的行，且有 breakdown（比照 JS 那邊的 `note` 行）
3. **反向驗證**：造一個真的胖 stylesheet，證明新預算會紅。附實際輸出
4. `@import` 的處理有明確結論（有／沒有／算不算，附理由）
5. 腳本註解更新，說明為什麼 CSS 需要獨立預算
6. commit 列明確路徑

## 不做

- 不改 JS 預算的量法或數值
- 不改 dist total
- 不做 CSS 本身的減重（那是另一件事）

## 決策紀錄

### D1：預算定為 120,000 B —— 用這個 repo 自己的成長率，不用整數直覺

先量了再定。跑 git 歷史統計 `src/**/*.css` 的位元組數：

```
2026-02-24     46,089 B    7 files   ← 初期 build-out 結束
2026-05-01     72,707 B    7 files
2026-07-31     77,703 B    7 files
```

初期爆量（0 → 46 KB／8 天）不能當成長率。**穩態**是 2026-02-24 之後：
157 天 +31,614 B ≈ **6.1 KB/月**；最近三個月只有 **1.7 KB/月**（UI 成熟後在減速）。

量到的 render-blocking CSS 是 **78,513 B**。120,000 B 留下 **41,487 B** 空間：
以歷史穩態算約 **7 個月**，以近三個月速率算 **2 年以上**。
選這個區間的理由是「**gate 每季都要調 = 教會大家調 gate**」——
守衛的價值來自它很少響，而響的時候大家會認真看。

另一端：120,000 B 是今天的 **1.53 倍**，所以任何讓使用者首幀成本「多出一半」的
單筆加入都會被擋下 —— 完整 Bootstrap（~230 KB min）、未 purge 的 Tailwind（MB 級）、
完整 Font Awesome（~57 KB min → 落在 ~135 KB）、highlight.js 全主題組。
它**刻意不擋**單一個 ~32 KB 的元件樣式表（例如 katex）：那跟半年的正常功能成長
在數字上無法區分，**一個分不出來的 gate 不該假裝分得出來**。

### D2：CSS 的 65.4% 比 JS 的 82.5% 寬鬆，這不是雙標

一開始想「CSS 是 render-blocking，所以要比 JS 更緊」，寫到一半發現這個論證是錯的，
在此推翻自己：百分比在兩個相差 16 倍的量之間**不是可比的尺**。
JS 的 267 KB 空間相對 1.23 MB 很小，但絕對值很大（功能級 JS 一次幾 KB）；
CSS 的 41.5 KB 空間相對 78 KB 很大，但絕對值很小。
正確的共同尺是「**還剩幾個月**」，用這把尺兩者其實接近。已寫進註解。

### D3：`@import` —— 主張，不解析（也不忽略）

先自己確認過 PM 的事實：`grep -c '@import' dist/assets/index-C7g6y5J4.css` → **0**。

三個選項裡選了第三個：

1. 忽略 → 就是這一波在修的「靜默少算」，直接否決。
2. 遞迴解析 → 今天是死碼。而且要做對得處理相對路徑、`layer()`、`supports()`、
   媒體條件式 import、以及**磁碟上根本沒有大小的遠端 URL**。做半套會製造一個
   _看起來更有自信_ 的少算，比現在更糟。
3. **偵測到就丟例外** → 採用。假設被寫成斷言，會失效的那天它自己會喊。

那個假設要壞掉需要：build 不再 inline import（Vite／lightningcss 設定改變），
或出現無法 inline 的遠端 `@import`。屆時由人決定要 inline 還是教這個函式走 import graph，
唯一不會發生的是「安靜地量錯」。

掃描是對 minified CSS 做**純子字串比對**，所以 `content: "@import"` 這種也會誤報。
這個取捨是刻意的：**誤報是五分鐘的對話，漏報是這整個檔案存在的理由。**

### D4：字型檔排除 —— 維持 R4 原則，而且不排除會錯一個數量級

entry CSS 裡有 **94 個 woff2 url() 引用**，對應 `dist/assets/` 裡 **43 個檔、共 576 KB**。
不跟 `url()`：瀏覽器對字型有自己的策略，`unicode-range` 分片意味著它只抓
實際用到的一兩片，而且**沒有字型文字照樣會 render**。
把 576 KB 全算成啟動成本會錯一個數量級，也會跟 R4「不內嵌 CJK 字型」的既定原則打架。
維持排除，沒有理由推翻。

### D5：把 inline `<style>` 也算進去（超出原始要求的範圍，但同一個病）

`index.html` 本身有一段 209 B 的 reset `<style>`，那也是 render-blocking。
如果不算，**最省事的過關方式就是把規則貼進 document** ——
而那對使用者嚴格更糟（不可快取、每次載入都重傳）。
這一波的主題就是「關掉指標與目的之間的縫」，留著這條縫等於下一波再寫一次同樣的字。
所以算進去，breakdown 分行顯示。量到的數字因此是 78,304 + 209 = **78,513 B**。

### D6：重用解析器的作法，以及它對 JS 量法的影響

照 B2 的指示沒有寫第二個 regex。抽出 `attribute(tag, name)` 與
`linkedHrefs(html, rel)`，`preloadedChunkPaths()` 變成 `linkedHrefs(html, 'modulepreload')`，
`stylesheetPaths()` 是 `linkedHrefs(html, 'stylesheet')`。

順手修掉舊解析的兩個窄處，兩個都是**只會變得更不容易少算**的方向：

- `rel` 是空白分隔的 token list，舊的前綴比對會漏掉 `rel="preload modulepreload"`。
- `href` 舊的只吃有引號的值。

**量到的 JS 數字沒有變**：1,237,942 B / 82.5%，與 baseline 逐位元組相同；
`startupChunks` / `entryChunkSize` / `formatStartupBreakdown` / `dist total` 一行未動。

### D7：反向驗證做了兩個實驗，其中一個的結論跟預期不同

**實驗 B（塞大東西 → 該紅）**：把 `katex/dist/katex.css` 與 `plyr/dist/plyr.css`
（兩個都已在 node_modules，沒有新增依賴）import 進 eager entry。
→ **138,969 B / 115.8%，over by 18,969 B，exit 1**。

這裡有個意外收穫：**同一個 build 的 `dist total` 停在 91.6%，是綠的。**
也就是說原本的 dist total 根本攔不下這件事 —— 這是「CSS 需要獨立預算」最硬的證據，
已經寫進註解與測試。

**實驗 A（純搬移 → 不該被騙）**：把 xterm.css 從 JS import 鏈搬到 `index.html`
的 `<link rel="stylesheet">`。
→ 結果是 **Vite 把它併回同一個 entry stylesheet**：hash 仍是 `C7g6y5J4`、
仍是 78,304 B、裡面仍有 130 條 xterm 規則，量測維持 78,513 B。

原本預期會看到「`index-*.css` 變小、總數不動」。**實際結論不同，如實記錄**：
Vite 會把所有**靜態可達**的 CSS 併成一個 stylesheet，只有 `import()` 的 chunk 才另外出檔。
所以「搬移繞過」在今天的設定下**根本走不到**，JS 那邊被咬的那個縫在 CSS 沒有對應體。
量測仍然是「加總每一個 link」而不是 glob `index-*.css`，並用 fixture 測試釘住 ——
因為「bundler 剛好不這樣做」是這版 Vite 的事實，不是指標的性質。

兩個實驗都已還原，工作樹只剩 `scripts/` 兩個檔與本文件。

## 結束摘要

在 `check:bundle` 加了第三個預算 **`renderer startup CSS` = 120,000 B**，
量的是「document 在首幀前承諾的所有 render-blocking CSS」：
`index.html` link 的每一個 stylesheet，加上 inline `<style>`。目前 **78,513 B / 65.4%**。

- **解析器單一化**：抽出 `attribute()` / `linkedHrefs()`，JS 與 CSS 共用一套容錯
  （屬性順序、引號風格、href 形狀、`rel` token list），照 B2 的指示沒有寫第二個 regex。
- **邊界**：lazy chunk 的 CSS 不算（`ArenaOverlay-*.css` 18,502 B，跟著元件到）；
  `url()` 的字型不跟（43 檔 576 KB）；`@import` 不解析但**偵測到就丟例外**。
- **反向驗證兩個方向都做了**，紅的輸出與「Vite 不允許搬移」的意外結論都留在 D7。
- **JS 量法未受擾動**：1,237,942 B / 82.5%，逐位元組相同。

四道 gate 全綠，測試 **2631 passed / 26 skipped**（baseline 2611 + 20 個新測試）。

**沒做**：CSS 本身的減重、`ArenaOverlay-*.css` 的 lazy CSS 預算、
`@import` 的 import graph 解析、把 `dist total` 或 JS 預算重新校準。

---

## PM 已查證的事實（不用重查，但要自己確認一次）

```
dist/index.html:
  <link rel="stylesheet" crossorigin href="./assets/index-C7g6y5J4.css">   ← 只有這一個

dist/assets/index-C7g6y5J4.css        78,304 B   ← render-blocking
dist/assets/ArenaOverlay-BoZYIJ_Z.css 18,502 B   ← 不在 index.html，隨 lazy 元件載入

index-*.css 裡沒有 @import。
```

**兩個 CSS 檔的存在本身就是答案的一部分**：B1 那一波把 Arena 拆成 lazy chunk 時，
Vite 也把它的 CSS 拆了出去。所以 CSS 的「啟動成本」與「總量」本來就已經分離 ——
**你的預算應該只管 `index.html` 真的 link 的那些**，跟 JS 那邊
「entry + 所有 modulepreload」的原則一致，而不是把 `dist/assets/*.css` 全部加總。

`@import` 目前不存在，但**規則要能處理它出現的情況**（或明確說明為什麼不處理、
以及那個假設哪天會失效）。
