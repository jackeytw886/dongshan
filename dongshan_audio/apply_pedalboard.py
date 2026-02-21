"""
apply_pedalboard.py
"""
import sys
import os
import soundfile as sf
from pedalboard import (
    Pedalboard, Reverb, Delay, Chorus, Distortion, 
    HighpassFilter, LowpassFilter, Gain, Compressor, Limiter
)

def apply_fx(theme_name, input_wav, output_wav):
    print(f"    Applying Pedalboard EFX ({theme_name})...")
    
    try:
        audio, sample_rate = sf.read(input_wav)
        
        # 1. 瓜棚火車站 (Train) - 寬廣、機械感、回音
        if theme_name == 'train':
            board = Pedalboard([
                Compressor(threshold_db=-10, ratio=2.5),
                Delay(delay_seconds=0.25, feedback=0.3, mix=0.2), # 營造車站大廳回音
                Reverb(room_size=0.6, wet_level=0.3),
                Limiter(threshold_db=-1.0)
            ])

        # 2. 神秘河道 (River) - 濕潤、洞穴感、流動
        elif theme_name == 'river':
            board = Pedalboard([
                HighpassFilter(cutoff_frequency_hz=150), # 去除低頻雜訊
                Chorus(rate_hz=1.5, depth=0.3, mix=0.4), # 水波感
                Reverb(room_size=0.8, damping=0.2, wet_level=0.5), # 洞穴大殘響
                Gain(gain_db=-2.0)
            ])

        # 3. 梅花湖 (Lake) - 清澈、平靜、開闊
        elif theme_name == 'lake':
            board = Pedalboard([
                Compressor(threshold_db=-12, ratio=2.0),
                Reverb(room_size=0.4, wet_level=0.25), # 自然空間
                Gain(gain_db=-1.0)
            ])
            
        # 4. 新寮瀑布 (Waterfall) - 轟鳴、濕氣、力量
        elif theme_name == 'waterfall':
            board = Pedalboard([
                LowpassFilter(cutoff_frequency_hz=8000), # 柔化高頻刺耳聲
                Reverb(room_size=0.9, wet_level=0.6),    # 巨大空間感
                Compressor(threshold_db=-8, ratio=3.0),  # 壓制動態
                Limiter(threshold_db=-0.5)
            ])

        # 5. 三奇美徑 (RiceField) - 輕快、風聲、乾燥
        elif theme_name == 'rice_field':
            board = Pedalboard([
                HighpassFilter(cutoff_frequency_hz=100),
                Chorus(rate_hz=0.8, depth=0.15, mix=0.2), # 微風感
                Reverb(room_size=0.3, wet_level=0.15),    # 開放空間
                Gain(gain_db=0.0)
            ])

        # 6. 宜農牧場 (Farm) - 溫暖、親切、小空間
        elif theme_name == 'farm':
            board = Pedalboard([
                Compressor(threshold_db=-10, ratio=2.0),
                Reverb(room_size=0.2, wet_level=0.15), # 小木屋空間
                Gain(gain_db=1.0) # 稍微大聲一點
            ])

        # 7. 水火同源 (FireWater) - 神秘、溫暖、共振
        elif theme_name == 'fire_water':
            board = Pedalboard([
                Delay(delay_seconds=0.4, feedback=0.4, mix=0.3), # 傳說的回音
                Reverb(room_size=0.7, wet_level=0.4),
                LowpassFilter(cutoff_frequency_hz=6000), # 溫暖火光
                Limiter(threshold_db=-1.0)
            ])

        # 8. 仁山植物園 (Forest) - 夢幻、精靈、空氣感
        elif theme_name == 'forest':
            board = Pedalboard([
                HighpassFilter(cutoff_frequency_hz=200),
                Chorus(rate_hz=2.0, depth=0.25, mix=0.3), # 精靈飛舞感
                Delay(delay_seconds=0.5, feedback=0.2, mix=0.2),
                Reverb(room_size=0.85, width=1.0, wet_level=0.5), # 森林深處
                Gain(gain_db=-2.0)
            ])
            
        else:
            # Default
            board = Pedalboard([Reverb(room_size=0.5)])

        # Apply output
        effected = board(audio, sample_rate)
        sf.write(output_wav, effected, sample_rate)
        print("    Effects applied successfully")

    except Exception as e:
        print(f"    [!] Error applying effects: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python apply_pedalboard.py <theme> <input_wav> <output_wav>")
    else:
        apply_fx(sys.argv[1], sys.argv[2], sys.argv[3])
