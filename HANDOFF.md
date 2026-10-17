# Handoff — P013 冬山鄉探險隊・互動語音燈板導覽

- 更新時間：2026-10-18T03:25+08:00
- 更新者：Claude（逐檔讀原始碼，撰寫專案交接）
- 倉庫：https://github.com/jackeytw886/dongshan
- 分支：main
- 本次基準 SHA：`f89d6fb653f430cc803a72d198ca196c5c9e20f2`（Codex 管理整理提交）
- 核對層級：已讀網頁與音訊產生腳本；已執行語法檢查與無頭瀏覽器測試（見 docs/VERIFICATION.md）；**未重新執行 Python 音訊管線、未接實體燈板**。

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

## 版本定位

基準 SHA 定位本次文件修改前的程式；本次文件提交由此檔所在的 Git 提交與倉庫歷史定位，不預填同一提交自己的 SHA。
