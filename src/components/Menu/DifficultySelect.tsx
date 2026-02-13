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
}

export const DifficultySelect = memo<DifficultySelectProps>(({ selected, onSelect }) => {
  return (
    <div className="difficulty-selector">
      <label className="difficulty-selector__label">Select Difficulty</label>
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
            <div className="difficulty-option__name">{diff.name}</div>
            <div className="difficulty-option__description">{diff.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
});

DifficultySelect.displayName = 'DifficultySelect';
