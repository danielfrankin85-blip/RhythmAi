import { memo } from 'react';
import type { ScoreState } from '../../engine/types';
import { Scoreboard } from './Scoreboard';
import { ComboDisplay } from './ComboDisplay';
import { ProgressBar } from './ProgressBar';
import { HitFeedback } from './HitFeedback';
import { SlavaSongEffects } from './SlavaSongEffects';
import type { HitJudgment } from '../../engine/types';

interface GameUIProps {
  score: ScoreState;
  progress: number;
  lastJudgment: HitJudgment | 'miss' | null;
  judgmentKey: number;
  lastPoints: number;
  lastMultiplier: number;
  songName: string;
}

export const GameUI = memo<GameUIProps>(({ score, progress, lastJudgment, judgmentKey, lastPoints, lastMultiplier, songName }) => {
  const isSlava = songName.toLowerCase().includes('tel_aviv') || songName.toLowerCase().includes('slava');
  return (
    <div className="game__ui">
      <Scoreboard score={score} />
      <ComboDisplay combo={score.combo} />
      <HitFeedback 
        key={judgmentKey} 
        judgment={lastJudgment} 
        key_prop={judgmentKey} 
        points={lastPoints} 
        multiplier={lastMultiplier} 
      />
      <ProgressBar progress={progress} />
      {isSlava && (
        <SlavaSongEffects judgment={lastJudgment} judgmentKey={judgmentKey} combo={score.combo} />
      )}
    </div>
  );
});

GameUI.displayName = 'GameUI';
