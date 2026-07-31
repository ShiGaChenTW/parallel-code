# D：`tasks.test.ts` 的 timer 洩漏（S3）

**分支：** `fix/store-timer-leak`（從 main 分出）

## 問題

F1（`80e1401`）修好 coordinator 那邊的 timer 洩漏時，順帶查了這一個並**更正了先前兩波的結論**。

B2 與 R3b 各自獨立確認過「`src/store/tasks.test.ts` 有 6 個 unhandled timer error，
是既存的、**不會讓套件失敗**」。F1 發現**那句話只在機器閒置時成立**：

```
run 3: exit=1, 0 failed tests
run 4: exit=1, 0 failed tests
```

負載高時那個 stray timer 會在 worker teardown 期間觸發，產生
`EnvironmentTeardownError: Closing rpc while "onUnhandledError" was pending`，
錯誤數從 6 變 10，**`npm test` 退出非零但沒有任何失敗的測試**。

**這是最難查的一種 CI 紅**：看不到哪個測試壞了，只看到 exit 1，而且間歇出現。
它會很快教出「重跑就好」的習慣，而那個習慣會蓋掉真的回歸 ——
這批所有守衛的價值，都建立在「gate 紅了就是真的有問題」這個前提上。

## F1 已追出的根因

`removeTaskFromStore`（`src/store/tasks.ts:654`）發射一個 fire-and-forget 的
`setTimeout(…, REMOVE_ANIMATION_MS)`。store helper 先重設了狀態，
所以回呼裡的 `delete s.taskGitStatus[taskId]` 打在 `undefined` 上。

**跟 coordinator 那個不同的地方**：coordinator 的洩漏是**未釋放的實例**，
它們的 timer map 從 harness 搆得到，所以 F1 用 Proxy construct trap 就解決了。
這一個是**模組層級的單例**，handle 封在 closure 裡，**從外面搆不到**。

F1 因此判斷它不是小幅延伸而是獨立波次，並列出兩條路：

1. 從 production 匯出一個測試專用的 reset
2. 把那個 85 個測試的檔案改成 fake timers

## 🔴 第 1 條路要先論證，不能直接做

這個 repo **有過先例被自己否決**：第四波（`plans/…wave4-startup-timing.md`）
刪掉了自己剛寫的 `resetStartupMarks`，理由是

> knip 抓到它是 unused export —— 我加它當「測試接縫」但沒有任何測試用它。
> 這正是前三波一路在刪的那種投機程式碼，不能自己犯。

**如果你選第 1 條路，要先回答：為什麼這次不一樣？**
可接受的理由例如「有測試真的會用它、且沒有其他方式搆得到」。
不可接受的理由是「這樣比較方便」。

同時注意 `knip` 在 `check:static` 裡跑 —— 一個沒被用到的 export 會讓 gate 紅。

## 要達成什麼

**`npm test` 不會在沒有失敗測試的情況下退出非零。**

驗證方式必須反映它是負載相關的：F1 是在 load average 216–220 時重現的，
閒置時跑不出來。**單次綠不算數。**

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2611
2. **連續 6 次全套跑，回報每一次的退出碼與失敗測試數**（不只是 pass/fail）
3. 那 6 個（或 10 個）unhandled error 降到 0，並說明是消失了還是被正確處理了
4. 若走第 1 條路，決策紀錄要回答「為什麼這次不是投機程式碼」
5. 動到的測試檔單獨跑與整套跑各一次
6. commit 列明確路徑

## 不做

- 不改 `REMOVE_ANIMATION_MS` 的值或動畫行為
- 不順手重構 `tasks.ts` 的其他部分
- 不用 retry、不加 sleep、不放寬斷言

## 決策紀錄

### 決策 1：走第 2 條路（fake timers），第 1 條路（匯出 reset）不需要

**選擇：** 只改 `src/store/tasks.test.ts`，`src/store/tasks.ts` 一行都沒動。

第 1 條路之所以「不需要」而不是「比較不方便」，關鍵在於重新界定問題。
F1 把它描述成「handle 封在 closure 裡，從外面搆不到」——這句話是對的，
但它問的是「怎麼把 handle 拿出來」。真正該問的是
**「這個 timer 為什麼要進到真實的 event loop？」**

`vi.useFakeTimers()` 讓那個 handle **根本不需要被搆到**：
timer 從一開始就沒有進入真實 event loop，`vi.useRealTimers()` 會把還沒跑的
fake timer 直接丟掉。所以這不是「另一種搆到 handle 的方法」，而是
**讓洩漏在結構上不可能發生** —— 比 reset 更強的保證。
reset 是「事後清掉逃出去的東西」，fake timer 是「一開始就沒逃出去」。

這也正面回答了第四波 `resetStartupMarks` 的先例：那次的問題是
「加了 export 但沒有測試用它」。這次連 export 都不必加，
所以那個爭論根本不會發生，`knip` 也沒有東西可抓（gate 已驗證全綠）。

**副作用是好的**：原本這 8 個移除點**完全沒有驗證 phase-2 刪除**——
測試只斷言到 `closingStatus === 'removing'` 就停了。改用 fake timer 之後
可以在測試內把刪除跑完並斷言，覆蓋率是**增加**的，不是放寬。

### 決策 2：`vi.runOnlyPendingTimers()`，不複製 `REMOVE_ANIMATION_MS`

用 `vi.advanceTimersByTime(REMOVE_ANIMATION_MS)` 需要在測試檔複製一份 300 的常數，
或從 production 匯出它——後者又踩回「為了測試而加 export」的老問題。
`runOnlyPendingTimers()` 不需要知道延遲是多少，語意也更準確：
「把目前掛著的 timer 跑掉」。它也不會執行那些 timer 再排出來的 timer，
所以不會有無限迴圈風險。

### 決策 3：補上 mock store 的 `taskGitStatus`，這不是放寬斷言

真正丟出 `TypeError` 的是 `delete s.taskGitStatus[taskId]`（`tasks.ts:112`），
而 `s.taskGitStatus` 是 `undefined`。**這在 production 不會發生**：
`AppStore.taskGitStatus` 在 `types.ts:375` 有型別、在 `core.ts:23` 初始化成 `{}`。
是**測試替身少了一個真實 store 一定有的欄位**。

補上它是「讓 mock 符合真實形狀」，不是「讓斷言變鬆」。
為了避免它變成沒人用的死鷹架，第一個 closeTask 測試會塞一筆
`mockTaskGitStatus['task-1']` 並斷言刪除後它消失——這個欄位是被真的用到的。

### 決策 4：反轉——不是只修觸發失敗的那一個點，而是掃過整個類別

第一次 RED 只證明了「有測試會炸」。但如果只修跑出來的那幾個，
剩下的移除點還是會留下真 timer。所以做了兩層掃描：

1. **測試面**：`tasks.test.ts` 裡所有 `closeTask` / `mergeTask` 呼叫共 9 處
   （8 處真的會走到 `removeTaskFromStore`，1 處 `cleanup:false` 被 guard 擋掉），
   全部落在三個已裝 fake timer 的 describe 內。
2. **production 面**：`tasks.ts` 的 4 個 timer 點全部檢查過——
   `167` 與 `785` 是被 `await` 包住的（不會逃逸）、
   `1660` 存進 `activityReleaseTimers` map 而且會被 clear，
   **只有 `654` 是沒有追蹤的 fire-and-forget**，也就是本波的目標。
   同時確認 `projects.test.ts` 是 mock 掉 `closeTask` 的，不受影響。

### 決策 5：反轉——單跑測試檔重現不出來，機制判斷錯了

一開始假設「負載讓 closeTask 之後的測試變慢，timer 就在同一個檔案內炸掉」，
於是加 16 個 CPU burner 單跑 `tasks.test.ts` ——**跑 3 次都是 exit 0、0 錯誤**。

假設是錯的。真正的機制是：**worker fork 會被下一個測試檔重用**。
單跑時檔案結束＝行程結束，timer 還沒到 300ms 就跟著行程一起消失；
跑整套時 fork 被留給下一個檔案，行程還活著，timer 才有地方炸。
（vitest 也明說了：`This error originated in "src/store/tasks.test.ts"`
「It doesn't mean the error was thrown inside the file itself」。）

改成**整套 + 負載**後第一次就重現，見下方證據。這也解釋了為什麼
B2 和 R3b 會誤判成「既存但無害」——閒置機器上它確實不會出現。

### 決策 6：環境問題，不是程式問題（差點誤報 gate 紅）

`npm run check` 第一次跑出 14 個 typecheck 錯誤（`mermaid`/`shiki` 找不到型別、
`replaceAll`/`at`/`Object.hasOwn` 說要 ES2021/ES2022）。
把改動 stash 掉之後**在乾淨的 baseline 上錯誤一模一樣**，所以不是本波造成的。

根因是這個 sandbox 的 `node_modules` 裝壞了：`.bin/` 整個不存在
（所以 `npm test` 一開始是 `vitest: command not found`），
而且 `shiki`/`mermaid` 的 `.d.ts` 檔案沒被裝進來。
那些 `.d.ts` 裡的 `/// <reference lib="es2022" />` 正是 `replaceAll`/`at`/`hasOwn`
的來源，檔案不見了，lib 就跟著不見——14 個錯誤其實是**同一個根因**。

`npm ci` 照 lockfile 重裝之後四道 gate 全綠。
**沒有為了讓 gate 變綠而改任何 tsconfig 或程式碼。**

## 結束摘要

### 做了什麼

只動一個檔案：`src/store/tasks.test.ts`。

- 三個會觸發 `removeTaskFromStore` 的 describe 裝上 `vi.useFakeTimers()` /
  `vi.useRealTimers()`，讓延遲刪除的 timer 留在排它的那個測試裡。
- 新增 `flushTaskRemoval()` helper（`vi.runOnlyPendingTimers()`），
  在 9 個移除點把 phase-2 刪除跑完並斷言結果。
- mock store 補上 `taskGitStatus`，對齊真實的 `AppStore`。
- 移除 `delete mockTasks['task-a']; // removeTaskFromStore's deferred deletion`
  這個手動模擬——現在是真的跑那個刪除。

`src/store/tasks.ts` **未修改**。沒有新增 export、沒有新增 npm 依賴。

### 證據

**修復前（deterministic，兩種）**

1. 裝上 fake timer 但還沒補 `taskGitStatus` 時單跑：**8 個測試穩定失敗**，
   全部指向 `TypeError: Cannot convert undefined or null to object`
   at `removeTaskDraftEntries src/store/tasks.ts:112:26`。
2. 整套 + 12 個 CPU burner，在 baseline（改動 stash 掉）上重現完整症狀：
   `exit=1 failed=0 passed=2635 unhandled=7`，
   stack 是 `Timeout._onTimeout src/store/tasks.ts:656:5` → `listOnTimeout`，
   確認就是那個 stray 真 timer。

**修復後**

| 條件                                             | 結果                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| 整套 + 相同 12 burner ×3（load 182 / 292 / 283） | 全部 exit=0、0 failed、0 unhandled、0 teardown               |
| 連續 6 次整套（load 45–55）                      | 全部 exit=0、0 failed、2635 passed / 26 skipped、0 unhandled |
| `tasks.test.ts` 單跑                             | 85 passed                                                    |

負載 292 比 F1 當初重現的 216–220 還高，仍然全綠。

**四道 gate**（`npm ci` 修好環境後）

- `npm run check` — compile / typecheck / lint / format 全過
- `npm run check:static` — typecheck / lint / **knip** / depcruise 全過，
  `no dependency violations found (465 modules, 1564 dependencies cruised)`
- `npm test` — 2635 passed | 26 skipped，exit 0
- `npm run check:bundle` — 82.5% / 65.4% / 85.3%，三個預算**一個都沒動**

### 那 6 個 unhandled error 怎麼了

**消失了，不是被吞掉。** 它們原本是「production 程式碼真的丟出 TypeError，
只是沒有人接」。現在那個 callback 在排它的測試裡同步跑完、
跑在一個形狀正確的 store 上，所以**沒有 exception 產生**——
不是產生了然後被 catch 起來。

順帶說明數字：實際的移除點是 8 個，之前只觀察到 6 個錯誤，
是因為最後排的 2 個 timer 還沒到 300ms 行程就結束了，被靜靜丟掉。
負載變化會改變有幾個來得及炸，這就是它時而 6、時而 10 的原因。

### 沒做的事

- **沒有動 `src/store/tasks.ts`。** 那個 fire-and-forget timer 在 production
  依然是 fire-and-forget。在 production 它不會炸（`taskGitStatus` 一定存在），
  所以本波沒有理由改它；要改就是動移除動畫的行為，那在「不做」清單裡。
- **沒有把整個檔案改成 fake timers。** 只有三個會觸發移除的 describe 裝了。
  `sendPrompt` 那類測試會走到 `tasks.ts:785` 真的 `await` 一個 setTimeout，
  全域 fake timer 會讓它們掛死。
- **沒有處理「timer 在 production 跨越 state reload」的假想情境**
  （300ms 內切換專案，timer 打到新 state）。想得到，但目前沒有任何證據
  說它會發生，寫防禦程式碼就是這個 repo 前幾波一直在刪的那種投機程式碼。
- **沒有 push。**
