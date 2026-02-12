// ─────────────────────────────────────────────────────────────────────────────
// Audio module – barrel export
// ─────────────────────────────────────────────────────────────────────────────

export { AudioEngine } from './AudioEngine';
export { AudioAnalyzer } from './AudioAnalyzer';
export { BeatDetector } from './BeatDetector';

export {
  AudioEngineState,
  AudioEngineEvent,
  type AudioEngineConfig,
  type AudioEngineEventMap,
  type AudioTimingSnapshot,
  type DecodedTrack,
} from './types';

export type { AudioAnalyzerConfig } from './AudioAnalyzer';
export type { BeatDetectorConfig, DetectedBeat, BeatDetectionResult } from './BeatDetector';
