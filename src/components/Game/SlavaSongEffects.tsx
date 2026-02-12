import { memo, useState, useEffect, useRef } from 'react';
import { HitJudgment } from '../../engine/types';

interface SlavaSongEffectsProps {
  judgment: HitJudgment | 'miss' | null;
  judgmentKey: number;
  combo: number;
}

// All images in the images folder for combo spam
const ALL_IMAGES = [
  '/images/jeffery.jpg',
  '/images/israel_flag.jpg',
  '/images/diddy).jpg',
  '/images/baby_oil.webp',
];

interface FlagParticle {
  id: number;
  x: number;
  y: number;
  side: 'left' | 'right';
  rotation: number;
  scale: number;
  src: string;
}

interface SpamParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  src: string;
  motionClass: string;
}

let particleId = 0;

export const SlavaSongEffects = memo<SlavaSongEffectsProps>(({ judgment, judgmentKey, combo }) => {
  const [flags, setFlags] = useState<FlagParticle[]>([]);
  const [spamImages, setSpamImages] = useState<SpamParticle[]>([]);
  const [showMissImage, setShowMissImage] = useState(false);
  const [showYakubOverlay, setShowYakubOverlay] = useState(false);
  const [showOmegaOverlay, setShowOmegaOverlay] = useState(false);
  const missTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const omegaAudioRef = useRef<HTMLAudioElement | null>(null);
  const omegaRetryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spamTeleportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevKeyRef = useRef(0);
  const hasSpawnedCombo20ImagesRef = useRef(false);

  useEffect(() => {
    // Only trigger on actual new judgments (key changed)
    if (judgmentKey === prevKeyRef.current || judgmentKey === 0) return;
    prevKeyRef.current = judgmentKey;

    if (judgment === HitJudgment.PERFECT) {
      // Spawn a bunch of flags on both sides
      const newFlags: FlagParticle[] = [];
      const count = 8; // 8 flags per side = 16 total
      for (let i = 0; i < count; i++) {
        // Left side flags
        newFlags.push({
          id: ++particleId,
          x: 5 + Math.random() * 12,
          y: 15 + Math.random() * 60,
          side: 'left',
          rotation: -30 + Math.random() * 60,
          scale: 0.6 + Math.random() * 0.5,
          src: '/images/slava-flag.jpg',
        });
        // Right side flags
        newFlags.push({
          id: ++particleId,
          x: 83 + Math.random() * 12,
          y: 15 + Math.random() * 60,
          side: 'right',
          rotation: -30 + Math.random() * 60,
          scale: 0.6 + Math.random() * 0.5,
          src: '/images/slava-flag.jpg',
        });
      }
      setFlags(prev => [...prev, ...newFlags]);

      setTimeout(() => {
        const ids = new Set(newFlags.map(f => f.id));
        setFlags(prev => prev.filter(f => !ids.has(f.id)));
      }, 800);
    }

    if (judgment === 'miss') {
      // Show the miss image overlay
      setShowMissImage(true);
      if (missTimeoutRef.current) clearTimeout(missTimeoutRef.current);
      missTimeoutRef.current = setTimeout(() => {
        setShowMissImage(false);
      }, 300);
    }
  }, [judgment, judgmentKey, combo]);

  useEffect(() => {
    // Combo reset = streak lost -> clear streak visuals
    if (combo === 0) {
      hasSpawnedCombo20ImagesRef.current = false;
      setSpamImages([]);
      setShowYakubOverlay(false);
      setShowOmegaOverlay(false);
      return;
    }

    // Combo 20 trigger: spawn persistent image spam once per streak
    if (combo >= 20 && !hasSpawnedCombo20ImagesRef.current) {
      const newSpam: SpamParticle[] = [];
      const spamCount = 20;

      // Ensure each image appears at least once
      for (const src of ALL_IMAGES) {
        newSpam.push({
          id: ++particleId,
          x: Math.random() * 90 + 2,
          y: Math.random() * 85 + 5,
          rotation: -45 + Math.random() * 90,
          scale: 0.4 + Math.random() * 0.8,
          src,
          motionClass: `slava-spam-motion-${Math.floor(Math.random() * 4) + 1}`,
        });
      }

      // Fill the rest randomly for visual chaos
      for (let i = newSpam.length; i < spamCount; i++) {
        const src = ALL_IMAGES[Math.floor(Math.random() * ALL_IMAGES.length)];
        newSpam.push({
          id: ++particleId,
          x: Math.random() * 90 + 2,
          y: Math.random() * 85 + 5,
          rotation: -45 + Math.random() * 90,
          scale: 0.4 + Math.random() * 0.8,
          src,
          motionClass: `slava-spam-motion-${Math.floor(Math.random() * 4) + 1}`,
        });
      }

      setSpamImages(newSpam);
      hasSpawnedCombo20ImagesRef.current = true;
    }

    // Combo 30 trigger: show Yakub overlay until replaced by Omega at 40+
    if (combo >= 30 && combo < 40 && !showOmegaOverlay) {
      setShowYakubOverlay(true);
    }

    // Combo 40 trigger: replace Yakub with Omega overlay; stays until streak loss (combo reset)
    if (combo >= 40) {
      setShowYakubOverlay(false);
      setShowOmegaOverlay(true);
    }
  }, [combo, showOmegaOverlay]);

  useEffect(() => {
    // Combo 20+ active: continuously teleport spam images around the screen
    if (combo < 20 || spamImages.length === 0) {
      if (spamTeleportIntervalRef.current) {
        clearInterval(spamTeleportIntervalRef.current);
        spamTeleportIntervalRef.current = null;
      }
      return;
    }

    if (spamTeleportIntervalRef.current) {
      clearInterval(spamTeleportIntervalRef.current);
    }

    spamTeleportIntervalRef.current = setInterval(() => {
      setSpamImages(prev => prev.map(img => ({
        ...img,
        x: Math.random() * 92 + 1,
        y: Math.random() * 88 + 2,
        rotation: -65 + Math.random() * 130,
      })));
    }, 170);

    return () => {
      if (spamTeleportIntervalRef.current) {
        clearInterval(spamTeleportIntervalRef.current);
        spamTeleportIntervalRef.current = null;
      }
    };
  }, [combo, spamImages.length]);

  useEffect(() => {
    if (showOmegaOverlay) {
      const audio = omegaAudioRef.current;
      if (!audio) return;

      audio.loop = true;
      audio.volume = 1;
      void audio.play().catch(() => {
        // If blocked once, retries below will keep trying while combo remains active.
      });

      if (omegaRetryIntervalRef.current) {
        clearInterval(omegaRetryIntervalRef.current);
      }

      omegaRetryIntervalRef.current = setInterval(() => {
        if (!showOmegaOverlay) return;
        const currentAudio = omegaAudioRef.current;
        if (!currentAudio) return;
        if (currentAudio.paused) {
          currentAudio.volume = 1;
          void currentAudio.play().catch(() => {
            // Keep retrying until browser allows playback.
          });
        }
      }, 500);
      return;
    }

    if (omegaRetryIntervalRef.current) {
      clearInterval(omegaRetryIntervalRef.current);
      omegaRetryIntervalRef.current = null;
    }

    const audio = omegaAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [showOmegaOverlay]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (missTimeoutRef.current) clearTimeout(missTimeoutRef.current);
      if (omegaRetryIntervalRef.current) {
        clearInterval(omegaRetryIntervalRef.current);
        omegaRetryIntervalRef.current = null;
      }
      if (spamTeleportIntervalRef.current) {
        clearInterval(spamTeleportIntervalRef.current);
        spamTeleportIntervalRef.current = null;
      }
      if (omegaAudioRef.current) {
        omegaAudioRef.current.pause();
      }
    };
  }, []);

  return (
    <>
      {/* Flag particles */}
      {flags.map(flag => (
        <img
          key={flag.id}
          src={flag.src}
          alt=""
          className="slava-flag-particle"
          style={{
            left: `${flag.x}%`,
            top: `${flag.y}%`,
            transform: `rotate(${flag.rotation}deg) scale(${flag.scale})`,
            animationDelay: `${Math.random() * 0.1}s`,
          }}
        />
      ))}

      {/* 20+ combo image spam */}
      {spamImages.map(img => (
        <img
          key={img.id}
          src={img.src}
          alt=""
          className={`slava-spam-particle ${img.motionClass}`}
          style={{
            left: `${img.x}%`,
            top: `${img.y}%`,
            transform: `rotate(${img.rotation}deg) scale(${img.scale})`,
            animationDelay: `${Math.random() * 0.8}s`,
            animationDuration: `${1.1 + Math.random() * 1.2}s`,
          }}
        />
      ))}

      {/* 30+ combo Yakub overlay (until combo 40 replaces it) */}
      {showYakubOverlay && (
        <div className="slava-yakub-overlay">
          <img src="/images/Yakub.jpg" alt="" className="slava-yakub-image" />
        </div>
      )}

      {/* 40+ combo persistent Omega video overlay */}
      {showOmegaOverlay && (
        <div className="slava-omega-overlay">
          <video
            className="slava-omega-video"
            src="/images/HAIL_THE_OMEGA_TREE_480p.mp4"
            autoPlay
            muted
            loop
            playsInline
          />
          <audio
            ref={omegaAudioRef}
            src="/music/HAIL_THE_OMEGA_TREE_320k.mp3"
            loop
            autoPlay
            preload="auto"
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Full-screen miss overlay */}
      {showMissImage && (
        <div className="slava-miss-overlay">
          <img
            src="/images/Slava-miss.jpg"
            alt=""
            className="slava-miss-image"
          />
        </div>
      )}
    </>
  );
});

SlavaSongEffects.displayName = 'SlavaSongEffects';
