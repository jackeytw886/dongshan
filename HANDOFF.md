# Handoff — P013 冬山鄉探險隊・互動語音燈板導覽

- 更新時間：2026-10-22T05:54+08:00
- 更新者：Claude（新增 `motion-games/`：兩款 3D 體感遊戲改版與三個共用模組）
- 倉庫：https://github.com/jackeytw886/dongshan
- 分支：`claude/clever-franklin-2l6wbx`（尚未合併到 main）
- 本次基準 SHA：`bdcfcd33f377bdf4983abb337abce884d552c3d5`（上一份交接提交）
- 核對層級：冬山導覽（第 1–7 節）沿用 2026-10-18 的紀錄，本次未改動 `index.html` 與音訊。`motion-games/` 已跑單元測試與無頭瀏覽器測試（見第 8 節與 docs/VERIFICATION.md）；**未做真人鏡頭、實際雙螢幕硬體與展場測試**。

## 1. 這是什麼

宜蘭冬山鄉的兒童旅遊故事導覽網頁：8 個景點主題，每個主題 8 幕故事，每幕有標題、文字、預錄語音（TTS）、背景音樂，以及一塊 **16×16 像素 LED 燈板動畫**（網頁上模擬，對應實體 LED 矩陣燈板）。

8 個主題：瓜棚火車站奇幻之旅、神秘河道的水上冒險、梅花湖的四季守護者、追瀑布的小探險家、彩稻田的熱氣球夢、牧場小羊找媽媽、水火同源奇幻傳說、仁山精靈森林秘密。

- 線上網址：https://jackeytw886.github.io/dongshan/ （GitHub Pages）

## 2. 檔案

| 路徑 | 內容 |
| --- | --- |
| `index.html` | 導覽網頁（約 77 KB、1,376 行），單檔、無外部程式庫 |
| `dongshan_audio/generate_story_audio.py` | 用 edge-tts（`zh-TW-HsiaoChenNeural`）把故事文字轉成 `tts_audio/00001.mp3`～`00065.mp3` |
| `dongshan_audio/generate_bgm.py` | 用 MIDIUtil 產生各主題 MIDI → FluidSynth 轉 WAV → `apply_pedalboard.py` 加效果 → FFmpeg 轉 MP3，輸出到 `bgm_mp3/`。FluidSynth 與音色庫路徑寫死為 `C:\fluidsynth\…`（Windows） |
| `dongshan_audio/apply_pedalboard.py` | 依主題套用 Pedalboard 音效 |
| `dongshan_audio/mix_audio.py` | 用 FFmpeg 把語音與配樂混成 8 個故事檔，輸出到 `final_output/` |
| `dongshan_audio/run_all.py` | 依序執行上面三步（`--test` 參數會傳給各腳本） |
| `dongshan_audio/tts_audio/*.mp3` | 已產生的 65 個語音檔（00001 是開場白，00002～00065 是 8 主題 × 8 幕） |

`bgm_mp3/` 與 `final_output/` **沒有入庫**。

## 3. 網頁怎麼運作

| 部分 | 位置／名稱 | 說明 |
| --- | --- | --- |
| 調色盤 | `P`（約第 397 行） | 單字元色碼，例如 `'.'` 黑、`'G'` 亮綠、`'B'` 亮藍，與作者 LED 動畫工具的慣例相同 |
| 主題資料 | `THEMES`（約第 408 行） | 每個主題：`name`、`emoji`、`color`、`bgm`（配樂代號）、`titles[8]`、`texts[8]`、`files[8]`（語音檔號） |
| 燈板動畫 | `makeFrame()`、`setPixel()`、`drawRect()`、`drawSprite()`、`drawLine()`、`SPR`、`SCENE_GEN` | 每幀是 16 個 16 字元字串；`SCENE_GEN[主題][幕]` 產生該幕動畫 |
| 播放 | `preloadAndPlay(idx)`、`loadScene(idx)`、`playCurrent()`、`togglePlay()`、`nextScene()`、`prevScene()`、`stopStory()` | 語音 `audioTTS` 播完自動到下一幕 |
| 音效 | `playThemeSfx()`（Web Audio 合成） | 依主題與幕數加一點環境音效 |
| 音量 | `#volSlider`（語音）、`#bgmSlider`（配樂） | |

## 4. 已知問題與待辦

- ⚠️ **線上版找不到語音與配樂（已用本機伺服器重現 404）**：
  - 網頁讀 `tts_audio/00002.mp3`（相對於網頁所在資料夾），但檔案在 `dongshan_audio/tts_audio/`。
  - 網頁讀 `bgm_mp3/bgm_train.mp3` 等配樂，但倉庫裡沒有 `bgm_mp3/`。
  - 結果：GitHub Pages 上只有文字、燈板動畫與合成音效，**沒有旁白與配樂**。
  - 修正選項（擇一，需作者決定）：(a) 把網頁裡的路徑改成 `dongshan_audio/tts_audio/…`；(b) 把 `tts_audio/` 與產生好的 `bgm_mp3/` 移到倉庫根目錄。配樂需先執行 `generate_bgm.py` 產生（需要 MIDI 合成與 Pedalboard 環境），或從作者電腦補上傳。
- `final_output/` 的混音檔網頁沒有使用，可能是給實體裝置或其他播放器用，用途待確認。
- 實體燈板（LED 矩陣尺寸、走線、控制板）的規格不在此倉庫；網頁動畫是 16×16，若實體尺寸不同需要轉換。
- `tts_audio/00001.mp3`（開場白）網頁沒有用到。

## 5. 重新產生音訊

```bash
cd dongshan_audio
pip install edge-tts MIDIUtil pedalboard soundfile
python run_all.py          # 或加 --test 先跑少量
```

需要網路（edge-tts）、FFmpeg，以及 FluidSynth＋`FluidR3_GM.sf2`（路徑在 `generate_bgm.py` 開頭）。Windows 終端機的 UTF-8 設定已寫在腳本內。改故事文字時要同時改 `generate_story_audio.py` 與 `index.html` 的 `THEMES.texts`，兩邊目前各存一份。

## 6. 測試方式

用本機伺服器開（`python3 -m http.server`），點主題卡片進入播放頁；開發者工具的 Network 可看到語音與配樂是否 404。自動化測試可讀 `audioTTS.src`、`audioBGM.src`、`curThemeId`、`curScene`。

## 7. 版本沿革

- 2026-02-21：經 EZPage 部署。
- 2026-10-17：Codex 管理整理（代號 P013、AI 入口文件）。
- 2026-10-18：Claude 補寫本交接，記錄音訊路徑問題。
- 2026-10-21：Claude 新增 `motion-games/`（使用者上傳的兩款 3D 體感遊戲改版、MotionKit v2、DualScreenKit、UIIcons、測試台、範本）。

## 8. motion-games：3D 體感遊戲與共用模組（2026-10-21 新增）

來源：使用者上傳的 `files_6.zip`（`3d__9_optimized.html`、`3d__10_optimized.html`、`motion-kit.js` v1）。原檔先以提交 `c05afa4` 原樣入庫作為比對基準，之後的提交才是改版。內容與冬山導覽無關，只是放在本倉庫的子資料夾，`index.html`（Pages 入口）沒有改動。

| 路徑 | 內容 |
| --- | --- |
| `motion-games/3d-09-dragon-lion.html` | 舞龍舞獅：夜空穹頂與星月、擺動聚光燈、福字地毯、鱗片金龍（龍鬚、爪、火焰鰭）、燈籠光暈、帶狀光棒拖尾、升空式煙火（含愛心煙火）、金箔飄落；介面改線條圖示；體感分級；雙視窗改用 DualScreenKit |
| `motion-games/3d-10-slow-jog.html` | 超慢跑：卡通著色角色、腳下柔影、速度線、日月光暈、光澤題目徽章與看板、能量簾幕拱門、柔光粒子；資訊座艙改由狀態渲染（`renderAll()`），彈出視窗鏡像同步；容器查詢自動換排 |
| `motion-games/motion-kit.js` | MotionKit v2：分級 `quick/hands/run/body/advanced`；新增愛心、Y 字、交叉、舉手、指向、傾斜、鞠躬、點頭、搖頭、跑步狀態；進階分級用 MediaPipe Holistic 辨識手指手勢與張嘴；自訂規則、連續動作、錄製姿勢、鍵盤模擬、有人站上/離開、ROI、鏡頭斷線重連 |
| `motion-games/dual-screen-kit.js` | DualScreenKit v1：並排/浮動/僅舞台/僅資訊、彈出視窗（記住位置）、送到副螢幕（Window Management API）、全螢幕、資訊字體 70–300%（每種版面分開記、可遙控）、主控/鏡像同步 |
| `motion-games/ui-icons.js` | 線條圖示，取代 Font Awesome 與按鈕表情符號 |
| `motion-games/motion-lab.html`、`game-template.html`、`index.html` | 測試台、新遊戲範本、入口 |
| `motion-games/docs/` | `MOTION_KIT_SPEC.md`、`DUAL_SCREEN_SPEC.md` |
| `motion-games/tests/` | `motion-kit.test.js`（32 項）、`smoke.js`（18 項） |

設計重點（決策另記於 docs/DECISIONS.md）：有舞台的視窗是主控端，資訊視窗只鏡像；所有按鈕、鍵盤、鏡頭動作都經 `ds.command()` 交給主控端；鏡頭可以開在任一視窗。

驗證（2026-10-22，無頭 Chromium、swiftshader、假鏡頭）：

- `node motion-games/tests/motion-kit.test.js`：32／32 通過（合成骨架與手部座標）。
- `node motion-games/tests/smoke.js`：18／18 通過；三個遊戲頁都驗證了彈出視窗版面、從彈出視窗按鈕計分並同步、遙控字體 1.4→1.6、關閉後還原、浮動版面，全程無 JS 錯誤。
- 假鏡頭開啟：quick（Pose）、advanced（Holistic＋校正精靈）、run（超慢跑）都能載入模型並處理影格，無錯誤。

限制與下一步：

- 未做真人測試：各動作門檻（愛心、鞠躬、點頭、手指手勢）只用合成資料驗證過，需要在展場光線與距離下用 `motion-lab.html` 實測再調 `thresholds`。
- 未在真實雙螢幕上測「送到副螢幕」；該功能只在 Chrome / Edge 有效，其他瀏覽器退回手動拖曳。
- 進階分級（Holistic）較耗效能，需在展場電腦實測 FPS。
- 依賴 CDN（Tailwind、three.js r128、MediaPipe、Google Fonts）；離線展場需另外把這些檔案下載到本機。
- 無頭瀏覽器的背景分頁計時器會暫停，`smoke.js` 因此在關閉彈出視窗後先把主視窗帶到前景；真實瀏覽器不受影響。

## 版本定位

基準 SHA 定位本次文件修改前的程式；本次文件提交由此檔所在的 Git 提交與倉庫歷史定位，不預填同一提交自己的 SHA。
