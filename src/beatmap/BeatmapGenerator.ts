// ─────────────────────────────────────────────────────────────────────────────
// BeatmapGenerator – Converts audio analysis into playable note sequences
// ─────────────────────────────────────────────────────────────────────────────
//
//  Pipeline:
//    1. Run BeatDetector on the AudioBuffer  → onsets + BPM
//    2. Compute per-band energy profile      → lane assignment
//    3. Detect sustained vocal/instrument segments → hold notes
//    4. Apply difficulty scaling              → note density / lane spread
//    5. Quantize to BPM-aware musical grid    → tight sync
//    6. Return deterministic BeatmapNote[]
//
//  Determinism guarantee:
//    Same AudioBuffer + same Difficulty → identical output, every time.
//    No Math.random() – all "randomness" is derived from audio data via
//    a seeded PRNG keyed on a hash of the PCM content.
//
// ─────────────────────────────────────────────────────────────────────────────

import { BeatDetector, type DetectedBeat, type BeatDetectionResult } from '../audio/BeatDetector';

// ── Public types ─────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme' | 'deadly';

/** Hold note duration categories. */
export type HoldDuration = 'short' | 'medium' | 'long';

/** A single note in the generated beatmap. */
export interface BeatmapNote {
  /** Hit time in seconds from the start of the track. */
  time: number;
  /** Zero-based lane index (0 … laneCount-1). */
  lane: number;
  /** If present, this is a hold note with the given duration in seconds. */
  holdDuration?: number;
  /** Category of hold note for scoring purposes. */
  holdType?: HoldDuration;
}

/** Full output from the generator. */
export interface GeneratedBeatmap {
  notes: BeatmapNote[];
  bpm: number;
  duration: number;
  difficulty: Difficulty;
  laneCount: number;
}

/** Tuning knobs exposed to callers. */
export interface BeatmapGeneratorConfig {
  /** Number of playable lanes. Default 4. */
  laneCount: number;

  /**
   * Frequency band boundaries (Hz) used for lane mapping.
   * Length must equal laneCount + 1.
   * Default for 4 lanes: [0, 250, 2000, 6000, 22050]
   *   lane 0 = sub-bass / kick
   *   lane 1 = bass / snare body
   *   lane 2 = mids / vocals / guitar
   *   lane 3 = highs / cymbals / hats
   */
  bandBoundaries: number[];

  /** Quantize notes to the nearest grid division (seconds). 0 = no quantize. */
  quantizeGrid: number;
}

// ── Difficulty presets ───────────────────────────────────────────────────────

interface DifficultyProfile {
  /** BeatDetector sensitivity (0–1). Higher = more onsets. */
  sensitivity: number;
  /** Minimum gap between notes in the same lane (seconds). */
  minLaneGap: number;
  /** Minimum gap between any two notes (seconds). */
  minGlobalGap: number;
  /** Max simultaneous notes (chords). 1 = single notes only. */
  maxChordSize: number;
  /** Fraction of detected onsets to keep (0–1). */
  densityFactor: number;
  /** Number of active lanes (chosen from the centre outward). */
  activeLanes: number;
  /** Strength threshold – ignore beats below this (0–1). */
  strengthFloor: number;
  /** Fraction of sustains to convert to holds (0-1). */
  holdFraction: number;
  /** Minimum sustain duration (seconds) to qualify for a hold note. */
  minSustainDuration: number;
}

const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    sensitivity: 0.3,
    minLaneGap: 0.6,
    minGlobalGap: 0.4,
    maxChordSize: 1,
    densityFactor: 0.3,
    activeLanes: 3,
    strengthFloor: 0.4,
    holdFraction: 0.5,
    minSustainDuration: 0.6,
  },
  medium: {
    sensitivity: 0.55,
    minLaneGap: 0.3,
    minGlobalGap: 0.2,
    maxChordSize: 2,
    densityFactor: 0.65,
    activeLanes: 4,
    strengthFloor: 0.18,
    holdFraction: 0.65,
    minSustainDuration: 0.4,
  },
  hard: {
    sensitivity: 0.62,
    minLaneGap: 0.22,
    minGlobalGap: 0.15,
    maxChordSize: 2,
    densityFactor: 0.72,
    activeLanes: 4,
    strengthFloor: 0.16,
    holdFraction: 0.7,
    minSustainDuration: 0.35,
  },
  extreme: {
    sensitivity: 0.75,
    minLaneGap: 0.15,
    minGlobalGap: 0.1,
    maxChordSize: 3,
    densityFactor: 0.85,
    activeLanes: 4,
    strengthFloor: 0.12,
    holdFraction: 0.8,
    minSustainDuration: 0.3,
  },
  deadly: {
    sensitivity: 0.88,
    minLaneGap: 0.10,
    minGlobalGap: 0.06,
    maxChordSize: 4,
    densityFactor: 0.95,
    activeLanes: 4,
    strengthFloor: 0.06,
    holdFraction: 0.9,
    minSustainDuration: 0.2,
  },
};

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_BAND_BOUNDARIES_4 = [0, 250, 2000, 6000, 22050];

function defaultConfig(laneCount: number): BeatmapGeneratorConfig {
  return {
    laneCount,
    bandBoundaries: laneCount === 4
      ? DEFAULT_BAND_BOUNDARIES_4
      : buildEqualBands(laneCount, 22050),
    quantizeGrid: 0,
  };
}

/** Fallback: logarithmically spaced bands when no explicit boundaries given. */
function buildEqualBands(lanes: number, nyquist: number): number[] {
  const bands: number[] = [0];
  const logMin = Math.log2(60);       // ~60 Hz lower bound
  const logMax = Math.log2(nyquist);
  for (let i = 1; i <= lanes; i++) {
    bands.push(Math.round(2 ** (logMin + (logMax - logMin) * (i / lanes))));
  }
  return bands;
}

// ── Sustained note segment ──────────────────────────────────────────────────

/** A detected segment of sustained audio energy (held vocal, instrument, etc.) */
interface SustainSegment {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Duration in seconds */
  duration: number;
  /** Average energy level during the sustain (0-1) */
  energy: number;
  /** Dominant frequency band index */
  dominantBand: number;
}

// ── Generator ────────────────────────────────────────────────────────────────

export class BeatmapGenerator {
  private config: BeatmapGeneratorConfig;

  constructor(config?: Partial<BeatmapGeneratorConfig>) {
    const laneCount = config?.laneCount ?? 4;
    const defaults = defaultConfig(laneCount);
    this.config = {
      ...defaults,
      ...config,
      // Ensure boundaries match lane count
      bandBoundaries: config?.bandBoundaries?.length === laneCount + 1
        ? config.bandBoundaries
        : defaults.bandBoundaries,
    };
  }

  /**
   * Generate a beatmap from a decoded AudioBuffer.
   *
   * Deterministic: identical AudioBuffer + difficulty → identical output.
   * 
   * @param audioBuffer - The decoded audio data
   * @param difficulty - Game difficulty level
   * @param onProgress - Optional callback to track generation progress (0-100)
   */
  generate(
    audioBuffer: AudioBuffer, 
    difficulty: Difficulty,
    onProgress?: (progress: number) => void
  ): GeneratedBeatmap {
    const profile = DIFFICULTY_PROFILES[difficulty];

    onProgress?.(5); // Starting...

    // ── 1. Beat / onset detection ──────────────────────────────────────────
    const detector = new BeatDetector({
      sensitivity: profile.sensitivity,
      minOnsetGap: profile.minGlobalGap,
    });
    const detection: BeatDetectionResult = detector.detect(audioBuffer);

    onProgress?.(25); // Beat detection complete

    // ── 2. Filter by strength floor ────────────────────────────────────────
    let beats = detection.beats.filter(b => b.strength >= profile.strengthFloor);

    onProgress?.(30); // Filtering complete

    // ── 3. Density scaling – keep only a fraction of onsets ────────────────
    beats = this.applyDensity(beats, profile.densityFactor);

    onProgress?.(35); // Density scaling complete

    // ── 4. Compute per-band energy for lane assignment ─────────────────────
    const bandEnergies = this.computeBandEnergies(audioBuffer);

    onProgress?.(45); // Band energy analysis complete

    // ── 5. Detect sustained audio segments (held vocals, long notes) ───────
    const sustains = this.detectSustainedSegments(
      audioBuffer, detection.beats, profile.minSustainDuration,
    );

    onProgress?.(60); // Sustain detection complete

    // ── 6. Derive deterministic seed from PCM data ─────────────────────────
    const seed = this.hashPCM(audioBuffer);
    const rng = this.createSeededRNG(seed);

    // ── 7. Assign lanes ────────────────────────────────────────────────────
    const activeLanes = Math.min(profile.activeLanes, this.config.laneCount);
    const laneOffset = Math.floor((this.config.laneCount - activeLanes) / 2);

    let notes: BeatmapNote[] = beats.map((beat) => {
      const lane = this.assignLane(
        beat,
        bandEnergies,
        audioBuffer.sampleRate,
        activeLanes,
        laneOffset,
        rng,
      );
      return { time: beat.time, lane };
    });

    onProgress?.(70); // Lane assignment complete

    // ── 8. Expand to chords for harder difficulties ────────────────────────
    if (profile.maxChordSize > 1) {
      notes = this.expandChords(notes, beats, profile, activeLanes, laneOffset, rng);
    }

    onProgress?.(75); // Chord expansion complete

    // ── 9. BPM-aware quantization for tight sync ───────────────────────────
    //    Snap notes to the nearest 1/16th note of the detected BPM.
    //    This keeps notes perfectly aligned with the actual beat grid.
    const bpmGrid = detection.bpm > 0 ? (60 / detection.bpm) / 4 : 0; // 1/16th note
    const quantizeGrid = this.config.quantizeGrid > 0
      ? this.config.quantizeGrid
      : bpmGrid;
    if (quantizeGrid > 0) {
      notes = this.quantize(notes, quantizeGrid);
    }

    onProgress?.(80); // Quantization complete

    // ── 10. Enforce minimum gaps per lane ──────────────────────────────────
    notes = this.enforceMinLaneGap(notes, profile.minLaneGap);

    // ── 11. Final sort by time ─────────────────────────────────────────────
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);

    onProgress?.(85); // Sort complete

    // ── 12. Convert sustained segments to hold notes ───────────────────────
    //    This is the core improvement: rather than randomly sprinkling holds,
    //    we detect WHERE the audio actually sustains (held vocals, long
    //    instrument notes, pads, etc.) and create hold notes for those.
    notes = this.applySustainHolds(notes, sustains, profile, rng);

    onProgress?.(90); // Hold note generation complete

    // ── 13. Remove notes hidden inside hold note ranges ────────────────────
    //    Any tap note whose time falls within a hold note's active window
    //    (in the same lane) is invisible to the player and causes phantom
    //    misses. Remove them.
    notes = this.removeNotesInsideHolds(notes);

    // ── 14. Re-enforce lane gaps after hold insertion ──────────────────────
    notes = this.enforceMinLaneGap(notes, profile.minLaneGap);

    // ── 15. Final re-sort ──────────────────────────────────────────────────
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);

    onProgress?.(100); // Complete!

    return {
      notes,
      bpm: detection.bpm,
      duration: detection.duration,
      difficulty,
      laneCount: this.config.laneCount,
    };
  }

  // ── Band energy analysis ─────────────────────────────────────────────────

  /**
   * For each onset time we want to know which frequency band is dominant.
   * Pre-compute a coarse energy-per-band array from the full track.
   *
   * Returns: Float32Array[laneCount] with normalised energy per band.
   */
  private computeBandEnergies(buffer: AudioBuffer): Float32Array {
    const pcm = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const { bandBoundaries, laneCount } = this.config;
    const N = 2048;
    const hop = 1024;
    const frames = Math.floor((pcm.length - N) / hop) + 1;

    // Accumulate energy per band across all frames
    const totalEnergy = new Float32Array(laneCount);

    // Hann window
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    }

    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const hzPerBin = sampleRate / N;

    for (let f = 0; f < frames; f++) {
      const offset = f * hop;

      // Windowed frame
      for (let i = 0; i < N; i++) {
        real[i] = (pcm[offset + i] ?? 0) * win[i];
        imag[i] = 0;
      }

      this.fft(real, imag);

      // Accumulate magnitude into bands
      const binCount = N / 2;
      for (let bin = 0; bin < binCount; bin++) {
        const freq = bin * hzPerBin;
        const mag = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);

        for (let band = 0; band < laneCount; band++) {
          if (freq >= bandBoundaries[band] && freq < bandBoundaries[band + 1]) {
            totalEnergy[band] += mag;
            break;
          }
        }
      }
    }

    // Normalise to 0–1
    let maxE = 0;
    for (let i = 0; i < laneCount; i++) {
      if (totalEnergy[i] > maxE) maxE = totalEnergy[i];
    }
    if (maxE > 0) {
      for (let i = 0; i < laneCount; i++) {
        totalEnergy[i] /= maxE;
      }
    }

    return totalEnergy;
  }

  // ── Lane assignment ──────────────────────────────────────────────────────

  /**
   * Assign a lane to a beat using musical patterns.
   * Creates recognizable patterns like waves, zigzags, and sequences
   * instead of random placements for more engaging gameplay.
   */
  private assignLane(
    beat: DetectedBeat,
    bandEnergies: Float32Array,
    _sampleRate: number,
    activeLanes: number,
    laneOffset: number,
    rng: () => number,
  ): number {
    // Use beat time scaled to create pattern index
    const timeScale = beat.time * 2; // Scale factor for pattern speed
    const patternIndex = Math.floor(timeScale) % 16;
    
    // Determine which frequency band is dominant
    let dominantBand = 0;
    let maxEnergy = 0;
    for (let i = 0; i < activeLanes; i++) {
      const bandIdx = laneOffset + i;
      const energy = bandEnergies[bandIdx] ?? 0;
      if (energy > maxEnergy) {
        maxEnergy = energy;
        dominantBand = i;
      }
    }
    
    // Choose pattern based on beat strength and RNG seed
    const patternChoice = Math.floor(rng() * 12);
    
    let lane: number;
    
    if (beat.strength > 0.7) {
      // Strong beats: Use dominant band for emphasis
      lane = dominantBand;
    } else {
      // Regular beats: Use patterns
      switch (patternChoice) {
        case 0: // Wave pattern (0,1,2,3,3,2,1,0)
          if (patternIndex < 4) {
            lane = patternIndex;
          } else {
            lane = 7 - patternIndex;
          }
          break;
          
        case 1: // Zigzag pattern (0,2,1,3,1,2,0,2)
          lane = [0, 2, 1, 3, 1, 2, 0, 2][patternIndex % 8];
          break;
          
        case 2: // Sequential with repetition (0,0,1,1,2,2,3,3)
          lane = Math.floor(patternIndex / 2) % activeLanes;
          break;
          
        case 3: // Inward spiral (0,3,1,2,1,3,0,2)
          lane = [0, 3, 1, 2, 1, 3, 0, 2][patternIndex % 8] % activeLanes;
          break;
          
        case 4: // Staircase up (0,1,2,3 diagonal run)
          lane = patternIndex % activeLanes;
          break;
          
        case 5: // Bounce-back (0,1,2,3,2,1,0,1,2,3,2,1) – the addictive flow
          lane = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3][patternIndex] % activeLanes;
          break;
          
        case 6: // Gallop (same lane repeated then jump: 0,0,0,3,3,3,1,1)
          lane = [0, 0, 0, 3, 3, 3, 1, 1, 1, 2, 2, 2, 0, 0, 3, 3][patternIndex] % activeLanes;
          break;
          
        case 7: // Trill (fast alternation between two lanes: 0,2,0,2,1,3,1,3)
          lane = [0, 2, 0, 2, 1, 3, 1, 3, 0, 2, 0, 2, 1, 3, 1, 3][patternIndex] % activeLanes;
          break;
          
        case 8: // Cascade down then up (3,2,1,0,0,1,2,3) – reverse staircase
          lane = [3, 2, 1, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3][patternIndex] % activeLanes;
          break;
          
        case 9: // Butterfly (edges in, center out: 0,3,1,2,2,1,3,0)
          lane = [0, 3, 1, 2, 2, 1, 3, 0, 0, 3, 1, 2, 2, 1, 3, 0][patternIndex] % activeLanes;
          break;
          
        case 10: // Pulse (center emphasis: 1,2,1,2,0,3,1,2)
          lane = [1, 2, 1, 2, 0, 3, 1, 2, 1, 2, 1, 2, 3, 0, 2, 1][patternIndex] % activeLanes;
          break;
          
        default: // Alternating edges to center (0,3,1,2)
          lane = [0, 3, 1, 2][patternIndex % 4] % activeLanes;
          break;
      }
      
      // Ensure lane is within active range
      lane = lane % activeLanes;
    }
    
    return laneOffset + lane;
  }

  // ── Chord expansion ──────────────────────────────────────────────────────

  /**
   * On harder difficulties, strong beats can become 2- or 3-note chords.
   * A chord is multiple notes at the same timestamp in different lanes.
   */
  private expandChords(
    notes: BeatmapNote[],
    beats: DetectedBeat[],
    profile: DifficultyProfile,
    activeLanes: number,
    laneOffset: number,
    rng: () => number,
  ): BeatmapNote[] {
    const expanded: BeatmapNote[] = [];

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const beat = beats[i];
      expanded.push(note);

      // Only expand strong beats into chords
      if (!beat || beat.strength < 0.6) continue;

      const chordSize = Math.min(
        profile.maxChordSize,
        1 + Math.floor(beat.strength * (profile.maxChordSize - 1) + rng() * 0.5),
      );

      const usedLanes = new Set<number>([note.lane]);
      for (let c = 1; c < chordSize; c++) {
        // Pick an adjacent unused lane
        let candidate = -1;
        const direction = rng() > 0.5 ? 1 : -1;
        for (let attempt = 0; attempt < activeLanes; attempt++) {
          const tryLane = note.lane + direction * (attempt + 1);
          if (
            tryLane >= laneOffset &&
            tryLane < laneOffset + activeLanes &&
            !usedLanes.has(tryLane)
          ) {
            candidate = tryLane;
            break;
          }
          // Try opposite direction
          const tryLane2 = note.lane - direction * (attempt + 1);
          if (
            tryLane2 >= laneOffset &&
            tryLane2 < laneOffset + activeLanes &&
            !usedLanes.has(tryLane2)
          ) {
            candidate = tryLane2;
            break;
          }
        }
        if (candidate >= 0) {
          usedLanes.add(candidate);
          expanded.push({ time: note.time, lane: candidate });
        }
      }
    }

    return expanded;
  }

  // ── Sustained segment detection ──────────────────────────────────────────

  /**
   * Detect segments of sustained audio energy — these correspond to held
   * vocals, long instrument notes, pads, sustained guitar, synth holds, etc.
   *
   * Algorithm:
   *   1. Compute short-time RMS energy in ~20ms windows
   *   2. Compute spectral flux (transient-ness) per window
   *   3. Look for regions where RMS energy stays above a threshold
   *      BUT spectral flux is LOW (= no new attacks, just sustain)
   *   4. Merge adjacent sustain windows into segments
   *   5. Filter by minimum duration
   *
   * Also tracks dominant frequency band per segment so the hold note
   * is assigned to the correct lane.
   */
  private detectSustainedSegments(
    buffer: AudioBuffer,
    beats: DetectedBeat[],
    minDuration: number,
  ): SustainSegment[] {
    const pcm = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const { laneCount, bandBoundaries } = this.config;

    // Analysis params
    const windowSize = Math.round(sr * 0.025); // 25ms windows
    const hopSize = Math.round(sr * 0.010);    // 10ms hop → fine resolution
    const numFrames = Math.floor((pcm.length - windowSize) / hopSize) + 1;
    if (numFrames < 10) return [];

    // 1. Compute per-frame RMS energy and spectral flux
    const rms = new Float32Array(numFrames);
    const flux = new Float32Array(numFrames);

    // Hann window
    const win = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    }

    // For spectral flux we use a small FFT
    const fftN = 512;
    const hzPerBin = sr / fftN;
    let prevMag = new Float32Array(fftN / 2);

    // Per-frame band energies for dominant-band tracking
    const frameBandEnergies: Float32Array[] = [];

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;

      // RMS
      let sumSq = 0;
      for (let i = 0; i < windowSize; i++) {
        const s = (pcm[offset + i] ?? 0) * win[i];
        sumSq += s * s;
      }
      rms[f] = Math.sqrt(sumSq / windowSize);

      // FFT for spectral flux + band energy
      const real = new Float32Array(fftN);
      const imag = new Float32Array(fftN);
      const n = Math.min(windowSize, fftN);
      for (let i = 0; i < n; i++) {
        real[i] = (pcm[offset + i] ?? 0) * (i < win.length ? win[i] : 0);
      }
      this.fft(real, imag);

      const mag = new Float32Array(fftN / 2);
      const bandE = new Float32Array(laneCount);
      let fluxVal = 0;
      for (let bin = 0; bin < fftN / 2; bin++) {
        mag[bin] = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
        const diff = mag[bin] - prevMag[bin];
        if (diff > 0) fluxVal += diff;

        const freq = bin * hzPerBin;
        for (let band = 0; band < laneCount; band++) {
          if (freq >= bandBoundaries[band] && freq < bandBoundaries[band + 1]) {
            bandE[band] += mag[bin];
            break;
          }
        }
      }
      flux[f] = fluxVal;
      prevMag = mag;
      frameBandEnergies.push(bandE);
    }

    // 2. Normalise RMS and flux to 0-1
    let maxRMS = 0, maxFlux = 0;
    for (let f = 0; f < numFrames; f++) {
      if (rms[f] > maxRMS) maxRMS = rms[f];
      if (flux[f] > maxFlux) maxFlux = flux[f];
    }
    if (maxRMS > 0) for (let f = 0; f < numFrames; f++) rms[f] /= maxRMS;
    if (maxFlux > 0) for (let f = 0; f < numFrames; f++) flux[f] /= maxFlux;

    // 3. Mark frames as "sustain" if energy is above threshold AND flux is low
    //    (high energy = something is sounding; low flux = no new onset = sustain)
    const rmsThreshold = 0.15;  // minimum energy to be considered "sounding"
    const fluxCeiling = 0.25;   // maximum flux to be considered "sustained" (no transient)
    const isSustain = new Uint8Array(numFrames);

    // Also exclude frames that are too close to a detected beat/onset
    // (those are attack transients, not sustains)
    const beatTimes = new Set<number>();
    for (const b of beats) {
      // Mark a ±30ms zone around each beat as "transient"
      const frameIdx = Math.round(b.time / (hopSize / sr));
      for (let off = -3; off <= 3; off++) {
        beatTimes.add(frameIdx + off);
      }
    }

    for (let f = 0; f < numFrames; f++) {
      if (rms[f] >= rmsThreshold && flux[f] <= fluxCeiling && !beatTimes.has(f)) {
        isSustain[f] = 1;
      }
    }

    // 4. Merge adjacent sustain frames into segments
    const segments: SustainSegment[] = [];
    let segStart = -1;

    for (let f = 0; f <= numFrames; f++) {
      if (f < numFrames && isSustain[f]) {
        if (segStart < 0) segStart = f;
      } else {
        if (segStart >= 0) {
          const startTime = (segStart * hopSize) / sr;
          const endTime = (f * hopSize) / sr;
          const duration = endTime - startTime;

          if (duration >= minDuration) {
            // Average energy across the segment
            let avgEnergy = 0;
            const bandAccum = new Float32Array(laneCount);
            for (let i = segStart; i < f; i++) {
              avgEnergy += rms[i];
              for (let b = 0; b < laneCount; b++) {
                bandAccum[b] += frameBandEnergies[i][b];
              }
            }
            avgEnergy /= (f - segStart);

            // Dominant band
            let domBand = 0;
            let domVal = 0;
            for (let b = 0; b < laneCount; b++) {
              if (bandAccum[b] > domVal) {
                domVal = bandAccum[b];
                domBand = b;
              }
            }

            segments.push({
              start: startTime,
              end: endTime,
              duration,
              energy: avgEnergy,
              dominantBand: domBand,
            });
          }
          segStart = -1;
        }
      }
    }

    return segments;
  }

  // ── Apply sustain-detected hold notes ────────────────────────────────────

  /**
   * Convert tap notes that fall within detected sustain segments into hold notes.
   * The hold duration is derived from the actual sustained audio, not random.
   *
   * Rules:
   * - If a tap note's time falls within a sustain segment, convert it to a hold
   *   whose duration matches the remaining sustain length
   * - Ensure holds don't overlap with the next note in the same lane
   * - Apply difficulty-based holdFraction to control how many sustains→holds
   * - Classify hold type (short/medium/long) from actual duration
   */
  private applySustainHolds(
    notes: BeatmapNote[],
    sustains: SustainSegment[],
    profile: DifficultyProfile,
    rng: () => number,
  ): BeatmapNote[] {
    if (notes.length < 10 || sustains.length === 0) return notes;

    // Build per-lane time index for "next note" lookups
    const laneNotes = new Map<number, number[]>();
    for (const note of notes) {
      if (!laneNotes.has(note.lane)) laneNotes.set(note.lane, []);
      laneNotes.get(note.lane)!.push(note.time);
    }
    for (const times of laneNotes.values()) {
      times.sort((a, b) => a - b);
    }

    const getNextNoteTime = (lane: number, afterTime: number): number => {
      const times = laneNotes.get(lane);
      if (!times) return Infinity;
      for (const t of times) {
        if (t > afterTime + 0.05) return t;
      }
      return Infinity;
    };

    // Sort sustains by start time for binary-search-like matching
    sustains.sort((a, b) => a.start - b.start);

    let holdCount = 0;
    let lastHoldEnd = -999;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note.holdDuration) continue; // already a hold

      // Find a sustain segment that contains this note's time
      const sustain = this.findSustainAt(sustains, note.time);
      if (!sustain) continue;

      // Probabilistic: only convert `holdFraction` of qualifying notes
      if (rng() > profile.holdFraction) continue;

      // Don't create holds too close together
      if (note.time < lastHoldEnd + 0.45) continue;

      // Calculate hold duration = remaining sustain from note's time to segment end
      let holdDuration = sustain.end - note.time;

      // Clamp to sane range
      holdDuration = Math.max(0.25, Math.min(holdDuration, 4.0));

      // Ensure hold doesn't overlap next note in same lane (leave 0.15s gap)
      const nextTime = getNextNoteTime(note.lane, note.time);
      const maxDuration = nextTime - note.time - 0.15;
      if (maxDuration < 0.25) continue; // not enough room

      holdDuration = Math.min(holdDuration, maxDuration);

      // Classify
      let holdType: HoldDuration;
      if (holdDuration <= 0.7) holdType = 'short';
      else if (holdDuration <= 1.5) holdType = 'medium';
      else holdType = 'long';

      notes[i] = {
        ...note,
        holdDuration,
        holdType,
      };
      holdCount++;
      lastHoldEnd = note.time + holdDuration;
    }

    const minHoldTarget = Math.max(1, Math.floor(notes.length * this.getMinimumHoldRatio(profile)));
    if (holdCount < minHoldTarget) {
      return this.ensureMinimumHolds(notes, profile, rng, minHoldTarget - holdCount);
    }

    return notes;
  }

  private getMinimumHoldRatio(profile: DifficultyProfile): number {
    if (profile.minLaneGap >= 0.6) return 0.04;   // easy
    if (profile.minLaneGap >= 0.3) return 0.07;   // medium
    return 0.10;                                  // hard
  }

  private ensureMinimumHolds(
    notes: BeatmapNote[],
    profile: DifficultyProfile,
    rng: () => number,
    needed: number,
  ): BeatmapNote[] {
    if (needed <= 0) return notes;

    const holdCandidates = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => !note.holdDuration)
      .sort((a, b) => a.note.time - b.note.time);

    if (holdCandidates.length === 0) return notes;

    const laneTimes = new Map<number, number[]>();
    for (const note of notes) {
      if (!laneTimes.has(note.lane)) laneTimes.set(note.lane, []);
      laneTimes.get(note.lane)!.push(note.time);
    }
    for (const times of laneTimes.values()) {
      times.sort((a, b) => a - b);
    }

    const maxByDifficulty = profile.minLaneGap >= 0.6
      ? { min: 0.35, max: 0.7 }
      : profile.minLaneGap >= 0.3
        ? { min: 0.4, max: 1.0 }
        : { min: 0.45, max: 1.35 };

    const usedWindows: Array<{ start: number; end: number }> = [];

    const getNextTimeInLane = (lane: number, after: number): number => {
      const times = laneTimes.get(lane) ?? [];
      for (const time of times) {
        if (time > after + 0.01) return time;
      }
      return Infinity;
    };

    let added = 0;
    for (let i = 0; i < holdCandidates.length && added < needed; i++) {
      const { note, index } = holdCandidates[i];

      if (i % 2 === 1 && rng() < 0.5) continue;

      const nextTime = getNextTimeInLane(note.lane, note.time);
      const maxDurationByLane = Math.max(0, nextTime - note.time - 0.15);
      const durationCap = Math.min(maxByDifficulty.max, maxDurationByLane);
      if (durationCap < maxByDifficulty.min) continue;

      const candidateDuration = Math.max(
        maxByDifficulty.min,
        Math.min(durationCap, maxByDifficulty.min + rng() * (durationCap - maxByDifficulty.min)),
      );

      const start = note.time;
      const end = note.time + candidateDuration;
      const overlaps = usedWindows.some((window) => start < window.end + 0.35 && end > window.start - 0.2);
      if (overlaps) continue;

      let holdType: HoldDuration;
      if (candidateDuration <= 0.7) holdType = 'short';
      else if (candidateDuration <= 1.5) holdType = 'medium';
      else holdType = 'long';

      notes[index] = {
        ...note,
        holdDuration: candidateDuration,
        holdType,
      };

      usedWindows.push({ start, end });
      added++;
    }

    return notes;
  }

  /**
   * Binary-search-like lookup: find the sustain segment that contains `time`.
   */
  private findSustainAt(sustains: SustainSegment[], time: number): SustainSegment | null {
    // Linear scan is fine since sustains are sorted and typically < 200 segments
    for (const s of sustains) {
      if (time >= s.start && time <= s.end - 0.2) return s;
      if (s.start > time + 1) break; // past any possible match
    }
    return null;
  }

  // ── Remove notes hidden inside holds ─────────────────────────────────────

  /**
   * After hold notes are assigned, any other note in the same lane whose hit
   * time falls within a hold note's active window is invisible to the player.
   * These phantom notes silently trigger misses. Remove them.
   *
   * Also removes any note in ANY lane that overlaps with the hold note's time
   * range if it would be too close to be playable (within 0.1s of hold start).
   */
  private removeNotesInsideHolds(notes: BeatmapNote[]): BeatmapNote[] {
    // Collect all hold note ranges per lane
    const holdRanges: { lane: number; start: number; end: number }[] = [];
    for (const note of notes) {
      if (note.holdDuration && note.holdDuration > 0) {
        holdRanges.push({
          lane: note.lane,
          start: note.time,
          end: note.time + note.holdDuration,
        });
      }
    }

    if (holdRanges.length === 0) return notes;

    return notes.filter((note) => {
      // Hold notes themselves always survive
      if (note.holdDuration && note.holdDuration > 0) return true;

      // Check if this tap note is hidden inside any hold note in the same lane
      for (const hold of holdRanges) {
        if (note.lane !== hold.lane) continue;

        // Note falls within the hold's active range (with a small buffer)
        // Allow notes that are at the exact start (that's the hold's own head)
        if (note.time > hold.start + 0.05 && note.time < hold.end + 0.1) {
          return false; // Remove — this note is invisible
        }
      }

      return true; // Keep
    });
  }

  // ── Density scaling ──────────────────────────────────────────────────────

  /**
   * Keep only `factor` fraction of onsets.
   * Deterministically selects the strongest beats to survive culling.
   */
  private applyDensity(beats: DetectedBeat[], factor: number): DetectedBeat[] {
    if (factor >= 1) return beats;

    const targetCount = Math.max(1, Math.round(beats.length * factor));
    if (beats.length <= targetCount) return beats;

    // Sort by strength descending, pick top N, then re-sort by time
    const ranked = [...beats].sort((a, b) => b.strength - a.strength);
    const kept = ranked.slice(0, targetCount);
    kept.sort((a, b) => a.time - b.time);
    return kept;
  }

  // ── Quantization ─────────────────────────────────────────────────────────

  /**
   * Snap note times to the nearest grid line.
   * Merges notes that collapse onto the same time+lane after snapping.
   */
  private quantize(notes: BeatmapNote[], grid: number): BeatmapNote[] {
    const seen = new Set<string>();
    const result: BeatmapNote[] = [];

    for (const note of notes) {
      const snapped = Math.round(note.time / grid) * grid;
      const key = `${snapped.toFixed(4)}:${note.lane}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ time: snapped, lane: note.lane });
      }
    }
    return result;
  }

  // ── Minimum gap enforcement ──────────────────────────────────────────────

  /**
   * Remove notes in the same lane that are closer than minGap seconds.
   * Keeps the earlier note.
   */
  private enforceMinLaneGap(notes: BeatmapNote[], minGap: number): BeatmapNote[] {
    // Track last kept note index per lane so we can prefer hold notes on conflicts
    const lastKeptIndexByLane = new Map<number, number>();
    const sorted = [...notes].sort((a, b) => a.time - b.time || a.lane - b.lane);
    const result: BeatmapNote[] = [];

    for (const note of sorted) {
      const lastIndex = lastKeptIndexByLane.get(note.lane);
      const prev = lastIndex !== undefined ? result[lastIndex]?.time ?? -Infinity : -Infinity;

      if (note.time - prev >= minGap) {
        result.push(note);
        lastKeptIndexByLane.set(note.lane, result.length - 1);
        continue;
      }

      const prevNote = lastIndex !== undefined ? result[lastIndex] : null;
      const currentIsHold = Boolean(note.holdDuration && note.holdDuration > 0);
      const prevIsHold = Boolean(prevNote?.holdDuration && prevNote.holdDuration > 0);

      // If two notes conflict, prefer a hold note over a tap note.
      if (lastIndex !== undefined && prevNote && currentIsHold && !prevIsHold) {
        result[lastIndex] = note;
      }
    }
    return result;
  }

  // ── Deterministic seeded PRNG ────────────────────────────────────────────

  /**
   * Simple hash of the first 10 000 PCM samples.
   * Produces a 32-bit integer seed.
   */
  private hashPCM(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    const len = Math.min(data.length, 10_000);
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < len; i++) {
      // Convert float →  deterministic integer bits
      const bits = (data[i] * 32768) | 0;
      hash ^= bits & 0xff;
      hash = Math.imul(hash, 0x01000193); // FNV prime
      hash ^= (bits >> 8) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /**
   * Mulberry32 – fast 32-bit seeded PRNG.
   * Returns a function that yields deterministic floats in [0, 1).
   */
  private createSeededRNG(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Minimal radix-2 FFT (same as BeatDetector) ──────────────────────────

  private fft(real: Float32Array, imag: Float32Array): void {
    const N = real.length;
    if (N <= 1) return;

    let j = 0;
    for (let i = 0; i < N; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      let m = N >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    for (let size = 2; size <= N; size <<= 1) {
      const halfSize = size >> 1;
      const angle = (-2 * Math.PI) / size;
      for (let i = 0; i < N; i += size) {
        for (let k = 0; k < halfSize; k++) {
          const twR = Math.cos(angle * k);
          const twI = Math.sin(angle * k);
          const eIdx = i + k;
          const oIdx = i + k + halfSize;
          const tR = twR * real[oIdx] - twI * imag[oIdx];
          const tI = twR * imag[oIdx] + twI * real[oIdx];
          real[oIdx] = real[eIdx] - tR;
          imag[oIdx] = imag[eIdx] - tI;
          real[eIdx] += tR;
          imag[eIdx] += tI;
        }
      }
    }
  }
}
