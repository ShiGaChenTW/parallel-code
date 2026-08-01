# S1：redaction 硬化（「規則觸發、標記蓋上、東西還在」）

**分支：** `fix/redact-hardening`（從 `main @ 95ca09c` 分出）

## 這一波修的是同一種病的三個實例

三方跨模型稽核（Gemini／Claude／xAI 各自獨立）找出來的。**全部已由 PM 對照程式碼確認為真。**

共同形狀：**規則匹配到了、`redacted: [...]` 標記寫上去了、敏感內容仍然完整落地。**
這比「完全沒有規則」更危險 —— 標記是一個「已處理」的肯定宣稱，會讓人看到遮罩就停止追查。

### 1. PEM 私鑰只遮標頭，本體整段寫入

`electron/ipc/redact.ts:66`

```js
/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g;
```

只匹配標頭那一行，沒有捕捉本體。實測輸出：

```
rules=[private-key]
out = "[REDACTED:private-key]\nMIIEowIBAAKCAQEAvBpXk9SECRETKEYMATERIAL0000\n
       QIDAQABAoIBAQCsecondline11111\n-----END RSA PRIVATE KEY-----"
```

原始碼註解說「標頭就足以知道後續幾行不該被寫入」—— **但沒有任何程式碼據此行動。**
`transcript.ts:199-212` 只是把觸發過的規則收進 `redacted` 陣列，然後照樣寫。
`detail` 上限 4096 字元，**放得下一把 2048-bit 金鑰**。

另外 `ENCRYPTED PRIVATE KEY` 不在 alternation 裡，**連 flag 都不會觸發**。

### 2. `generic-assignment` 在第一個不合字元類處截斷，尾巴留著

`electron/ipc/redact.ts:127-131`，值的字元類是 `[A-Za-z0-9/+=_-]{16,}`

```
export DB_PASSWORD=abcdefghijklmnop@QRSTUVWXYZ123456
→ "export [REDACTED:generic-assignment]@QRSTUVWXYZ123456"   rules=[generic-assignment]

API_TOKEN=aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb
→ "[REDACTED:generic-assignment].bbbbbbbbbbbbbbbbbbbb"

PARALLEL_CODE_MCP_TOKEN=zzzz…(24)==tail
→ "[REDACTED:parallel-code-mcp-token]==tail"
```

任何含 `@ ! # $ % ( ) ^ .` 或空白的密碼都會被切一半。

### 3. 40 個語料裡 27 個完全漏掉 —— 而且是它宣稱涵蓋的類別

已實測會漏（全部是**長的、有前綴的、結構化的**）：

```
github_pat_11AABBCCD0…          GitHub 現行 fine-grained PAT
sk_live_51H8xQ2eZvKYlo2C…       Stripe
SG.abcdefghijklmnopqrstuv.…     SendGrid
AGE-SECRET-KEY-1QQQ…
AccountKey=…==                  Azure storage
Authorization: Bearer abcdef…
postgres://appuser:s3cr3tP4ss@db.internal:5432/prod
mongodb+srv://admin:MyP%40ssw0rd@…
redis://:supersecretpassword123@10.0.0.5:6379/0
https://alice:hunter2…@git.internal/repo.git
-----BEGIN ENCRYPTED PRIVATE KEY-----
AKIA… 的 id 有抓到，但 40 字元的 secret access key 裸奔
token 在 URL 路徑段（非 query param）
```

`github_pat_` 是**一個會 shell out 到 `git` 和 `gh` 的工具最可能出現的憑證**，而它漏掉。

`redact.ts:4-8` 的註解把缺口界定為「散文密碼、內部主機名、**短或無前綴**憑證、原始碼」。
上面全部不屬於那四類 —— **那個聲明太樂觀，必須一併修正。**

## 要達成什麼

**當一條規則匹配到某樣東西時，那樣東西不能有任何一部分留在寫出的文字裡。**

至於怎麼達成由你判斷。可能的方向（不是指定）：多行區塊整段遮蔽、值的字元類放寬到
「到空白或行尾為止」、補上漏掉的憑證形狀。**任何做法都要能回答一個問題：
還有沒有「規則觸發但內容存活」的情況？**

## 硬性要求

1. **不可放寬既有的斷言。** `redact.test.ts:68-72` 目前斷言「標頭沒了、規則觸發了」，
   但**沒有斷言本體不見了** —— 那正是它漏掉問題的原因。新測試要斷言**整段不存在**。
2. **redaction 在寫入前，這條不能動。** C6 的原話：寫入後再掃是道歉不是遮蔽，
   bytes 已經進了 page cache，在 copy-on-write 檔案系統上重寫後可能仍可復原。
3. **regex 必須 quantifier-flat 且有 DoS 上界測試。** C6 已有一個餵 20,000 個惡意字元
   量執行時間的測試 —— **寫進 transcript 的內容是 agent 控制的**，回溯爆炸就是寫入路徑上的 DoS。
   新增或放寬任何 pattern 都要維持這個性質並擴充該測試。
4. **不要整套跑 gitleaks**（行程級工具，append-only 高頻寫入路徑）。
5. **更新 `PRIVACY.md` 與 `redact.ts` 檔頭的「擋不住什麼」聲明**，讓它與修好後的實際能力一致。
   C6 的原則是「masks shapes, not meaning」—— 那句話仍然對，但四類例外的清單要重寫。

## 驗收

1. 四道 gate 全綠，測試數 ≥ 2489，啟動 JS 不得超過 90%（目前 82.5%）
2. **上面 27 個漏掉的語料，逐一給出修後結果**（抓到／仍漏／刻意不抓 + 理由）
3. 有測試證明「規則觸發 ⇒ 匹配到的東西完全不在輸出裡」，含 PEM 多行案例
4. DoS 上界測試涵蓋新增的 pattern
5. `PRIVACY.md` 與檔頭聲明與實際一致
6. commit 列明確路徑

## 不做

- 不改 transcript 的儲存格式或 retention
- 不加網路請求（`OUTBOUND_SURFACES` 維持 11 —— 注意另一波正在把它從 10 加到 11）
- 不做 opt-in 粒度的改動

## 決策紀錄

### D1：不逐條補規則，改成把「不變式」寫進演算法

第一直覺是把漏掉的 27 個形狀逐條加上去。**這個直覺我推翻了。**
逐條補規則只能讓「規則觸發但內容存活」變得**比較不可能**，不能讓它**不可能**——
下一個人加一條新規則，字元類一樣會在某個字元停住，同一個病會再犯一次。

改成：**匹配到的位置，一律往右延伸到「空白或引號」為止，然後才蓋標記。**
規則負責「從哪裡開始」，延伸負責「到哪裡結束」。
字元類再怎麼窄，尾巴都不會活下來——因為終點已經不由字元類決定了。

代價：`{"api_key":"…"}` 這種一整串沒有空白的 JSON，遮蔽會多吃掉右邊的 `}`。
接受。原始碼註解本來就寫著「false positive 只是 log 裡多一個遮罩，
false negative 是磁碟上一把外洩憑證」，這條原則我照著走。

### D2：只往右延伸，不往左

往左延伸也能防「頭部殘留」，但實測沒有任何一條規則會從憑證中間開始匹配——
每條規則不是錨在前綴（`sk-ant-`、`github_pat_`）就是錨在關鍵字（`AccountKey`、
`Authorization`、scheme `://`）。往左吃只會把 `ANTHROPIC_API_KEY=` 這種
「哪個變數」的線索也吃掉，讓 transcript 更難讀而沒有多防到東西。

**這條是「結構上不可能」有邊界的地方，我明講**：右邊是機械保證，
左邊是「每條規則的 pattern 都從憑證起點開始」這個性質——由 43 筆語料逐筆斷言守住，
不是由演算法守住。加新規則的人要自己確認這件事（檔頭有寫）。

### D3：PEM 用獨立的 extender，不用 `[\s\S]*?` 硬吃到 END

`-----BEGIN…-----[\s\S]*?-----END…-----` 看起來最省事，但沒有 END 的時候
（金鑰被 4096 字元 detail 上限截斷）整條規則就不匹配，退回今天的 bug。
而且多個 BEGIN 標頭會讓引擎每個起點都掃到檔尾，是 O(n²)。

改成手寫的逐行掃描：吃完標頭行，然後逐行吃「看起來像 PEM 的行」
（base64＋RFC 1421 標頭＋空行），碰到 `-----END` 含該行結束，
碰到明顯不是金鑰的行就停在前一行。**金鑰本體本來就是 base64，
所以本體永遠會被吃掉**；而後面的散文會活下來，過度遮蔽有邊界。
同一條規則內已被前一個 match 涵蓋的起點直接跳過，掃描維持線性。

### D4：規則改成「收集區間 → 取聯集 → 一次拼接」，不再逐條 replace

原本是逐條 `String.replace`，後面的規則看到的是已經被前面規則改過的文字。
延伸機制需要在**原文**上算偏移，所以改成收集區間。

順帶要處理一個回歸：`openai-api-key`（`\bsk-…`）在原文上是會匹配到 `sk-ant-…` 的，
舊架構因為它跑在已遮蔽的文字上所以不會觸發。**如果照實記錄，
`redacted` 陣列會從 `['anthropic-api-key']` 變成兩條，破壞既有斷言。**
規則：**只有當一條規則匹配到「前面規則還沒蓋住的東西」時才記為觸發**，
但它的區間仍然參與聯集（該寬還是要寬）。標記名稱取聯集內最前面（最specific）的規則。
這樣既保留舊語意，又不會為了語意犧牲涵蓋範圍。

### D5：DoS 上界測試改成「枚舉規則清單」，而不是「枚舉我加的規則」

要求是「新增的 pattern 都要涵蓋」。逐條列出來等於下一個人加規則時要記得補測試——
跟 D1 是同一個病。改成 `it.each(REDACTION_RULES.map(...))`：
從每條規則的 source 抽出字面前綴，接 20,000 個惡意字元餵進去。
**以後加的規則自動被涵蓋，不需要任何人記得。**
另外補了靜態檢查：任何規則的 source 不得出現 `)+`、`)*`、`){`——
群組可以是 optional，不可以重複。巢狀量詞從語法層就進不來。

### D6（推翻自己）：兩個自審才發現的洞

寫完、四道 gate 全綠之後，我回頭問「還有沒有規則觸發但內容存活的情況」，找到兩個：

1. **跳脫引號**：`API_TOKEN=aaaa\"tail…`。`\"` 在 JSON 裡是值的一部分，
   不是值的結尾。原本的延伸在引號停住，尾巴照樣落地。
   → 延伸時往回數反斜線，奇數個就當作值的一部分繼續吃。
   （順帶把 shell 的 `\ ` 跳脫空白也涵蓋了。換行永遠是無條件停止——
   吃進下一行不是安全方向。）
2. **U+00A0**：原本被我放進「中斷字元」集合。但 pattern 裡的 `\s` 本來就會在它停住，
   把它也當中斷等於再造一次同樣的截斷。
   → 從集合移除，只留 ASCII 空白與三種引號。

**這兩個洞會被漏掉的原因是同一個**：我用「語料全綠」當作完成訊號，
而語料是我自己寫的——它只涵蓋我想得到的形狀。
真正抓到它們的是「反過來問延伸函式在什麼情況下會提早停」，
也就是**檢查機制本身，而不是檢查資料**。這一點記下來給下一個人。

### D7：不碰的東西

- `.gitleaks.toml` 的三條規則 pattern 一字未動——檔頭寫著「verbatim」，
  要加 URL path 的涵蓋就另開 `token-in-url-path` 一條，不去改 `bearer-token-in-url`。
- `PRIVACY.md` 只動 redaction 那一顆 bullet，`OUTBOUND_SURFACES` 段落完全沒碰
  （另一波正在改那裡，留給 PM 好合併）。
- 沒加任何 npm 依賴、沒有 gitleaks 子行程、redaction 仍在 `append` 序列化之前。

## 結束摘要

**做了什麼**：把 redaction 從「一組 regex 逐條 replace」改成
「收集區間 → 往右延伸到值的邊界 → 取聯集 → 一次拼接」，
並把規則集從 14 條擴到 32 條。

**三個缺陷的結果**：

1. PEM 私鑰：標頭改用獨立的區塊掃描器往下吃完整個 block（含 `ENCRYPTED`，
   含沒有 END 的截斷情況）。`redact.test.ts` 現在斷言標頭、本體、END 三者皆不存在——
   舊測試只斷言標頭，那正是本體漏掉沒被發現的原因。
2. `generic-assignment` 截斷：值的字元類放寬成三選一（單引號／雙引號／到空白為止），
   再加上機械式的右延伸。`@ ! # $ % ^ ( ) .` 逐一有測試。
3. 語料漏抓：43 筆語料在 `main` 上有 30 筆會漏（27 筆完全沒匹配、
   3 筆是「規則觸發但內容存活」），修後 **0 筆**。

**四道 gate**：`check` / `check:static` / `test` / `check:bundle` 全綠。
測試 2600 passed / 26 skipped（基線 2489），啟動 JS 82.5%（上限 90%，未變動——
`redact.ts` 只在主行程）。

**還會漏的**（刻意不追，檔頭與 PRIVACY.md 已如實寫明）：散文密碼、
內部主機名與客戶名這類「敏感但不是憑證」的內容、原始碼本身、
以及**沒有前綴也沒有相鄰標籤的高熵字串**——裸奔的 40 字元 AWS secret access key
與 git object id 逐位元組相同，任何 pattern 都分不開（有標籤的形式有抓到）。

**留給下一個人的一句話**：加規則時，你只需要保證 pattern 從憑證的**起點**開始；
終點不歸你管，`extendToValueEnd` 會處理。DoS 測試會自動涵蓋你加的規則。
