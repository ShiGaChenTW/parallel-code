# App Icon 重新設計 + 可切換圖示系統

**分支：** `feat/app-icon-redesign`

## Scott 的指示

1. 把第三輪的「配色 04 洋紅爆點」改成 **Nord 配色**
2. 用這款設計（方向 C 順時針 90°：三根頂端對齊、由左至右遞增的柱體）**置換掉目前的 icon**
3. 預設走 **配色 01 終端綠**
4. 其他配色讓使用者在**設定裡自由更換**
5. **保留最原始的 icon**，同樣可自由更換

## 設計定案

方向 C 順時針 90°。三根柱體 x=152/256/360，頂端對齊 y=120，向下生長，
長度由左至右遞增（152→214、256→296、360→392）。stroke-width 50、round cap。
底層 track 為全長暗色，上層 fill 為進度亮色。

## 圖示變體（6 款）

| id                          | 名稱             | Base      | Track     | Live      |
| --------------------------- | ---------------- | --------- | --------- | --------- |
| `terminal-green` **(預設)** | 終端綠           | `#0E1F17` | `#1E3A2C` | `#7DFF9B` |
| `signal-amber`              | 訊號琥珀         | `#12100C` | `#3A2E1A` | `#FFB020` |
| `indigo-dusk`               | 靛藍薄暮         | `#0B0F1E` | `#1E2540` | `#8B9DFF` |
| `nord`                      | Nord             | `#2E3440` | `#4C566A` | `#88C0D0` |
| `mono-paper`                | 紙感單色         | `#F2F0EB` | `#D9D5CC` | `#17181A` |
| `classic`                   | 原始設計（保留） | `#000000` | —         | `#2ec8ff` |

Nord 用官方色：nord0 Polar Night 當底、nord3 當 track、nord8 Frost 當 live。

## 執行步驟

- [x] 1. 產生 6 款 SVG 主檔 → `build/icons/<id>.svg`
- [x] 2. 光柵化各尺寸 PNG → `build/icons/<id>-{16,32,64,128,256,512,1024}.png`（42 檔）
- [x] 3. 產生預設款 `.icns`（`iconutil`，10 個 slice）與 `.ico`
- [x] 4. 置換 `build/icon.svg` / `icon.png` / `icon.icns` / `icon.ico` / `128x128.png` / `128x128@2x.png`
- [x] 5. `extraResources` 加入 `build/icons/`（filter `*.png`）
- [x] 6. 新增 IPC channel `set_app_icon` + `electron/ipc/app-icon.ts` handler
- [x] 7. store：`types.ts` / `core.ts` / `persistence.ts` / `autosave.ts` / `ui.ts` / `store.ts`
- [x] 8. SettingsDialog：Themes 分頁新增「App 圖示」區塊（swatch 用同一組幾何畫成 inline SVG）
- [x] 9. i18n 條目（繁中）＋ 動態 key 註冊到 `DYNAMIC_TR_SOURCES`
- [x] 10. 啟動時 `loadState()` 後套用已保存的圖示
- [x] 11. `npm run typecheck` 通過、`vitest` 2664 passed / 0 failed、eslint 與 knip 無輸出

## 限制

- 只支援 macOS / Linux（專案本身不發 Windows）
- macOS 打包進 `.app` 的 `.icns` 無法在執行期更換，能換的是 **Dock 圖示**；Linux 換的是視窗圖示
- 不自動 commit、不開 PR

## 結束摘要

**已完成。** 程式碼 +155 / −2，跨 14 個既有檔 + 2 個新檔（`electron/ipc/app-icon.ts`、`src/lib/app-icon.ts`）。

**驗證到的：** dev 模式實跑，log 出現 `set_app_icon` → `set_app_icon ok`，且未出現
`app-icon not applied`，代表 `nativeImage` 讀檔成功且 `app.dock.setIcon()` 真的執行了。
全套 2664 測試通過。

**沒驗證到的：** Settings 裡的「App 圖示」區塊**沒有目視確認過**。
`Ctrl+,` 會被焦點所在的 prompt 輸入框吃掉；System Events 的 `click at`、AX `click`
與 `AXPress` 對 Chromium 算繪的按鈕都沒有反應（試了三種都是 no-op）。
型別、lint、測試都過，但這一塊仍屬「未親眼看過」。

**一個範圍外但會被看見的不一致：** 舊的青色 `#2ec8ff` 標記仍留在
`build/logo-text.svg`、`build/logo-text-squared.svg`（側邊欄與 README 的文字標）、
`build/icon-squared.svg`、`build/icon-rounded.svg`，以及
`src/remote/public/icons/icon.svg`（手機端／PWA 圖示）。
這次只換 app icon，這些未動 —— 需要一起換的話是另一輪工作。
