import type { Difficulty } from '../../../beatmap/BeatmapGenerator';
import type { DifficultyOption } from './types';

interface DifficultyPanelProps {
  selectedDifficulty: Difficulty | null;
  onDifficultySelect: (difficulty: Difficulty) => void;
}

const DIFFICULTIES: DifficultyOption[] = [
  { value: 'easy', label: 'easy' },
  { value: 'medium', label: 'medium' },
  { value: 'hard', label: 'hard' },
  { value: 'extreme', label: 'extreme' },
  { value: 'deadly', label: 'deadly' },
];

export function DifficultyPanel({ selectedDifficulty, onDifficultySelect }: DifficultyPanelProps) {
  const selectedIndex = DIFFICULTIES.findIndex((difficulty) => difficulty.value === selectedDifficulty);

  const moveSelection = (delta: number) => {
    const startIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = (startIndex + delta + DIFFICULTIES.length) % DIFFICULTIES.length;
    onDifficultySelect(DIFFICULTIES[nextIndex].value);
  };

  return (
    <section className="rounded-xl border border-game-border bg-game-surface p-4">
      <h2 id="difficulty-heading" className="mb-3 text-lg font-semibold text-game-text">
        Difficulty
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="difficulty-heading"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveSelection(1);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(-1);
          }
          if ((event.key === 'Enter' || event.key === ' ') && selectedIndex >= 0) {
            event.preventDefault();
            onDifficultySelect(DIFFICULTIES[selectedIndex].value);
          }
        }}
        className="space-y-2"
      >
        {DIFFICULTIES.map((difficulty) => {
          const isSelected = difficulty.value === selectedDifficulty;
          return (
            <button
              key={difficulty.value}
              role="radio"
              aria-checked={isSelected}
              onClick={() => onDifficultySelect(difficulty.value)}
              className={`w-full rounded-md border px-3 py-3 text-left text-sm font-medium uppercase tracking-wide transition ${
                isSelected
                  ? 'border-game-accent bg-sky-500/15 text-game-text shadow-glow'
                  : 'border-game-border bg-game-panel text-game-text hover:border-sky-300/50 hover:bg-slate-700/40'
              }`}
            >
              {difficulty.label}
              {isSelected && <span className="ml-2 text-xs text-sky-300">selected</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
