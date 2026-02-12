import { memo, useEffect, useState } from 'react';
import { HitJudgment } from '../../engine/types';

interface HitFeedbackProps {
  judgment: HitJudgment | 'miss' | null;
  key_prop?: number;
  points: number;
  multiplier: number;
}

export const HitFeedback = memo<HitFeedbackProps>(({ judgment, key_prop, points, multiplier }) => {
  const [visible, setVisible] = useState(false);
  const [currentJudgment, setCurrentJudgment] = useState<HitJudgment | 'miss' | null>(null);
  const [currentPoints, setCurrentPoints] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState(1);

  useEffect(() => {
    // key_prop changes on every hit, so this effect runs for each new judgment
    if (judgment && key_prop !== undefined) {
      setCurrentJudgment(judgment);
      setCurrentPoints(points);
      setCurrentMultiplier(multiplier);
      setVisible(true);

      const timer = setTimeout(() => {
        setVisible(false);
      }, 600);

      return () => clearTimeout(timer);
    }
  }, [key_prop]); // Only depend on key_prop which increments every hit

  if (!visible || !currentJudgment) return null;

  const text = currentJudgment === HitJudgment.PERFECT
    ? 'PERFECT!'
    : currentJudgment === HitJudgment.GOOD
    ? 'GOOD'
    : 'MISS';

  return (
    <div className="hit-feedback">
      <div className={`hit-feedback__text ${currentJudgment}`}>
        <div className="hit-feedback__judgment">{text}</div>
        <div className="hit-feedback__points">
          {currentPoints > 0 ? '+' : ''}{currentPoints}
          {currentMultiplier > 0 && <span className="hit-feedback__multiplier"> ×{currentMultiplier}</span>}
        </div>
      </div>
    </div>
  );
});

HitFeedback.displayName = 'HitFeedback';
