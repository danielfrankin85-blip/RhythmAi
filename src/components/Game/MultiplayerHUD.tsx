import { memo } from 'react';
import type { PlayerScore } from '../../multiplayer/MultiplayerManager';

interface MultiplayerHUDProps {
  opponentScore: PlayerScore | null;
  myScore: number;
}

export const MultiplayerHUD = memo<MultiplayerHUDProps>(({ opponentScore, myScore }) => {
  if (!opponentScore) return null;

  const ahead = myScore >= opponentScore.score;
  const diff = Math.abs(myScore - opponentScore.score);

  return (
    <div className="mp-hud">
      <div className="mp-hud__title">VS Opponent</div>
      <div className="mp-hud__opp-score">
        {opponentScore.score.toLocaleString()}
      </div>
      <div className="mp-hud__opp-combo">{opponentScore.combo}x combo</div>
      <div className={`mp-hud__diff ${ahead ? 'mp-hud__diff--ahead' : 'mp-hud__diff--behind'}`}>
        {ahead ? '+' : '-'}{diff.toLocaleString()}
      </div>
    </div>
  );
});

MultiplayerHUD.displayName = 'MultiplayerHUD';
