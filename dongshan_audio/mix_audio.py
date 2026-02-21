
"""
mix_audio.py — 冬山鄉探險隊：音訊混合
"""

import os
import sys
import subprocess
import glob

# 設定
TTS_DIR = "tts_audio"
BGM_DIR = "bgm_mp3"
OUTPUT_DIR = "final_output"
FFMPEG_CMD = r"C:\ffmpeg\bin\ffmpeg.exe"

os.makedirs(OUTPUT_DIR, exist_ok=True)

THEMES = [
    # (ID, Name, StartFileIndex, EndFileIndex)
    ('train', '01_瓜棚火車站', 2, 9),
    ('river', '02_神秘河道', 10, 17),
    ('lake', '03_梅花湖', 18, 25),
    ('waterfall', '04_新寮瀑布', 26, 33),
    ('rice_field', '05_三奇美徑', 34, 41),
    ('farm', '06_宜農牧場', 42, 49),
    ('fire_water', '07_水火同源', 50, 57),
    ('forest', '08_仁山植物園', 58, 65)
]

def get_audio_duration(file_path):
    try:
        result = subprocess.run(
            [FFMPEG_CMD, '-i', file_path], 
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        # ffmpeg output goes to stderr
        for line in result.stderr.split('\n'):
            if "Duration" in line:
                # Duration: 00:00:05.12, ...
                time_str = line.split("Duration:")[1].split(",")[0].strip()
                h, m, s = time_str.split(':')
                return float(h)*3600 + float(m)*60 + float(s)
    except:
        return 0
    return 0

def mix_story(theme_id, output_name, start_idx, end_idx):
    print(f"  [{theme_id}] {output_name}")
    
    bgm_path = os.path.join(BGM_DIR, f"bgm_{theme_id}.mp3")
    if not os.path.exists(bgm_path):
        print(f"    [!] BGM not found: {bgm_path}")
        return

    # 1. 收集 TTS 檔案與長度
    tts_files = []
    for i in range(start_idx, end_idx + 1):
        fpath = os.path.join(TTS_DIR, f"{i:05d}.mp3")
        if os.path.exists(fpath):
            dur = get_audio_duration(fpath)
            tts_files.append((fpath, dur))
            print(f"    載入第 {i-start_idx+1} 幕: {os.path.basename(fpath)}")
        else:
            print(f"    [!] TTS 缺失: {fpath}")

    if not tts_files:
        return

    # 2. 建構 ffmpeg filter complex
    
    cmd_inputs = ['-i', bgm_path]
    for f, _ in tts_files:
        cmd_inputs.extend(['-i', f])

    # 串接 TTS (adelay)
    # 起始延遲 3000ms (3秒) 給特效
    current_delay = 3000 
    filter_parts = []
    
    # 每個 TTS 檔案對應 input index 1, 2, 3...
    for i, (fpath, dur) in enumerate(tts_files):
        idx = i + 1
        delay_ms = int(current_delay)
        # [1:a]adelay=3000|3000[s1]
        filter_parts.append(f"[{idx}:a]adelay={delay_ms}|{delay_ms}[s{i}]")
        
        # 下一句的延遲 = 當前延遲 + 語音長度 * 1000 + 1000ms 間隔
        current_delay += (dur * 1000) + 1000

    # 混合所有 TTS 軌道
    input_tags = "".join([f"[s{i}]" for i in range(len(tts_files))])
    filter_parts.append(f"{input_tags}amix=inputs={len(tts_files)}:duration=longest[voice]")

    # 混合 BGM (背景) 與 語音 (前景)
    # BGM 音量 0.25
    total_len_sec = (current_delay / 1000) + 4 # 多留 4 秒尾韻
    
    # BGM 淡入淡出處理
    filter_parts.append(f"[0:a]volume=0.25,afade=t=in:ss=0:d=2,afade=t=out:st={total_len_sec-2}:d=2[bgm_ready]")
    filter_parts.append(f"[bgm_ready][voice]amix=inputs=2:duration=first:weights=1 3[out]")

    filter_complex = ";".join(filter_parts)

    output_path = os.path.join(OUTPUT_DIR, f"{output_name}.mp3")
    
    cmd = [
        FFMPEG_CMD, '-y',
        *cmd_inputs,
        '-filter_complex', filter_complex,
        '-map', '[out]',
        '-t', str(total_len_sec), # 強制截斷
        output_path
    ]
    
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"    輸出: {output_path} (約 {total_len_sec:.1f}s)")
    except subprocess.CalledProcessError as e:
        print(f"    [!] 混合失敗: {e}")

def main():
    print("🎧 開始混合冬山故事音訊...")
    for item in THEMES:
        mix_story(item[0], item[1], item[2], item[3])
    
    print(f"\n✅ 完成！8 個故事檔案位於 {OUTPUT_DIR}/")

if __name__ == "__main__":
    main()
