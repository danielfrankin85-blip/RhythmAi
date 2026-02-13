// ─────────────────────────────────────────────────────────────────────────────
// GameEngine – Central orchestrator for the rhythm game
// ─────────────────────────────────────────────────────────────────────────────
//
//  Owns and coordinates:
//    • Game loop (requestAnimationFrame)
//    • Note spawning, Y-position computation, miss detection
//    • Input → hit-judgment pipeline
//    • Score engine
//    • Canvas renderer invocation
//    • Pause / resume
//
//  Does NOT own:
//    • React state (no useState / useEffect / useRef inside here)
//    • Audio playback (delegated to AudioEngine, received via timing snapshot)
//    • Beat-map generation (receives a BeatmapNote[] as input)
//
//  Timing model:
//    The AudioEngine provides a timing snapshot each frame containing
//    audioContext.currentTime-derived song position.  All note positions
//    are computed from this single source of truth.
//
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from '../audio/EventEmitter';
import type { AudioEngine } from '../audio/AudioEngine';
import type { BeatmapNote } from '../beatmap/BeatmapGenerator';
import { CanvasRenderer } from './CanvasRenderer';
import { InputManager, type InputEvent } from './InputManager';
import { ScoreEngine } from './ScoreEngine';
import {
  GameState,
  GameEvent,
  NoteState,
  HitJudgment,
  TargetFPS,
  type ActiveNote,
  type GameEngineConfig,
  type GameEventMap,
  type RenderState,
  type RendererConfig,
  type ScoreState,
} from './types';

// Re-export types so consumers can import from GameEngine directly
export { GameState, GameEvent, HitJudgment, TargetFPS, type ScoreState };

export type PerfectHitSound = 'bass' | 'guitar' | 'drum' | 'trumpet' | 'synth' | 'piano';

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: GameEngineConfig = {
  laneCount: 4,
  scrollSpeed: 800,
  hitWindow: { perfect: 0.045, good: 0.10 },
  keyBindings: ['d', 'f', 'j', 'k'],
  hitFadeDuration: 0.3,
  missThreshold: 0.25,
  spawnLeadTime: 3,
  targetFPS: TargetFPS.FPS_100,
};

// ── Engine ───────────────────────────────────────────────────────────────────

export class GameEngine extends EventEmitter<GameEventMap> {
  // ── Sub-systems ──────────────────────────────────────────────────────────
  private renderer: CanvasRenderer;
  private input: InputManager;
  private scoreEngine: ScoreEngine;
  private audioEngine: AudioEngine;

  // ── Configuration ────────────────────────────────────────────────────────
  private config: GameEngineConfig;

  // ── State ────────────────────────────────────────────────────────────────
  private state: GameState = GameState.IDLE;

  // All notes from the beatmap (immutable reference)
  private beatmapNotes: BeatmapNote[] = [];

  // Runtime note pool
  private activeNotes: ActiveNote[] = [];

  // Index into beatmapNotes — next note to spawn
  private nextNoteIndex = 0;

  // Auto-incrementing note ID
  private noteIdCounter = 0;

  // rAF handle
  private rafId: number | null = null;

  // Fixed timestep accumulator for stable FPS
  private fixedDeltaTime = 1 / 100; // Updated based on targetFPS
  private accumulator = 0;
  private lastFrameTime = 0;

  // Pause bookkeeping
  private pauseKey = 'escape';

  // Canvas dimensions cache
  private canvasWidth = 0;
  private canvasHeight = 0;

  // ── SFX ──────────────────────────────────────────────────────────────────
  /** Shared gain for hit SFX so we can control volume independently. */
  private sfxGain: GainNode | null = null;
  /** Current SFX volume (0..1). */
  private sfxVolume = 0.8;
  /** Selected sound preset for perfect hits. */
  private perfectHitSound: PerfectHitSound = 'bass';
  /** Volume dip timeout handle for miss effect. */
  private missDipTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Original music volume to restore after miss dip. */
  private originalMusicVolume = 0.7;

  // ── Constructor ──────────────────────────────────────────────────────────

  constructor(
    canvas: HTMLCanvasElement,
    audioEngine: AudioEngine,
    config?: Partial<GameEngineConfig>,
    rendererConfig?: Partial<RendererConfig>,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.audioEngine = audioEngine;
    this.originalMusicVolume = audioEngine.getVolume();

    this.renderer = new CanvasRenderer(canvas, rendererConfig);
    this.input = new InputManager(this.config.keyBindings, this.config.laneCount);
    this.scoreEngine = new ScoreEngine(this.config.hitWindow);

    const size = this.renderer.getSize();
    this.canvasWidth = size.width;
    this.canvasHeight = size.height;

    // Calculate fixed delta time from target FPS
    this.updateFixedDeltaTime();

    // Listen for pause key
    this.handlePauseKey = this.handlePauseKey.bind(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getState(): GameState {
    return this.state;
  }

  getConfig(): Readonly<GameEngineConfig> {
    return this.config;
  }

  getScore() {
    return this.scoreEngine.getState();
  }

  /** Scroll speed can be changed at runtime. */
  setScrollSpeed(speed: number): void {
    this.config.scrollSpeed = Math.max(200, Math.min(2000, speed));
  }

  /** Update target FPS at runtime. */
  setTargetFPS(fps: TargetFPS): void {
    this.config.targetFPS = fps;
    this.updateFixedDeltaTime();
  }

  /** Get current target FPS. */
  getTargetFPS(): TargetFPS {
    return this.config.targetFPS;
  }

  /** Update key bindings at runtime. */
  setKeyBindings(bindings: string[]): void {
    this.config.keyBindings = bindings;
    this.input.setKeyBindings(bindings);
  }

  /** Update music volume (0..1), used by miss-dip restoration too. */
  setMusicVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.originalMusicVolume = clamped;
    if (!this.missDipTimeout) {
      this.audioEngine.setVolume(clamped);
    }
  }

  getMusicVolume(): number {
    return this.originalMusicVolume;
  }

  /** Update hit/perfect SFX volume (0..1). */
  setSfxVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.sfxVolume = clamped;

    const ctx = this.audioEngine.getAudioContext();
    if (this.sfxGain && ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, ctx.currentTime);
    }
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setPerfectHitSound(sound: PerfectHitSound): void {
    this.perfectHitSound = sound;
  }

  getPerfectHitSound(): PerfectHitSound {
    return this.perfectHitSound;
  }

  /** Trigger canvas resize (call when canvas becomes visible). */
  resize(): void {
    this.renderer.handleResize();
    const size = this.renderer.getSize();
    this.canvasWidth = size.width;
    this.canvasHeight = size.height;
  }

  // ── Game lifecycle ───────────────────────────────────────────────────────

  /**
   * Load a beatmap and prepare for play.
   * Call this after AudioEngine.load() has completed.
   */
  loadBeatmap(notes: BeatmapNote[]): void {
    this.beatmapNotes = [...notes].sort((a, b) => a.time - b.time);
    this.scoreEngine.setTotalNotes(this.beatmapNotes.length);
    this.reset();
    this.setState(GameState.READY);
  }

  /**
   * Start (or restart) the game.
   * AudioEngine.play() should be called externally before or after this.
   */
  start(): void {
    if (this.state !== GameState.READY && this.state !== GameState.GAME_OVER) {
      throw new Error(`GameEngine: Cannot start in state "${this.state}".`);
    }

    this.reset();
    this.setState(GameState.PLAYING);

    this.input.attach();
    window.addEventListener('keydown', this.handlePauseKey);

    this.startLoop();
  }

  /** Pause gameplay. */
  pause(): void {
    if (this.state !== GameState.PLAYING) return;

    this.setState(GameState.PAUSED);
    this.stopLoop();
    this.input.flush();

    // Render one frame to show pause overlay
    this.renderFrame(this.audioEngine.getCurrentTime());
  }

  /** Resume from pause. */
  resume(): void {
    if (this.state !== GameState.PAUSED) return;

    this.setState(GameState.PLAYING);
    this.input.flush();
    this.startLoop();
  }

  /** End the game (called automatically when all notes are done, or manually). */
  endGame(): void {
    this.stopLoop();
    this.input.detach();
    window.removeEventListener('keydown', this.handlePauseKey);
    this.setState(GameState.GAME_OVER);
    this.emit(GameEvent.GAME_OVER, { score: this.scoreEngine.getState() });
  }

  /** Full teardown. */
  dispose(): void {
    this.stopLoop();
    this.input.detach();
    window.removeEventListener('keydown', this.handlePauseKey);
    this.removeAllListeners();
    this.activeNotes = [];
    this.beatmapNotes = [];

    // Cleanup SFX
    if (this.missDipTimeout) {
      clearTimeout(this.missDipTimeout);
      this.missDipTimeout = null;
      // Restore original volume on cleanup
      this.audioEngine.setVolume(this.originalMusicVolume);
    }
    if (this.sfxGain) {
      try { this.sfxGain.disconnect(); } catch { /* already disconnected */ }
      this.sfxGain = null;
    }

    this.setState(GameState.IDLE);
  }

  // ── Game loop ────────────────────────────────────────────────────────────

  /**
   * Game loop with fixed timestep accumulator.
   * 
   * Logic updates run at the configured targetFPS (60/100/144) using a fixed
   * timestep accumulator, ensuring consistent physics and preventing drift.
   * Rendering runs at the monitor's refresh rate for smooth visuals.
   * 
   * This pattern guarantees:
   * - Deterministic simulation independent of frame rate
   * - No note position drift over time
   * - Stable hit detection timing
   */
  private startLoop(): void {
    this.stopLoop();
    this.lastFrameTime = performance.now();
    this.accumulator = 0;

    const tick = (currentTime: number) => {
      if (this.state !== GameState.PLAYING) return;

      // Calculate frame delta (in seconds)
      const deltaTime = (currentTime - this.lastFrameTime) / 1000;
      this.lastFrameTime = currentTime;

      // Accumulate time, capped to prevent spiral of death
      this.accumulator += Math.min(deltaTime, 0.1);

      // Run fixed updates until accumulator is depleted
      // This ensures consistent update rate regardless of render FPS
      while (this.accumulator >= this.fixedDeltaTime) {
        const songTime = this.audioEngine.getCurrentTime();
        this.update(songTime);
        this.accumulator -= this.fixedDeltaTime;
      }

      // Render at monitor refresh rate (smooth visuals)
      const songTime = this.audioEngine.getCurrentTime();
      this.renderFrame(songTime);

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ── Update (logic tick) ──────────────────────────────────────────────────

  private update(songTime: number): void {
    // 1. Spawn upcoming notes
    this.spawnNotes(songTime);

    // 2. Process player input
    const inputs = this.input.consumeQueue();
    this.processInputs(inputs, songTime);

    // 3. Update note positions & detect misses
    this.updateNotes(songTime);

    // 4. Check game-over condition
    this.checkGameOver(songTime);
  }

  /**
   * Spawn notes that are within `spawnLeadTime` of the current song time.
   * Converts BeatmapNote → ActiveNote.
   */
  private spawnNotes(songTime: number): void {
    const horizon = songTime + this.config.spawnLeadTime;

    while (
      this.nextNoteIndex < this.beatmapNotes.length &&
      this.beatmapNotes[this.nextNoteIndex].time <= horizon
    ) {
      const src = this.beatmapNotes[this.nextNoteIndex];
      const active: ActiveNote = {
        id: this.noteIdCounter++,
        time: src.time,
        lane: src.lane,
        state: NoteState.ACTIVE,
        y: 0, // computed in updateNotes
        holdDuration: src.holdDuration,
        holdType: src.holdType,
      };
      this.activeNotes.push(active);
      this.nextNoteIndex++;
    }
  }

  /**
   * Match each press event to the closest ACTIVE note in that lane.
   * Handle hold note initiation on press, hold completion on release.
   */
  private processInputs(inputs: InputEvent[], songTime: number): void {
    for (const evt of inputs) {
      if (evt.type === 'release') {
        // Check for active hold notes in this lane
        this.processHoldRelease(evt.lane, songTime);
        continue;
      }

      if (evt.type !== 'press') continue;

      // Find the closest active note in this lane within the hit window
      let bestNote: ActiveNote | null = null;
      let bestAbsError = Infinity;

      for (const note of this.activeNotes) {
        if (note.state !== NoteState.ACTIVE) continue;
        if (note.lane !== evt.lane) continue;

        const error = songTime - note.time;
        const absError = Math.abs(error);

        // Must be within the outer (good) hit window
        if (absError <= this.config.hitWindow.good && absError < bestAbsError) {
          bestNote = note;
          bestAbsError = absError;
        }
      }

      if (bestNote) {
        const timingError = songTime - bestNote.time;
        const judgment = this.scoreEngine.judge(timingError);

        if (judgment) {
          // If this is a hold note, start tracking the hold
          if (bestNote.holdDuration && bestNote.holdDuration > 0) {
            bestNote.state = NoteState.HIT;
            bestNote.judgment = judgment;
            bestNote.judgedAt = songTime;
            bestNote.isBeingHeld = true;
            bestNote.holdCompleted = false;
            bestNote.holdDropped = false;

            this.renderer.addSplash(bestNote.lane, judgment, songTime);
            this.playHitSound(judgment);

            // Don't score yet — scoring happens on hold completion
            // But emit a partial event so UI knows a hold started
            this.emit(GameEvent.NOTE_HIT, {
              note: bestNote,
              judgment,
              timing: timingError,
              points: 0,
              multiplier: this.scoreEngine.getState().multiplier,
            });
          } else {
            // Regular tap note
            bestNote.state = NoteState.HIT;
            bestNote.judgment = judgment;
            bestNote.judgedAt = songTime;

            const hitResult = this.scoreEngine.registerHit(judgment);
            this.renderer.addSplash(bestNote.lane, judgment, songTime);
            this.playHitSound(judgment);

            this.emit(GameEvent.NOTE_HIT, {
              note: bestNote,
              judgment,
              timing: timingError,
              points: hitResult.points,
              multiplier: hitResult.multiplier,
            });
            this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
          }
        }
        // If judgment is null (edge case), just ignore — don't penalize
      }
      // No note nearby — just ignore the press (no penalty)
    }
  }

  /**
   * Handle key release for hold notes.
   * Checks if the player held long enough to complete the hold.
   */
  private processHoldRelease(lane: number, songTime: number): void {
    for (const note of this.activeNotes) {
      if (note.lane !== lane) continue;
      if (!note.isBeingHeld) continue;

      note.isBeingHeld = false;

      // Calculate how much of the hold was completed
      const holdStart = note.judgedAt ?? note.time;
      const holdEnd = note.time + (note.holdDuration ?? 0);
      const heldDuration = songTime - holdStart;
      const requiredDuration = holdEnd - holdStart;
      const completionRatio = requiredDuration > 0 ? heldDuration / requiredDuration : 1;

      if (completionRatio >= 0.5) {
        // Successfully completed hold — award full points
        note.holdCompleted = true;
        const judgment = note.judgment ?? HitJudgment.GOOD;
        const hitResult = this.scoreEngine.registerHit(judgment, note.holdType);

        this.renderer.addSplash(note.lane, judgment, songTime);

        this.emit(GameEvent.NOTE_HIT, {
          note,
          judgment,
          timing: 0,
          points: hitResult.points,
          multiplier: hitResult.multiplier,
        });
        this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
      } else {
        // Dropped hold too early — treat as miss
        note.holdDropped = true;
        note.state = NoteState.MISSED;

        const hadCombo = this.scoreEngine.getState().combo > 0;
        this.scoreEngine.registerMiss();

        this.emit(GameEvent.NOTE_MISS, { note });
        this.triggerMissDip();
        if (hadCombo) {
          this.emit(GameEvent.COMBO_BREAK, {
            finalCombo: this.scoreEngine.getState().maxCombo,
          });
        }
        this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
      }

      break; // Only process one hold note per lane
    }
  }

  /**
   * Compute Y positions for all live notes.
   * Mark notes as MISSED if they've passed the hit zone + miss threshold.
   * Handle hold note timing (auto-complete or drop).
   * Cull dead notes (faded hit, old miss).
   */
  private updateNotes(songTime: number): void {
    const hitZoneY = this.renderer.getHitZoneY();
    const { scrollSpeed, hitFadeDuration, missThreshold } = this.config;

    const toRemove: number[] = [];

    for (let i = 0; i < this.activeNotes.length; i++) {
      const note = this.activeNotes[i];

      // Y position: note.time maps to hitZoneY, earlier times are above
      const distance = (note.time - songTime) * scrollSpeed;
      note.y = hitZoneY - distance;

      // ── Hold note: auto-complete if held past the end ────────────
      if (note.isBeingHeld && note.holdDuration) {
        const holdEnd = note.time + note.holdDuration;
        if (songTime >= holdEnd) {
          // Player held all the way through — complete it
          note.isBeingHeld = false;
          note.holdCompleted = true;

          const judgment = note.judgment ?? HitJudgment.GOOD;
          const hitResult = this.scoreEngine.registerHit(judgment, note.holdType);

          this.renderer.addSplash(note.lane, judgment, songTime);

          this.emit(GameEvent.NOTE_HIT, {
            note,
            judgment,
            timing: 0,
            points: hitResult.points,
            multiplier: hitResult.multiplier,
          });
          this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
        }
      }

      // ── Hold note: check if player dropped it (lane released while held) ──
      // Use a small grace period (50ms) to avoid false drops from input glitches
      if (note.isBeingHeld && !this.input.isLanePressed(note.lane)) {
        if (!note.holdReleaseGrace) {
          // Start grace period — don't drop immediately
          note.holdReleaseGrace = songTime;
        } else if (songTime - note.holdReleaseGrace > 0.05) {
          // Grace period expired — actually process the release
          note.holdReleaseGrace = undefined;
          this.processHoldRelease(note.lane, songTime);
        }
      } else if (note.isBeingHeld) {
        // Key is pressed again — reset grace timer
        note.holdReleaseGrace = undefined;
      }

      // Miss detection – note has passed the hit zone beyond the window
      if (note.state === NoteState.ACTIVE && songTime - note.time > missThreshold) {
        note.state = NoteState.MISSED;
        note.judgedAt = songTime;

        const hadCombo = this.scoreEngine.getState().combo > 0;
        this.scoreEngine.registerMiss();

        this.emit(GameEvent.NOTE_MISS, { note });
        this.triggerMissDip();
        if (hadCombo) {
          this.emit(GameEvent.COMBO_BREAK, {
            finalCombo: this.scoreEngine.getState().maxCombo,
          });
        }
        this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
      }

      // Cull: remove hit notes after fade, and missed notes after they scroll off
      if (note.state === NoteState.HIT && !note.isBeingHeld) {
        if (note.holdDuration && note.holdDuration > 0) {
          // Hold notes: keep until hold period is done + fade
          const holdEnd = note.time + note.holdDuration;
          if (songTime > holdEnd + hitFadeDuration) {
            toRemove.push(i);
          }
        } else {
          const elapsed = songTime - (note.judgedAt ?? songTime);
          if (elapsed > hitFadeDuration) {
            toRemove.push(i);
          }
        }
      } else if (note.state === NoteState.MISSED) {
        if (note.y > this.canvasHeight + 50) {
          toRemove.push(i);
        }
      }
    }

    // Remove dead notes (iterate in reverse to preserve indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.activeNotes.splice(toRemove[i], 1);
    }
  }

  /**
   * End the game when all notes have been spawned and processed.
   */
  private checkGameOver(songTime: number): void {
    if (
      this.nextNoteIndex >= this.beatmapNotes.length &&
      this.activeNotes.every(n => n.state !== NoteState.ACTIVE)
    ) {
      // Small grace period after last note
      const lastNoteTime = this.beatmapNotes[this.beatmapNotes.length - 1]?.time ?? 0;
      if (songTime > lastNoteTime + 2) {
        this.endGame();
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  private renderFrame(songTime: number): void {
    const size = this.renderer.getSize();
    this.canvasWidth = size.width;
    this.canvasHeight = size.height;

    const renderState: RenderState = {
      songTime,
      notes: this.activeNotes,
      lanePressed: this.input.getLanePressedSnapshot(),
      score: this.scoreEngine.getState(),
      gameState: this.state,
      config: this.config,
      width: this.canvasWidth,
      height: this.canvasHeight,
    };

    this.renderer.render(renderState);
  }

  // ── Pause handling ───────────────────────────────────────────────────────

  private handlePauseKey(e: KeyboardEvent): void {
    if (e.key.toLowerCase() !== this.pauseKey) return;

    if (this.state === GameState.PLAYING) {
      this.audioEngine.pause();
      this.pause();
    } else if (this.state === GameState.PAUSED) {
      this.audioEngine.play();
      this.resume();
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private reset(): void {
    this.activeNotes = [];
    this.nextNoteIndex = 0;
    this.noteIdCounter = 0;
    this.scoreEngine.reset();
    this.scoreEngine.setTotalNotes(this.beatmapNotes.length);
    this.input.flush();
  }

  private setState(next: GameState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.emit(GameEvent.STATE_CHANGE, { prev, next });
  }

  /**
   * Update the fixed delta time based on targetFPS configuration.
   * Called on initialization and when FPS setting changes.
   */
  private updateFixedDeltaTime(): void {
    this.fixedDeltaTime = 1 / this.config.targetFPS;
  }

  // ── SFX helpers ────────────────────────────────────────────────────────

  /**
   * Play a hit sound effect.
   * Perfect hits get a rich, layered bass punch (sub-bass + mid thump + harmonic)
   * that feels deeply satisfying. Good hits get a lighter single-layer thump.
   */
  private playHitSound(judgment: HitJudgment): void {
    const ctx = this.audioEngine.getAudioContext();
    if (!ctx) return;

    // Lazy-create SFX gain node
    if (!this.sfxGain) {
      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, ctx.currentTime);
      this.sfxGain.connect(ctx.destination);
    }

    const now = ctx.currentTime;

    if (judgment === HitJudgment.PERFECT) {
      switch (this.perfectHitSound) {
        case 'guitar':
          this.playPerfectGuitar(ctx, now);
          break;
        case 'drum':
          this.playPerfectDrum(ctx, now);
          break;
        case 'trumpet':
          this.playPerfectTrumpet(ctx, now);
          break;
        case 'synth':
          this.playPerfectSynth(ctx, now);
          break;
        case 'piano':
          this.playPerfectPiano(ctx, now);
          break;
        case 'bass':
        default:
          this.playPerfectBass(ctx, now);
          break;
      }
    } else {
      // ── GOOD: Lighter single thump ──
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  }

  private playPerfectBass(ctx: AudioContext, now: number): void {
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(40, now);
    sub.frequency.exponentialRampToValueAtTime(25, now + 0.12);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.50, now + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    sub.connect(subGain);
    subGain.connect(this.sfxGain!);
    sub.start(now);
    sub.stop(now + 0.15);

    const mid = ctx.createOscillator();
    mid.type = 'triangle';
    mid.frequency.setValueAtTime(80, now);
    mid.frequency.exponentialRampToValueAtTime(50, now + 0.08);
    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0, now);
    midGain.gain.linearRampToValueAtTime(0.36, now + 0.005);
    midGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    mid.connect(midGain);
    midGain.connect(this.sfxGain!);
    mid.start(now);
    mid.stop(now + 0.12);

    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(200, now);
    click.frequency.exponentialRampToValueAtTime(60, now + 0.03);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0, now);
    clickGain.gain.linearRampToValueAtTime(0.18, now + 0.003);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    click.connect(clickGain);
    clickGain.connect(this.sfxGain!);
    click.start(now);
    click.stop(now + 0.05);
  }

  private playPerfectGuitar(ctx: AudioContext, now: number): void {
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(196, now);
    body.frequency.exponentialRampToValueAtTime(170, now + 0.16);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(0.32, now + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    body.connect(bodyGain);
    bodyGain.connect(this.sfxGain!);
    body.start(now);
    body.stop(now + 0.22);

    const pick = ctx.createOscillator();
    pick.type = 'sawtooth';
    pick.frequency.setValueAtTime(880, now);
    pick.frequency.exponentialRampToValueAtTime(420, now + 0.04);
    const pickGain = ctx.createGain();
    pickGain.gain.setValueAtTime(0.0001, now);
    pickGain.gain.linearRampToValueAtTime(0.15, now + 0.002);
    pickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    pick.connect(pickGain);
    pickGain.connect(this.sfxGain!);
    pick.start(now);
    pick.stop(now + 0.06);
  }

  private playPerfectDrum(ctx: AudioContext, now: number): void {
    const kick = ctx.createOscillator();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(145, now);
    kick.frequency.exponentialRampToValueAtTime(45, now + 0.09);
    const kickGain = ctx.createGain();
    kickGain.gain.setValueAtTime(0.0001, now);
    kickGain.gain.linearRampToValueAtTime(0.48, now + 0.003);
    kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    kick.connect(kickGain);
    kickGain.connect(this.sfxGain!);
    kick.start(now);
    kick.stop(now + 0.12);

    const snap = ctx.createOscillator();
    snap.type = 'square';
    snap.frequency.setValueAtTime(340, now);
    snap.frequency.exponentialRampToValueAtTime(180, now + 0.02);
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.0001, now);
    snapGain.gain.linearRampToValueAtTime(0.18, now + 0.002);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    snap.connect(snapGain);
    snapGain.connect(this.sfxGain!);
    snap.start(now);
    snap.stop(now + 0.04);
  }

  private playPerfectTrumpet(ctx: AudioContext, now: number): void {
    const tone = ctx.createOscillator();
    tone.type = 'sawtooth';
    tone.frequency.setValueAtTime(262, now);
    tone.frequency.exponentialRampToValueAtTime(330, now + 0.12);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.linearRampToValueAtTime(0.30, now + 0.008);
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    tone.connect(toneGain);
    toneGain.connect(this.sfxGain!);
    tone.start(now);
    tone.stop(now + 0.17);

    const overtone = ctx.createOscillator();
    overtone.type = 'square';
    overtone.frequency.setValueAtTime(524, now);
    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.0001, now);
    overtoneGain.gain.linearRampToValueAtTime(0.09, now + 0.01);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    overtone.connect(overtoneGain);
    overtoneGain.connect(this.sfxGain!);
    overtone.start(now);
    overtone.stop(now + 0.15);
  }

  private playPerfectSynth(ctx: AudioContext, now: number): void {
    const lead = ctx.createOscillator();
    lead.type = 'square';
    lead.frequency.setValueAtTime(392, now);
    lead.frequency.exponentialRampToValueAtTime(523, now + 0.08);
    const leadGain = ctx.createGain();
    leadGain.gain.setValueAtTime(0.0001, now);
    leadGain.gain.linearRampToValueAtTime(0.26, now + 0.004);
    leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    lead.connect(leadGain);
    leadGain.connect(this.sfxGain!);
    lead.start(now);
    lead.stop(now + 0.13);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(98, now);
    sub.frequency.exponentialRampToValueAtTime(82, now + 0.1);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.18, now + 0.005);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    sub.connect(subGain);
    subGain.connect(this.sfxGain!);
    sub.start(now);
    sub.stop(now + 0.15);
  }

  /**
   * Piano – bright hammer strike with rich harmonics + soft sustain tail.
   * Uses sine fundamentals with overtone partials for a realistic piano timbre.
   */
  private playPerfectPiano(ctx: AudioContext, now: number): void {
    // Fundamental – C4 (261.63 Hz)
    const fund = ctx.createOscillator();
    fund.type = 'sine';
    fund.frequency.setValueAtTime(261.63, now);
    const fundGain = ctx.createGain();
    fundGain.gain.setValueAtTime(0.0001, now);
    fundGain.gain.linearRampToValueAtTime(0.40, now + 0.004);
    fundGain.gain.exponentialRampToValueAtTime(0.06, now + 0.15);
    fundGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    fund.connect(fundGain);
    fundGain.connect(this.sfxGain!);
    fund.start(now);
    fund.stop(now + 0.36);

    // 2nd partial (octave) – softer
    const p2 = ctx.createOscillator();
    p2.type = 'sine';
    p2.frequency.setValueAtTime(523.25, now);
    const p2Gain = ctx.createGain();
    p2Gain.gain.setValueAtTime(0.0001, now);
    p2Gain.gain.linearRampToValueAtTime(0.18, now + 0.003);
    p2Gain.gain.exponentialRampToValueAtTime(0.02, now + 0.12);
    p2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    p2.connect(p2Gain);
    p2Gain.connect(this.sfxGain!);
    p2.start(now);
    p2.stop(now + 0.30);

    // 3rd partial (octave + fifth) – bright shimmer
    const p3 = ctx.createOscillator();
    p3.type = 'sine';
    p3.frequency.setValueAtTime(784.0, now);
    const p3Gain = ctx.createGain();
    p3Gain.gain.setValueAtTime(0.0001, now);
    p3Gain.gain.linearRampToValueAtTime(0.08, now + 0.002);
    p3Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
    p3.connect(p3Gain);
    p3Gain.connect(this.sfxGain!);
    p3.start(now);
    p3.stop(now + 0.12);

    // Hammer attack – short high-frequency click for key-strike feel
    const hammer = ctx.createOscillator();
    hammer.type = 'triangle';
    hammer.frequency.setValueAtTime(4000, now);
    hammer.frequency.exponentialRampToValueAtTime(800, now + 0.008);
    const hammerGain = ctx.createGain();
    hammerGain.gain.setValueAtTime(0.0001, now);
    hammerGain.gain.linearRampToValueAtTime(0.12, now + 0.001);
    hammerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
    hammer.connect(hammerGain);
    hammerGain.connect(this.sfxGain!);
    hammer.start(now);
    hammer.stop(now + 0.02);
  }

  /**
   * Briefly dip the music volume on a miss to give feedback.
   * Drops to ~30% for 200ms then restores.
   */
  private triggerMissDip(): void {
    const dippedVolume = this.originalMusicVolume * 0.3;

    // Cancel any pending restoration from a previous miss
    if (this.missDipTimeout) {
      clearTimeout(this.missDipTimeout);
    }

    this.audioEngine.setVolume(dippedVolume);

    // Always restore to original max volume after 200ms
    this.missDipTimeout = setTimeout(() => {
      this.audioEngine.setVolume(this.originalMusicVolume);
      this.missDipTimeout = null;
    }, 200);
  }
}
