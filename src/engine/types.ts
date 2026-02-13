// ─────────────────────────────────────────────────────────────────────────────
// Engine types – Data models for the game engine layer
// ─────────────────────────────────────────────────────────────────────────────

import type { BeatmapNote } from '../beatmap/BeatmapGenerator';

// ── Game state machine ───────────────────────────────────────────────────────

export enum GameState {
  IDLE = 'idle',
  LOADING = 'loading',
  READY = 'ready',
  PLAYING = 'playing',
  PAUSED = 'paused',
  GAME_OVER = 'game_over',
}

// ── Events ───────────────────────────────────────────────────────────────────

export enum GameEvent {
  STATE_CHANGE = 'stateChange',
  NOTE_HIT = 'noteHit',
  NOTE_MISS = 'noteMiss',
  COMBO_BREAK = 'comboBreak',
  SCORE_UPDATE = 'scoreUpdate',
  GAME_OVER = 'gameOver',
}

export interface GameEventMap extends Record<string, unknown> {
  [GameEvent.STATE_CHANGE]: { prev: GameState; next: GameState };
  [GameEvent.NOTE_HIT]: { note: ActiveNote; judgment: HitJudgment; timing: number; points: number; multiplier: number };
  [GameEvent.NOTE_MISS]: { note: ActiveNote };
  [GameEvent.COMBO_BREAK]: { finalCombo: number };
  [GameEvent.SCORE_UPDATE]: { score: ScoreState };
  [GameEvent.GAME_OVER]: { score: ScoreState };
}

// ── Note lifecycle ───────────────────────────────────────────────────────────

export enum NoteState {
  /** Approaching the hit zone. */
  ACTIVE = 'active',
  /** Successfully hit by the player. */
  HIT = 'hit',
  /** Passed the hit zone without being hit. */
  MISSED = 'missed',
}

/**
 * A live note on the highway.
 * Extends BeatmapNote with runtime state needed by the engine and renderer.
 */
export interface ActiveNote extends BeatmapNote {
  id: number;
  state: NoteState;
  /** Current Y-position on the canvas (pixels). Computed each frame. */
  y: number;
  /** Hit judgment if state === HIT. */
  judgment?: HitJudgment;
  /** Timestamp (song time) when the note was judged. */
  judgedAt?: number;
  /** Whether the player is currently holding this note. */
  isBeingHeld?: boolean;
  /** Whether the hold was completed successfully. */
  holdCompleted?: boolean;
  /** Whether the hold was dropped early. */
  holdDropped?: boolean;
  /** Grace period start time for hold release detection (prevents false drops). */
  holdReleaseGrace?: number;
}

// ── Hit judgment ─────────────────────────────────────────────────────────────

export enum HitJudgment {
  PERFECT = 'perfect',
  GOOD = 'good',
}

export interface HitWindow {
  /** ± seconds for a PERFECT judgment. */
  perfect: number;
  /** ± seconds for a GOOD judgment (must be > perfect). */
  good: number;
}

// ── Score ────────────────────────────────────────────────────────────────────

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  multiplier: number;
  judgments: {
    perfect: number;
    good: number;
    miss: number;
  };
  /** 0 – 100. */
  accuracy: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Target FPS presets for game loop. */
export enum TargetFPS {
  FPS_60 = 60,
  FPS_100 = 100,
  FPS_144 = 144,
}

export interface GameEngineConfig {
  /** Number of lanes. Default 4. */
  laneCount: number;

  /** Note scroll speed in pixels per second. Default 800. */
  scrollSpeed: number;

  /** Hit window widths. */
  hitWindow: HitWindow;

  /** Key bindings: lane index → keyboard key. */
  keyBindings: string[];

  /** Time (seconds) notes remain visible after being hit before fading. */
  hitFadeDuration: number;

  /** Time (seconds) past the hit zone before a note is marked as missed. */
  missThreshold: number;

  /** How far ahead to spawn notes (seconds). Default 3. */
  spawnLeadTime: number;

  /** Target framerate for game logic updates. Default 100. */
  targetFPS: TargetFPS;
}

// ── Renderer types ───────────────────────────────────────────────────────────

export interface RenderState {
  /** Current song time (seconds). */
  songTime: number;
  /** Active notes to render. */
  notes: ReadonlyArray<ActiveNote>;
  /** Per-lane key-press state (true = held). */
  lanePressed: ReadonlyArray<boolean>;
  /** Current score snapshot. */
  score: Readonly<ScoreState>;
  /** Game state. */
  gameState: GameState;
  /** Config reference. */
  config: Readonly<GameEngineConfig>;
  /** Canvas dimensions. */
  width: number;
  height: number;
}

export interface RendererConfig {
  /** Hit zone Y-position from the bottom (pixels). Default 150. */
  hitZoneOffset: number;
  /** Note width (pixels). Default 60. */
  noteWidth: number;
  /** Note height (pixels). Default 24. */
  noteHeight: number;
  /** Lane colours (CSS strings). */
  laneColors: string[];
  /** Background color. */
  backgroundColor: string;
  /** Highway line color. */
  highwayLineColor: string;
}
