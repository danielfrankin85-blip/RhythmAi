// ─────────────────────────────────────────────────────────────────────────────
// ScoreEngine – Hit judgment, scoring, combo, and accuracy tracking
// ─────────────────────────────────────────────────────────────────────────────

import {
  HitJudgment,
  type HitWindow,
  type ScoreState,
} from './types';
import type { HoldDuration } from '../beatmap/BeatmapGenerator';

/** Points awarded per judgment for regular tap notes. */
const JUDGMENT_POINTS: Record<HitJudgment, number> = {
  [HitJudgment.PERFECT]: 50,
  [HitJudgment.GOOD]: 25,
};

/** Points for hold notes by type and judgment. */
const HOLD_POINTS: Record<string, Record<HitJudgment, number>> = {
  short:  { [HitJudgment.PERFECT]: 75,  [HitJudgment.GOOD]: 50 },
  medium: { [HitJudgment.PERFECT]: 100, [HitJudgment.GOOD]: 75 },
  long:   { [HitJudgment.PERFECT]: 125, [HitJudgment.GOOD]: 100 },
};

/** Points deducted for a miss. */
const MISS_PENALTY = -50;

/** Combo thresholds for multiplier increases: [combo] → multiplier. Max is 6x. */
const MULTIPLIER_THRESHOLDS = [
  { combo: 0,  multiplier: 1 },
  { combo: 5,  multiplier: 2 },
  { combo: 10, multiplier: 3 },
  { combo: 20, multiplier: 4 },
  { combo: 30, multiplier: 5 },
  { combo: 50, multiplier: 6 },
];

export class ScoreEngine {
  private state: ScoreState;
  private hitWindow: HitWindow;
  // Total note count – currently unused but preserved for potential accuracy enhancements
  // private totalNotes = 0;

  constructor(hitWindow: HitWindow) {
    this.hitWindow = hitWindow;
    this.state = ScoreEngine.createInitialState();
  }

  /** Reset all scoring state for a new game. */
  reset(): void {
    this.state = ScoreEngine.createInitialState();
    // this.totalNotes = 0;
  }

  /** Set the total note count (for potential future accuracy calculation). */
  setTotalNotes(_count: number): void {
    // this.totalNotes = count;
    // Currently unused – accuracy is calculated from judgment counts
  }

  /** Return a read-only snapshot of the current score. */
  getState(): Readonly<ScoreState> {
    return this.state;
  }

  // ── Judgment ─────────────────────────────────────────────────────────────

  /**
   * Evaluate a hit attempt.
   *
   * @param timingError – Signed difference: playerHitTime − note.hitTime (seconds).
   *                      Negative = early, positive = late.
   * @returns The judgment if within any hit window, or null if out of range.
   */
  judge(timingError: number): HitJudgment | null {
    const abs = Math.abs(timingError);
    if (abs <= this.hitWindow.perfect) return HitJudgment.PERFECT;
    if (abs <= this.hitWindow.good) return HitJudgment.GOOD;
    return null;
  }

  // ── State mutations ──────────────────────────────────────────────────────

  /**
   * Record a successful hit.
   * Updates score, combo, multiplier, accuracy.
   * Returns the points earned (base points × multiplier).
   */
  registerHit(judgment: HitJudgment, holdType?: HoldDuration): { points: number; multiplier: number } {
    const s = this.state;

    // Combo
    s.combo += 1;
    if (s.combo > s.maxCombo) {
      s.maxCombo = s.combo;
    }

    // Multiplier
    s.multiplier = this.computeMultiplier(s.combo);

    // Score — use hold points if applicable
    const basePoints = holdType
      ? (HOLD_POINTS[holdType]?.[judgment] ?? JUDGMENT_POINTS[judgment])
      : JUDGMENT_POINTS[judgment];
    const points = basePoints * s.multiplier;
    s.score += points;

    // Judgment histogram
    s.judgments[judgment] += 1;

    // Accuracy
    this.recalculateAccuracy();
    
    return { points, multiplier: s.multiplier };
  }

  /**
   * Record a miss. Breaks the combo, decreases multiplier by 1 (min 1), and deducts points.
   */
  registerMiss(): void {
    const s = this.state;
    s.combo = 0;
    
    // Decrease multiplier by 1 (minimum 1)
    s.multiplier = Math.max(1, s.multiplier - 1);
    
    s.judgments.miss += 1;
    
    // Deduct points for miss (score can go negative)
    s.score += MISS_PENALTY;
    
    this.recalculateAccuracy();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private computeMultiplier(combo: number): number {
    let mult = 1;
    for (const tier of MULTIPLIER_THRESHOLDS) {
      if (combo >= tier.combo) {
        mult = tier.multiplier;
      }
    }
    return mult;
  }

  /**
   * Accuracy = weighted percentage of hit notes.
   * Perfect = 100% weight, Good = 50% weight, Miss = 0%.
   * Formula: (perfects + goods * 0.5) / (perfects + goods + misses) * 100
   */
  private recalculateAccuracy(): void {
    const { perfect, good, miss } = this.state.judgments;
    const total = perfect + good + miss;
    if (total === 0) {
      this.state.accuracy = 100;
      return;
    }
    // Weighted scoring: perfect = 100%, good = 50%, miss = 0%
    const weighted = perfect * 1.0 + good * 0.5;
    this.state.accuracy = Math.round((weighted / total) * 10000) / 100;
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  private static createInitialState(): ScoreState {
    return {
      score: 0,
      combo: 0,
      maxCombo: 0,
      multiplier: 1,
      judgments: { perfect: 0, good: 0, miss: 0 },
      accuracy: 100,
    };
  }
}
