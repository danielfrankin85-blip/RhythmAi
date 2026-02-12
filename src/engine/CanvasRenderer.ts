// ─────────────────────────────────────────────────────────────────────────────
// CanvasRenderer – Pure rendering layer (no game logic)
// ─────────────────────────────────────────────────────────────────────────────
//
//  Receives a RenderState snapshot each frame and draws everything.
//  Owns no mutable game state – purely functional "state in → pixels out".
//
//  Layers (drawn back to front):
//    1. Background
//    2. Highway lanes + dividers
//    3. Hit zone / target line
//    4. Notes (active, hit flash, miss fade)
//    5. Lane press glow
//    6. Combo / hit splash effects
//
// ─────────────────────────────────────────────────────────────────────────────

import {
  NoteState,
  HitJudgment,
  GameState,
  type RenderState,
  type RendererConfig,
} from './types';

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_LANE_COLORS = [
  '#e74c3c', // red
  '#2ecc71', // green
  '#3498db', // blue
  '#f1c40f', // yellow
];

const DEFAULT_RENDERER_CONFIG: RendererConfig = {
  hitZoneOffset: 150,
  noteWidth: 60,
  noteHeight: 36,
  laneColors: DEFAULT_LANE_COLORS,
  backgroundColor: '#0a0a0f',
  highwayLineColor: 'rgba(255, 255, 255, 0.08)',
};

// ── Renderer ─────────────────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: RendererConfig;
  private dpr = 1;

  // Pre-computed per-lane geometry (recalculated on resize)
  private laneWidth = 0;
  private laneXPositions: number[] = [];
  private highwayLeft = 0;
  private highwayWidth = 0;
  private hitZoneY = 0;

  // Splash effect pool
  private splashes: Splash[] = [];

  constructor(canvas: HTMLCanvasElement, config?: Partial<RendererConfig>) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('CanvasRenderer: Failed to get 2D context.');
    this.ctx = ctx;

    this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };
    this.handleResize();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Call when canvas / window is resized. */
  handleResize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.recalculateGeometry(rect.width, rect.height);
  }

  /** The main draw call – invoke once per rAF. */
  render(state: RenderState): void {
    const { ctx } = this;
    const w = state.width;
    const h = state.height;

    // Recalculate geometry if size changed
    if (this.laneWidth === 0) {
      this.recalculateGeometry(w, h);
    }

    ctx.clearRect(0, 0, w, h);

    this.drawBackground(w, h);
    this.drawHighway(w, h, state.config.laneCount);
    this.drawHitZone(state.config.laneCount);
    this.drawKeybindLabels(state.config.keyBindings, state.config.laneCount);
    this.drawNotes(state);
    this.drawLanePressGlow(state);
    this.drawSplashes(state.songTime);

    if (state.gameState === GameState.PAUSED) {
      this.drawPauseOverlay(w, h);
    }
  }

  /** Queue a hit-splash effect at a lane position. */
  addSplash(lane: number, judgment: HitJudgment, songTime: number): void {
    this.splashes.push({
      lane,
      judgment,
      startTime: songTime,
      duration: 0.4,
    });
  }

  /** Return the CSS-pixel dimensions. */
  getSize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  /** Get the Y-position of the hit zone (CSS pixels from top). */
  getHitZoneY(): number {
    return this.hitZoneY;
  }

  // ── Geometry ─────────────────────────────────────────────────────────────

  private recalculateGeometry(canvasW: number, canvasH: number): void {
    const lanes = this.config.laneColors.length;
    const maxHighwayWidth = Math.min(canvasW * 0.6, lanes * 100);
    this.laneWidth = Math.floor(maxHighwayWidth / lanes);
    this.highwayWidth = this.laneWidth * lanes;
    this.highwayLeft = Math.floor((canvasW - this.highwayWidth) / 2);

    this.laneXPositions = [];
    for (let i = 0; i < lanes; i++) {
      this.laneXPositions.push(this.highwayLeft + i * this.laneWidth);
    }

    this.hitZoneY = canvasH - this.config.hitZoneOffset;
  }

  // ── Drawing layers ───────────────────────────────────────────────────────

  private drawBackground(w: number, h: number): void {
    const { ctx, config } = this;
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, w, h);
  }

  private drawHighway(_w: number, h: number, laneCount: number): void {
    const { ctx, highwayLeft, highwayWidth, laneWidth, config } = this;

    // Highway background (slightly lighter)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(highwayLeft, 0, highwayWidth, h);

    // Lane divider lines
    ctx.strokeStyle = config.highwayLineColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= laneCount; i++) {
      const x = highwayLeft + i * laneWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal scroll lines (moving grid for depth perception)
    // Static faint lines every 80px
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    for (let y = 0; y < h; y += 80) {
      ctx.beginPath();
      ctx.moveTo(highwayLeft, y);
      ctx.lineTo(highwayLeft + highwayWidth, y);
      ctx.stroke();
    }
  }

  private drawHitZone(laneCount: number): void {
    const { ctx, hitZoneY, highwayLeft, highwayWidth } = this;

    // Glowing target line
    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(highwayLeft, hitZoneY);
    ctx.lineTo(highwayLeft + highwayWidth, hitZoneY);
    ctx.stroke();
    ctx.restore();

    // Per-lane target circles
    for (let i = 0; i < laneCount; i++) {
      const cx = this.laneXPositions[i] + this.laneWidth / 2;
      ctx.beginPath();
      ctx.arc(cx, hitZoneY, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /**
   * Draw keybind labels directly under each hit target circle.
   * Dynamic: reads from the config so changes auto-update.
   */
  private drawKeybindLabels(keyBindings: string[], laneCount: number): void {
    const { ctx, hitZoneY } = this;

    ctx.save();
    ctx.font = 'bold 24px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Map arrow keys to unicode arrow symbols
    const arrowMap: Record<string, string> = {
      'ARROWDOWN': '↓',
      'ARROWLEFT': '←',
      'ARROWRIGHT': '→',
      'ARROWUP': '↑',
    };

    for (let i = 0; i < laneCount; i++) {
      const cx = this.laneXPositions[i] + this.laneWidth / 2;
      const rawKey = (keyBindings[i] ?? '').toUpperCase();
      const label = arrowMap[rawKey] || rawKey;

      // Subtle glow behind text
      ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(label, cx, hitZoneY + 26);

      // Crisp text on top
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(label, cx, hitZoneY + 26);
    }

    ctx.restore();
  }

  private drawNotes(state: RenderState): void {
    const { ctx, config, laneWidth } = this;
    const noteW = config.noteWidth;
    const noteH = config.noteHeight;

    for (const note of state.notes) {
      const laneX = this.laneXPositions[note.lane];
      if (laneX === undefined) continue;

      const cx = laneX + (laneWidth - noteW) / 2;
      const cy = note.y - noteH / 2;

      let alpha = 1;
      let color = config.laneColors[note.lane % config.laneColors.length];

      if (note.state === NoteState.HIT) {
        // Don't fade hold notes while they're being held
        if (note.isBeingHeld) {
          alpha = 1;
          color = config.laneColors[note.lane % config.laneColors.length];
        } else {
          // Flash white then fade out (only after hold is complete)
          const elapsed = state.songTime - (note.judgedAt ?? state.songTime);
          alpha = Math.max(0, 1 - elapsed / 0.3);
          color = note.judgment === HitJudgment.PERFECT ? '#ffffff' : '#ccffcc';
        }
      } else if (note.state === NoteState.MISSED) {
        alpha = 0.25;
        color = '#666666';
      }

      if (alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = alpha;

      // ── Hold note rendering ──────────────────────────────────────────
      if (note.holdDuration && note.holdDuration > 0) {
        const holdHeight = note.holdDuration * state.config.scrollSpeed;
        const tailY = cy - holdHeight; // Tail extends upward (earlier in time)
        const bodyWidth = noteW * 0.6;
        const bodyX = laneX + (laneWidth - bodyWidth) / 2;

        // Calculate progress for visual feedback
        const holdStart = note.judgedAt ?? note.time;
        const holdEnd = note.time + note.holdDuration;
        const progress = note.isBeingHeld 
          ? Math.min(1, (state.songTime - holdStart) / (holdEnd - holdStart))
          : 0;

        // Hold body (the long bar)
        if (note.state === NoteState.ACTIVE || note.isBeingHeld) {
          // Active hold: glowing body
          const isHeld = note.isBeingHeld;
          
          // Outer glow
          ctx.shadowColor = isHeld ? '#ffffff' : color;
          ctx.shadowBlur = isHeld ? 20 : 8;

          // Body gradient - more vibrant
          const gradient = ctx.createLinearGradient(0, tailY, 0, cy + noteH);
          if (isHeld) {
            // Being held: bright gradient showing consumption
            gradient.addColorStop(0, color + '60');
            gradient.addColorStop(Math.max(0, progress - 0.1), color + '90');
            gradient.addColorStop(progress, '#ffffff');
            gradient.addColorStop(Math.min(1, progress + 0.05), color + 'ff');
            gradient.addColorStop(1, color);
          } else {
            // Waiting: pulsing gradient
            const pulse = Math.sin(state.songTime * 4) * 0.15 + 0.85;
            gradient.addColorStop(0, color + '50');
            gradient.addColorStop(0.3, color + Math.floor(pulse * 180).toString(16).padStart(2, '0'));
            gradient.addColorStop(0.7, color + Math.floor(pulse * 220).toString(16).padStart(2, '0'));
            gradient.addColorStop(1, color);
          }
          ctx.fillStyle = gradient;
          this.roundRect(bodyX, tailY, bodyWidth, cy + noteH - tailY, 6);
          ctx.fill();

          // Animated progress stripe
          if (isHeld) {
            const consumedHeight = (cy + noteH - tailY) * progress;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            const stripeW = bodyWidth * 0.25;
            const stripeX = bodyX + (bodyWidth - stripeW) / 2;
            ctx.fillRect(stripeX, cy + noteH - consumedHeight, stripeW, consumedHeight);
          } else {
            // Pulsing decorative stripes when not held
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            const stripeW = bodyWidth * 0.15;
            for (let s = 0; s < 3; s++) {
              const stripeX = bodyX + (bodyWidth * (s + 1)) / 4 - stripeW / 2;
              ctx.fillRect(stripeX, tailY + 4, stripeW, cy + noteH - tailY - 8);
            }
          }

          ctx.shadowBlur = 0;
        } else if (note.holdCompleted) {
          // Completed hold: bright flash
          ctx.fillStyle = '#ffd70060';
          this.roundRect(bodyX, tailY, bodyWidth, cy + noteH - tailY, 4);
          ctx.fill();
        } else if (note.holdDropped || note.state === NoteState.MISSED) {
          // Dropped/missed hold: dim grey
          ctx.fillStyle = '#33333360';
          this.roundRect(bodyX, tailY, bodyWidth, cy + noteH - tailY, 4);
          ctx.fill();
        }

        // Head note (the rounded rect at the bottom) - larger and more prominent
        if (note.state === NoteState.ACTIVE || note.isBeingHeld) {
          ctx.shadowColor = note.isBeingHeld ? '#ffffff' : color;
          ctx.shadowBlur = note.isBeingHeld ? 16 : 10;
        }
        
        // Head gradient for depth
        const headGradient = ctx.createLinearGradient(0, cy, 0, cy + noteH);
        if (note.isBeingHeld) {
          headGradient.addColorStop(0, '#ffffff');
          headGradient.addColorStop(0.5, color + 'ee');
          headGradient.addColorStop(1, color);
        } else {
          headGradient.addColorStop(0, color + 'dd');
          headGradient.addColorStop(1, color);
        }
        ctx.fillStyle = headGradient;
        this.roundRect(cx, cy, noteW, noteH, 8);
        ctx.fill();

        // Inner highlight on head - brighter
        ctx.fillStyle = note.isBeingHeld ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.35)';
        this.roundRect(cx + 3, cy + 3, noteW - 6, noteH / 2 - 3, 5);
        ctx.fill();

        // Hold icon - three parallel lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        const iconX = cx + noteW / 2;
        const iconY = cy + noteH / 2;
        const lineSpacing = 5;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(iconX + i * lineSpacing, iconY - 5);
          ctx.lineTo(iconX + i * lineSpacing, iconY + 5);
          ctx.stroke();
        }

      } else {
        // ── Regular tap note ───────────────────────────────────────────
        // Glow
        if (note.state === NoteState.ACTIVE) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
        }

        // Note body (rounded rect)
        ctx.fillStyle = color;
        this.roundRect(cx, cy, noteW, noteH, 6);
        ctx.fill();

        // Inner highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.roundRect(cx + 2, cy + 2, noteW - 4, noteH / 2 - 2, 4);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawLanePressGlow(state: RenderState): void {
    const { ctx, hitZoneY, laneWidth, config } = this;

    for (let i = 0; i < state.lanePressed.length; i++) {
      if (!state.lanePressed[i]) continue;

      const laneX = this.laneXPositions[i];
      if (laneX === undefined) continue;

      const color = config.laneColors[i % config.laneColors.length];

      // Vertical glow strip
      const gradient = ctx.createLinearGradient(0, hitZoneY - 60, 0, hitZoneY + 20);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.5, color + '40');
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.fillRect(laneX, hitZoneY - 60, laneWidth, 80);

      // Bright circle at hit zone
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = color + '80';
      ctx.beginPath();
      ctx.arc(laneX + laneWidth / 2, hitZoneY, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawSplashes(songTime: number): void {
    const { ctx } = this;

    this.splashes = this.splashes.filter(s => songTime - s.startTime < s.duration);

    for (const splash of this.splashes) {
      const elapsed = songTime - splash.startTime;
      const progress = elapsed / splash.duration;
      const alpha = 1 - progress;
      const scale = 1 + progress * 0.5;

      const laneX = this.laneXPositions[splash.lane];
      if (laneX === undefined) continue;

      const cx = laneX + this.laneWidth / 2;
      const cy = this.hitZoneY;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      // Text
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = splash.judgment === HitJudgment.PERFECT ? '#ffd700' : '#90ee90';
      ctx.fillText(
        splash.judgment === HitJudgment.PERFECT ? 'PERFECT' : 'GOOD',
        0,
        -25,
      );

      // Expanding ring
      ctx.strokeStyle = splash.judgment === HitJudgment.PERFECT ? '#ffd700' : '#90ee90';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawPauseOverlay(w: number, h: number): void {
    const { ctx } = this;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('PAUSED', w / 2, h / 2);

    ctx.font = '16px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText('Press Escape to resume', w / 2, h / 2 + 40);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

// ── Internal types ───────────────────────────────────────────────────────────

interface Splash {
  lane: number;
  judgment: HitJudgment;
  startTime: number;
  duration: number;
}
