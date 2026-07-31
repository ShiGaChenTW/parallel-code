# S2：離線模式漏掉的第十一個對外連線點 —— `docker run`

**分支：** `fix/docker-run-offline`（從 `main @ 95ca09c` 分出）
**狀態：** 完成

---

## 缺陷

R2（`649d609`）把離線模式做成 `OUTBOUND_SURFACES` 單一真相來源，盤點出十個對外連線點。
跨模型稽核找到**第十一個沒有被關住的**。

`electron/ipc/pty.ts` 全檔只有兩處提到離線模式：

```
electron/ipc/pty.ts:11     import { offlineMessage, isOfflineMode }
electron/ipc/pty.ts:1002   if (isOfflineMode()) {      // 只在 buildDockerImage 裡
```

`docker build` 在 1002 被擋住。**`pty.ts:263` 的 `docker run` 沒有。**
而 `docker run <image>` 在 image 不存在於本機時會去 registry 拉 ——
那是一次由 Parallel Code 呼叫本機工具所發起的對外連線，
正好落在 `electron/ipc/offline.ts:5-10` 自己寫下的涵蓋範圍裡。

### 為什麼 R2 會漏

R2 的盤點方法記在 `plans/…waveR2-offline-mode.md:80`：`rg -e "spawn\(" -e "execFile\("`。
`docker build` 是 `cpSpawn('docker', ['build', …])` —— 字面量，抓得到。
`docker run` 的 argv 是 `buildPtySpawnSpec()` **回傳的資料**，交給 `node-pty` 去 spawn，
grep `spawn(` 抓不到 `'docker'` 這個字串。這是一個方法論的洞，不是一時疏忽。

### 實際可觸發

1. 設一個從未在本機 build 過的自訂 `dockerImage`（或換一台沒 build 過預設 image 的機器）
2. 打開離線模式
3. 用 Docker 模式建一個 task

`src/components/NewTaskDialog.tsx:407` 的 `dockerImageReady` **不是閘門**，
它是 renderer 端的提示訊號 —— 見下方驗證。

---

## 驗證：上游沒有既有閘門（稽核者自陳的唯一可能反證，已排除）

稽核者說「可能有某個 `spawnAgent` 的上游呼叫端已經在離線時拒絕 Docker 模式」。
逐條追完，**沒有**。

### `spawnAgent` 的全部呼叫端（生產碼恰好兩個）

| #   | 位置                              | dockerMode 來源                              |
| --- | --------------------------------- | -------------------------------------------- |
| 1   | `electron/ipc/register.ts:498`    | 原封不動來自 renderer 的 IPC payload         |
| 2   | `electron/mcp/coordinator.ts:985` | `coordinator.ts:996` 硬寫 `dockerMode: true` |

其餘全是測試碼（`pty.test.ts`、`coordinator.test.ts`、`coordinator-test-harness.ts:175`）。

### 路徑 1：renderer → `register.ts:498`

`ipcMain.handle(IPC.SpawnAgent)`（`register.ts:478`）只做型別驗證
（`assertOptionalBoolean(args.dockerMode)`），**沒有離線檢查**。

renderer 端只有一個發送點：`src/components/TerminalView.tsx:1020`，
在 `startSpawn()` 裡，是**掛載時的副作用**。三個短路條件
（`isLandedTaskState`、`spawnHeldForDependency`、MCP 未就緒）**都不提離線或 docker**。

會帶 docker props 掛載 `<TerminalView>` 的只有兩處：
`TaskAITerminal.tsx:685-711`、`TaskShellSection.tsx:275-285`。
因此問題化約成「什麼會讓 `task.dockerMode` 為真、又讓這些元件（重新）掛載」，
答案有十一條：新建 task、`restartAgent`（generation +1 強制 remount，四個按鈕入口）、
`addAgentToTask`、`switchAgent`、app 重啟還原（`persistence.ts:719/827`）、
開 task shell、摺疊／展開 task、focus mode 重排、MCP retry、依賴 landed 自動放行、
coordinator 繼承（`TaskAITerminal.tsx:694-696`，子 task 自己的 `dockerMode` 是 unset 也會繼承）。
**十一條沒有一條讀離線模式。**

### 路徑 2：MCP／REST → `coordinator.ts:985`

觸發者是 MCP tool `create_task`（`electron/mcp/server.ts:52`）與
REST route（`electron/remote/server.ts:400`）。
`rg "offline" electron/mcp/ electron/remote/` 在非測試碼是**零命中**。

### `dockerImageReady` 是提示，不是閘門

`NewTaskDialog.tsx:407` 宣告，三個消費者全是裝飾性的
（`:210` 顯示「Image not found locally.」+ Build Image 按鈕、`:284` 顯示「Image ready.」、
`:1428` 傳給 `DockerTaskOptions`）。

決定性的一行是 `canSubmit()`（`NewTaskDialog.tsx:924-937`）：

```ts
const branchOk = isNonGitProject() || (!!baseBranch() && !branchesError());
return (
  !!selectedProjectId() && !loading() && !branchesLoading() && branchOk && !branchPrefixConflict()
);
```

**沒有 `dockerImageReady`、沒有 `dockerMode`、沒有 `offlineMode`。**
`handleSubmit`（`:939`）也從不讀 `dockerImageReady`。
`dockerImageReady() === false` 時建立按鈕完全可按 —— 這正是那個洞。

其計算來源（`:783-813`）只看 `dockerMode()`、`store.dockerAvailable`、
`projectDockerfile()`、`store.dockerImage`，**離線模式不在其中**。

### 結論

**發現成立。** 唯一與 docker 相關的閘門是 `pty.ts:1002`，
守的是 `buildDockerImage()` —— `spawnAgent` 從不呼叫它的另一個函式。

---

## 設計裁決：拒絕，但只拒絕真的會連線的那一種

### D1 —— 不是無條件拒絕

指令說「離線時 `docker run` 要拒絕，並給出可讀的理由」。字面照做會是
**離線模式一開，Docker 模式整個不能用**。但 image 已經在本機時，
`docker run` 一個封包都不送 —— 拒絕它並不服務 `offline.ts:4-6` 寫的範圍
（「Parallel Code 自己發起的網路活動」），只是砍功能。

**離線 + 本機已 build 好的 image**，恰恰是離線模式最正當的使用情境（air-gapped 開發）。

既有前例支持分級處理：`git-remote-head`（`electron/ipc/git.ts:250`）離線時
**不是拒絕，而是退回本機 ref 解析**。同一份文件裡已經有「降級而非拒絕」這條路。

所以閘門是：

| dockerMode | offline | image 在本機 | 行為                                                                |
| ---------- | ------- | ------------ | ------------------------------------------------------------------- |
| false      | 任意    | —            | 不受影響                                                            |
| true       | false   | —            | 不受影響（argv 一字未動）                                           |
| true       | true    | 是           | 放行，並補上 `--pull never`                                         |
| true       | true    | 否           | **在 `docker` 被呼叫之前拒絕**，丟 `OfflineModeError('docker-run')` |

### D2 —— `--pull never` 是結構性保證，不是裝飾

本機探測與實際 `docker run` 之間有 TOCTOU 空隙（探測後、spawn 前 image 被刪）。
`--pull never` 讓 docker daemon 自己在任何情況下都不去 registry，
使保證不依賴我那次探測的正確性。離線關閉時**不加這兩個 argv**，
所以既有的 argv 斷言測試一個都不會動到。

### D3 —— 決策邏輯是純函式

vitest 是 `environment: 'node'`、無 DOM harness。`gateDockerRun()` 只吃
`{ offline, imagePresentLocally }` 兩個布林，回傳 `{ allowed, extraRunArgs }`，
四格真值表可以完全純測。探測（shell out）留在 `spawnAgent` 裡。

### D4 —— 探測用同步呼叫

`spawnAgent` 是同步的，改成 async 會擴散到 `register.ts` 與 `coordinator.ts`。
而 `spawnAgent` 在 docker 路徑上**本來就已經有一次同步 shell out**
（`validateCommand('docker')` → `execFileSync('which', …)`）。
再加一次 `execFileSync('docker', ['image','ls',…], { timeout: 5000 })`
——**而且只在離線模式開著時才跑**——與這個檔案既有的行為一致。
`docker image ls` 是純本機 daemon 查詢，不碰網路。

### D5 —— 只問「在不在」，不問「新不新」

既有的 `dockerImageExists()` 還會比對 Dockerfile hash 判斷過期。
離線閘門不需要那個：**過期但存在的 image 跑起來一樣不連網**。
所以新的探測只問存在性。

---

## 三方數量檢查（十 → 十一）

`electron/ipc/offline.test.ts:77-122` 從 `OUTBOUND_SURFACES.length` 推導期望值，
實際讀兩份文件比對。改動數量必然牽動三處：

1. `electron/ipc/offline.ts` —— `OUTBOUND_SURFACES` 加 `'docker-run'` + 訊息
2. `PRIVACY.md` —— `**ten**` → `**eleven**`（兩處），且
   `**Offline mode:**` 註記數必須等於 `11 - 1 = 10`（git 兩個 surface 併成一則），
   所以「Docker task isolation」那一則要新增自己的 `**Offline mode:**`
3. `docs/PRD.md` §7.1 —— 清單要有第 11 項，且不得有第 12 項
4. `offline.test.ts` 的 `asWords` 要補 `11: 'eleven'`（否則守衛測試會擋下 `undefined`）

---

## 進度

- [x] 驗證發現成立、上游無既有閘門
- [x] 寫追蹤文檔
- [x] 測試先行（RED —— 11 個新測試，7 個紅）
- [x] 實作（GREEN）
- [x] 三份文件同步到十一
- [x] 四道 gate + 單檔重跑
- [x] commit

---

## 結束摘要

### 使用者實際看到什麼

離線模式開著、用 Docker 模式建 task、而該 image 不在本機時：

終端裡出現紅字（`TerminalView.tsx:1044` 既有的 spawn 失敗顯示路徑）：

```
Failed to spawn: Error: Offline mode is on, so the Docker container was not
started — its image is not on this machine, and starting it would pull from a
registry. Turn it off in Settings to allow this.
```

同時 `props.onExit({ signal: 'spawn_failed' })` 被呼叫，agent 進入已退出狀態、
帶 Restart 按鈕。**不需要新的顯示通道** —— `spawnAgent` 的失敗本來就是丟例外，
renderer 本來就會把它印進終端。這也是為什麼閘門用 `throw` 而不是回傳 `{ ok: false }`。

image 已在本機時：**照常啟動**，只是 argv 多了 `--pull never`。使用者看不到差別。

### 檔案

新增：

- `plans/fork_parallel-code__2026-07-31-0700__waveS2-docker-run-offline.md`（本檔）

修改：

- `electron/ipc/offline.ts` —— `OUTBOUND_SURFACES` 加 `'docker-run'`、對應訊息、
  檔頭範圍註解補上 `docker run`
- `electron/ipc/pty.ts` —— 新增純函式 `gateDockerRun()`、同步探測
  `dockerImagePresentLocally()`；`spawnAgent()` 在 `validateCommand` 之後、
  `cleanupExistingSession` 之前設閘門；`buildPtySpawnSpec()` 收第六個參數
  `offlineRunArgs` 並展開進 `docker run` argv
- `electron/ipc/pty.test.ts` —— `gateDockerRun` 真值表 3 個 + spawnAgent 閘門 8 個；
  把 hoisted 的 `execFileSync` 預設實作抽成具名的 `defaultExecFileSync` 以便還原
- `electron/ipc/offline.test.ts` —— `asWords` 補 `11: 'eleven'`
- `PRIVACY.md` —— **只動 4 行**（51／56／62／81），全在離線模式與對外連線點兩節內
- `docs/PRD.md` §7.1 —— 第 11 項、總數三處、inbound 那句的「這十個」
- `src/components/SettingsDialog.tsx` + `src/lib/i18n.ts` —— 開關說明列舉補上
  「啟動 image 不在本機的 Docker 任務」（英文原文是 i18n key，兩檔必須同步改）

### 三方數量一致（十一）

| 來源                       | 值                                               |
| -------------------------- | ------------------------------------------------ |
| `OUTBOUND_SURFACES.length` | 11                                               |
| `PRIVACY.md` `**eleven**`  | 2 處；`**Offline mode:**` 註記 10 則（= 11 − 1） |
| `docs/PRD.md` §7.1         | 清單到第 11 項，無第 12 項                       |

### Gate

```
npm run check         全過（compile / typecheck / lint / format:check）
npm run check:static  全過，depcruise: no dependency violations (465 modules, 1564 dependencies)
npm test              Test Files 133 passed | 2 skipped (135)
                      Tests 2500 passed | 26 skipped (2526)     [baseline 2489/26 → +11]
npm run check:bundle  renderer entry chunk 1,237,942 B / 1,500,000 B — 82.5%（天花板 90%）
                      dist total 15,348,413 B / 18,000,000 B — 85.3%
```

單檔重跑：`pty.test.ts` 78 passed、`offline.test.ts` 16 passed、`i18n.test.ts` 34 passed。

### 沒做的（刻意）

- **沒有無條件拒絕離線下的 `docker run`。** 見 D1 —— image 已在本機時它零連線，
  拒絕它只會讓離線模式與 Docker 模式互斥，而那正是 air-gapped 開發要的組合。
  這是對指令字面的一處偏離，理由記在 D1，前例是 `git-remote-head` 的降級處理。
- **沒有改 `dockerImageReady`／`canSubmit()`。** New Task 對話框在離線＋image 缺失時
  仍然允許送出。那是 renderer 端的提示層，真正的保證應該在 main 的單一咽喉點；
  在 UI 再加一道只會是第二份會忘記更新的真相。要做的話是另一波的 UX 工作。
- **沒有把 `dockerImageExists()` 換成新的探測。** 兩者問的問題不同（新舊 vs 存在），
  合併會讓 UI 的「image 過期，要不要重 build」提示壞掉。
- **沒有動 `docker build` 那一格。** 它本來就對。
- **沒有碰 `electron/ipc/redact.ts`。** 另一波在改。
- **沒有 push。**
