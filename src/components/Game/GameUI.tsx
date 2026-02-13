import { memo } from 'react';
import type { ScoreState } from '../../engine/types';
import { Scoreboard } from './Scoreboard';
import { ComboDisplay } from './ComboDisplay';
import { ProgressBar } from './ProgressBar';
import { HitFeedback } from './HitFeedback';
import { SlavaSongEffects } from './SlavaSongEffects';
import type { HitJudgment } from '../../engine/types';
import type { PerfectHitSound } from '../../engine/GameEngine';

const PERFECT_HIT_SOUND_OPTIONS: Array<{ value: PerfectHitSound; label: string }> = [
  { value: 'bass', label: 'Bass Punch' },
  { value: 'guitar', label: 'Guitar Pluck' },
  { value: 'drum', label: 'Drum Hit' },
  { value: 'trumpet', label: 'Trumpet Stab' },
  { value: 'synth', label: 'Synth Pop' },
];

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
  perfectHitSound: PerfectHitSound;
  leaderboardRuns: Array<{
    score: number;
    accuracy: number;
    maxCombo: number;
    playedAt: number;
  }>;
  onMusicVolumeChange: (volume: number) => void;
  onSfxVolumeChange: (volume: number) => void;
  onPerfectHitSoundChange: (sound: PerfectHitSound) => void;
}

export const GameUI = memo<GameUIProps>(({ score, progress, lastJudgment, judgmentKey, lastPoints, lastMultiplier, songName, musicVolume, sfxVolume, perfectHitSound, leaderboardRuns, onMusicVolumeChange, onSfxVolumeChange, onPerfectHitSoundChange }) => {
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
      <div className="map-leaderboard">
        <div className="map-leaderboard__title">Leaderboard</div>
        {leaderboardRuns.length === 0 ? (
          <div className="map-leaderboard__empty">No past runs yet</div>
        ) : (
          <div className="map-leaderboard__list">
            {leaderboardRuns.slice(0, 5).map((run, index) => (
              <div key={`${run.playedAt}-${index}`} className="map-leaderboard__row">
                <span className="map-leaderboard__rank">#{index + 1}</span>
                <span className="map-leaderboard__score">{run.score.toLocaleString()}</span>
                <span className="map-leaderboard__acc">{run.accuracy.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
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
        <div className="game-volume-controls__row">
          <label className="game-volume-controls__label">Perfect Hit Sound</label>
          <select
            className="game-volume-controls__select"
            value={perfectHitSound}
            onChange={(e) => onPerfectHitSoundChange(e.target.value as PerfectHitSound)}
          >
            {PERFECT_HIT_SOUND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
      {isSlava && (
        <SlavaSongEffects judgment={lastJudgment} judgmentKey={judgmentKey} combo={score.combo} />
      )}
    </div>
  );
});

GameUI.displayName = 'GameUI';
