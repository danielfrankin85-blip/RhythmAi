// ─────────────────────────────────────────────────────────────────────────────
// RankSystem – Clean, modular accuracy-based ranking
// ─────────────────────────────────────────────────────────────────────────────
//
//  Easily adjustable thresholds and colors.
//  Just edit the RANK_TIERS array to change the scale.
//
// ─────────────────────────────────────────────────────────────────────────────

export interface RankTier {
  /** Display label (e.g. "SSS", "A+"). */
  rank: string;
  /** Minimum accuracy % to achieve this rank (inclusive). */
  minAccuracy: number;
  /** CSS color for the rank text. */
  color: string;
  /** Optional CSS background/gradient for special ranks. */
  gradient?: string;
  /** Whether this rank triggers special effects. */
  isSpecial?: boolean;
}

/**
 * Rank tiers ordered from highest to lowest.
 * To adjust thresholds, simply edit the minAccuracy values.
 */
const RANK_TIERS: RankTier[] = [
  {
    rank: 'SSS',
    minAccuracy: 100,
    color: '#ffd700',
    gradient: 'linear-gradient(135deg, #ffd700 0%, #ffaa00 25%, #fff5b0 50%, #ffaa00 75%, #ffd700 100%)',
    isSpecial: true,
  },
  {
    rank: 'S',
    minAccuracy: 97,
    color: '#ffe033',
  },
  {
    rank: 'A+',
    minAccuracy: 93,
    color: '#2ecc71',
  },
  {
    rank: 'A',
    minAccuracy: 88,
    color: '#27ae60',
  },
  {
    rank: 'B',
    minAccuracy: 80,
    color: '#3498db',
  },
  {
    rank: 'C',
    minAccuracy: 70,
    color: '#e67e22',
  },
  {
    rank: 'D',
    minAccuracy: 60,
    color: '#e74c3c',
  },
  {
    rank: 'F',
    minAccuracy: 0,
    color: '#8b0000',
  },
];

/**
 * Determine the rank tier for a given accuracy percentage.
 */
export function getRank(accuracy: number): RankTier {
  for (const tier of RANK_TIERS) {
    if (accuracy >= tier.minAccuracy) {
      return tier;
    }
  }
  // Fallback (should never reach here)
  return RANK_TIERS[RANK_TIERS.length - 1];
}

/**
 * Get all rank tiers (for display in help/info screens).
 */
export function getAllRanks(): ReadonlyArray<RankTier> {
  return RANK_TIERS;
}
