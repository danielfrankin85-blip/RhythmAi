"""
Audio file converter for Guitar Hero game
Converts MP3 files to a standard format that Web Audio API can decode
Requires: ffmpeg

Download ffmpeg from: https://ffmpeg.org/download.html
Add ffmpeg to your PATH or place ffmpeg.exe in the same directory as this script
"""

import os
import sys
import subprocess
from pathlib import Path

def convert_audio_file(input_path, output_path):
    """Convert audio to standard MP3 format (44.1kHz, stereo, 192kbps CBR)"""
    print(f"Converting: {input_path.name}")
    try:
        # Use ffmpeg to convert
        cmd = [
            "ffmpeg.exe",
            "-i", str(input_path),
            "-ar", "44100",  # Sample rate 44.1kHz
            "-ac", "2",      # Stereo
            "-b:a", "192k",  # Bitrate
            "-y",            # Overwrite output
            str(output_path)
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            print(f"  ✓ Converted successfully")
            return True
        else:
            print(f"  ✗ ffmpeg error: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"  ✗ Conversion timed out")
        return False
    except FileNotFoundError:
        print(f"  ✗ ffmpeg not found. Make sure ffmpeg.exe is in your PATH or in the current directory")
        return False
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False

def main():
    music_dir = Path("music")
    output_dir = Path("public/music")
    
    if not music_dir.exists():
        print(f"ERROR: {music_dir} directory not found")
        sys.exit(1)
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Find all MP3 files
    mp3_files = list(music_dir.glob("*.mp3"))
    
    if not mp3_files:
        print(f"No MP3 files found in {music_dir}")
        sys.exit(1)
    
    print(f"Found {len(mp3_files)} MP3 files\n")
    
    success_count = 0
    for mp3_file in mp3_files:
        output_path = output_dir / mp3_file.name
        if convert_audio_file(mp3_file, output_path):
            success_count += 1
    
    print(f"\n{'='*60}")
    print(f"Conversion complete: {success_count}/{len(mp3_files)} successful")
    print(f"{'='*60}")
    
    if success_count < len(mp3_files):
        print("\nSome files failed to convert. Check errors above.")
        sys.exit(1)

if __name__ == "__main__":
    main()
