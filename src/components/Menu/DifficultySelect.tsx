import { memo } from 'react';
import type { Difficulty } from '../../beatmap/BeatmapGenerator';

interface DifficultyOption {
  value: Difficulty;
  name: string;
  description: string;
}

const DIFFICULTIES: DifficultyOption[] = [
  { value: 'easy', name: 'Easy', description: 'Sparse notes, 3 lanes' },
  { value: 'medium', name: 'Medium', description: 'Moderate density, 4 lanes' },
  { value: 'hard', name: 'Hard', description: 'Dense notes, 4 lanes' },
  { value: 'extreme', name: 'Extreme', description: 'Insane density + chords' },
  { value: 'deadly', name: 'Deadly', description: 'Pure chaos, good luck' },
];

interface DifficultySelectProps {
  selected: Difficulty;
  onSelect: (difficulty: Difficulty) => void;
  bestByDifficulty?: Partial<Record<Difficulty, { bestScore: number; bestAccuracy: number }>>;
}

export const DifficultySelect = memo<DifficultySelectProps>(({ selected, onSelect, bestByDifficulty }) => {
  return (
    <div className="difficulty-selector">
      <div className="difficulty-selector__options">
        {DIFFICULTIES.map((diff) => (
          <button
            key={diff.value}
            className={`difficulty-option ${diff.value} ${
              selected === diff.value ? 'selected' : ''
            }`}
            onClick={() => onSelect(diff.value)}
            type="button"
          >
            <div className="difficulty-option__name">{diff.name.toLowerCase()}</div>
            {bestByDifficulty?.[diff.value] && (
              <div className="difficulty-option__best">
                Best: {bestByDifficulty[diff.value]!.bestScore.toLocaleString()} • {bestByDifficulty[diff.value]!.bestAccuracy.toFixed(2)}%
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});

DifficultySelect.displayName = 'DifficultySelect';
