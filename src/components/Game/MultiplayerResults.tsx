import { memo } from 'react';
import type { PlayerScore } from '../../multiplayer/MultiplayerManager';

interface MultiplayerResultsProps {
  myScore: PlayerScore;
  opponentScore: PlayerScore | null;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

export const MultiplayerResults = memo<MultiplayerResultsProps>(({
  myScore,
  opponentScore,
  onPlayAgain,
  onMainMenu,
}) => {
  const waiting = !opponentScore;
  const won = opponentScore ? myScore.score > opponentScore.score : false;
  const tied = opponentScore ? myScore.score === opponentScore.score : false;

  const resultText = waiting
    ? 'Waiting for opponent...'
    : won
    ? 'You Win!'
    : tied
    ? "It's a Tie!"
    : 'You Lose!';

  const resultClass = waiting
    ? ''
    : won
    ? 'mp-results__verdict--win'
    : tied
    ? 'mp-results__verdict--tie'
    : 'mp-results__verdict--lose';

  return (
    <div className="mp-results">
      <h1 className={`mp-results__verdict ${resultClass}`}>{resultText}</h1>

      <div className="mp-results__cards">
        {/* My score */}
        <div className={`mp-results__card ${(won || tied) ? 'mp-results__card--winner' : ''}`}>
          <div className="mp-results__card-title">You</div>
          <div className="mp-results__card-score">{myScore.score.toLocaleString()}</div>
          <div className="mp-results__card-stat">Accuracy: {myScore.accuracy.toFixed(1)}%</div>
          <div className="mp-results__card-stat">Max Combo: {myScore.maxCombo}x</div>
          <div className="mp-results__card-stat">
            P: {myScore.judgments.perfect} / G: {myScore.judgments.good} / M: {myScore.judgments.miss}
          </div>
        </div>

        {/* Opponent score */}
        <div className={`mp-results__card ${opponentScore && !won && !tied ? 'mp-results__card--winner' : ''}`}>
          <div className="mp-results__card-title">Opponent</div>
          {opponentScore ? (
            <>
              <div className="mp-results__card-score">{opponentScore.score.toLocaleString()}</div>
              <div className="mp-results__card-stat">Accuracy: {opponentScore.accuracy.toFixed(1)}%</div>
              <div className="mp-results__card-stat">Max Combo: {opponentScore.maxCombo}x</div>
              <div className="mp-results__card-stat">
                P: {opponentScore.judgments.perfect} / G: {opponentScore.judgments.good} / M: {opponentScore.judgments.miss}
              </div>
            </>
          ) : (
            <div className="mp-results__card-waiting">
              <div className="loading__spinner" />
              <span>Still playing...</span>
            </div>
          )}
        </div>
      </div>

      {!waiting && (
        <div className="mp-results__actions">
          <button className="btn btn-success" onClick={onPlayAgain}>
            Play Again
          </button>
          <button className="btn" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
      )}
    </div>
  );
});

MultiplayerResults.displayName = 'MultiplayerResults';
