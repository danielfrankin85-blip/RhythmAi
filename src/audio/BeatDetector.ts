// ─────────────────────────────────────────────────────────────────────────────
// BeatDetector – Offline beat/onset detection from an AudioBuffer
// ─────────────────────────────────────────────────────────────────────────────
//
//  Uses spectral flux analysis to find note onsets in a decoded audio buffer.
//  This runs offline (not in real-time) and produces an array of timestamps
//  that can be fed into the BeatmapGenerator.
//
//  Algorithm overview:
//    1. Extract PCM data from AudioBuffer (mono-mixed)
//    2. Divide into overlapping windows
//    3. Compute FFT magnitude spectrum per window
//    4. Calculate spectral flux (positive half-wave rectified difference)
//    5. Adaptive thresholding to pick peaks
//    6. Return array of onset timestamps
//
// ─────────────────────────────────────────────────────────────────────────────

export interface BeatDetectorConfig {
  /** FFT window size (power of 2). Default 1024. */
  fftSize: number;
  /** Hop size between consecutive windows. Default fftSize / 2. */
  hopSize: number;
  /** Multiplier above the local average to count as a peak. Default 1.5. */
  thresholdMultiplier: number;
  /** Number of frames for the local-average window. Default 10. */
  thresholdWindowSize: number;
  /** Minimum gap between detected onsets in seconds. Default 0.1. */
  minOnsetGap: number;
  /** Sensitivity 0–1 (lower = fewer onsets). Default 0.5. */
  sensitivity: number;
}

export interface DetectedBeat {
  /** Time in seconds from the start of the track. */
  time: number;
  /** Relative strength / energy at the onset (0–1 normalized). */
  strength: number;
}

export interface BeatDetectionResult {
  beats: DetectedBeat[];
  /** Estimated BPM (most dominant tempo). */
  bpm: number;
  /** Duration of the analysed audio (seconds). */
  duration: number;
}

const DEFAULT_CONFIG: BeatDetectorConfig = {
  fftSize: 1024,
  hopSize: 512,
  thresholdMultiplier: 1.5,
  thresholdWindowSize: 10,
  minOnsetGap: 0.1,
  sensitivity: 0.5,
};

export class BeatDetector {
  private config: BeatDetectorConfig;

  constructor(config: Partial<BeatDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!this.config.hopSize) {
      this.config.hopSize = this.config.fftSize / 2;
    }
  }

  /**
   * Analyse an AudioBuffer and return detected onsets + estimated BPM.
   *
   * This is a CPU-intensive operation. For large files, consider wrapping
   * the call in a Web Worker via `detectBeatsInWorker()`.
   */
  detect(audioBuffer: AudioBuffer): BeatDetectionResult {
    const monoData = this.mixToMono(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    // 1. Compute spectral flux
    const flux = this.computeSpectralFlux(monoData, sampleRate);

    // 2. Pick peaks via adaptive threshold
    const rawOnsets = this.pickPeaks(flux, sampleRate);

    // 3. Enforce minimum onset gap
    const beats = this.enforceMinGap(rawOnsets);

    // 4. Estimate BPM from inter-onset intervals
    const bpm = this.estimateBPM(beats);

    return {
      beats,
      bpm,
      duration: audioBuffer.duration,
    };
  }

  // ── Spectral Flux ───────────────────────────────────────────────────────

  private computeSpectralFlux(samples: Float32Array, _sampleRate: number): Float32Array {
    const { fftSize, hopSize } = this.config;
    const numFrames = Math.floor((samples.length - fftSize) / hopSize) + 1;
    const flux = new Float32Array(numFrames);

    // Hann window (pre-compute once)
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    const binCount = fftSize / 2;
    let prevMagnitudes = new Float32Array(binCount);

    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * hopSize;

      // Extract windowed frame
      const real = new Float32Array(fftSize);
      const imag = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        real[i] = (samples[offset + i] ?? 0) * window[i];
      }

      // In-place FFT
      this.fft(real, imag);

      // Compute magnitude spectrum
      const magnitudes = new Float32Array(binCount);
      for (let i = 0; i < binCount; i++) {
        magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      }

      // Spectral flux: sum of positive differences only (half-wave rectification)
      let fluxValue = 0;
      for (let i = 0; i < binCount; i++) {
        const diff = magnitudes[i] - prevMagnitudes[i];
        if (diff > 0) fluxValue += diff;
      }
      flux[frame] = fluxValue;

      prevMagnitudes = magnitudes;
    }

    return flux;
  }

  // ── Peak Picking ────────────────────────────────────────────────────────

  private pickPeaks(flux: Float32Array, sampleRate: number): DetectedBeat[] {
    const { thresholdMultiplier, thresholdWindowSize, sensitivity, hopSize } = this.config;
    const beats: DetectedBeat[] = [];

    // Adaptive threshold: local mean × multiplier, scaled by sensitivity
    const adjustedMultiplier = thresholdMultiplier * (2 - sensitivity * 1.5);

    // Normalize flux to 0–1 for strength values
    let maxFlux = 0;
    for (let i = 0; i < flux.length; i++) {
      if (flux[i] > maxFlux) maxFlux = flux[i];
    }
    if (maxFlux === 0) return beats;

    for (let i = 1; i < flux.length - 1; i++) {
      // Local mean over surrounding window
      const windowStart = Math.max(0, i - thresholdWindowSize);
      const windowEnd = Math.min(flux.length - 1, i + thresholdWindowSize);
      let localSum = 0;
      for (let j = windowStart; j <= windowEnd; j++) {
        localSum += flux[j];
      }
      const localMean = localSum / (windowEnd - windowStart + 1);

      const threshold = localMean * adjustedMultiplier;

      // Must be a local maximum AND above threshold
      if (flux[i] > threshold && flux[i] > flux[i - 1] && flux[i] > flux[i + 1]) {
        const time = (i * hopSize) / sampleRate;
        const strength = flux[i] / maxFlux;
        beats.push({ time, strength });
      }
    }

    return beats;
  }

  // ── Post-processing ─────────────────────────────────────────────────────

  private enforceMinGap(beats: DetectedBeat[]): DetectedBeat[] {
    if (beats.length === 0) return beats;

    const filtered: DetectedBeat[] = [beats[0]];
    for (let i = 1; i < beats.length; i++) {
      const gap = beats[i].time - filtered[filtered.length - 1].time;
      if (gap >= this.config.minOnsetGap) {
        filtered.push(beats[i]);
      } else if (beats[i].strength > filtered[filtered.length - 1].strength) {
        // Keep the stronger one within the gap window
        filtered[filtered.length - 1] = beats[i];
      }
    }
    return filtered;
  }

  // ── BPM Estimation ──────────────────────────────────────────────────────

  private estimateBPM(beats: DetectedBeat[]): number {
    if (beats.length < 4) return 120; // fallback

    // Collect inter-onset intervals
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      intervals.push(beats[i].time - beats[i - 1].time);
    }

    // Histogram-based BPM estimation (10ms bins)
    const bpmCounts = new Map<number, number>();
    for (const interval of intervals) {
      if (interval <= 0) continue;
      const bpm = Math.round(60 / interval);
      if (bpm >= 60 && bpm <= 240) {
        const rounded = Math.round(bpm / 2) * 2; // round to nearest 2
        bpmCounts.set(rounded, (bpmCounts.get(rounded) ?? 0) + 1);
      }
    }

    // Find the most common BPM
    let bestBPM = 120;
    let bestCount = 0;
    for (const [bpm, count] of bpmCounts) {
      if (count > bestCount) {
        bestBPM = bpm;
        bestCount = count;
      }
    }

    return bestBPM;
  }

  // ── Utilities ───────────────────────────────────────────────────────────

  /**
   * Mix all channels down to mono by averaging.
   */
  private mixToMono(buffer: AudioBuffer): Float32Array {
    const length = buffer.length;
    const channels = buffer.numberOfChannels;

    if (channels === 1) {
      return buffer.getChannelData(0);
    }

    const mono = new Float32Array(length);
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i];
      }
    }

    const scale = 1 / channels;
    for (let i = 0; i < length; i++) {
      mono[i] *= scale;
    }

    return mono;
  }

  /**
   * Radix-2 Cooley–Tukey in-place FFT.
   * Operates on real[] and imag[] arrays of length N (must be power of 2).
   */
  private fft(real: Float32Array, imag: Float32Array): void {
    const N = real.length;
    if (N <= 1) return;

    // Bit-reversal permutation
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

    // Butterfly operations
    for (let size = 2; size <= N; size <<= 1) {
      const halfSize = size >> 1;
      const angle = (-2 * Math.PI) / size;

      for (let i = 0; i < N; i += size) {
        for (let k = 0; k < halfSize; k++) {
          const twiddleReal = Math.cos(angle * k);
          const twiddleImag = Math.sin(angle * k);

          const evenIdx = i + k;
          const oddIdx = i + k + halfSize;

          const tReal = twiddleReal * real[oddIdx] - twiddleImag * imag[oddIdx];
          const tImag = twiddleReal * imag[oddIdx] + twiddleImag * real[oddIdx];

          real[oddIdx] = real[evenIdx] - tReal;
          imag[oddIdx] = imag[evenIdx] - tImag;
          real[evenIdx] += tReal;
          imag[evenIdx] += tImag;
        }
      }
    }
  }
}
