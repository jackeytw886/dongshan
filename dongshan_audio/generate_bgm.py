
"""
generate_bgm.py — 冬山鄉探險隊：主題配樂生成器
"""

import os
import sys
import subprocess
import random
import time
from midiutil import MIDIFile

# 讓 Windows 終端機顯示 Emoji 正常
sys.stdout.reconfigure(encoding='utf-8')

# ════════════════════════════════════════════════════════════
# 1. 設定 & 常數
# ════════════════════════════════════════════════════════════

MIDI_DIR = "bgm_midi"
MP3_DIR  = "bgm_mp3"
DEFAULT_DURATION = 60  # 秒

# FluidSynth 設定 (請依實際路徑修改)
FLUIDSYNTH_CMD = r"C:\fluidsynth\bin\fluidsynth.exe"
SOUNDFONT_PATH = r"C:\fluidsynth\FluidR3_GM.sf2"
SAMPLE_RATE    = 44100

# ════════════════════════════════════════════════════════════
# 2. 音樂理論資料 (Scales & Chords)
# ════════════════════════════════════════════════════════════

SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10], 
    'pentatonic_major': [0, 2, 4, 7, 9],
    'pentatonic_minor': [0, 3, 5, 7, 10],
    'dorian': [0, 2, 3, 5, 7, 9, 10], # 神秘、古老
    'mixolydian': [0, 2, 4, 5, 7, 9, 10], # 快樂、鄉村
    'lydian': [0, 2, 4, 6, 7, 9, 11]      # 夢幻、漂浮
}

# 基礎和弦級數 (I, ii, iii, IV, V, vi)
CHORD_PROGRESSIONS = [
    [1, 5, 6, 4],  # Pop Punk / Axis
    [1, 4, 5, 1],  # Classic
    [1, 6, 2, 5],  # Jazz Turnaround
    [6, 4, 1, 5],  # Emotional
    [1, 5, 2, 6],  # Wandering
]

# ════════════════════════════════════════════════════════════
# 3. 主題定義 (冬山鄉 8 大景點)
# ════════════════════════════════════════════════════════════

THEMES = [
    {
        'id': 'train', 'name': '瓜棚火車站', 'emoji': '🚂',
        'bpm': 110, 'scale': 'major', 'key': 60, # C Major
        'progression': [1, 5, 6, 4],
        'instruments': [0, 11, 118], # Acoustic Grand, Vibraphone, Synth Drum
        'style': 'rhythmic' # 模仿火車行進節奏
    },
    {
        'id': 'river', 'name': '神秘河道', 'emoji': '🌊',
        'bpm': 75, 'scale': 'dorian', 'key': 62, # D Dorian
        'progression': [1, 4, 1, 5], 
        'instruments': [46, 101, 91], # Harp, Goblins (Pad), Choir
        'style': 'flowing' # 琶音流動
    },
    {
        'id': 'lake', 'name': '梅花湖', 'emoji': '🌺',
        'bpm': 65, 'scale': 'major', 'key': 65, # F Major
        'progression': [1, 6, 2, 5],
        'instruments': [73, 24, 48], # Flute, Acoustic Guitar, Strings
        'style': 'peaceful' # 慢速分解和弦
    },
    {
        'id': 'waterfall', 'name': '新寮瀑布', 'emoji': '💧',
        'bpm': 90, 'scale': 'mixolydian', 'key': 67, # G Mixolydian
        'progression': [1, 5, 1, 4],
        'instruments': [127, 47, 56], # Gunshot (Impact), Timpani, Trumpet
        'style': 'dynamic' # 強弱對比大
    },
    {
        'id': 'rice_field', 'name': '三奇美徑', 'emoji': '🌾',
        'bpm': 100, 'scale': 'pentatonic_major', 'key': 64, # E Pentatonic
        'progression': [1, 4, 5, 1],
        'instruments': [68, 75, 12], # Oboe, Pan Flute, Marimba
        'style': 'bouncy' # 輕快跳躍
    },
    {
        'id': 'farm', 'name': '宜農牧場', 'emoji': '🐑',
        'bpm': 120, 'scale': 'major', 'key': 60, # C Major
        'progression': [1, 4, 1, 5],
        'instruments': [108, 113, 14], # Kalimba, Agogo, Tubular Bells
        'style': 'playful' # 斷奏、可愛
    },
    {
        'id': 'fire_water', 'name': '水火同源', 'emoji': '🔥',
        'bpm': 60, 'scale': 'minor', 'key': 59, # B Minor (神秘)
        'progression': [6, 4, 1, 5],
        'instruments': [53, 95, 89], # Voice Oohs, Sweep Pad, Warm Pad
        'style': 'drone' # 長音鋪底
    },
    {
        'id': 'forest', 'name': '仁山植物園', 'emoji': '🌿',
        'bpm': 70, 'scale': 'lydian', 'key': 69, # A Lydian (夢幻)
        'progression': [1, 2, 1, 5],
        'instruments': [46, 73, 49], # Harp, Flute, Slow Strings
        'style': 'magical' # 豎琴琶音 + 長笛旋律
    }
]

# ════════════════════════════════════════════════════════════
# 4. MIDI 生成邏輯
# ════════════════════════════════════════════════════════════

def get_chord_notes(root, scale_type, degree):
    # 簡化版和弦生成：三和弦
    # degree 是級數 1~7
    scale_intervals = SCALES[scale_type]
    
    # 找出該級數在音階中的索引
    idx = degree - 1
    
    # 根音、三度、五度 (在音階陣列中取模循環)
    i1 = idx
    i3 = (idx + 2) % len(scale_intervals)
    i5 = (idx + 4) % len(scale_intervals)
    
    n1 = root + scale_intervals[i1]
    n3 = root + scale_intervals[i3]
    # 如果跨越八度需加 12
    if i3 < i1: n3 += 12
        
    n5 = root + scale_intervals[i5]
    if i5 < i1: n5 += 12
        
    return [n1, n3, n5]

def gen_note_events(theme, duration_sec):
    events = []
    bpm = theme['bpm']
    beat_dur = 60.0 / bpm
    total_beats = int(duration_sec / beat_dur)
    
    scale_type = theme['scale']
    root_key = theme['key']
    progression = theme['progression']
    style = theme.get('style', 'chord')
    
    # 配器
    instr_melody = theme['instruments'][0]
    instr_harmony = theme['instruments'][1]
    instr_bass = theme['instruments'][2]

    # 設定樂器 (Program Change)
    events.append({'t': 0, 'type': 'program', 'ch': 0, 'val': instr_melody})
    events.append({'t': 0, 'type': 'program', 'ch': 1, 'val': instr_harmony})
    events.append({'t': 0, 'type': 'program', 'ch': 2, 'val': instr_bass})

    # 生成循環
    current_beat = 0
    prog_idx = 0
    
    while current_beat < total_beats:
        degree = progression[prog_idx % len(progression)]
        chord_notes = get_chord_notes(root_key, scale_type, degree)
        
        # Bass (Channel 2) - 根音長音
        bass_note = chord_notes[0] - 12 # 低八度
        events.append({'t': current_beat, 'dur': 4, 'note': bass_note, 'vel': 90, 'ch': 2})

        # Harmony (Channel 1) - 根據風格
        if style == 'rhythmic':
            # 每拍一下
            for b in range(4):
                for n in chord_notes:
                    events.append({'t': current_beat + b, 'dur': 0.5, 'note': n, 'vel': 70, 'ch': 1})
        elif style == 'flowing':
            # 琶音
            pat = [0, 1, 2, 1] # 根-三-五-三
            for b in range(4):
                n = chord_notes[pat[b]]
                events.append({'t': current_beat + b, 'dur': 1, 'note': n, 'vel': 75, 'ch': 1})
        elif style == 'drone':
             # 長和弦
             for n in chord_notes:
                 events.append({'t': current_beat, 'dur': 4, 'note': n, 'vel': 60, 'ch': 1})
        else:
             # Default: 柱狀和弦每兩拍
             for n in chord_notes:
                 events.append({'t': current_beat, 'dur': 2, 'note': n, 'vel': 70, 'ch': 1})
                 events.append({'t': current_beat + 2, 'dur': 2, 'note': n, 'vel': 70, 'ch': 1})

        # Melody (Channel 0) - 隨機漫步
        # 在和弦音與音階音中隨機
        scale_intervals = SCALES[scale_type]
        scale_notes = [root_key + i for i in scale_intervals] + [root_key + i + 12 for i in scale_intervals]
        
        # 簡單旋律生成邏輯
        num_notes = 4 if style in ['rhythmic', 'bouncy'] else 2
        for i in range(num_notes):
            step = 4 / num_notes
            if random.random() > 0.3: # 70% 機率有音符
                note = random.choice(scale_notes)
                # 傾向選和弦內音
                if random.random() > 0.5:
                    note = random.choice(chord_notes) + (12 if random.random()>0.5 else 0)
                
                dur = step * (random.choice([0.5, 1.0]))
                vel = random.randint(80, 110)
                events.append({'t': current_beat + (i*step), 'dur': dur, 'note': note, 'vel': vel, 'ch': 0})

        current_beat += 4
        prog_idx += 1
        
    return events

def events_to_midi(events, theme, filename):
    mid = MIDIFile(3) # 3 tracks
    bpm = theme['bpm']
    
    mid.addTempo(0, 0, bpm)
    
    for e in events:
        if e['type'] == 'program':
            mid.addProgramChange(e['ch'], e['ch'], e['t'], e['val'])
        else:
            mid.addNote(e['ch'], e['ch'], e['note'], e['t'], e['dur'], e['vel'])
            
    with open(filename, "wb") as output_file:
        mid.writeFile(output_file)

# ════════════════════════════════════════════════════════════
# 5. 渲染與轉檔
# ════════════════════════════════════════════════════════════

def midi_to_wav_fluidsynth(midi_path, wav_path):
    if not os.path.exists(FLUIDSYNTH_CMD):
        return False
    
    cmd = [
        FLUIDSYNTH_CMD, '-ni', SOUNDFONT_PATH, midi_path,
        '-F', wav_path, '-r', str(SAMPLE_RATE), '-g', '1.0'
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except:
        return False

def call_pedalboard_script(theme_id, input_wav, output_wav):
    # 呼叫外部 script: apply_pedalboard.py <theme> <in> <out>
    cmd = [sys.executable, "apply_pedalboard.py", theme_id, input_wav, output_wav]
    try:
        subprocess.run(cmd, check=True)
        return True
    except Exception as e:
        print(f"    [!] Pedalboard 失敗: {e}")
        return False

def wav_to_mp3(wav_path, mp3_path):
    # FFMPEG is assumed in path or we just use wav
    # For this task, let's keep it as wav if ffmpeg fails, or simple copy
    # But user wants mp3 usually.
    cmd = ['ffmpeg', '-y', '-i', wav_path, '-b:a', '192k', mp3_path]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except:
        return False

def main():
    os.makedirs(MIDI_DIR, exist_ok=True)
    os.makedirs(MP3_DIR, exist_ok=True)
    
    print("🎵 開始生成冬山主題配樂...")
    
    import tempfile
    
    for theme in THEMES:
        tid = theme['id']
        name = theme['name']
        print(f"\n  [{tid}] {name} {theme['emoji']}")
        
        # 1. MIDI
        midi_path = os.path.join(MIDI_DIR, f"bgm_{tid}.mid")
        events = gen_note_events(theme, DEFAULT_DURATION)
        events_to_midi(events, theme, midi_path)
        print(f"    MIDI Created: {midi_path}")
        
        # 2. Wav (Raw)
        raw_wav = os.path.join(MIDI_DIR, f"raw_{tid}.wav") # Temp
        if midi_to_wav_fluidsynth(midi_path, raw_wav):
            # 3. Apply Pedalboard FX -> Final Wav
            fx_wav = os.path.join(MIDI_DIR, f"fx_{tid}.wav") # Temp
            call_pedalboard_script(tid, raw_wav, fx_wav)
            
            # 4. MP3
            mp3_path = os.path.join(MP3_DIR, f"bgm_{tid}.mp3")
            wav_to_mp3(fx_wav, mp3_path)
            print(f"    MP3 Final: {mp3_path}")
            
            # Cleanup
            try:
                os.remove(raw_wav)
                os.remove(fx_wav)
            except: pass
            
        else:
            print("    [!] FluidSynth not found, skipping synthesis.")
            
    print("\n✅ BGM 生成完成！")

if __name__ == "__main__":
    main()
