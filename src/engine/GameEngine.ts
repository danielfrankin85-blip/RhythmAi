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
        } else {
          // Hit outside timing window - count as miss
          const hadCombo = this.scoreEngine.getState().combo > 0;
          this.scoreEngine.registerMiss();

          this.triggerMissDip();
          if (hadCombo) {
            this.emit(GameEvent.COMBO_BREAK, {
              finalCombo: this.scoreEngine.getState().maxCombo,
            });
          }
          this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
        }
      } else {
        // Pressed key but no note nearby - count as miss (phantom press)
        const hadCombo = this.scoreEngine.getState().combo > 0;
        this.scoreEngine.registerMiss();

        this.triggerMissDip();
        if (hadCombo) {
          this.emit(GameEvent.COMBO_BREAK, {
            finalCombo: this.scoreEngine.getState().maxCombo,
          });
        }
        this.emit(GameEvent.SCORE_UPDATE, { score: this.scoreEngine.getState() });
      }
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

      if (completionRatio >= 0.75) {
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
      if (note.isBeingHeld && !this.input.isLanePressed(note.lane)) {
        this.processHoldRelease(note.lane, songTime);
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
      this.sfxGain.connect(ctx.destination);
    }

    const now = ctx.currentTime;

    if (judgment === HitJudgment.PERFECT) {
      // ── PERFECT: Rich layered bass punch ──

      // Layer 1: Deep sub-bass (40Hz sine) – the rumble
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(40, now);
      sub.frequency.exponentialRampToValueAtTime(25, now + 0.12);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0, now);
      subGain.gain.linearRampToValueAtTime(0.35, now + 0.008);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      sub.connect(subGain);
      subGain.connect(this.sfxGain!);
      sub.start(now);
      sub.stop(now + 0.15);

      // Layer 2: Mid punch (80Hz triangle) – the thump
      const mid = ctx.createOscillator();
      mid.type = 'triangle';
      mid.frequency.setValueAtTime(80, now);
      mid.frequency.exponentialRampToValueAtTime(50, now + 0.08);
      const midGain = ctx.createGain();
      midGain.gain.setValueAtTime(0, now);
      midGain.gain.linearRampToValueAtTime(0.25, now + 0.005);
      midGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      mid.connect(midGain);
      midGain.connect(this.sfxGain!);
      mid.start(now);
      mid.stop(now + 0.12);

      // Layer 3: Click/transient (200Hz square, very short) – the snap
      const click = ctx.createOscillator();
      click.type = 'square';
      click.frequency.setValueAtTime(200, now);
      click.frequency.exponentialRampToValueAtTime(60, now + 0.03);
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0, now);
      clickGain.gain.linearRampToValueAtTime(0.12, now + 0.003);
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      click.connect(clickGain);
      clickGain.connect(this.sfxGain!);
      click.start(now);
      click.stop(now + 0.05);
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
