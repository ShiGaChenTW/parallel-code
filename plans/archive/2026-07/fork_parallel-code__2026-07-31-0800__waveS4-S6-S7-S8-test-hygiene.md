# A：四項測試衛生（S4 / S6 / S7 / S8）

**分支：** `fix/test-hygiene`（從 `main @ d489871` 分出）

四項全部由跨模型稽核找出、已由 PM 對照程式碼確認為真。四個不同檔案，互不碰撞。
共同主題：**測試看起來在驗證，實際上沒有。**

---

## S4 — 離線隱私斷言是順序相依的（兩家獨立指出）

`electron/ipc/ask-code-minimax.test.ts` 的 `offline mode` describe（約 :308）
`beforeEach` 只有 `setOfflineMode(false)`，**少了兄弟區塊都有的 `vi.clearAllMocks()`**
（:65 與 :267 有）。`mockFetch` 是模組層級的（:4），所以 :317 的

```js
expect(mockFetch).not.toHaveBeenCalled();
```

是在對**累積的跨測試呼叫紀錄**斷言。

確定性重現（PM 已實測）：

```
npx vitest run electron/ipc/ask-code-minimax.test.ts --sequence.shuffle --sequence.seed=2
→ FAIL: offline mode > never reaches api.minimax.io, even with a key configured
```

seed 777 / 42 / 999 也會。**這是「證明離線模式擋住網路呼叫」的那條測試** ——
一條隱私斷言只在檔案順序下成立。

---

## S6 — `pty.test.ts:968` 的 mock 從未被消費，且污染後續

`dockerImageExists` 在 `electron/ipc/pty.ts:949-951` **早退**（dockerfile hash 為 null 時），
`execFile` 根本不會被呼叫。所以 `:968` 排的 `mockExecFile.mockImplementationOnce(...)`
**從來沒有被消費**。

`beforeEach` 用 `vi.clearAllMocks()`（:198），它清呼叫紀錄但**不排空 once 佇列**，
於是 `isDockerAvailable` 在 `:1236` / `:1250` 消費到那個陳舊的 implementation。

一個測試兩個錯：**它自己什麼都沒驗**（拿掉 mock 結果一樣），而且**污染後面的**。

確定性重現：

```
npx vitest run electron/ipc/pty.test.ts --sequence.shuffle --sequence.seed=27
→ 2 failed
```

---

## S7 — `preload-allowlist.test.ts` 的三方比對是同義反覆

`electron/ipc/channels.ts:3` 是

```ts
export const IPC = channelManifest;
```

所以 `preload-allowlist.test.ts:28-29` 的

```js
expect(new Set(IPC_CHANNELS)).toEqual(new Set(channels));
expect(IPC_CHANNELS).toHaveLength(channels.length);
```

**是拿同一個物件比自己，永遠不會失敗。** 真正在做事的只有下半段的 `preloadChannels` 比對。

測試名稱是「keeps the manifest, IPC enum, and preload allowlist as an exact set」——
**只有一半屬實**。PM 在十幾份規格裡引用這個守衛時都把涵蓋範圍講大了。

修法要求：**要嘛讓那個比對真的能失敗，要嘛拿掉它並修正測試名稱與註解。**
不要留一個「看起來在驗證三方」的空殼。

---

## S8 — `relay-payload.test.ts:16` 複製常數而非 import

```js
const MAX_PROMPT_BYTES = 64 * 1024; // 測試檔本地字面量
```

production 在 `electron/mcp/coordinator.ts:85` 定義同一個值，並在 `:91` 匯出
衍生的 `MAX_DELIVERED_PROMPT_BYTES` —— **那才是真正在 `:1235-1236` 把關投遞的東西**。

兩個兄弟測試都正確 import（`coordinator-relay.test.ts:23`、
`coordinator-prompt-sanitise.test.ts:18`），只有這個負責該檔核心安全不變量的複製了一份。

驗證方式：把 `coordinator.ts:85` 改成 `32 * 1024`，`relay-payload.test.ts` 仍然綠，
而真實的 relay payload 開始被拒絕。

**稽核者標了一個它無法排除的可能**：`electron/shared/` import `electron/mcp/`
可能被 dependency-cruiser 禁止，那會讓這個複製變成架構問題而非疏忽。
**先查證這件事再決定修法** —— 如果真的被禁，正確的修法是把常數移到 `shared/`，
或在測試裡從編譯輸出讀，而不是硬 import 一個違規的路徑。

---

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2611，啟動 JS 不得超過 90%（目前 82.5%）
2. **S4 與 S6 的具名種子必須在修後全綠**：seed 2、27、42、777、999，逐一回報
3. **S7 修完後，那個比對要嘛能失敗要嘛不存在** —— 附一個「刻意弄壞就會紅」的證明
4. S8 的架構限制先查證再修，並說明結論
5. 每個動到的測試檔**單獨跑與整套跑各一次**
6. commit 列明確路徑

## 不做

- 不改 production 行為（S8 若必須動 `shared/` 的常數位置，那是移動不是改行為）
- 不放寬任何既有斷言
- 不順手重構這四個檔案的其他部分

## 決策紀錄

### D1 — S4：只加 `vi.clearAllMocks()`，不動兄弟區塊

`offline mode` describe 的 `beforeEach` 補上 `vi.clearAllMocks()`，與 :65 / :267 對齊。
沒有順手把三個 `beforeEach` 抽成共用 helper —— 那屬於「順手重構」，明令不做。

加了一段註解說明**為什麼**這行不能拿掉（`mockFetch` 是模組層級、斷言的是累積呼叫紀錄）。
沒有註解的話，下一個人會覺得這行是多餘的樣板而刪掉，缺陷就回來了。

### D2 — S6：兩半分別修，且刻意**不**改全域 `beforeEach`

- **洩漏那半**：直接刪掉 :984 那個永遠不會被消費的 `mockImplementationOnce`。
- **沒驗到那半**：補 `expect(mockExecFile).not.toHaveBeenCalled()`。

第二點才是重點。原斷言 `resolves.toBe(false)` 太弱 —— 把 `pty.ts:949-951` 的早退拿掉，
它**還是綠的**（`mockExecFile` 是裸的 `vi.fn()`，回 undefined，最後也是 false）。
補上「連問都沒問 docker」這個斷言之後，早退被刪掉就會紅。測試名稱也改成
`fails closed on an unreadable custom dockerfile without consulting docker`，把這件事講明。

**評估後否決**：把 :214 的 `vi.clearAllMocks()` 換成 `vi.resetAllMocks()`。
那是這類缺陷的結構解（會排空 once 佇列），但它一次影響全檔 78 條測試，
且會重置 `mockExecFileSync` 的預設實作。明令「不順手重構這四個檔案的其他部分」，
所以採用範圍收斂的修法，並把這個選項寫進「刻意未做」。

### D3 — S7：稽核者的診斷不精確，實測後改用「拆成兩條誠實的測試」

稽核者說 `IPC` 與 manifest 的比對「是拿同一個物件比自己，永遠不會失敗」。
**實測不成立**：`IPC_MANIFEST` 是用 `createRequire` 另外讀一次 JSON，
跟 `channels.ts` 的 `import ... with { type: 'json' }` 是兩個不同物件。
把 `channels.ts` 改成 `{ ...channelManifest, DriftProbe: 'drift_probe' }` 之後那條比對**會紅**（實測）。

所以它不是同義反覆，而是**守備範圍比名稱小很多**：
`channels.ts:3` 是逐字 re-export，manifest 與 IPC enum 之間**不存在**可以漂移的空間，
真正會漂移的只有 `preload.cjs`（sandboxed preload 不能 require JSON，只能手抄）。
測試名稱說「三方」，實際上只有兩個手工維護的來源。

修法：拆成兩條，各自名副其實，並補註解記錄「為什麼今天必綠、什麼改動會讓它紅」。

**順帶補強（非放寬）**：原本只比 `Object.values`。改成比完整的 key→value 映射。
理由：呼叫端寫的是 `IPC.SpawnAgent`，**改 key 名而不動 value** 會讓呼叫端壞掉，
但 value set 完全相同 → 原斷言照樣綠。實測確認：改 key 名時新斷言紅、舊的 value 比對綠。
這證明新斷言嚴格強於舊的。

### D4 — S8：先查證架構限制，結論是「稽核者的假設不成立」，但仍選擇搬常數

**查證方式不是讀設定檔，是真的加一條 import 再跑 gate。**
在 `relay-payload.test.ts` 加 `import { MAX_DELIVERED_PROMPT_BYTES } from '../mcp/coordinator.js'`：

```
npx depcruise --config .dependency-cruiser.cjs src electron
→ ✔ no dependency violations found (465 modules, 1565 dependencies cruised)
```

測試也照跑照過。dependency-cruiser 只禁三件事：
`src/ → electron/`（renderer 進 main）、`electron/mcp/ → src/(components|store|lib)/`、以及循環相依。
**`electron/shared/ → electron/mcp/` 沒有任何規則擋。** 稽核者的假設被推翻。

即使如此仍選擇「把常數搬進 `shared/`」而非直接 import，理由三點：

1. **現況分層是單向的**：`mcp/ → shared/` 有 9 處，`shared/ → mcp/` 掛零。
   直接 import 會是第一個反向邊，而且**沒有任何 gate 會抓到**（規則不禁、
   `no-orphans` 又跳過 test 檔）。等於在無人看守的地方開一個反向依賴的先例。
2. **常數本來就放錯層了**：`prompt-sanitise.ts:55` 寫「Callers size their own limits against
   `MAX_PROMPT_BYTES + this`」，`relay-payload.ts:56` 寫「the `MAX_PROMPT_BYTES` delivery budget」。
   `shared/` 有兩個模組拿自己的預算對著這個常數算，卻**都 import 不到它**，
   只好用散文和測試字面量各抄一份。這才是缺陷的根：定義在上層、約束的是下層。
3. **純測試該保持純**：直接 import 會把整個主行程（electron、node-pty、git、MCP SDK）
   拉進一個純函式單元測試的模組圖。兄弟測試敢這樣做，是因為它們先跑
   `setupCoordinatorHarness()` 裝好 mock 再動態 import；靜態 import 沒有這層保護。

`MAX_DELIVERED_PROMPT_BYTES` 仍然由 `coordinator.ts` 匯出（兩個兄弟測試靠它），只搬 `MAX_PROMPT_BYTES`。

**確認沒有行為變更**：值仍是 `64 * 1024`。編譯後實測
`MAX_PROMPT_BYTES = 65536 | header = 256 | delivered = 65792`，與修改前相同。

## 結束摘要

四項全部修畢，四道 gate 全綠，**2612 passed / 26 skipped**（基線 2611，+1 來自 S7 拆成兩條），
啟動 JS **82.5%**（上限 90%，與基線相同 —— 本次只動測試與一個常數的所在檔案）。

修前確定性重現、修後全綠的種子：`ask-code-minimax` 與 `pty` 各跑 seed 2 / 27 / 42 / 777 / 999，
十次全過。

三個「刻意弄壞就會紅」的證明都做了：
S7 改 `channels.ts` key 名 → 新斷言紅（**舊的 value 比對綠**，證明是補強不是平移）；
S7 從 `preload.cjs` 刪一個 channel → 第二條紅；
S8 把 `MAX_PROMPT_BYTES` 改成 `32 * 1024` → `relay-payload.test.ts` 紅
（正是追蹤文件說「應該紅卻是綠」的那個情境）。

最值得記的一點：稽核者對 S7 與 S8 的**機制判斷都不精確**（S7 不是物件比自己，
S8 的架構限制根本不存在），但兩項**指出的問題都是真的** —— 一個名不副實、一個複製常數。
先實測再決定修法，才沒有照著錯誤的機制描述去改錯地方。

## 刻意未做

- **`pty.test.ts` 全域 `beforeEach` 沒改成 `vi.resetAllMocks()`**（見 D2）。
  這是 once-佇列洩漏這個**類別**的結構解，但影響全檔 78 條測試，超出「不順手重構」的界線。
  目前只堵住這一個實例。建議另開一波單獨評估。
- **沒有加 lint 規則禁止 `electron/shared/ → electron/mcp/`。** D4 查出這個反向依賴
  無人看守，但新增 dependency-cruiser 規則不在本波範圍內。建議另開。
- 四個檔案其他部分一律未動。
