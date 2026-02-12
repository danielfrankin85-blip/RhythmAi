import { memo } from 'react';
import type { ScoreState } from '../../engine/types';

interface ScoreboardProps {
  score: ScoreState;
}

export const Scoreboard = memo<ScoreboardProps>(({ score }) => {
  const isMaxMultiplier = score.multiplier >= 6;
  
  return (
    <div className="scoreboard">
      <div className="scoreboard__left">
        <div className="scoreboard__item scoreboard__item--score">
          {score.score.toLocaleString()}
        </div>
        <div className="scoreboard__item scoreboard__item--accuracy">
          {score.accuracy.toFixed(1)}%
        </div>
      </div>

      <div className="scoreboard__right">
        <div className="scoreboard__item scoreboard__item--combo">
          {score.combo}x
        </div>
        <div className={`scoreboard__item scoreboard__item--multiplier ${isMaxMultiplier ? 'max-multiplier' : ''}`}>
          ×{score.multiplier}
        </div>
      </div>
    </div>
  );
});

Scoreboard.displayName = 'Scoreboard';
