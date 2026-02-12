// ─────────────────────────────────────────────────────────────────────────────
// Audio Engine Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle states for the AudioEngine.
 *
 *   UNLOADED  →  LOADING  →  READY  →  PLAYING  →  PAUSED
 *                   ↓                      ↓          ↓
 *                 ERROR                  STOPPED    STOPPED
 *
 * Any state can transition to UNLOADED via dispose().
 */
export enum AudioEngineState {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  READY = 'ready',
  PLAYING = 'playing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/** Events emitted by the AudioEngine. */
export enum AudioEngineEvent {
  STATE_CHANGE = 'stateChange',
  TIME_UPDATE = 'timeUpdate',
  ENDED = 'ended',
  ERROR = 'error',
  LOADED = 'loaded',
}

/** Payload map for strongly-typed event callbacks. */
export interface AudioEngineEventMap extends Record<string, unknown> {
  [AudioEngineEvent.STATE_CHANGE]: { prev: AudioEngineState; next: AudioEngineState };
  [AudioEngineEvent.TIME_UPDATE]: { currentTime: number; duration: number };
  [AudioEngineEvent.ENDED]: void;
  [AudioEngineEvent.ERROR]: { message: string; error?: unknown };
  [AudioEngineEvent.LOADED]: { duration: number; sampleRate: number; channels: number };
}

/** Configuration options for AudioEngine construction. */
export interface AudioEngineConfig {
  /** Global audio offset for latency compensation (seconds). Default 0. */
  audioOffset: number;

  /** Volume level 0 – 1. Default 1. */
  volume: number;

  /** Target sample rate. Omit to use browser default (usually 44100 or 48000). */
  sampleRate?: number;
}

/** Read-only snapshot of the engine's timing state, used by the game loop. */
export interface AudioTimingSnapshot {
  /** Current playback position in seconds. */
  currentTime: number;

  /** Total duration of the loaded track in seconds. */
  duration: number;

  /** True when audio is actively playing. */
  isPlaying: boolean;

  /** High-resolution AudioContext time at snapshot. */
  contextTime: number;
}

/** Represents a loaded & decoded audio track. */
export interface DecodedTrack {
  buffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  channels: number;
}
