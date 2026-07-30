# R4：終端中文字體選擇（5 種，含偵測與下載）

**建立時間：** 2026-07-31 02:45
**狀態：** 進行中
**分支：** `feat/cjk-font`（從 `main @ 649d609` 分出）

## 目標

Settings 可選終端中文字體，只提供 5 個選項。選到未安裝的字體時，
先偵測系統有沒有，沒有就**詢問使用者要不要下載**，同意才下載安裝。

`terminalFont?: string` 設定**已經存在**（`src/store/types.ts:272`、`core.ts:42` 的
`DEFAULT_TERMINAL_FONT`）。這是擴充，不是新建。

## 五個候選（全部繁中 TC 變體，中英寬度 2:1）

| 字體                                    | 特色                           | 來源                      |
| --------------------------------------- | ------------------------------ | ------------------------- |
| **Sarasa Term TC**（更紗黑體 等距）     | 專為終端設計，**Scott 已安裝** | `be5invis/Sarasa-Gothic`  |
| **Sarasa Mono TC**（更紗黑體 等寬）     | 更嚴格等寬，**Scott 已安裝**   | 同上                      |
| **Maple Mono NF CJK**                   | 圓角、連字、Nerd 圖示          | `subframe7536/maple-font` |
| **Noto Sans Mono CJK TC**               | 保守通用                       | Google Noto               |
| **LXGW WenKai Mono TC**（霞鶩文楷等寬） | 楷體風格，長時間閱讀舒適       | `lxgw/LxgwWenKai`         |

預設為 **Sarasa Term TC**。

### ⚠️ 授權必須逐一查證，不得沿用本文件的說法

Scott 要求「免費授權且開放下載」。已知 **LXGW WenKai 是 SIL OFL 1.1**（已查證）；
其餘四個據稱為開源但**我沒有逐一確認**。

**開工第一步：到每個 repo 讀 `LICENSE`（或 `OFL.txt`）確認實際授權條款，
並把確認結果寫進決策紀錄。任何一個確認不了免費商用授權的，就從清單移除並補位。**
不要把「大家都說它開源」當成授權證據。

## 🔴 這個功能會新增第 10 個對外連線點

R2（已合併於 `649d609`）把離線模式做成 `OUTBOUND_SURFACES` 單一真相來源，
且有測試**讀 `PRIVACY.md` 與 `docs/PRD.md` 的檔案內容**比對數量。

**字體下載是一次 HTTPS 請求，必須：**

1. 註冊進 `OUTBOUND_SURFACES`
2. 同步更新 `PRIVACY.md` 與 PRD §7.1（9 → 10）
3. **遵守離線開關** —— 離線模式開啟時不得下載，並顯示明確原因

漏做任何一項，R2 的機器檢查會讓 CI 紅。這是刻意的守衛，不要繞過它。

## 範圍

做：

- 5 個選項的下拉選單（擴充既有 `terminalFont`）
- 安裝偵測
- 未安裝時詢問；**同意後**才下載並安裝到使用者字體目錄
  （macOS `~/Library/Fonts`、Linux `~/.local/share/fonts`，都不需要管理員權限）
- 下載前顯示**授權、來源網址、檔案大小**

不做：

- **絕不內嵌字體。** CJK 字體單個 5–30 MB，dist 預算已在 85.1%
- **絕不自動下載。** 一定要使用者明確同意 —— 這是 Q3 離線承諾的一部分
- 不做字體預覽渲染（先確認整條路徑會動）
- 不碰 `src/App.tsx` 開頭的 CSS import 區塊（cascade 順序敏感）

## 設計要求

- 下載失敗要有可讀訊息與重試，不可靜默失敗或無限轉圈
- 判斷邏輯（「這個字體裝了沒」「該不該問使用者」）放 `src/lib` 當純函式 ——
  vitest 是 node 環境，component 層測不到
- 選了未安裝的字體而使用者拒絕下載時，行為要明確定義並測試
- 下載網址用 HTTPS 且指向該專案的正式 release，不要指向第三方鏡像

## Plan Steps

- [x] Step 1 — 逐一查證 5 個字體的授權，寫進決策紀錄
- [x] Step 2 — 安裝偵測（純函式 + 平台查詢）
- [x] Step 3 — Settings 下拉選單
- [x] Step 4 — 下載＋安裝流程與使用者同意
- [x] Step 5 — 註冊第 10 個連線點 + 文件同步 + 遵守離線開關
- [x] Step 6 — 四道 gate

## 驗收條件（PM 側）

1. 四道 gate 全綠，測試數 ≥ 1888，entry bundle 不得超過 90%
2. 五個字體的授權各有查證結果與出處
3. 有測試斷言「離線模式開啟時不會發出字體下載請求」
4. `PRIVACY.md` 與 PRD §7.1 都是 10，且 R2 的機器檢查通過
5. commit 列明確路徑，不得出現 `.agent/`、`.codex/`、`openspec/`

## 決策紀錄

### D1 — 五個字體的授權查證結果（Step 1）

查證方式：直接讀該專案 repo 內的 `LICENSE` / `OFL.txt` 原始檔，或 GitHub
`/repos/{owner}/{repo}/license` API（該 API 回傳的是它實際讀到的授權檔內容與 SPDX 判定，
不是 README 的自我宣稱）。查證日期 2026-07-31。

| #   | 字體家族名              | 授權        | 查證出處（實際讀到的檔案）                                                                                                                                                     |
| --- | ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `Sarasa Term TC`        | SIL OFL 1.1 | `https://raw.githubusercontent.com/be5invis/Sarasa-Gothic/main/LICENSE` —— 全文讀畢，首行為 `Copyright (c) 2015-2025, Renzhi Li ...`，內含 OFL 1.1 全文                        |
| 2   | `Sarasa Mono TC`        | SIL OFL 1.1 | 同上（Sarasa-Gothic 單一 repo 單一授權檔，涵蓋 Term/Mono/Fixed/Gothic/UI 全系列）                                                                                              |
| 3   | `Maple Mono NF CN`      | SIL OFL 1.1 | `GET /repos/subframe7536/maple-font/license` → `OFL.txt` @ `variable` 分支，SPDX `OFL-1.1`，內文 `Copyright 2022 The Maple Mono Project Authors`                               |
| 4   | `Noto Sans Mono CJK TC` | SIL OFL 1.1 | `https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE` —— **注意 repo 根目錄沒有 LICENSE，`/license` API 回 404**；授權檔在 `Sans/` 與 `Serif/` 子目錄各一份 |
| 5   | `LXGW WenKai Mono TC`   | SIL OFL 1.1 | `GET /repos/lxgw/LxgwWenkaiTC/license` → `OFL.txt`，SPDX `OFL-1.1`                                                                                                             |

**結論：五個全部確認為 SIL OFL 1.1，允許免費商用、允許重新散布。沒有任何一個因授權問題被替換。**

三個查證過程中修正的事實：

1. **LXGW WenKai Mono TC 不在 `lxgw/LxgwWenKai`。** 追蹤文件寫的來源 repo 是
   `lxgw/LxgwWenKai`，但該 repo 的 release 只有 SC 版（`LXGWWenKaiMono-Regular.ttf`），
   沒有 TC。TC 版在另一個 repo `lxgw/LxgwWenkaiTC`（注意是小寫 k 的 `Wenkai`）。
   我先試了 `lxgw/LxgwWenKai-TC`，404；用 `search/repositories?q=user:lxgw` 才找到正確名稱。
2. **`Maple Mono NF CJK` 不是真正的家族名。** 該專案的 CJK 版本叫 `CN`
   （release asset 為 `MapleMono-NF-CN.zip`），字體家族名是 `Maple Mono NF CN`。
   偵測要靠字體家族名字串比對，名字寫錯偵測就永遠失敗，所以改用實際家族名。
   附帶風險註記：Maple 的 CJK 字形來自 Resource Han Rounded，偏簡體取向，
   放在「繁中字體清單」裡是五個裡面最勉強的一個 —— 但授權沒問題，且是 Scott 指定的清單，故保留。
3. **LXGW 的 OFL 有一段 ADDITIONAL PERMISSION**，放寬（不是限縮）保留字型名稱
   `霞鶩` / `LXGW` 在未修改重編譯版本上的使用。我們只是原封不動下載安裝，不受影響。

### D2 — 五個裡面只有兩個能真的自動下載安裝，因為上游只發布壓縮檔

這是查證授權時一併發現、而且會決定整個功能形狀的事實。我用 GitHub releases API
逐一列出每個專案最新 release 的 asset 清單：

| 字體                  | 最新 release | 最小可用 asset                                        | 形式          |
| --------------------- | ------------ | ----------------------------------------------------- | ------------- |
| Sarasa Term TC        | `v1.0.40`    | `SarasaTermTC-TTF-Unhinted-1.0.40.7z`（50,676,743 B） | **7z**        |
| Sarasa Mono TC        | `v1.0.40`    | `SarasaMonoTC-TTF-Unhinted-1.0.40.7z`（50,673,819 B） | **7z**        |
| Maple Mono NF CN      | `v7.9`       | `MapleMono-NF-CN.zip`（159,498,447 B）                | **zip**       |
| Noto Sans Mono CJK TC | `Sans2.004`  | `14_NotoSansMonoCJKtc.zip`（27,797,087 B）            | **zip**       |
| LXGW WenKai Mono TC   | `v1.522`     | `LXGWWenKaiMonoTC-Regular.ttf`（15,277,228 B）        | **裸 ttf** ✅ |

Sarasa-Gothic 的 139 個 asset 統計是 `{'7z': 118, 'zip': 20, 'txt': 1}` —— 一個裸字體檔都沒有。

限制條件「不得新增 npm 依賴」直接排除 `yauzl` / `7zip-bin`。Node 內建只有 `zlib`，
手刻 ZIP central directory parser 勉強可行，但 **7z 用 LZMA，內建模組完全做不到**。

於是我做了取捨評估：就算手刻一個 ZIP 解壓器（約 120 行放進 main process），
能解鎖的是 Noto（27.8 MB）與 Maple（159 MB），**解不開的正好是預設字體 Sarasa Term TC
和 Sarasa Mono TC**。也就是說付出手刻壓縮格式解析器的代價，換到的是 3/5 而不是 5/5，
而且最重要的那個還是不會動。**投入產出不成立，不做。**

改用的方案：把「上游用什麼形式發布」變成字體描述子的一個明確欄位，分成兩種：

- `direct` —— 上游發布單一可直接安裝的字體檔。同意後 app 直接下載安裝。
- `archive` —— 上游只發布壓縮檔。app **明確告訴使用者原因**，並提供 release 頁面讓他自己裝。

這是「明確定義的行為」，不是靜默失敗，可以用純函式測。而且是加法式可逆的：
哪天願意加解壓縮能力，只要把表格裡那幾列從 `archive` 改成 `direct` 就好。

### D3 — Noto 改用 release tag 上的 raw 檔，讓能自動安裝的從 1/5 變 2/5

限制條件寫「下載網址要指向該專案的正式 release，不要指向第三方鏡像」。

Noto 的 release asset 是 zip（見 D2），照 D2 的規則會被判成 `archive`，
結果五個裡面只剩 LXGW 一個能自動安裝。但 `notofonts/noto-cjk` 這個 repo **本身就把
建好的字體檔 commit 進 repo**：

    https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Mono/NotoSansMonoCJKtc-Regular.otf

已用 `curl -I` 確認 HTTP 200，實測大小 16,392,304 B。

我判定這條網址**符合**該限制條件：它是 Noto 專案自己的 repo、釘在專案自己的
release tag `Sans2.004` 上、HTTPS。條件的對照組是「第三方鏡像」，而
`raw.githubusercontent.com/notofonts/...` 在任何解讀下都不是鏡像 —— 它跟
`github.com/notofonts/.../releases/download/...` 是同一個信任來源。條件那句話管的是
**產物出處（whose）**，不是 GitHub 的哪個 hostname。

我承認這是把「release」讀成「release tag」而非「release asset」。
所以刻意把它做成表格裡單獨一列、單行可逆：如果 reviewer 採嚴格讀法，
把 Noto 那列從 `direct` 改成 `archive`（asset 用 `14_NotoSansMonoCJKtc.zip`，27,797,087 B）
即可，其餘程式碼一行都不用動。

Sarasa 與 Maple 沒有這條路可走 —— 那兩個都是純建置 repo，沒有 commit 建好的字體檔。

### D4 — 主行程不接受 renderer 傳來的網址，只接受字體家族名

Renderer 傳 URL 給主行程去 fetch，等於把任意對外請求的能力交給 renderer，
是這個功能最明顯的一條攻擊路徑。所以 IPC 只傳字體家族名，主行程從**自己那份表**
查出網址。renderer 傳一個不在表裡的名字就直接拒絕。

代價是字體表要在兩邊各存一份（`src/lib/cjk-fonts.ts` 給 renderer、
`electron/ipc/font-install.ts` 給主行程）。這不是偷懶，是被建置設定逼出來的：
`electron/tsconfig.json` 的 `rootDir` 是 `.`，electron 這個 TS 專案**根本編不到 `src/`**；
反向 `src/` → `electron/` 又被 dependency-cruiser 的 `no-renderer-importing-main` 擋住
（只開放 `channels.ts` 與 `prompt-detect.ts` 兩個例外）。

處理方式沿用這個 repo 已經在用的模式 —— `preload.cjs` 的字面清單、
`channel-manifest.json`、`channels.ts` 三份也是各存一份，靠
`preload-allowlist.test.ts` 斷言三者完全一致。字體表照做：寫一個測試斷言兩份表
的家族名、網址、大小、授權完全相同。有守衛的重複，不是無守衛的重複。

### D5 — 使用者拒絕下載時，不套用該字體

「選了未安裝的字體而使用者拒絕下載時」的行為定為：**維持原本的字體，不套用新選擇**。

另一個選項是照樣套用，讓它 fallback 到 `monospace`。不採用的理由：xterm 會安靜地
掉到 fallback 字體，畫面看起來就是「我選了字體但沒生效」，跟壞掉無法區分。
拒絕下載是一個明確的決定，正確的回應是讓設定停在原地並說明，而不是製造一個
看起來像 bug 的狀態。下載失敗（`failed`）同理。

### D6 — 離線模式下，`archive` 字體仍然可以開 release 頁面

離線開關管的是「Parallel Code 自己發起的對外請求」。`archive` 路徑不發任何請求，
只是把 release 頁面交給作業系統的瀏覽器 —— 這跟 PRIVACY.md 已經寫明的
「連結保持原樣，只有使用者點下去才會抓取」是同一條原則。

所以純函式 `planCjkFontSelection` 的判斷順序是：已安裝 → `archive` → 離線 → 詢問下載。
`archive` 排在離線之前是刻意的：在離線模式下對一個本來就不會下載的選項回報
「離線模式擋住了」是假訊息。

### D7 — 偵測不能只靠 `fc-list :spacing=mono`

既有的 `getSystemMonospaceFonts()` 跑的是 `fc-list :spacing=mono family`。兩個問題：
（a）macOS 預設沒有 fontconfig，`fc-list` 不存在，該函式會快取 `[]`；
（b）Sarasa Term 是中英 2:1 的雙寬字體，是否被 fontconfig 判為 mono 並不保證。

所以 CJK 偵測改成三個來源取聯集：不加 spacing 過濾的 `fc-list family`、
**加上直接掃使用者字體目錄的檔名**。後者讓「剛裝完馬上就偵測得到」在沒有
fontconfig 的 macOS 上也成立 —— 檔名→家族名的對照本來就在字體表裡。
檔名比對的部分抽成純函式 `familiesFromFontFiles`，可測。

### D8 — 翻譯 key 的守衛測試（避免測試在常數改動後失去意義）

i18n 的 key 就是英文原文字串本身，所以訊息一改，翻譯就會靜默失效。
`cjk-fonts.test.ts` 裡的翻譯檢查**不重抄字串**，而是呼叫 `planCjkFontSelection`
把五個字體 × 離線開/關的所有訊息跑出來，再去 `catalogueFor('zh-TW')` 查。
另外一條測試比對英文與中文的 `{placeholder}` 集合是否一致 —— 翻譯漏掉一個
placeholder 等於畫面上少一個值。

同理，主行程與 renderer 的字體表一致性測試也是從 `CJK_FONT_DOWNLOADS`
迭代出來去比對 `cjk-fonts.ts` 的原始碼文字，不是寫死一份網址清單。

## 結束摘要

### 做了什麼

Settings 新增「終端中文字體」區塊，提供五個繁中終端字體。選擇時：

- **已安裝** → 直接套用（離線模式下也可以，因為套用不發任何請求）
- **未安裝、上游有單一字體檔** → 跳出確認框，**先顯示授權、來源網址、檔案大小**，
  同意後才下載，安裝到 `~/Library/Fonts`（macOS）或 `~/.local/share/fonts`（Linux）
- **未安裝、上游只發布壓縮檔** → 說明原因並開啟 release 頁面讓使用者自行安裝
- **未安裝、離線模式開啟** → 拒絕下載並說明原因，字體維持原狀

字體下載註冊為第 10 個對外連線點（`font-download`），`PRIVACY.md` 與 PRD §7.1
同步改為十個，R2 的機器檢查通過。

### 檔案

新增：`src/lib/cjk-fonts.ts`（純函式＋字體表）、`src/lib/cjk-fonts.test.ts`、
`src/store/cjkFont.ts`（IPC 編排）、`electron/ipc/font-install.ts`、
`electron/ipc/font-install.test.ts`。

修改：`electron/ipc/offline.ts`（第 10 個 surface）、`channel-manifest.json` 與
`preload.cjs`（兩個新 channel）、`register.ts`（handler）、`SettingsDialog.tsx`（UI）、
`src/lib/i18n.ts`（zh-TW 翻譯）、`PRIVACY.md`、`docs/PRD.md`。

**沒有碰 `src/App.tsx` 的 CSS import 區塊，沒有新增任何 npm 依賴，沒有內嵌任何字體。**

### 四道 gate

| Gate                   | 結果                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run check`        | 通過（compile / typecheck / lint / format:check）                               |
| `npm run check:static` | 通過，`no dependency violations found (436 modules, 1464 dependencies cruised)` |
| `npm test`             | **1955 passed / 24 skipped**（分支基準 1888 / 24，+67）                         |
| `npm run check:bundle` | entry **88.2%**（1,322,926 / 1,500,000 B），dist total 85.1%                    |

兩個新測試檔都另外單獨跑過，也單獨跑過個別 test case（`-t`）確認沒有
mock 實作殘留的問題 —— 用 `vi.stubGlobal` + `vi.unstubAllGlobals()`，
不用 `vi.clearAllMocks()`，因為後者只清呼叫紀錄不清實作。

### 刻意沒做的事

1. **沒有手刻壓縮檔解壓縮。** 理由見 D2：付出代價換到的還是 3/5，
   而且解不開的正好是預設字體。
2. **沒有做字體預覽渲染。** 追蹤文件明確列為不做，先確認整條路徑會動。
3. **`src/store/cjkFont.ts` 沒有單元測試。** 它只是把純函式的決策接到 IPC 上，
   所有判斷邏輯都在 `cjk-fonts.ts` 裡測過了。要測它得先搭 `window.electron` 的假物件，
   換到的覆蓋率是「這幾行有沒有把回傳值接對」，價值不高。
4. **沒有做安裝後自動重繪終端。** 字體裝好後 `setTerminalFont` 會更新 store，
   xterm 讀 `store.terminalFont`；但作業系統的字體快取何時看得到新檔案不由 app 決定，
   極端情況可能要重開 app。這點沒有額外處理，也沒有假裝處理了。
