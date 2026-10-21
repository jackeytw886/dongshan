# DualScreenKit v1.0.0 — 雙視窗／雙螢幕展演模組規格

單一檔案 `dual-screen-kit.js`。把遊戲畫面分成兩塊：

- **stage**：3D 主舞台（全螢幕、零文字），通常接投影或大電視。
- **info**：導覽與資訊視窗（分數、說明、按鈕、鏡頭畫面），通常放在操作員螢幕或第二個螢幕。

新遊戲只要指定這兩塊的選擇器，就自動得到：四種版面、彈出成獨立視窗、送到第二螢幕、全螢幕、資訊字體大小調整、視窗位置記憶、兩個視窗之間的同步，以及一條極簡工具列。

## 1. 版面

| 版面 | 說明 | 快捷鍵 |
| --- | --- | --- |
| `split` 並排 | 遊戲自己的預設排法（左右或上下），模組不改動 | `Alt`+`1` |
| `float` 浮動資訊 | 舞台全螢幕，資訊區「彈跳」成可拖曳、可縮放的浮動小視窗（有彈出動畫），位置與大小會記住 | `Alt`+`2` |
| `stage` 僅舞台 | 只顯示 3D 舞台；工具列 2.6 秒後自動淡出，滑鼠移過來才出現 | `Alt`+`3` |
| `info` 僅資訊 | 只顯示資訊區，滿版 | `Alt`+`4` |

網址參數 `?ds=info` / `?ds=stage` 可直接指定（舊的 `?screen=right_only` / `left_only` 也相容）。一般分頁的版面會記在 sessionStorage，重新整理不會跑掉。

## 2. 彈出視窗與第二螢幕

- **彈出資訊視窗**（工具列第一顆、`Alt`+`P`）：用**同一個網址**加上 `?ds=info` 開新視窗；原視窗自動切成「僅舞台」。把新視窗拖到另一個螢幕即可。
  - 彈出視窗每秒記住自己的位置與大小，下次按「彈出」會開在同一個位置（同一個螢幕）。
  - 關掉彈出視窗，原視窗自動還原成並排。彈出視窗內按「合併回主視窗」也一樣。
  - 選單裡也有「彈出主舞台」：反過來讓 3D 舞台到新視窗，原視窗留資訊（狀態會交接過去）。
  - 瀏覽器擋彈出視窗時，會提示並改用「浮動資訊」。
- **送到副螢幕**（螢幕圖示）：使用瀏覽器的視窗管理 API（Chrome / Edge 100 以上）。第一次會詢問「視窗管理」權限，允許後直接把資訊視窗放到另一個螢幕並佔滿，並在該視窗顯示「按一下進入全螢幕」（瀏覽器規定全螢幕需要在那個視窗點一下）。不支援或只有一個螢幕時，改為一般彈出並提示手動拖曳。
- **全螢幕**：工具列或 `Alt`+`F`；也可以直接按 `F11`。

## 3. 字體大小

- 工具列 `−` / `+`（每次 10%，範圍 70%–300%）、點百分比恢復 100%；快捷鍵 `Alt`+`=`、`Alt`+`-`、`Alt`+`0`。
- 做法是縮放資訊區內容（CSS `zoom`），文字、按鈕、間距一起放大，排版不會亂；遊戲可再用 container query 讓放大後自動換排（超慢跑遊戲就是這樣做）。
- **每種版面分開記住**：例如並排時 100%、彈出到副螢幕時 160%，下次自動套用。
- **遙控**：在「僅舞台」視窗按 `−` / `+`，會調整另一個視窗的資訊字體，百分比顯示的是對方目前的大小。

## 4. 同步模型

```
 舞台視窗（主控端）                       資訊視窗（鏡像端）
  遊戲邏輯、3D、音效       state 快照 ─────▶  apply(s) → 更新畫面
  ds.handle('jump', fn)  ◀───── command    按鈕 / 鏡頭動作 → ds.command('jump')
```

- **有舞台的視窗是主控端**（`ds.isAuthority === true`），負責遊戲規則與音效；只有資訊的視窗是鏡像端，用快照顯示。若找不到主控端（例如只開了資訊視窗），它會自己當主控端，不會卡住。
- `snapshot()`：主控端每秒 15 次（`syncHz`）呼叫，只有在對方是資訊視窗時才送。
- `apply(s, meta)`：鏡像端收到快照時呼叫；`meta.handoff` 表示交接（彈出主舞台時舊主控端把狀態交給新視窗）。
- `ds.handle(name, fn)` + `ds.command(name, data)`：任何視窗都呼叫 `command`；主控端直接執行，鏡像端轉送給主控端。**按鈕、鍵盤、鏡頭動作一律走 command**，兩個視窗就不會各算各的。
- `ds.send(name, data)` + `ds.onPeer(name, fn)`：一般訊息（例如只想讓對方顯示提示）。
- 傳輸：BroadcastChannel（同網域分頁）＋ `postMessage`（彈出視窗與開啟者）＋ localStorage 備援，訊息自動去重。也就是說，手動開兩個分頁（一個 `?ds=stage`、一個 `?ds=info`）也能連線。

## 5. 接到新遊戲（5 步）

1. 載入：`<script src="dual-screen-kit.js"></script>`（建議一起載入 `ui-icons.js`）。
2. HTML 分兩塊：舞台容器、資訊容器；資訊容器內再包一層要縮放的內容（例如 `#info-scale`），並留一個放工具列的位置（例如 `#ds-slot`）。
3. 建立：

```js
const ds = DualScreen.create({
  app: 'my-game',                 // 每個遊戲不同（頻道與記憶位置用）
  title: '我的遊戲',
  stage: '#stage', info: '#info', scale: '#info-scale',
  toolbar: { mount: '#ds-slot', corner: 'tr' },   // false = 不要工具列（自己用 API 做按鈕）
  accent: '#38bdf8',
  labels: { stage: '3D 主舞台', info: '資訊視窗' },
  onLayout: (layout, prev) => resizeRenderer(),    // 版面改變後重設 3D 畫布大小
  snapshot: () => ({ score, lives, toast }),       // 只放畫面需要的資料
  apply: s => Object.assign(view, s)
});
```

4. 遊戲動作改成 `ds.handle('xxx', fn)`；按鈕 / 鍵盤 / 鏡頭改呼叫 `ds.command('xxx', data)`。
5. 主迴圈：

```js
if (ds.isAuthority) simulate(dt);   // 只有主控端跑遊戲邏輯
if (ds.hasStage) renderer.render(scene, camera);
if (ds.hasInfo) renderInfoPanel();  // 從狀態畫資訊區（主控端與鏡像端共用）
```

`game-template.html` 是完整可執行的範例。

## 6. API 一覽

| 屬性 / 方法 | 說明 |
| --- | --- |
| `layout` / `setLayout(l)` | 目前版面／切換版面 |
| `hasStage` / `hasInfo` / `isAuthority` / `isPopup` / `connected` / `peers` | 狀態查詢 |
| `popout('info' \| 'stage', { geom, fullscreen })` | 彈出視窗（回傳 window 或 null） |
| `sendToOtherScreen('info')` | 送到副螢幕 |
| `closePopup()` / `dock()` | 關閉彈出視窗／合併回單一視窗 |
| `fullscreen(on?)` | 切換全螢幕 |
| `font` / `setFont(v)` / `bumpFont(d)` | 字體大小（沒有資訊區時會遙控對方） |
| `handle` / `command` / `send` / `onPeer` | 見第 4 節 |
| `on('layout' \| 'peer' \| 'popup' \| 'blocked' \| 'font' \| 'state' \| 'handoff', fn)` | 模組事件 |
| `toast(msg)` / `forgetPosition()` / `destroy()` | 提示、清除記住的位置、移除 |

選項：`app, title, stage, info, scale, defaultLayout('split'), layouts, syncHz(15), accent, toolbar{mount, corner(tr/tl/br/bl), autoHide(2600), popoutStage}, font{min .7, max 3, step .1}, popup{width 1100, height 780}, labels, shortcuts(true), snapshot, apply, onLayout`。

## 7. 限制

- 彈出視窗必須由使用者點擊觸發（瀏覽器規定）。「送到副螢幕」第一次授權後，若瀏覽器擋下，請再按一次。
- 視窗管理 API 目前只有 Chromium 系（Chrome / Edge）；Safari / Firefox 會退回一般彈出＋手動拖曳。
- 不同網域、或用 `file://` 開啟時，部分瀏覽器不允許 BroadcastChannel／彈出視窗互通；請用本機伺服器或 GitHub Pages。
- 被縮小或在背景的分頁，瀏覽器會降低計時器頻率；展演時兩個視窗都保持在螢幕上顯示。
- 字體縮放用 CSS `zoom`（Chrome / Edge / Safari 全支援，Firefox 126 以上）。
