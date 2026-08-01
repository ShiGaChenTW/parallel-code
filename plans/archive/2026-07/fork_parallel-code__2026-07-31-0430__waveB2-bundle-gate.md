# B2：修 bundle gate 的量測盲點

**分支：** `feat/bundle-gate`（從 `main @ 9b17f4e` 分出）

## 問題

B1（`9b17f4e`）證明了現行 gate 可以被規避。

`scripts/check-bundle-size.mjs` 的 `entryChunkSize()` 只量 `dist/assets/index-*.js`。
B1 拆出 lazy chunk 後，rolldown 把共用程式碼抬進 `platform-*.js`（193,157 B），
而 entry 仍然**靜態 import** 它、`index.html` 仍然 `modulepreload` 它。

結果：

```
check:bundle 報告          1,038,196 B = 69.2%
使用者實際付的啟動 JS      1,232,561 B = 82.2%
```

**對 gate 為真，對使用者為假。** 差 194,365 B。

這跟 monaco 那次是同一類問題：指標與它要防的東西之間有縫。
第一波的教訓是「沒有 linter 抓得到 imported but inert」，
這次是「gate 量的檔案不等於使用者付的成本」。

## 要做的

`entryChunkSize()` 改成加總 **entry chunk + `index.html` 裡每一個被 `modulepreload`
的 chunk**，**天花板維持 `1_500_000` 不變**。

這是**收緊**不是放寬：現在能通過的東西，改完之後有些會不通過。
但 `main @ 9b17f4e` 在新算法下是 82.2%，仍然通過 —— 所以這個修正不會擋住剛做完的優化。

實作提示（已實測可行）：

```js
const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const preloaded = [...html.matchAll(/modulepreload[^>]*href="[^"]*\/([^"\/]+)"/g)].map((m) => m[1]);
```

在 `main @ 9b17f4e` 上這會撈到 `preload-helper-*.js`（1,208 B）與 `platform-*.js`（193,157 B）。

## 一定要更新註解

腳本開頭那段註解記錄了 gate 存在的理由與當時的數字。
**改了量測方式就要改註解**，否則下一個人會拿舊數字對照新指標。
把「為什麼從 entry-only 改成 entry+preload」寫進去，連同 B1 量到的 194,365 B 落差。

## 不做

- **不調 `BUDGETS`。** 天花板不變，這是重點
- 不改 dist total 的量法（那個沒有這個盲點）
- 不改 `build.modulePreload`（B1 已評估：`platform-*.js` 是靜態 import 邊不是 preload
  啟發式，關掉只會讓啟動變慢而指標變好看）

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2248
2. `check:bundle` 在 `main @ 9b17f4e` 的內容上回報約 **82.2%**（1,232,561 B）
3. **反向驗證**：造一個「把程式碼搬進被 preload 的 chunk」的情境，
   證明新算法**不會**被它騙過。第三波做 gate 時就是用真的把 monaco 裝回去反向驗證的 ——
   照同一個標準，不要只證明比較運算子能動
4. 腳本註解已更新
5. commit 列明確路徑

## 決策紀錄

- **函式名維持 `entryChunkSize`，沒有改成 `startupJsSize`。**
  一度想改，因為「名字說謊」跟「註解說謊」是同一種病。但 `BUDGETS` 的 key
  `'renderer entry chunk'` 是凍結的（本波明令不動），而那個 key 就是 CI 輸出上的標籤。
  只改函式名會讓同一個概念在腳本裡有兩套詞彙，比一個名字略窄更糟。
  改用另一種方式治「名字說謊」：檔頭註解 + JSDoc 明講它現在含 preload，
  再加下面那條 breakdown 輸出。

- **加了 `formatStartupBreakdown()`，在 gate 行後面列出組成。**
  代價是每次 CI 多幾行輸出，換到兩件事：(a) 有人看到 `1,232,561 B` 卻 grep
  `dist/assets/index-*.js` 得到 `1,038,196 B` 時不會困惑；(b) gate 紅的時候直接看得出
  是**哪個** chunk 長了 —— 反向驗證那次輸出 16 行，一眼看得出 mermaid 的 chunk 全被拉進啟動路徑。
  這不是 `BUDGETS` 的改動，只是輸出。

- **`preloadedChunkPaths()` 比題目給的 regex 寬。**
  題目那版 `href="[^"]*\/([^"\/]+)"` 要求 href 裡有 `/`，而且綁死屬性順序與雙引號。
  在現況的 Vite 輸出上可行，但**漏掉一個 link = 靜默少算**——那正是本波要修的病，
  不該在修它的過程中重造一次。改成先撈 `<link>` tag 再檢查 `rel`，
  單雙引號、屬性順序、`./assets/x.js` / `/assets/x.js` / `x.js` 都吃得下。

- **preload 指到不存在的檔案 → 直接 throw，不 skip。**
  同一條理由：靜默少算是這道 gate 唯一真正的失效模式。寧可紅在「量不到」也不要綠在「量錯」。

- **entry 自己若出現在 preload 清單裡不重複計算。** Vite 目前不會這樣輸出，
  但重複計算會讓數字虛高、逼人去調預算 —— 便宜的保險。

- **只算 `modulepreload`，不算 `import()` 才到得了的 chunk。**
  那些不是啟動成本；把它們算進來等於再做一次 `dist total`，這道 gate 就沒有獨立意義了。

- **反向驗證做了兩個，不是一個。** 只做「把東西搬進 preload chunk」證明了不被騙，
  但沒證明 gate 會紅；只做「塞大東西」證明會紅，但沒證明舊算法會漏。兩個合起來才是完整的命題：
  **舊算法綠、新算法紅，而且使用者真的付了那些 bytes。**

- **沒有動 `BUDGETS`、沒有動 `build.modulePreload`、沒有動 dist total 的量法。** 依題目範圍。

## 反向驗證（真的建了，不是推論）

兩個實驗都是**真的改 source / config 重新 build**，量完後全部還原。
比較用腳本同時跑舊算法（只看 `index-*.js`）與新算法（entry + preload）。

### 實驗一：純搬移 —— 一個 byte 都沒加，舊算法卻回報「省了 57.8%」

用 `advancedChunks` 把已經在啟動路徑上的 `@xterm` + `solid-js` 拉進獨立 chunk。
沒加程式碼、沒刪程式碼，只是換檔案放。

| 算法                  | 基準線      | 搬移後          | 變化                   |
| --------------------- | ----------- | --------------- | ---------------------- |
| 舊（只算 entry）      | 1,038,196 B | **438,280 B**   | **−599,916 B**（假的） |
| 新（entry + preload） | 1,232,561 B | **1,232,012 B** | −549 B（0.04%）        |

舊算法從 69.2% 掉到 29.2%，看起來像一次巨大的優化 —— 使用者實際付的 bytes 一個都沒少。
新算法只動了 549 B（chunk 邊界與 import 語句的差），**沒有被騙過**。

### 實驗二：真的塞東西進 preload chunk —— 舊算法綠、新算法紅

把 `mermaid` 從 entry 靜態 import（`PlanViewerDialog` 仍用 `import()` 拿它）。
一個模組同時被靜態圖與動態圖用到，rolldown 只能把它切成 entry 靜態 import 的共用 chunk ——
`index.html` 於是 preload 它。這就是 `platform-*.js` 的機制本身。

```
OLD gate (entry only)          1,120,767 B   74.7%  PASS   ← 舊 gate 放行
NEW gate (entry + preloads)    1,809,933 B  120.7%  FAIL   ← 新 gate 擋下
hidden from OLD gate             689,166 B
```

`node scripts/check-bundle-size.mjs` 實際 `EXIT=1`，並印出 `over by 309,933 B`，
breakdown 逐行列出 mermaid 的 16 個 chunk 全部落在啟動路徑上。

**689,166 B 的新啟動成本，舊 gate 完全看不到，新 gate 擋下。**
天花板全程維持 `1_500_000`，兩個實驗都沒有為了造出失敗而調低預算。

## 驗收結果

| 項目            | 結果                                                  |
| --------------- | ----------------------------------------------------- |
| `npm run check` | 綠（compile / typecheck / lint / format:check）       |
| `check:static`  | 綠（typecheck / lint / knip / depcruise 455 modules） |
| `npm test`      | **2264 passed / 24 skipped**（基準 2248 → +16）       |
| `check:bundle`  | 綠，**1,232,561 B / 82.2%**                           |

```
ok    renderer entry chunk: 1,232,561 B / 1,500,000 B budget — 82.2% used
ok    dist total: 15,342,902 B / 18,000,000 B budget — 85.2% used
note  "renderer entry chunk" = entry + every chunk index.html modulepreloads:
note    assets/index-BJDxOh9R.js  1,038,196 B  (entry)
note    assets/preload-helper-kNaey6uv.js  1,208 B  (modulepreload)
note    assets/platform-B5eFPIUU.js  193,157 B  (modulepreload)
```

## 結束摘要

**做了什麼**：把 `entryChunkSize()` 從「量 `index-*.js`」改成「量 entry + `index.html` 每一個
`modulepreload` 的 chunk」，天花板 `1_500_000` 一個字都沒動。同一棵樹的回報從 69.2% 變成 82.2% ——
數字變大不是退步，是本來就該是這個數字。加 16 個測試（總計 24），其中一個直接用 B1 的真實數字
（1,038,196 / 193,157 / 1,208）斷言「搬移不會讓量測值下降」。檔頭註解改寫，寫明為什麼從
entry-only 變成 entry+preload，含 194,365 B 的落差。

**未做什麼**（刻意）：

- 沒動 `BUDGETS`。天花板不動是本波的全部意義；改了就等於把「收緊」偷偷變成「放寬」。
- 沒動 `build.modulePreload`。關掉只會拿掉 `<link>` 提示、留著 import 邊 —— 啟動更慢、數字更好看，
  正好是本波在修的反面。
- 沒改 dist total 的量法（它沒有這個盲點）。
- 沒改函式名。理由見決策紀錄第一條。
- 沒去追 `src/store/tasks.test.ts` 那個 unhandled timer error。**已確認是既存的**：
  stash 掉本波改動後單跑該檔仍有 6 個 errors，與本波無關，不在範圍內。

**後續建議**：

1. 這道 gate 現在量的是「啟動 JS」，但名字（`renderer entry chunk`）還停在舊語彙。
   下次有正當理由碰 `BUDGETS` 時，順手把 key 改成 `renderer startup JS`，
   讓標籤與量測終於對上。現在不做是因為改 key 就是改 `BUDGETS`。
2. 目前 82.2%，headroom 約 267 KB。B1 之後看起來很寬鬆的餘裕其實只有這麼多 ——
   下一個「順手加個 npm 套件」的 PR 就可能吃掉一半。真要留空間就得再減，不是調高天花板。
3. **下一波：CSS 在啟動路徑上，但沒有任何預算守它。**（本波量到的、最值得接手的東西）

   **實測，不是推測。** 在乾淨的 `main @ 9b17f4e` build 上：

   ```
   $ grep -o '<link[^>]*stylesheet[^>]*>' dist/index.html
   <link rel="stylesheet" crossorigin href="./assets/index-C7g6y5J4.css">

   $ ls -l dist/assets/index-C7g6y5J4.css   →  78,304 B
   ```

   **機制**：`index.html` 裡的 `<link rel="stylesheet">` 是**同步阻擋渲染**的。
   瀏覽器在第一幀之前一定要抓完、parse 完這 78,304 B。以「使用者付出的啟動成本」而言，
   它跟 `platform-*.js` 的 193,157 B 是同一個等級的東西，只是換一層皮 ——
   一個走 `modulepreload`，一個走 `stylesheet`，兩個都在第一幀之前付清。

   **為什麼現在的預算抓不到它**：

   | 預算項                 | 有沒有蓋到 CSS | 為什麼沒用                                                              |
   | ---------------------- | -------------- | ----------------------------------------------------------------------- |
   | `renderer entry chunk` | ❌ 沒有        | 本波把它擴成 entry + `modulepreload`，**`stylesheet` 不在其中**         |
   | `dist total`           | ⚠️ 名義上有    | 天花板 18,000,000 B，CSS 佔 0.43%。CSS 翻三倍（+156 KB）它動 1 個百分點 |

   也就是說：**CSS 可以無限成長到把啟動變慢，而四道 gate 全綠。**
   這正是本波修掉的那條縫，只是移到隔壁一層。

   **建議做法**（給接手的人，不必重新發現）：
   - 沿用本波已經寫好的 `preloadedChunkPaths()` 的解析法 —— 撈 `<link>` tag 再看 `rel`，
     只要把 `modulepreload` 換成 `stylesheet`，剩下的 normalise / 檔案不存在就 throw
     全部可以直接重用，不要另外寫一套 regex。
   - 新增獨立預算項而不是併進 `renderer entry chunk`：CSS 與 JS 的成本曲線不同
     （parse 便宜、但阻擋渲染），混在一起會讓兩邊都失去診斷力。
   - 天花板抓法照第三波的慣例：以當下實測 78,304 B 為基準，留約 18% headroom，
     並且**反向驗證** —— 真的塞一包大 CSS 進去，確認 gate 會紅。不要只驗證比較運算子。
   - 順便確認 `@fontsource/*`（四套字型）有多少落在啟動路徑上；那是同一個問題的鄰居。
