import { memo, useEffect, useState } from 'react';

interface ComboDisplayProps {
  combo: number;
}

export const ComboDisplay = memo<ComboDisplayProps>(({ combo }) => {
  const [prevCombo, setPrevCombo] = useState(combo);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (combo !== prevCombo && combo >= 10) {
      setPrevCombo(combo);
      setKey((k) => k + 1);
    }
  }, [combo, prevCombo]);

  // Only show for combos >= 10
  if (combo < 10) return null;

  return (
    <div className="combo-display" key={key}>
      <div className="combo-display__count">{combo}</div>
      <div className="combo-display__label">Combo</div>
    </div>
  );
});

ComboDisplay.displayName = 'ComboDisplay';
