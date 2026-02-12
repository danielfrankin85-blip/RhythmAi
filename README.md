# Rhythm Game

A browser-based rhythm game with real-time audio analysis and procedural beatmap generation.

## Features

- 🎵 **Audio Analysis** – Loads local audio files and generates beatmaps using spectral flux analysis
- 🎮 **Canvas Rendering** – 60+ FPS smooth scrolling notes with neon visual effects
- 🎯 **Hit Detection** – Precise timing windows (Perfect: ±45ms, Good: ±100ms)
- 🏆 **Scoring System** – Combo multipliers, accuracy tracking, and detailed statistics
- 🎚️ **Difficulty Modes** – Easy, Medium, Hard with adaptive note density
- ⚡ **Performance** – Deterministic beatmap generation, zero unnecessary re-renders

## Tech Stack

- **React 18** – UI layer with functional components
- **TypeScript** – Full type safety
- **Web Audio API** – High-precision audio playback and analysis
- **Canvas 2D** – Hardware-accelerated rendering
- **Vite** – Fast development server and build tool

## Project Structure

```
src/
├── audio/              # Web Audio API wrapper (AudioEngine, BeatDetector, AudioAnalyzer)
├── beatmap/            # Beatmap generation from audio analysis
├── engine/             # Game engine (GameEngine, CanvasRenderer, InputManager, ScoreEngine)
├── components/         # React UI components
│   ├── Menu/          # Song selection, difficulty picker
│   └── Game/          # Scoreboard, combo display, progress bar
└── styles/            # Global CSS with dark/neon theme
```

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

1. Click **"Select Your Song"** or drag & drop an audio file (MP3, WAV, OGG, FLAC)
2. Choose difficulty: **Easy**, **Medium**, or **Hard**
3. Click **"Start Game"** – beatmap will be generated (may take 5-10 seconds)
4. Play using **D, F, J, K** keys when notes reach the target zone
5. Press **Escape** to pause/resume

## Controls

- **D, F, J, K** – Hit notes in lanes 1, 2, 3, 4
- **Escape** – Pause / Resume

## Architecture

### Audio Engine
- `AudioEngine.ts` – Playback control, timing authority via `audioContext.currentTime`
- `BeatDetector.ts` – Onset detection using spectral flux + adaptive thresholding
- `AudioAnalyzer.ts` – Real-time frequency/waveform analysis

### Beatmap Generator
- Deterministic: same audio + difficulty → identical beatmap every time
- Frequency band analysis → lane assignment (sub-bass, bass, mids, highs)
- Difficulty presets control note density, lane spread, chord generation

### Game Engine
- `GameEngine.ts` – Central orchestrator (note spawning, hit detection, scoring)
- `CanvasRenderer.ts` – Pure rendering (stateless draw calls)
- `InputManager.ts` – Keyboard input with precise timestamps
- `ScoreEngine.ts` – Hit judgment, combo multipliers, accuracy calculation

### Performance Strategy
- **No inline styles** – All CSS is external and cacheable
- **Memoized components** – `React.memo` prevents unnecessary re-renders
- **RAF game loop** – Decoupled from React render cycle
- **Single source of truth** – `audioContext.currentTime` for timing

## Scoring

| Judgment | Window    | Points | Accuracy Weight |
|----------|-----------|--------|-----------------|
| Perfect  | ±45ms     | 300    | 100%            |
| Good     | ±100ms    | 100    | 50%             |
| Miss     | Outside   | 0      | 0%              |

### Combo Multipliers

- **×1**: 0-9 combo
- **×2**: 10-29 combo
- **×4**: 30-59 combo
- **×8**: 60+ combo

## License

MIT
