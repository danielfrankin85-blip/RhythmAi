# Audio File Fix

## Problem
Some MP3 files can't be decoded by the browser's Web Audio API due to codec/encoding issues.

## Solution
Convert the MP3 files to a standard format using the provided script.

### Requirements
1. **Python** (already installed ✓)
2. **pydub** Python library (already installed ✓)  
3. **ffmpeg** - Download from: https://ffmpeg.org/download.html
   - For Windows: Download the "release essentials" build
   - Extract ffmpeg.exe to a folder (e.g., C:\ffmpeg\bin)
   - Add to PATH or place in the project folder

### Steps

1. **Install ffmpeg** (if not already installed):
   ```bash
   # Check if ffmpeg is installed
   ffmpeg -version
   ```
   
   If not found, download from https://ffmpeg.org/download.html

2. **Run the converter**:
   ```bash
   python convert_audio.py
   ```

3. **Refresh browser** at http://localhost:3000

The script will convert all MP3 files in the `music/` folder to a compatible format (44.1kHz, stereo, 192kbps CBR) and place them in `public/music/`.

## Alternative: Manual Conversion

If you can't install ffmpeg, you can manually convert files using online tools:
- https://cloudconvert.com/mp3-converter
- https://www.freeconvert.com/mp3-converter

Settings to use:
- Sample Rate: 44100 Hz (44.1 kHz)
- Channels: Stereo (2)
- Bitrate: 192 kbps (Constant Bit Rate)
