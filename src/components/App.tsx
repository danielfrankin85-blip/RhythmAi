import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { BeatmapGenerator, type Difficulty, type GeneratedBeatmap } from '../beatmap/BeatmapGenerator';
import { GameEngine, GameEvent, TargetFPS, type ScoreState, HitJudgment, type PerfectHitSound } from '../engine/GameEngine';
import { SongSelect } from './Menu/SongSelect';
import { Settings } from './Menu/Settings';
import { GameUI } from './Game/GameUI';
import { GameOver } from './Game/GameOver';
import { MultiplayerLobby } from './Menu/MultiplayerLobby';
import { MultiplayerWaitingRoom } from './Menu/MultiplayerWaitingRoom';
import { MultiplayerHUD } from './Game/MultiplayerHUD';
import { MultiplayerResults } from './Game/MultiplayerResults';
import { MultiplayerManager, type SongInfo, type PlayerScore, type LobbyState } from '../multiplayer/MultiplayerManager';
import '../styles/global.css';
import '../styles/components.css';

type AppState = 'menu' | 'loading' | 'playing' | 'game-over' | 'mp-lobby' | 'mp-waiting';

const PERFECT_HIT_SOUND_OPTIONS: PerfectHitSound[] = ['bass', 'guitar', 'drum', 'trumpet', 'synth'];

interface SongBestRecord {
  songId: string;
  songName: string;
  bestScore: number;
  bestAccuracy: number;
}

interface SongRunRecord {
  score: number;
  accuracy: number;
  maxCombo: number;
  playedAt: number;
}

const INITIAL_SCORE: ScoreState = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  multiplier: 1,
  judgments: { perfect: 0, good: 0, miss: 0 },
  accuracy: 100,
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const gameEngineRef = useRef<GameEngine | null>(null);

  const [appState, setAppState] = useState<AppState>('menu');
  const [isLoadingBeatmap, setIsLoadingBeatmap] = useState(false);
  const [beatmapProgress, setBeatmapProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [currentFPS, setCurrentFPS] = useState<TargetFPS>(TargetFPS.FPS_100);
  const [musicVolume, setMusicVolume] = useState<number>(() => {
    const saved = localStorage.getItem('musicVolume');
    return saved ? Number(saved) : 0.7;
  });
  const [sfxVolume, setSfxVolume] = useState<number>(() => {
    const saved = localStorage.getItem('sfxVolume');
    return saved ? Number(saved) : 0.8;
  });
  const [perfectHitSound, setPerfectHitSound] = useState<PerfectHitSound>(() => {
    const saved = localStorage.getItem('perfectHitSound');
    if (saved && PERFECT_HIT_SOUND_OPTIONS.includes(saved as PerfectHitSound)) {
      return saved as PerfectHitSound;
    }
    return 'bass';
  });
  const [missDipEnabled, setMissDipEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('missDipEnabled');
    return saved === null ? true : saved === 'true';
  });
  const [keyBindings, setKeyBindings] = useState<string[]>(() => {
    const saved = localStorage.getItem('keyBindings');
    return saved ? JSON.parse(saved) : ['d', 'f', 'j', 'k'];
  });

  const [score, setScore] = useState<ScoreState>({ ...INITIAL_SCORE });
  const [progress, setProgress] = useState(0);
  const [lastJudgment, setLastJudgment] = useState<HitJudgment | 'miss' | null>(null);
  const [judgmentKey, setJudgmentKey] = useState(0);
  const [lastPoints, setLastPoints] = useState(0);
  const [lastMultiplier, setLastMultiplier] = useState(1);
  const [currentSongName, setCurrentSongName] = useState('');
  const [currentSongId, setCurrentSongId] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [songBestRecords, setSongBestRecords] = useState<Record<string, SongBestRecord>>(() => {
    try {
      const raw = localStorage.getItem('songBestRecords');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [songRunHistory, setSongRunHistory] = useState<Record<string, SongRunRecord[]>>(() => {
    try {
      const raw = localStorage.getItem('songRunHistory');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const scoreRef = useRef<ScoreState>(score);
  const progressRef = useRef<number>(0);
  const currentSongRef = useRef<{ file: File; difficulty: Difficulty; beatmap: GeneratedBeatmap; songId: string; songName: string } | null>(null);
  const currentSongMetaRef = useRef<{ songId: string; songName: string } | null>(null);
  const uiIntervalRef = useRef<number | null>(null);

  // ── Multiplayer state ──────────────────────────────────────────────────
  const mpManagerRef = useRef<MultiplayerManager | null>(null);
  const [mpLobbyState, setMpLobbyState] = useState<LobbyState>('idle');
  const [mpRoomCode, setMpRoomCode] = useState('');
  const [mpRole, setMpRole] = useState<'host' | 'guest'>('host');
  const [mpOpponentConnected, setMpOpponentConnected] = useState(false);
  const [mpSongInfo, setMpSongInfo] = useState<SongInfo | null>(null);
  const [mpOpponentScore, setMpOpponentScore] = useState<PlayerScore | null>(null);
  const [mpConnecting, setMpConnecting] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [mpActive, setMpActive] = useState(false);
  const [mpMyFinalScore, setMpMyFinalScore] = useState<PlayerScore | null>(null);
  const [mpOpponentFinalScore, setMpOpponentFinalScore] = useState<PlayerScore | null>(null);
  const mpSongFileRef = useRef<File | null>(null);
  const mpDifficultyRef = useRef<Difficulty>('medium');
  const appStateRef = useRef<AppState>(appState);
  const handleStartGameRef = useRef<((file: File, difficulty: Difficulty, songId: string, songName: string) => void) | null>(null);

  useEffect(() => {
    localStorage.setItem('songBestRecords', JSON.stringify(songBestRecords));
  }, [songBestRecords]);

  useEffect(() => {
    localStorage.setItem('songRunHistory', JSON.stringify(songRunHistory));
  }, [songRunHistory]);

  // ── Helper: attach event listeners to a game engine ────────────────────
  const attachListeners = useCallback((engine: GameEngine) => {
    engine.on(GameEvent.SCORE_UPDATE, (payload: unknown) => {
      const { score } = payload as { score: ScoreState };
      // Deep-copy so React sees a new reference on every update
      scoreRef.current = { ...score, judgments: { ...score.judgments } };
      // Sync score to multiplayer opponent if active
      if (mpManagerRef.current && mpManagerRef.current.getState() === 'playing') {
        mpManagerRef.current.updateScore({
          score: score.score,
          combo: score.combo,
          maxCombo: score.maxCombo,
          accuracy: score.accuracy,
          judgments: { ...score.judgments },
        });
      }
    });

    engine.on(GameEvent.NOTE_HIT, (payload: unknown) => {
      const { judgment, points, multiplier } = payload as { judgment: HitJudgment; points: number; multiplier: number };
      // Update all states in a batch to ensure they're synced
      setJudgmentKey((k) => {
        const newKey = k + 1;
        // Use the new key to ensure we're showing latest data
        setLastJudgment(judgment);
        setLastPoints(points);
        setLastMultiplier(multiplier);
        return newKey;
      });
    });

    engine.on(GameEvent.NOTE_MISS, () => {
      setJudgmentKey((k) => {
        const newKey = k + 1;
        setLastJudgment('miss');
        setLastPoints(-50);
        setLastMultiplier(0);
        return newKey;
      });
    });

    engine.on(GameEvent.STATE_CHANGE, (payload: unknown) => {
      const { next } = payload as { next: string };
      setIsPaused(next === 'paused');
    });

    engine.on(GameEvent.GAME_OVER, (payload: unknown) => {
      const { score } = payload as { score: ScoreState };
      const copy = { ...score, judgments: { ...score.judgments } };
      scoreRef.current = copy;
      setScore(copy);
      const meta = currentSongMetaRef.current;
      if (meta) {
        setSongRunHistory((prev) => {
          const runs = prev[meta.songId] ?? [];
          const updatedRuns = [
            {
              score: copy.score,
              accuracy: copy.accuracy,
              maxCombo: copy.maxCombo,
              playedAt: Date.now(),
            },
            ...runs,
          ]
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
              return b.playedAt - a.playedAt;
            })
            .slice(0, 10);

          return {
            ...prev,
            [meta.songId]: updatedRuns,
          };
        });

        setSongBestRecords((prev) => {
          const existing = prev[meta.songId];
          const isBetter =
            !existing ||
            copy.score > existing.bestScore ||
            (copy.score === existing.bestScore && copy.accuracy > existing.bestAccuracy);

          if (!isBetter) return prev;

          return {
            ...prev,
            [meta.songId]: {
              songId: meta.songId,
              songName: meta.songName,
              bestScore: copy.score,
              bestAccuracy: copy.accuracy,
            },
          };
        });
      }
      setIsPaused(false);
      // If multiplayer, signal finish and store final score
      if (mpManagerRef.current && mpManagerRef.current.getState() === 'playing') {
        const finalPs: PlayerScore = {
          score: copy.score,
          combo: copy.combo,
          maxCombo: copy.maxCombo,
          accuracy: copy.accuracy,
          judgments: { ...copy.judgments },
        };
        setMpMyFinalScore(finalPs);
        mpManagerRef.current.finishGame(finalPs);
      }
      setAppState('game-over');
    });
  }, []);

  // ── Helper: create a fresh GameEngine (needs canvas to be mounted) ─────
  const createGameEngine = useCallback((audioEngine: AudioEngine): GameEngine | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Canvas sizing happens later when visible (after appState='playing')
    const engine = new GameEngine(canvas, audioEngine, {
      laneCount: 4,
      scrollSpeed: 800,
      keyBindings: keyBindings,
      hitWindow: { perfect: 0.08, good: 0.16 },
      targetFPS: currentFPS,
    });
    attachListeners(engine);
    return engine;
  }, [attachListeners, currentFPS, keyBindings]);

  // ── Start batched UI updates ───────────────────────────────────────────
  const startUIUpdates = useCallback((audioEngine: AudioEngine) => {
    if (uiIntervalRef.current !== null) cancelAnimationFrame(uiIntervalRef.current);

    const tick = () => {
      if (audioEngine.getDuration() > 0) {
        const currentTime = audioEngine.getCurrentTime();
        const p = currentTime / audioEngine.getDuration();
        progressRef.current = p;
        setProgress(p);
        // Always spread to create a new reference so React re-renders
        const s = scoreRef.current;
        setScore({ ...s, judgments: { ...s.judgments } });
      }
      uiIntervalRef.current = requestAnimationFrame(tick);
    };
    uiIntervalRef.current = requestAnimationFrame(tick);
  }, []);

  const stopUIUpdates = useCallback(() => {
    if (uiIntervalRef.current !== null) {
      cancelAnimationFrame(uiIntervalRef.current);
      uiIntervalRef.current = null;
    }
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopUIUpdates();
      gameEngineRef.current?.dispose();
      void audioEngineRef.current?.dispose();
    };
  }, [stopUIUpdates]);

  // ── Handle canvas resize ──────────────────────────────────────────────
  useEffect(() => {
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (canvasRef.current) {
          const rect = canvasRef.current.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          canvasRef.current.width = rect.width * dpr;
          canvasRef.current.height = rect.height * dpr;
        }
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // ── Start Game ─────────────────────────────────────────────────────────
  const handleStartGame = useCallback(async (file: File, difficulty: Difficulty, songId: string, songName: string) => {
    try {
      setIsLoadingBeatmap(true);
      setBeatmapProgress(0);
      setCurrentSongName(songName);
      setCurrentSongId(songId);
      currentSongMetaRef.current = { songId, songName };
      setIsPaused(false);
      setAppState('loading');

      // Create AudioEngine if needed
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine({ audioOffset: 0, volume: musicVolume });
      }
      const audioEngine = audioEngineRef.current;
      audioEngine.setVolume(musicVolume);

      // Load audio file
      await audioEngine.load(file);
      setBeatmapProgress(5);

      const audioBuffer = audioEngine.getAudioBuffer();
      if (!audioBuffer) throw new Error('Failed to load audio buffer');

      // Generate beatmap
      const generator = new BeatmapGenerator({ laneCount: 4 });
      const beatmap = generator.generate(audioBuffer, difficulty, (p) => {
        setBeatmapProgress(p);
      });

      // Store for restart
      currentSongRef.current = { file, difficulty, beatmap, songId, songName };

      // Dispose old game engine if any
      gameEngineRef.current?.dispose();

      // Create new game engine (canvas is always mounted now)
      const gameEngine = createGameEngine(audioEngine);
      if (!gameEngine) throw new Error('Canvas not available');
      gameEngineRef.current = gameEngine;
      gameEngine.setMusicVolume(musicVolume);
      gameEngine.setSfxVolume(sfxVolume);
      gameEngine.setPerfectHitSound(perfectHitSound);
      gameEngine.setMissDipEnabled(missDipEnabled);

      // Load beatmap
      gameEngine.loadBeatmap(beatmap.notes);

      // Reset UI
      setScore({ ...INITIAL_SCORE });
      setProgress(0);
      setLastJudgment(null);

      // Start playback
      await audioEngine.play();
      gameEngine.start();
      startUIUpdates(audioEngine);
      // Start multiplayer score sync if in MP mode
      if (mpManagerRef.current && mpActive) {
        mpManagerRef.current.startScoreSync();
      }
      setAppState('playing');
      
      // Resize canvas now that it's visible
      setTimeout(() => gameEngine.resize(), 0);
    } catch (err) {
      console.error('Failed to start game:', err);
      const errorMsg = (err as Error).message;
      if (errorMsg.includes('decode') || errorMsg.includes('audio') || errorMsg.includes('codec')) {
        alert('⚠️ Unable to decode this audio file.\n\nThe file may use an unsupported codec. To fix:\n\n1. Install: pip install pydub\n2. Download ffmpeg from ffmpeg.org\n3. Run: python convert_audio.py\n\nThis will convert all songs to a compatible format.\n\nThen refresh the browser.');
      } else {
        alert(`Error: ${errorMsg}`);
      }
      setAppState('menu');
    } finally {
      setIsLoadingBeatmap(false);
    }
  }, [createGameEngine, missDipEnabled, musicVolume, perfectHitSound, sfxVolume, startUIUpdates]);

  // ── Restart ────────────────────────────────────────────────────────────
  const handleRestart = useCallback(async () => {
    const current = currentSongRef.current;
    if (!current) {
      setAppState('menu');
      return;
    }

    const audioEngine = audioEngineRef.current;
    if (!audioEngine) return;

    try {
      // Stop current
      audioEngine.stop();
      gameEngineRef.current?.dispose();

      // Create fresh engine
      const gameEngine = createGameEngine(audioEngine);
      if (!gameEngine) throw new Error('Canvas not available');
      gameEngineRef.current = gameEngine;
      gameEngine.setMusicVolume(musicVolume);
      gameEngine.setSfxVolume(sfxVolume);
      gameEngine.setPerfectHitSound(perfectHitSound);
      gameEngine.setMissDipEnabled(missDipEnabled);

      // Load beatmap
      gameEngine.loadBeatmap(current.beatmap.notes);

      // Reset UI
      setScore({ ...INITIAL_SCORE });
      setProgress(0);
      setLastJudgment(null);
      setCurrentSongName(current.songName);
      setCurrentSongId(current.songId);
      currentSongMetaRef.current = { songId: current.songId, songName: current.songName };
      setIsPaused(false);

      // Start
      audioEngine.seek(0);
      await audioEngine.play();
      gameEngine.start();
      startUIUpdates(audioEngine);
      setAppState('playing');
      
      // Resize canvas now that it's visible
      setTimeout(() => gameEngine.resize(), 0);
    } catch (err) {
      console.error('Failed to restart:', err);
      setAppState('menu');
    }
  }, [createGameEngine, missDipEnabled, musicVolume, perfectHitSound, sfxVolume, startUIUpdates]);

  // ── Main Menu ──────────────────────────────────────────────────────────
  const handleMainMenu = useCallback(() => {
    stopUIUpdates();
    audioEngineRef.current?.stop();
    gameEngineRef.current?.dispose();
    gameEngineRef.current = null;
    currentSongRef.current = null;
    currentSongMetaRef.current = null;
    setCurrentSongId('');
    setIsPaused(false);
    setAppState('menu');
  }, [stopUIUpdates]);

  const handleFPSChange = useCallback((fps: TargetFPS) => {
    setCurrentFPS(fps);
    gameEngineRef.current?.setTargetFPS(fps);
  }, []);

  const handleKeyBindingsChange = useCallback((bindings: string[]) => {
    setKeyBindings(bindings);
    localStorage.setItem('keyBindings', JSON.stringify(bindings));
    gameEngineRef.current?.setKeyBindings(bindings);
  }, []);

  const handleMusicVolumeChange = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setMusicVolume(clamped);
    localStorage.setItem('musicVolume', String(clamped));
    audioEngineRef.current?.setVolume(clamped);
    gameEngineRef.current?.setMusicVolume(clamped);
  }, []);

  const handleSfxVolumeChange = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setSfxVolume(clamped);
    localStorage.setItem('sfxVolume', String(clamped));
    gameEngineRef.current?.setSfxVolume(clamped);
  }, []);

  const handlePerfectHitSoundChange = useCallback((sound: PerfectHitSound) => {
    setPerfectHitSound(sound);
    localStorage.setItem('perfectHitSound', sound);
    gameEngineRef.current?.setPerfectHitSound(sound);
  }, []);

  const handleMissDipEnabledChange = useCallback((enabled: boolean) => {
    setMissDipEnabled(enabled);
    localStorage.setItem('missDipEnabled', String(enabled));
    gameEngineRef.current?.setMissDipEnabled(enabled);
  }, []);

  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleCloseSettings = useCallback(() => setShowSettings(false), []);

  // ── Multiplayer helpers ────────────────────────────────────────────────

  const getMpManager = useCallback(() => {
    if (!mpManagerRef.current) {
      mpManagerRef.current = new MultiplayerManager();
    }
    return mpManagerRef.current;
  }, []);

  // Keep refs fresh so the multiplayer event handler never has stale closures
  useEffect(() => { appStateRef.current = appState; }, [appState]);
  useEffect(() => { handleStartGameRef.current = handleStartGame; }, [handleStartGame]);

  const setupMpListeners = useCallback((mgr: MultiplayerManager) => {
    return mgr.on((event) => {
      switch (event.kind) {
        case 'state-change':
          setMpLobbyState(event.state);
          break;
        case 'opponent-connected':
          setMpOpponentConnected(true);
          setMpError(null);
          break;
        case 'opponent-disconnected':
          setMpOpponentConnected(false);
          if (appStateRef.current !== 'playing' && appStateRef.current !== 'game-over') {
            setMpError('Opponent disconnected');
          }
          break;
        case 'song-info':
          setMpSongInfo(event.data);
          mpDifficultyRef.current = event.data.difficulty;
          break;
        case 'guest-ready':
          // Host receives this
          break;
        case 'start-game': {
          // Guest receives this — start playing
          const file = mpSongFileRef.current;
          if (file && handleStartGameRef.current) {
            const songId = `mp-${file.name}-${file.size}`;
            const songName = file.name.replace(/\.[^/.]+$/, '');
            handleStartGameRef.current(file, mpDifficultyRef.current, songId, songName);
          }
          break;
        }
        case 'opponent-score':
          setMpOpponentScore({ ...event.data });
          break;
        case 'opponent-finished':
          setMpOpponentFinalScore({ ...event.data });
          break;
        case 'error':
          setMpError(event.message);
          setMpConnecting(false);
          break;
      }
    });
  }, []);  // stable — uses refs, no stale closures

  const handleOpenMultiplayer = useCallback(() => {
    setMpError(null);
    setMpConnecting(false);
    setMpOpponentConnected(false);
    setMpSongInfo(null);
    setMpOpponentScore(null);
    setMpMyFinalScore(null);
    setMpOpponentFinalScore(null);
    setAppState('mp-lobby');
  }, []);

  const handleMpCreateGame = useCallback(async () => {
    const mgr = getMpManager();
    const unsub = setupMpListeners(mgr);
    setMpConnecting(true);
    setMpError(null);
    setMpRole('host');
    try {
      const code = await mgr.createRoom();
      setMpRoomCode(code);
      setMpConnecting(false);
      setMpActive(true);
      setAppState('mp-waiting');
    } catch (e) {
      setMpConnecting(false);
      // Error message already set via event handler
      void unsub;
    }
  }, [getMpManager, setupMpListeners]);

  const handleMpJoinGame = useCallback(async (code: string) => {
    const mgr = getMpManager();
    const unsub = setupMpListeners(mgr);
    setMpConnecting(true);
    setMpError(null);
    setMpRole('guest');
    setMpRoomCode(code);
    try {
      await mgr.joinRoom(code);
      setMpConnecting(false);
      setMpActive(true);
      setAppState('mp-waiting');
    } catch (e) {
      setMpConnecting(false);
      // Error message already set via event handler
      void unsub;
    }
  }, [getMpManager, setupMpListeners]);

  const handleMpSelectSong = useCallback((file: File, difficulty: Difficulty) => {
    const mgr = mpManagerRef.current;
    if (!mgr) return;
    mpSongFileRef.current = file;
    mpDifficultyRef.current = difficulty;
    const songInfo: SongInfo = {
      songName: file.name.replace(/\.[^/.]+$/, ''),
      difficulty,
      fileSize: file.size,
    };
    setMpSongInfo(songInfo);
    mgr.sendSongInfo(songInfo);
  }, []);

  const handleMpGuestReady = useCallback((file: File) => {
    const mgr = mpManagerRef.current;
    if (!mgr) return;
    mpSongFileRef.current = file;
    mgr.sendGuestReady();
  }, []);

  const handleMpStartGame = useCallback(() => {
    const mgr = mpManagerRef.current;
    if (!mgr) return;
    mgr.startGame();
    // Host also starts playing
    const file = mpSongFileRef.current;
    if (file) {
      const songId = `mp-${file.name}-${file.size}`;
      const songName = file.name.replace(/\.[^/.]+$/, '');
      handleStartGame(file, mpDifficultyRef.current, songId, songName);
    }
  }, [handleStartGame]);

  const handleMpLeave = useCallback(() => {
    mpManagerRef.current?.cleanup();
    setMpActive(false);
    setMpOpponentConnected(false);
    setMpSongInfo(null);
    setMpOpponentScore(null);
    setMpMyFinalScore(null);
    setMpOpponentFinalScore(null);
    setMpError(null);
    setAppState('menu');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  const isPlaying = appState === 'playing' || appState === 'game-over';

  return (
    <div className="app">
      {/* Canvas is ALWAYS mounted so GameEngine can attach to it.
          Hidden via CSS when not actively playing. */}
      <div className="game" style={{ display: isPlaying ? undefined : 'none' }}>
        <canvas ref={canvasRef} className="game__canvas" />
        {appState === 'playing' && (
          <>
            <GameUI
              score={score}
              progress={progress}
              lastJudgment={lastJudgment}
              judgmentKey={judgmentKey}
              lastPoints={lastPoints}
              lastMultiplier={lastMultiplier}
              songName={currentSongName}
              musicVolume={musicVolume}
              sfxVolume={sfxVolume}
              perfectHitSound={perfectHitSound}
              leaderboardRuns={songRunHistory[currentSongId] ?? []}
              onMusicVolumeChange={handleMusicVolumeChange}
              onSfxVolumeChange={handleSfxVolumeChange}
              onPerfectHitSoundChange={handlePerfectHitSoundChange}
            />
            {mpActive && (
              <MultiplayerHUD opponentScore={mpOpponentScore} myScore={score.score} />
            )}
          </>
        )}
        {appState === 'playing' && isPaused && (
          <div className="pause-menu-actions">
            <div className="pause-menu-return" onClick={handleMainMenu}>Return to Menu</div>
          </div>
        )}
        {appState === 'game-over' && !mpActive && (
          <GameOver score={score} onRestart={handleRestart} onMainMenu={handleMainMenu} />
        )}
        {appState === 'game-over' && mpActive && (
          <MultiplayerResults
            myScore={mpMyFinalScore ?? {
              score: score.score,
              combo: score.combo,
              maxCombo: score.maxCombo,
              accuracy: score.accuracy,
              judgments: { ...score.judgments },
            }}
            opponentScore={mpOpponentFinalScore}
            onPlayAgain={handleRestart}
            onMainMenu={handleMpLeave}
          />
        )}
      </div>

      {appState === 'menu' && (
        <div className="menu">
          <div className="menu__header">
            <h1 className="menu__title">Rhythm Ai</h1>
            <p className="menu__subtitle">A fast-paced rhythm game where you hit notes in time with your music.</p>
            <p className="menu__subtitle">PC only for now</p>
          </div>
          <div className="menu__content">
            <SongSelect onStartGame={handleStartGame} isLoading={isLoadingBeatmap} bestRecords={songBestRecords} />
          </div>
          <div className="menu__footer">
            <button className="btn mp-menu-btn" onClick={handleOpenMultiplayer}>
              🎮 Multiplayer
            </button>
            <button className="btn menu__settings-btn" onClick={handleOpenSettings}>
              ⚙️ Settings
            </button>
          </div>
        </div>
      )}

      {appState === 'mp-lobby' && (
        <div className="menu">
          <MultiplayerLobby
            onCreateGame={handleMpCreateGame}
            onJoinGame={handleMpJoinGame}
            onBack={() => setAppState('menu')}
            isConnecting={mpConnecting}
            error={mpError}
          />
        </div>
      )}

      {appState === 'mp-waiting' && (
        <div className="menu">
          <MultiplayerWaitingRoom
            role={mpRole}
            roomCode={mpRoomCode}
            lobbyState={mpLobbyState}
            songInfo={mpSongInfo}
            opponentConnected={mpOpponentConnected}
            onSelectSong={handleMpSelectSong}
            onGuestReady={handleMpGuestReady}
            onStartGame={handleMpStartGame}
            onLeave={handleMpLeave}
          />
        </div>
      )}

      {appState === 'loading' && (
        <div className="menu">
          <div className="loading">
            <div className="loading__spinner" />
            <div className="loading__text">Analyzing audio & generating beatmap...</div>
            <div className="loading__progress">{beatmapProgress}%</div>
          </div>
        </div>
      )}

      {showSettings && (
        <Settings
          currentFPS={currentFPS}
          onFPSChange={handleFPSChange}
          keyBindings={keyBindings}
          onKeyBindingsChange={handleKeyBindingsChange}
          musicVolume={musicVolume}
          onMusicVolumeChange={handleMusicVolumeChange}
          sfxVolume={sfxVolume}
          onSfxVolumeChange={handleSfxVolumeChange}
          perfectHitSound={perfectHitSound}
          onPerfectHitSoundChange={handlePerfectHitSoundChange}
          missDipEnabled={missDipEnabled}
          onMissDipEnabledChange={handleMissDipEnabledChange}
          onClose={handleCloseSettings}
        />
      )}
    </div>
  );
}
