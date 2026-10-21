# motion-games — 3D 體感遊戲與共用模組

兩款雙螢幕 3D 體感遊戲，以及之後新遊戲可以直接沿用的三個共用模組。全部是單檔 HTML / JS，不需要打包；放在同一個資料夾、用 https 或本機伺服器開啟即可。

線上（GitHub Pages）：`https://jackeytw886.github.io/dongshan/motion-games/`

## 檔案

| 檔案 | 內容 |
| --- | --- |
| `index.html` | 入口頁（四個連結＋雙視窗用法） |
| `3d-09-dragon-lion.html` | 07 舞龍舞獅感應遊戲（原 `3d__9_optimized.html`）：左 3D 舞台、右導覽資訊 |
| `3d-10-slow-jog.html` | 3D 超慢跑環保闖關（原 `3d__10_optimized.html`）：上 3D 舞台、下資訊座艙 |
| `motion-lab.html` | 體感偵測測試台：切換分級、即時看每個動作有沒有被偵測、錄製自訂姿勢 |
| `game-template.html` | 新遊戲範本：體感分級＋雙視窗都接好，改最上面的 `GAME` 設定即可 |
| `motion-kit.js` | **MotionKit v2** 鏡頭體感偵測模組（快速／手部／跑步／全身／進階五級） |
| `dual-screen-kit.js` | **DualScreenKit v1** 雙視窗模組（彈出、送到副螢幕、字體大小、同步） |
| `ui-icons.js` | 極簡線條圖示（`<i data-ic="camera"></i>`） |
| `docs/MOTION_KIT_SPEC.md` | 偵測分級、全部動作與判斷方式、API、如何新增動作、架設建議 |
| `docs/DUAL_SCREEN_SPEC.md` | 版面、彈出／第二螢幕、字體、同步模型、接到新遊戲的步驟 |
| `tests/motion-kit.test.js` | 動作辨識單元測試（Node，不需相機） |
| `tests/smoke.js` | 瀏覽器煙霧測試（Playwright：載入、雙視窗同步、字體、浮動版面） |

## 本機執行與測試

```bash
npx http-server . -p 8765 -c-1          # 在倉庫根目錄執行
# 瀏覽器開 http://localhost:8765/motion-games/
node motion-games/tests/motion-kit.test.js
node motion-games/tests/smoke.js        # 需要 Playwright 與網路（CDN）
```

## 偵測分級怎麼選

| 情境 | 建議分級 |
| --- | --- |
| 展場人潮、每人玩 1 分鐘、不想校正 | `quick` 快速基本偵測 |
| 遊戲只用手（揮手、出拳、比愛心）、坐著玩 | `hands` 手部專用 |
| 跑步、踏步、跳躍、換跑道 | `run` 跑步踏步 |
| 一般全身體感、有工作人員協助校正 | `body` 全身標準 |
| 要辨識手指手勢（讚、YA、OK、比心） | `advanced` 進階手勢（需要較好的電腦） |

兩款遊戲的資訊區都有分級切換鈕，選擇會記在該電腦上。
