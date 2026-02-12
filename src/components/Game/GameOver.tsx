import { memo } from 'react';
import type { ScoreState } from '../../engine/types';
import { RankDisplay } from './RankDisplay';

interface GameOverProps {
  score: ScoreState;
  onRestart: () => void;
  onMainMenu: () => void;
}

export const GameOver = memo<GameOverProps>(({ score, onRestart, onMainMenu }) => {
  const totalNotes = score.judgments.perfect + score.judgments.good + score.judgments.miss;
  const hitRate = totalNotes > 0
    ? ((score.judgments.perfect + score.judgments.good) / totalNotes) * 100
    : 0;

  return (
    <div className="game-over">
      <h1 className="game-over__title">Game Complete!</h1>

      <RankDisplay accuracy={score.accuracy} />

      <div className="game-over__stats">
        <div className="game-over__stat">
          <span className="game-over__stat-label">Final Score</span>
          <span className="game-over__stat-value">{score.score.toLocaleString()}</span>
        </div>

        <div className="game-over__stat">
          <span className="game-over__stat-label">Max Combo</span>
          <span className="game-over__stat-value">{score.maxCombo}x</span>
        </div>

        <div className="game-over__stat">
          <span className="game-over__stat-label">Accuracy</span>
          <span className="game-over__stat-value">{score.accuracy.toFixed(2)}%</span>
        </div>

        <div className="game-over__stat">
          <span className="game-over__stat-label">Hit Rate</span>
          <span className="game-over__stat-value">{hitRate.toFixed(1)}%</span>
        </div>

        <div className="game-over__stat">
          <span className="game-over__stat-label">Perfect</span>
          <span className="game-over__stat-value" style={{ color: 'var(--color-perfect)' }}>
            {score.judgments.perfect}
          </span>
        </div>

        <div className="game-over__stat">
          <span className="game-over__stat-label">Good</span>
          <span className="game-over__stat-value" style={{ color: 'var(--color-good)' }}>
            {score.judgments.good}
          </span>
        </div>

        <div className="game-over__stat">
          <span className="game-over__stat-label">Miss</span>
          <span className="game-over__stat-value" style={{ color: 'var(--color-miss)' }}>
            {score.judgments.miss}
          </span>
        </div>
      </div>

      <div className="game-over__actions">
        <button className="btn btn-success" onClick={onRestart}>
          Play Again
        </button>
        <button className="btn" onClick={onMainMenu}>
          Main Menu
        </button>
      </div>
    </div>
  );
});

GameOver.displayName = 'GameOver';
