# MotionKit v2.0.0 — 鏡頭體感偵測模組規格

單一檔案 `motion-kit.js`，放在遊戲 HTML 旁邊用 `<script src="motion-kit.js"></script>` 載入即可；不需要打包。AI 模型（MediaPipe）由模組自動從 jsDelivr 下載。

- 相機需要 **https 或 localhost**（直接雙擊開檔 `file://` 在多數瀏覽器無法開相機）。
- 只追蹤**一個人**（畫面中最明顯的那位）。展場可用 `roi` 只看中間區域，避免旁人干擾。
- 左右以「玩家自己」為準：畫面已鏡像，玩家舉左手，事件就是 `side: 'left'`。

## 1. 分級（preset）

| 分級 | 名稱 | 用途 | 模型 | 校正 | 預設啟用的動作 |
| --- | --- | --- | --- | --- | --- |
| `quick` | 快速基本偵測 | 展場快速體驗、排隊人潮 | Pose lite（complexity 0）、輸入縮到 480px | 免校正；有人站上 0.5 秒自動定位，換人自動重新定位，離開 30 秒觸發 `idle` | 踏步、跳躍、蹲下、跑道、傾斜、出拳、揮手、揮掃、拍手、雙手高舉、張開雙臂、舉手、頭上愛心、Y 字、跑步 |
| `hands` | 手部專用 | 只需手部的遊戲、坐著玩、空間小 | Pose | 揮手測試 | 出拳、揮手、揮掃、拍手、雙手高舉、張開雙臂、舉手、頭上愛心、Y 字、交叉、指向、傾斜、鞠躬、點頭、搖頭 |
| `run` | 跑步踏步 | 跑步、闖關類 | Pose | 踏步＋跳躍測試 | 踏步、高抬腿、踢腿、跳躍、蹲下、跑道、傾斜、跑步 |
| `body` | 全身標準（預設） | 一般體感遊戲 | Pose（失敗時改動態偵測） | 完整精靈 | 全部基本動作 |
| `advanced` | 進階手勢 | 需要手指手勢的互動 | **Holistic**（骨架＋雙手 21 點＋臉） | 完整精靈＋手勢測試 | 全部基本動作＋手指手勢＋張嘴 |

- 遊戲傳入的選項**優先於** preset。例：`MotionKit.create({ preset: 'quick', lanes: 3 })` 會是快速模式但有 3 條跑道。
- 執行中可切換：`await kit.setPreset('advanced')`（必要時會自動換模型）。
- 進階分級較耗效能（一般筆電約 10–20 FPS）。電腦太慢（< 15 FPS 持續約 3 秒）時模組會自動降到 lite 模型；仍低於 8 FPS 時，進階分級退回一般骨架、骨架退回動態偵測，並觸發 `backend` 事件。

## 2. 動作總表

所有距離都以「玩家的軀幹長度」為單位，所以站遠站近不影響判斷。`GESTURE_INFO` 內有同一份清單（測試台 `motion-lab.html` 直接讀它）。

### 2.1 基本分級（骨架 33 點）

| 事件 | 名稱 | 判斷方式 | 事件資料 |
| --- | --- | --- | --- |
| `step` | 踏步 | 腳踝離地或膝蓋上抬超過門檻（校正時會學習你的幅度）；腳沒入鏡時改用肩膀上下律動 | `side`, `power`, `source`(legs/bounce/motion), `cadence` |
| `highKnee` | 高抬腿 | 膝蓋上抬超過大腿長 75% | `side` |
| `kick` | 踢腿 | 腳踝抬到膝蓋高度且向外踢出 | `side` |
| `jump` / `land` | 跳躍／落地 | 髖部與肩膀同時快速上升超過門檻 | `power`, `rise` |
| `squat` / `stand` | 蹲下／站起 | 髖部下降並維持 0.12 秒 | `depth` |
| `lane` | 左右跑道 | 身體中心相對校正位置左右移動，含遲滯 | `lane`, `lx` |
| `lean` | 身體傾斜 | 肩膀中心相對髖部傾斜超過 15° | `side`, `deg` |
| `punch` | 出拳 | 手臂快速伸直、或往鏡頭推出（單純舉手不算） | `side`, `power`, `speed` |
| `wave` | 揮手 | 手在胸口以上左右來回 2 次以上 | `side` |
| `swipe` | 揮掃 | 0.25 秒內水平移動超過 0.9 個手臂長 | `side`, `dir`(-1/1) |
| `clap` | 拍手 | 雙手從張開快速合攏（在頭上合攏不算，避免與愛心混淆） | — |
| `handsUp` | 雙手高舉 | 雙手腕高於頭頂 0.25 秒；**比愛心時不觸發** | — |
| `armsWide` | 張開雙臂 | 雙臂水平張開（T 字）0.4 秒 | — |
| `raiseHand` | 單手舉手 | 一手高於頭頂、另一手低於肩膀 0.3 秒 | `side` |
| `heart` | **頭上比愛心** | 雙手腕都高於頭頂、兩手腕距離 < 0.6 軀幹長、兩手肘向外撐開（寬度 > 1.25 倍肩寬）且手肘不低於肩膀，維持 0.3 秒 | — |
| `yPose` | Y 字歡呼 | 雙手高舉且左右張開超過 2 倍肩寬、手臂伸直 | — |
| `cross` | 雙手交叉 X | 左右手腕在胸前交叉（介於頭與髖之間） | — |
| `armPoint` | 單臂指向 | 一手臂水平伸直指向側邊、另一手放下 | `side`, `dir` |
| `bow` | 鞠躬 | 肩膀比站姿基準下降 > 0.25、頭低於肩線、髖部幾乎不動 | — |
| `nod` / `shake` | 點頭／搖頭 | 鼻子相對肩膀中心上下（或左右）來回 2 次，身體需靜止 | — |
| `motion` | 移動狀態 | 依步頻：idle / walk（< 95）/ jog（< 145）/ run（< 190）/ sprint，需維持 0.35 秒才切換 | `state`, `prev`, `cadence`, `armSwing` |
| `run` | **跑步** | 進入 run 或 sprint 狀態時觸發一次；`armSwing` 表示左右手反向擺臂程度（0–1） | `cadence`, `sprint`, `armSwing` |

### 2.2 進階分級（Holistic：雙手各 21 點）

| 事件 | 名稱 | 判斷方式 |
| --- | --- | --- |
| `open` | 張開手掌 | 五指伸直 |
| `fist` | 握拳 | 五指收起 |
| `point` | 食指指向 | 只伸出食指 |
| `victory` | YA ✌ | 食指＋中指 |
| `three` / `four` | 三／四 | 食中無名／四指（拇指收起） |
| `thumbsUp` / `thumbsDown` | 讚 / 倒讚 | 只伸出拇指，拇指方向朝上／朝下 |
| `ok` | OK 👌 | 拇指尖與食指尖相碰、其餘三指伸直 |
| `love` | 我愛你 🤟 | 拇指＋食指＋小指 |
| `rock` | 搖滾 🤘 | 食指＋小指 |
| `call` | 打電話 🤙 | 拇指＋小指 |
| `pinch` | 捏取 | 拇指尖與食指尖相碰、其餘收起 |
| `fingerHeart` | 手指愛心 🫰 | 拇指尖靠在彎曲的食指中段 |
| `heartHands` | 雙手比心 🫶 | 兩手食指尖相碰、拇指尖相碰，食指在上，維持 0.3 秒 |
| `count` | 手指數字 | 伸出的手指數量（0–5）穩定改變時 |
| `handShape` | 任一手勢 | 任何手勢穩定成立時（資料含 `name`） |
| `mouthOpen` / `mouthClose` | 張嘴／閉嘴 | 上下唇距離 > 臉長 7.5%（有遲滯） |

手指伸直的判斷：指節夾角 > 140° 且指尖比第二指節離手腕更遠。手勢要在最近 6 幀中出現 4 次以上、並持續 0.22 秒才觸發（單幀雜訊不會觸發），同一手勢 0.9 秒內不重複。左右手依「哪隻手腕比較近」分配，不受模型左右慣例影響。

### 2.3 系統事件

| 事件 | 說明 |
| --- | --- |
| `found` / `lost` | 找到人體／超過 0.7 秒找不到 |
| `presence` | 有人站上（`present: true`，0.5 秒）或離開（1.5 秒） |
| `idle` | 離開超過 `idleMs`（預設 30 秒），展場可用來重置分數 |
| `gesture` | 任何動作都會再發一次 `{ name, data }`，方便一次轉送給遊戲 |
| `frame` | 每幀資料（見下） |
| `ready` / `error` / `calibrated` / `backend` / `perf` / `camera` / `preset` | 啟動完成、失敗、校正結果、改用其他模型、自動降級、鏡頭中斷/重連、切換分級 |

`frame` 每幀內容：`tracking`, `backend`, `cov`（各部位是否入鏡）, `S`（軀幹長）, `rise`, `air`, `squat`, `lane`, `lx`, `feet`, `hands.left/right`（`x, y, rx, ry, energy, level, ext, waving`）, `cadence`, `motion`, `armSwing`, `lean`（-1–1）, `shape`（當下靜態姿勢旗標）, `pose`, 進階另有 `handShapes.left/right`（`name, fingers, pts`）與 `face`（`mouth, open`）。

## 3. 怎麼辨識「新的動作」

三種方式，由簡到繁：

**(a) 組合既有事件**——連續動作：

```js
kit.defineSequence('superJump', ['squat', 'jump'], { within: 1500 }); // 蹲下後 1.5 秒內跳 = 超級跳
kit.on('superJump', () => ...);
```

**(b) 自訂規則**——用關節位置寫條件（`ctx` 提供常用工具，距離單位都是軀幹長）：

```js
kit.defineGesture('touchHead', c => c.near('rwr', 'nose', 0.35), { hold: 300, cooldown: 1000 }); // 右手摸頭
kit.defineGesture('handsOnHips', c => c.near('lwr', 'lhp', 0.25) && c.near('rwr', 'rhp', 0.25), { hold: 500 }); // 雙手叉腰
kit.defineGesture('salute', c => c.near('rin', 'nose', 0.4) && c.angle('rsh', 'rel', 'rwr') < 70, { hold: 300 }); // 敬禮
kit.defineGesture('bigThumb', c => c.hands && c.hands.right.name === 'thumbsUp' && c.above('rwr', 'nose'), { hold: 200 }); // 舉高比讚
```

`ctx`：`b`（全部關節，`b.lsh.x/y/ok`…）、`f`（本幀資料）、`S`、`P`（校正資料）、`hands`（進階手勢）、`ok(...名稱)`、`angle(a,b,c)`（以 b 為頂點的角度）、`above(a,b,間距)`、`near(a,b,距離)`、`dist(a,b)`。關節名稱：`nose lsh rsh lel rel lwr rwr lin rin lpi rpi lhp rhp lkn rkn lan ran lft rft`（l=左、r=右；sh 肩、el 肘、wr 腕、in 食指、pi 小指、hp 髖、kn 膝、an 踝、ft 腳尖）。

**(c) 錄製自訂姿勢**——不用寫程式，擺一次姿勢就記住（存在該電腦的 localStorage）：

```js
await kit.recordPose('勝利姿勢');          // 3 秒內擷取 12 幀取中位數
kit.on('勝利姿勢', e => e.score);           // 之後擺出相同姿勢就觸發（也會發 'template'）
kit.addTemplate('名稱', 向量, { tol: 22 }); // 也可以直接寫入預先錄好的向量（MotionKit.poseVector 產生）
```

比對方式：手肘、肩、髖、膝 8 個角度＋兩手臂方向，平均誤差小於 `tol`（預設 22°）並維持 0.4 秒。測試台可以直接錄製與刪除。

## 4. API

```js
const kit = MotionKit.create({
  id: 'my-game',            // 校正結果與自訂姿勢的儲存名稱
  preset: 'quick',          // 見第 1 節
  video, canvas,            // canvas 會畫出鏡像畫面＋骨架＋手部＋跑道線
  lanes: 3,                 // 跑道數（1 = 不分跑道）
  gestures: null,           // 只啟用這些動作（null = 依 preset）
  thresholds: {},           // 覆寫靈敏度（見下）
  roi: { x: .2, y: 0, w: .6, h: 1 }, // 只看畫面中間 60%（展場防旁人）
  inputWidth: 640,          // 送進模型的寬度，越小越快
  autoCenter: false,        // 有人站上時自動定位（quick 預設開）
  idleMs: 30000,
  wizard: { tests: ['step', 'jump', 'hands'], fast: true, autoClose: true }, // false = 不跳校正視窗
  debug: false,             // 在 canvas 左上角顯示 FPS 與最近事件
  strings: {}               // 改精靈文字
});
kit.on(name, fn) / kit.once / kit.off;   kit.on('*', (name, data) => ...);
await kit.start();            // { ok, backend, preset, tier, quality } 或 { ok:false, reason, message }
kit.stop(); kit.destroy(); kit.pause(); kit.resume();
await kit.recalibrate();      // 再跑一次精靈（quick 分級改為不跳視窗的 quickCenter）
await kit.quickCenter();      // 1.5 秒重新抓站位中心
await kit.setPreset('hands');
kit.guide();                  // { ok, text, lv }：取景提示，可顯示在遊戲畫面
kit.capabilities();           // 目前分級＋模型可偵測的動作清單
kit.bindKeys({ Space: 'step', KeyW: 'jump', KeyH: { name: 'heart' } }); // 沒鏡頭時用鍵盤模擬同一套事件
kit.simulate('jump', { power: 1 });
kit.feedLandmarks(lm33, t, aspect, { left: lm21, right: lm21 }); // 測試或重播錄好的骨架
kit.listCameras(); kit.switchCamera(deviceId);
kit.setThresholds({ stepTh: 0.08 }); kit.getProfile();
```

靈敏度 `thresholds`（皆以軀幹長為單位，校正會自動調整）：`stepTh` 0.10、`kneeTh` 0.16、`jumpTh` 0.16、`squatTh` 0.22、`laneTh` 0.8、`laneHy` 0.25、`punchV` 2.2、`energyHi` 2.4、`leanDeg` 15、`heartGap` 0.6、`holdMs` 300。

## 5. 現場架設建議

- 鏡頭放在螢幕上方或下方中央、與胸口同高最穩；玩家距離 2–3 公尺（全身入鏡）、手部遊戲 1–1.5 公尺。
- 避免背光（窗戶、投影光在玩家身後）。衣服與背景顏色對比高一點。
- 先開 `motion-lab.html` 確認站位、光線與每個動作是否穩定，再開遊戲。
- 鏡頭建議開在**會一直顯示在螢幕上的視窗**（瀏覽器會暫停被縮小或在背景的分頁）。雙螢幕時通常開在資訊視窗。
- 手指手勢需要手掌朝向鏡頭、距離不要太遠（手掌在畫面中至少約 60 像素）。

## 6. 測試

- `node motion-games/tests/motion-kit.test.js`：32 項合成骨架測試（站立不誤觸、愛心不觸發高舉、跑步狀態、各手指手勢、單幀雜訊不觸發、自訂規則/連續動作/自訂姿勢、分級設定）。不需要相機。
- `motion-lab.html`：實機測試台。
- 已知限制：合成資料只驗證判斷邏輯；真實環境的準確度取決於鏡頭、光線與距離，需要現場實測調整 `thresholds`。

## 7. 從 v1 升級

v1 的 API 與事件全部保留。差異：儲存鍵改為 `motionkit.v2.<id>`（會重新校正一次）；新增 `preset`；`clap` 在雙手高於頭時不再觸發；步頻改用最近步伐間隔中位數計算、停步 1.5 秒歸零。
