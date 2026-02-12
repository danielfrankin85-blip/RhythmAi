import { memo } from 'react';

interface ProgressBarProps {
  /** Current progress 0–1. */
  progress: number;
}

export const ProgressBar = memo<ProgressBarProps>(({ progress }) => {
  const percent = Math.max(0, Math.min(100, progress * 100));

  return (
    <div className="progress-bar">
      <div
        className="progress-bar__fill"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';
