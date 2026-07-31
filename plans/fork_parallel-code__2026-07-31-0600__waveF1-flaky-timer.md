# F1：修掉 `coordinator.test.ts` 的間歇性失敗（洩漏的 real timer）

**分支：** `fix/flaky-timer`（從 `main @ 5f7300b` 分出）
**目標測試：** `electron/mcp/coordinator.test.ts > Coordinator cleanupTask — failure resilience > deleteTask failure clears scheduled initial prompt delivery timers`

---

## 一、診斷

### 1.1 交辦時的假設（已證偽）

交辦內容懷疑是這一行的同步性假設：

```ts
outputCb(encode(READY_AGENT_FRAME_FIXTURES[0].frame));
expect(c.initialPromptTimers.has('task-1')).toBe(true);
```

**這個假設是錯的。** 讀 code 可確認整條路徑
`outputCb → handlePromptDetected → scheduleInitialPromptDelivery`
**全程同步**，沒有任何 `await`、沒有 microtask 邊界。

更關鍵的是：`createTask()` 自己在 `coordinator.ts:1013` 就已經呼叫過
`scheduleInitialPromptDelivery()`。也就是說在餵 READY frame **之前**，
`initialPromptTimers.has('task-1')` 就已經是 `true`。這行斷言在任何負載下都是確定的。

### 1.2 真正的原因

失敗的是**最後一個**斷言：

```ts
await vi.advanceTimersByTimeAsync(2_000);
expect(mockWriteToAgent).not.toHaveBeenCalledWith(
  expect.any(String), // ← 任何 agent 都算
  expect.stringContaining('do'), // ← 'do' 是全檔案共用的 prompt
);
```

三個條件疊在一起就會壞：

1. **`createTask()` 會 arm 一個 real 1.5 秒 timer**（`INITIAL_PROMPT_READY_DELAY_MS`）。
   而 `tryDeliverInitialPrompt()` 在 agent 還沒 ready 時會**再 arm 一次**，
   形成自我延續的 timer 鏈。
2. **測試從不拆掉它。** 檔案裡有 189 處 `createTask()`，只有 55 處用 fake timers。
   量測結果：跑一次 `coordinator.test.ts` 會留下 **75 個活著的 1500ms real timer**。
3. **斷言用的是 file-global mock，而且不分 agent。**
   `expect.any(String)` 讓「任何 coordinator 對任何 agent 的寫入」都算數。

單獨跑這個檔案時 `tests` 只花 **1.80 秒** —— 比 1.5 秒 timer 的引信長不了多少，
所以幾乎沒有 timer 來得及在檔案結束前爆掉。

但在**全套件**裡，這個檔案要和另外 133 個檔案搶 10 顆 CPU，wall clock 被拉長好幾倍。
於是某個測試 arm 的 timer 會在 **1.5 秒後、別的測試執行中**爆掉，
呼叫 `writeToAgent(過期的 agentId, '[SUB-TASK MODE]…do')`，
汙染後面那個測試正在檢查的 mock。

這完全對得上觀察到的現象：單檔 256/256 過、全套件約 1/3 機率過、
測試數從 2431 長到 2513 之後變嚴重（檔案更多 → 爭用更兇 → wall clock 更長）。

### 1.3 證據

**(a) 量測 timer 洩漏**（暫時性的 `setTimeout` 包裝 + audit setup）：

- 單獨跑 `coordinator.test.ts`：75 個 1500ms timer 在自己的測試結束後仍然活著。
- 全套件跑：抓到 40+ 筆 `STRAY-FIRE`，明確記錄
  「在測試 A arm、在測試 B 爆掉」，delay=1500。

**(b) 確定性重現**（暫時性的 repro 檔）：
用「A 測試留下 timer → B 測試燒掉 1490ms wall clock（最後一段用同步 spin，
讓 event loop 轉不動）→ C 測試 = 原本那個 flaky 測試」的排法，
讓 stray timer 剛好落在 C 的執行窗內。結果 **100% 失敗**，
失敗訊息就是原本的那一則，而且汙染的寫入帶著**另一個 agentId**：

```
+   "d0084402-6bef-4962-b5b0-58268ae3378e",
+   "[SUB-TASK MODE] You are a coordinated sub-task inside Parallel Code…
+ ---
+ do",
```

同一個 repro 在套用修正後：`writeToAgent calls=0`，通過。

---

## 二、改了什麼

**完全沒有動 production code。** `git diff electron/mcp/coordinator.ts` 是空的。

### 2.1 根因修正 —— `electron/mcp/coordinator-test-harness.ts`

harness 用 `Proxy` 的 `construct` trap 追蹤測試建立的每個 `Coordinator`
（用 Proxy 而不是 subclass，`instanceof`、`name`、公開形狀都保持原樣），
再用 module 層級的 `afterEach` 把它們的
`initialPromptTimers` / `queuedPromptFlushTimers` 全部 `clearTimeout` 並清空。

效果：1500ms 洩漏 timer **75 → 0**。

這是測試生命週期的缺口，不是產品缺陷 —— production 全程只有一個 Coordinator，
跟著 process 活到最後。所以修在 harness，不修在 `coordinator.ts`。

### 2.2 針對性修正 —— `electron/mcp/coordinator.test.ts`（4 處）

四個測試共用同一個易碎形狀，全部改掉（不是只改今天在紅的那一個）：

| 行為                           | 測試                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `deregisterCoordinator`        | `deregister clears scheduled initial prompt delivery timers for child tasks`      |
| `closeTask`（deleteTask 失敗） | `deleteTask failure clears scheduled initial prompt delivery timers` ← 回報的那個 |
| `closeTask`                    | `closeTask clears scheduled initial prompt delivery timers`                       |
| `removeCoordinatedTask`        | `removeCoordinatedTask clears scheduled initial prompt delivery timers`           |

改法：

```ts
const agentId = getAgentId();          // 這個 task 自己的 agent
…
expect(getAgentTextWrites(agentId)).toEqual([]);
```

**為什麼這是「不可能」而不是「不太可能」：**
`agentId` 是每次 `createTask()` 現生的 `randomUUID()`。
任何別的 coordinator 的 stray 寫入必然帶著不同的 UUID，
**在型別上就進不了這個被過濾的集合**。不是機率變小，是進不來。

**為什麼這比原本更嚴格，不是更鬆：**
原本說「沒有任何寫入包含 'do'」；現在說「**這個 agent 完全沒被寫過任何東西**」。
後者是更強的宣稱。同一個檔案裡的 queued-prompt 版本
（`not.toHaveBeenCalledWith(task.agentId, 'queued')`）本來就是這個形狀 —— 有前例可循。

`deleteTask` 那一個另外補一條，把「取消而非送出」講明白：

```ts
expect(coordinator.getTask('task-1')?.initialPrompt).toContain('do');
```

### 2.3 新增常駐守門測試 —— `electron/mcp/coordinator-test-harness.test.ts`

不把東西堆進已經 5000+ 行、重度 mock 的 `coordinator.test.ts`
（沿用前一個 wave 的判斷，該判斷事後看是對的），另開小檔。

兩個測試：前一個 arm timer 且故意不關 task，後一個**從下一個測試回頭看**
前一個 coordinator 的 timer map 是不是空的。
**沒有 sleep、不依賴 wall clock**，所以守門測試自己不會變 flaky。

---

## 三、變異驗證（測試還證明得了原本證明的事嗎）

刻意把 `clearInitialPromptTimer()` 弄壞兩次：

| 變異                                                     | 結果                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| 整個 clear 變 no-op                                      | 4 個測試**全部** FAIL ✅                                              |
| map 清掉但 `clearTimeout` 拿掉（帳面清了、timer 還活著） | `deleteTask` 那個 FAIL，**紅在新加的 `getAgentTextWrites` 那一行** ✅ |

第二個變異正是這個測試存在的理由：deleteTask 失敗後 task 仍留在 map 裡，
所以 timer 一爆就真的會把 prompt 送給正在被拆掉的 task。新斷言抓得到。

---

## 四、有沒有回退掉什麼

有，三個純診斷用的暫時檔案，用完即刪、**沒有進 commit**：

- `electron/mcp/tmp-flaky-repro.test.ts`（確定性重現）
- `tmp-timer-audit.setup.ts`（`setTimeout` 包裝 + 洩漏量測）
- `tmp-vitest.audit.config.ts`（掛上面那個 setup 用的暫時 config）

其中「重現」的價值以 §2.3 的常駐守門測試保留下來 —— 但改成不依賴 wall clock 的寫法，
因為 sleep-based 的重現拿來當常駐測試，本身就會是下一個 flaky test。

`coordinator.ts` 的兩次變異探針也已還原，diff 為空。

---

## 五、`src/store/tasks.test.ts` 的既有錯誤

**同一類，但不是同一個根因，所以不動。**

`removeTask()`（`src/store/tasks.ts:654`）發射一個 fire-and-forget 的
`setTimeout(…, REMOVE_ANIMATION_MS)` 做刪除動畫的第二階段。
測試結束、store test-helper 把 store 重設之後 timer 才爆，
於是 `removeTaskDraftEntries()` 在 `s.taskGitStatus` 已經是 undefined 的情況下
執行 `delete s.taskGitStatus[taskId]` → `TypeError`。

- **相同處：** 都是「real timer 活得比 arm 它的測試久」。
  數量會浮動（量到 6 次也量到 8 次）也是同一個時間依賴的味道。
- **不同處：** coordinator 那邊是「測試建了 instance 卻沒拆」，
  harness 拿得到 instance 的 timer map，所以修得掉。
  這邊是 **module 級 singleton store**，timer handle 關在 `removeTask` 的 closure 裡，
  外面**根本拿不到**。要修只能動 production code
  （把 timer 記進 module map 並開 test-only reset），
  或動影響 85 個測試的 store test-helper。

修它是另一件工作，不是這次的小延伸。

### 5.1 一項要更正的既有認知

前面兩個 wave 說「這 6 個錯誤今天不會讓套件變紅」。**這句話只在機器閒的時候成立。**

本次 6 次全套件量測中，第 3、4 次 **exit code = 1，但 0 個測試失敗**
（`Tests 2489 passed | 26 skipped`，沒有任何 `FAIL` 行）。
非零退出完全來自這批 unhandled error：機器忙的時候 timer 爆得夠晚，
會撞進 vitest worker 的 teardown，多出

```
EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUnhandledError" was pending
```

錯誤數也跟著從 6 漲到 10。**所以它會讓 `npm test` 整個紅掉，只是不是每次。**
這比「只是噪音」嚴重，建議另開一個 wave 處理，優先度不低。

### 5.2 修它要多大

`removeTaskFromStore()` 的 phase-2 timer handle 關在 closure 裡，外面拿不到。
同一個函式裡的 `activityReleaseTimers`（`tasks.ts:1637`）已經是「記進 module map」的先例，
照著加一個 `removalTimers` 不難 —— **但沒有任何 production 呼叫端會在測試 teardown 時去清它**，
所以還是得往 production code 開一個 test-only 的 reset 出口，
或是把 `tasks.test.ts`（85 個測試）整檔改用 fake timers。
兩條路都不是這次的小延伸，需要一個明確的設計決定。

---

## 六、驗證

### 6.1 全套件連續執行

6 次連續全套件，**每一次都是 0 個測試失敗**（`2489 passed | 26 skipped`）：

| #   | exit  | 測試結果                                  | load avg |
| --- | ----- | ----------------------------------------- | -------- |
| 1   | 0     | 2489 passed / 26 skipped                  | 220      |
| 2   | 0     | 2489 passed / 26 skipped                  | 218      |
| 3   | **1** | 2489 passed / 26 skipped（**0 個 FAIL**） | 219      |
| 4   | **1** | 2489 passed / 26 skipped（**0 個 FAIL**） | 216      |
| 5   | 0     | 2489 passed / 26 skipped                  | 206      |
| 6   | 0     | 2489 passed / 26 skipped                  | 180      |

目標測試 6/6 全綠。第 3、4 次的非零退出是 §5.1 的既有問題，不是測試失敗。

2489 = baseline 2487 + §2.3 新增守門測試的 2 個。

### 6.2 環境干擾（誠實記錄）

量測期間 load average 在 160–277 之間（其他 agent 在跑）。
更早幾次在 load 277 時，`electron/ipc/handoff.test.ts` 的
`truncates at a line boundary…` 撞到 5 秒 `testTimeout`（實測 7088ms）。
那個測試建一個 256KB 字串再跑約 2600 次 `expect` —— **純 CPU、沒有任何 timer**，
和本次修正、和 coordinator 檔案都無關，機器閒下來後就沒再出現。沒有動它。
