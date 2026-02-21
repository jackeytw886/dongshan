"""
run_all.py — 冬山鄉探險隊：一鍵生成
"""

import subprocess
import sys
import os

# Windows 終端機 UTF-8 支援
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


SCRIPTS = [
    ("🎙️ 步驟 1/3：生成探險隊導覽語音 (TTS)", "generate_story_audio.py"),
    ("🎵 步驟 2/3：生成景點主題配樂 (BGM)", "generate_bgm.py"),
    ("🎧 步驟 3/3：混合最終音訊 (Mix)", "mix_audio.py"),
]


def main():
    test_flag = ["--test"] if "--test" in sys.argv else []
    script_dir = os.path.dirname(os.path.abspath(__file__))

    print("=" * 50)
    print("🏡 冬山鄉探險隊 — 音訊生成管線")
    print("=" * 50)

    for title, script in SCRIPTS:
        print(f"\n{'─' * 50}")
        print(f"{title}")
        print(f"{'─' * 50}")

        result = subprocess.run(
            [sys.executable, os.path.join(script_dir, script)] + test_flag,
            cwd=script_dir,
        )

        if result.returncode != 0:
            print(f"\n❌ {script} 執行失敗 (exit code: {result.returncode})")
            sys.exit(1)

    print(f"\n{'=' * 50}")
    print("🎉 全部完成！")
    print(f"   📁 TTS 語音:    tts_audio/")
    print(f"   📁 MIDI 檔案:   bgm_midi/")
    print(f"   📁 BGM 音訊:    bgm_mp3/")
    print(f"   📁 最終輸出:    final_output/")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
