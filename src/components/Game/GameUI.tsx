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
  musicVolume: number;
  sfxVolume: number;
  onMusicVolumeChange: (volume: number) => void;
  onSfxVolumeChange: (volume: number) => void;
}

export const GameUI = memo<GameUIProps>(({ score, progress, lastJudgment, judgmentKey, lastPoints, lastMultiplier, songName, musicVolume, sfxVolume, onMusicVolumeChange, onSfxVolumeChange }) => {
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
      <div className="game-volume-controls">
        <div className="game-volume-controls__row">
          <label className="game-volume-controls__label">Music {Math.round(musicVolume * 100)}%</label>
          <input
            className="game-volume-controls__slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={musicVolume}
            onChange={(e) => onMusicVolumeChange(Number(e.target.value))}
          />
        </div>
        <div className="game-volume-controls__row">
          <label className="game-volume-controls__label">Perfect Beat {Math.round(sfxVolume * 100)}%</label>
          <input
            className="game-volume-controls__slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sfxVolume}
            onChange={(e) => onSfxVolumeChange(Number(e.target.value))}
          />
        </div>
      </div>
      {isSlava && (
        <SlavaSongEffects judgment={lastJudgment} judgmentKey={judgmentKey} combo={score.combo} />
      )}
    </div>
  );
});

GameUI.displayName = 'GameUI';
