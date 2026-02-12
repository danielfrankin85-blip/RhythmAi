import { memo, useEffect, useState, useRef } from 'react';
import { getRank, type RankTier } from '../../engine/RankSystem';

interface RankDisplayProps {
  accuracy: number;
}

export const RankDisplay = memo<RankDisplayProps>(({ accuracy }) => {
  const [animState, setAnimState] = useState<'hidden' | 'entering' | 'visible'>('hidden');
  const [showParticles, setShowParticles] = useState(false);
  const tier = getRank(accuracy);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Delay before the rank appears
    const enterTimer = setTimeout(() => {
      setAnimState('entering');

      // Play rank reveal sound
      playRankSound(tier);

      // Transition to fully visible
      const visibleTimer = setTimeout(() => {
        setAnimState('visible');
        if (tier.isSpecial) {
          setShowParticles(true);
        }
      }, 600);

      return () => clearTimeout(visibleTimer);
    }, 400);

    return () => {
      clearTimeout(enterTimer);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const playRankSound = (rankTier: RankTier) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const now = ctx.currentTime;

      if (rankTier.isSpecial) {
        // SSS special sound: triumphant arpeggio
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0, now + i * 0.12);
          gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.6);
        });

        // Shimmering high harmonic
        const shimmer = ctx.createOscillator();
        const shimmerGain = ctx.createGain();
        shimmer.type = 'triangle';
        shimmer.frequency.setValueAtTime(2093, now + 0.5);
        shimmerGain.gain.setValueAtTime(0, now + 0.5);
        shimmerGain.gain.linearRampToValueAtTime(0.08, now + 0.55);
        shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
        shimmer.connect(shimmerGain);
        shimmerGain.connect(ctx.destination);
        shimmer.start(now + 0.5);
        shimmer.stop(now + 1.6);
      } else {
        // Regular rank sound: single tone, higher pitch = better rank
        const freq = rankTier.rank === 'F' ? 200 : rankTier.rank === 'D' ? 300 : 400 + accuracy * 3;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      }
    } catch {
      // Audio not available
    }
  };

  if (animState === 'hidden') return null;

  const rankStyle: React.CSSProperties = {
    color: tier.gradient ? undefined : tier.color,
    background: tier.gradient || undefined,
    WebkitBackgroundClip: tier.gradient ? 'text' : undefined,
    WebkitTextFillColor: tier.gradient ? 'transparent' : undefined,
    backgroundClip: tier.gradient ? 'text' : undefined,
  };

  return (
    <div className={`rank-display rank-display--${animState} ${tier.isSpecial ? 'rank-display--special' : ''}`}>
      <div className="rank-display__letter" style={rankStyle}>
        {tier.rank}
      </div>
      <div className="rank-display__label" style={{ color: tier.color }}>
        {tier.rank === 'SSS' ? 'PERFECT SCORE!' :
         tier.rank === 'S' ? 'SUPERB!' :
         tier.rank === 'A+' ? 'EXCELLENT!' :
         tier.rank === 'A' ? 'GREAT!' :
         tier.rank === 'B' ? 'GOOD' :
         tier.rank === 'C' ? 'OKAY' :
         tier.rank === 'D' ? 'NEEDS WORK' :
         'FAILED'}
      </div>
      {showParticles && (
        <div className="rank-display__particles">
          {Array.from({ length: 20 }).map((_, i) => (
            <span key={i} className="rank-particle" style={{
              '--delay': `${i * 0.1}s`,
              '--angle': `${(i / 20) * 360}deg`,
              '--distance': `${60 + Math.random() * 80}px`,
            } as React.CSSProperties} />
          ))}
        </div>
      )}
      {tier.isSpecial && <div className="rank-display__glow" />}
    </div>
  );
});

RankDisplay.displayName = 'RankDisplay';
