// ─────────────────────────────────────────────────────────────────────────────
// AudioEngine – Production-quality Web Audio API wrapper
// ─────────────────────────────────────────────────────────────────────────────
//
//  Lifecycle:
//    1.  const engine = new AudioEngine();
//    2.  await engine.load(file);          // File | URL string
//    3.  engine.play();
//    4.  engine.pause()  /  engine.stop();
//    5.  engine.dispose();                 // Tears everything down
//
//  Timing:
//    getCurrentTime() returns the precise playback position in seconds,
//    derived from audioContext.currentTime for sub-millisecond accuracy.
//    This is the single source-of-truth for the game loop.
//
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from './EventEmitter';
import {
  AudioEngineState,
  AudioEngineEvent,
  type AudioEngineConfig,
  type AudioEngineEventMap,
  type AudioTimingSnapshot,
  type DecodedTrack,
} from './types';

const DEFAULT_CONFIG: AudioEngineConfig = {
  audioOffset: 0,
  volume: 1,
};

export class AudioEngine extends EventEmitter<AudioEngineEventMap> {
  // ── Internal state ──────────────────────────────────────────────────────
  private config: AudioEngineConfig;
  private state: AudioEngineState = AudioEngineState.UNLOADED;

  // Web Audio nodes
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  // Decoded track data
  private track: DecodedTrack | null = null;

  // Timing bookkeeping
  /** audioContext.currentTime at the moment play() was called. */
  private playStartContextTime = 0;
  /** Playback offset (seconds into the song) when play() was called. */
  private playStartOffset = 0;
  /** Accumulates paused position so we can resume. */
  private pausedAt = 0;

  // Timing update RAF handle
  private timingRafId: number | null = null;

  // ── Constructor ─────────────────────────────────────────────────────────
  constructor(config: Partial<AudioEngineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Current engine state. */
  getState(): AudioEngineState {
    return this.state;
  }

  /**
   * Load an audio source.
   * Accepts either a local File (from <input type="file">) or a URL string.
   * Decodes the audio data and transitions to READY.
   */
  async load(source: File | string): Promise<void> {
    // Tear down any previous track
    this.releaseSource();
    this.track = null;
    this.pausedAt = 0;

    this.setState(AudioEngineState.LOADING);

    try {
      // Lazily create (or resume) the AudioContext
      const ctx = this.getOrCreateContext();

      const arrayBuffer = await this.fetchAudioData(source);
      
      // Try to decode the audio data
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      } catch (decodeError) {
        console.warn('Primary decode failed, trying fallback decode...', decodeError);
        
        // Fallback: Try with a fresh AudioContext (sometimes helps with codec issues)
        const fallbackCtx = new AudioContext();
        try {
          audioBuffer = await fallbackCtx.decodeAudioData(arrayBuffer.slice(0));
          // Close fallback context, we'll use the audio buffer with the main one
          await fallbackCtx.close();
        } catch (fallbackError) {
          throw new Error(`Unable to decode audio file. The file may use an unsupported codec or be corrupted. Try converting the file to a standard MP3 format (44.1kHz, stereo, CBR).`);
        }
      }

      this.track = {
        buffer: audioBuffer,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
      };

      this.setState(AudioEngineState.READY);

      this.emit(AudioEngineEvent.LOADED, {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
      });
    } catch (err) {
      this.setState(AudioEngineState.ERROR);
      this.emit(AudioEngineEvent.ERROR, {
        message: `Failed to load audio: ${(err as Error).message}`,
        error: err,
      });
      throw err;
    }
  }

  /**
   * Begin or resume playback.
   * Resumes from the paused position if previously paused.
   * 
   * Automatically handles suspended AudioContext (browser autoplay policy)
   * by resuming the context before starting playback.
   */
  async play(): Promise<void> {
    this.assertState([AudioEngineState.READY, AudioEngineState.PAUSED, AudioEngineState.STOPPED]);
    this.ensureTrack();

    const ctx = this.getOrCreateContext();

    // Handle suspended context (browser autoplay policy)
    // This ensures playback works even on first interaction
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.error('Failed to resume AudioContext:', err);
        // Continue anyway - some browsers may still allow playback
      }
    }

    // Reconstruct a new source node (they are one-shot in Web Audio)
    this.createSourceNode();

    const offset = this.pausedAt;
    this.playStartOffset = offset;
    this.playStartContextTime = ctx.currentTime;

    this.sourceNode!.start(0, offset);

    this.setState(AudioEngineState.PLAYING);
    this.startTimingUpdates();
  }

  /**
   * Pause playback, preserving the current position.
   */
  pause(): void {
    if (this.state !== AudioEngineState.PLAYING) return;

    this.pausedAt = this.getCurrentTime();
    this.releaseSource();
    this.stopTimingUpdates();

    this.setState(AudioEngineState.PAUSED);
  }

  /**
   * Stop playback and reset position to zero.
   */
  stop(): void {
    if (
      this.state !== AudioEngineState.PLAYING &&
      this.state !== AudioEngineState.PAUSED
    ) {
      return;
    }

    this.pausedAt = 0;
    this.releaseSource();
    this.stopTimingUpdates();

    this.setState(AudioEngineState.STOPPED);
  }

  /**
   * Returns the current playback position in **seconds**.
   *
   * Derived from audioContext.currentTime when playing, or the stored
   * pausedAt value when paused/stopped.  This is the authoritative clock
   * for the game loop.
   */
  getCurrentTime(): number {
    if (this.state === AudioEngineState.PLAYING && this.audioContext) {
      const elapsed = this.audioContext.currentTime - this.playStartContextTime;
      const raw = this.playStartOffset + elapsed + this.config.audioOffset;
      // Clamp to [0, duration]
      return Math.max(0, Math.min(raw, this.getDuration()));
    }
    return this.pausedAt;
  }

  /** Total duration of the loaded track in seconds, or 0 if nothing loaded. */
  getDuration(): number {
    return this.track?.duration ?? 0;
  }

  /** Returns the raw decoded AudioBuffer (for analysis/beat detection). */
  getAudioBuffer(): AudioBuffer | null {
    return this.track?.buffer ?? null;
  }

  /** Returns the AudioContext (for advanced consumers like analysers). */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /** Get / set volume (0 – 1). */
  getVolume(): number {
    return this.config.volume;
  }

  setVolume(value: number): void {
    this.config.volume = Math.max(0, Math.min(1, value));
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.config.volume, this.audioContext!.currentTime);
    }
  }

  /** Get / set audio offset for latency compensation (seconds). */
  getAudioOffset(): number {
    return this.config.audioOffset;
  }

  setAudioOffset(offset: number): void {
    this.config.audioOffset = offset;
  }

  /**
   * Seek to a specific position (seconds).
   * If currently playing, playback restarts from the new position.
   */
  seek(time: number): void {
    this.assertState([
      AudioEngineState.READY,
      AudioEngineState.PLAYING,
      AudioEngineState.PAUSED,
      AudioEngineState.STOPPED,
    ]);
    const clamped = Math.max(0, Math.min(time, this.getDuration()));

    if (this.state === AudioEngineState.PLAYING) {
      // Restart playback from new position
      this.releaseSource();
      this.pausedAt = clamped;
      this.createSourceNode();
      const ctx = this.audioContext!;
      this.playStartOffset = clamped;
      this.playStartContextTime = ctx.currentTime;
      this.sourceNode!.start(0, clamped);
    } else {
      this.pausedAt = clamped;
    }
  }

  /**
   * Return a frozen timing snapshot for the current frame.
   * Designed to be called once per game-loop tick so all systems
   * reference the same time value within a single frame.
   */
  getTimingSnapshot(): AudioTimingSnapshot {
    return {
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      isPlaying: this.state === AudioEngineState.PLAYING,
      contextTime: this.audioContext?.currentTime ?? 0,
    };
  }

  /**
   * Tear down the entire engine.
   * Releases all Web Audio resources, clears listeners, cancels timers.
   * The instance should not be reused after calling dispose().
   * 
   * Properly closes AudioContext and ensures all nodes are disconnected
   * to prevent memory leaks.
   */
  async dispose(): Promise<void> {
    this.stopTimingUpdates();
    this.releaseSource();

    // Disconnect gain node
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // Already disconnected
      }
      this.gainNode = null;
    }

    if (this.audioContext) {
      try {
        // Only close if not already closed
        if (this.audioContext.state !== 'closed') {
          await this.audioContext.close();
        }
      } catch (err) {
        console.warn('AudioContext close failed:', err);
      }
      this.audioContext = null;
    }

    this.track = null;
    this.pausedAt = 0;
    this.removeAllListeners();
    this.setState(AudioEngineState.UNLOADED);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Lazily create (or return the existing) AudioContext + master gain.
   */
  private getOrCreateContext(): AudioContext {
    if (!this.audioContext) {
      const opts: AudioContextOptions = {};
      if (this.config.sampleRate) opts.sampleRate = this.config.sampleRate;

      this.audioContext = new AudioContext(opts);

      // Master gain node sits between source and destination
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(this.config.volume, this.audioContext.currentTime);
      this.gainNode.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  /**
   * Fetch raw bytes from File or URL.
   */
  private async fetchAudioData(source: File | string): Promise<ArrayBuffer> {
    if (source instanceof File) {
      return source.arrayBuffer();
    }

    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching audio from ${source}`);
    }
    return response.arrayBuffer();
  }

  /**
   * Create a fresh AudioBufferSourceNode wired through the gain node.
   * Source nodes are one-shot; a new one is needed every play/seek.
   */
  private createSourceNode(): void {
    this.releaseSource();

    const ctx = this.audioContext!;
    const source = ctx.createBufferSource();
    source.buffer = this.track!.buffer;
    source.connect(this.gainNode!);

    // Handle natural end-of-track
    source.onended = () => {
      // Only fire if we're still in PLAYING state (not paused/stopped)
      if (this.state === AudioEngineState.PLAYING) {
        this.pausedAt = 0;
        this.releaseSource();
        this.stopTimingUpdates();
        this.setState(AudioEngineState.STOPPED);
        this.emit(AudioEngineEvent.ENDED, undefined as unknown as void);
      }
    };

    this.sourceNode = source;
  }

  /**
   * Disconnect and release the current source node.
   */
  private releaseSource(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch {
        // .stop() throws if never started – safe to ignore
      }
      try {
        this.sourceNode.disconnect();
      } catch {
        // already disconnected
      }
      this.sourceNode = null;
    }
  }

  /**
   * Emit TIME_UPDATE events at ~60 Hz via requestAnimationFrame.
   * This lets UI layers update smoothly without polling.
   */
  private startTimingUpdates(): void {
    this.stopTimingUpdates();

    const tick = () => {
      if (this.state !== AudioEngineState.PLAYING) return;

      this.emit(AudioEngineEvent.TIME_UPDATE, {
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
      });

      this.timingRafId = requestAnimationFrame(tick);
    };

    this.timingRafId = requestAnimationFrame(tick);
  }

  private stopTimingUpdates(): void {
    if (this.timingRafId !== null) {
      cancelAnimationFrame(this.timingRafId);
      this.timingRafId = null;
    }
  }

  /**
   * Transition to a new state and emit a STATE_CHANGE event.
   */
  private setState(next: AudioEngineState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.emit(AudioEngineEvent.STATE_CHANGE, { prev, next });
  }

  /**
   * Guard: throw if the engine is not in one of the expected states.
   */
  private assertState(expected: AudioEngineState[]): void {
    if (!expected.includes(this.state)) {
      throw new Error(
        `AudioEngine: Cannot perform this action in state "${this.state}". ` +
          `Expected one of: ${expected.join(', ')}`,
      );
    }
  }

  /**
   * Guard: throw if no track is loaded.
   */
  private ensureTrack(): void {
    if (!this.track) {
      throw new Error('AudioEngine: No audio track loaded.');
    }
  }
}
