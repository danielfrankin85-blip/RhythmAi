// Simple procedural music player using Web Audio API
// Plays a repeating, unobtrusive menu melody. No external assets required.

export default class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private isPlaying = false;
  private current16th = 0;
  private tempo = 90; // BPM
  private lookahead = 0.1; // seconds
  private scheduleInterval = 25; // ms
  private timerId: number | null = null;
  private nextNoteTime = 0;
  private pattern: number[] = [0, 2, 4, 7, 9, 7, 4, 2]; // scale steps
  private root = 48; // C3-ish

  start(): void {
    if (this.isPlaying) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.12; // low volume
    this.master.connect(this.ctx.destination);
    this.current16th = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.isPlaying = true;
    this.timerId = window.setInterval(() => this.scheduler(), this.scheduleInterval);
  }

  stop(): void {
    if (!this.isPlaying) return;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    // fade out quickly
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.0, this.ctx.currentTime + 0.2);
    }
    // close context after short delay
    const ctx = this.ctx;
    setTimeout(() => {
      try { ctx && ctx.close(); } catch (e) {}
    }, 300);

    this.ctx = null;
    this.master = null;
    this.isPlaying = false;
  }

  setVolume(v: number) {
    if (!this.master) return;
    this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  private scheduler() {
    if (!this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
      this.scheduleNote(this.current16th, this.nextNoteTime);
      this.advanceNote();
    }
  }

  private advanceNote() {
    // 16th notes: tempo -> seconds per 16th
    const secondsPerBeat = 60.0 / this.tempo;
    const secondsPer16th = secondsPerBeat / 4.0;
    this.nextNoteTime += secondsPer16th;
    this.current16th = (this.current16th + 1) % 32;
  }

  private scheduleNote(beatIndex: number, time: number) {
    if (!this.ctx || !this.master) return;
    // Use simple pattern: play melody on every 4th 16th (quarter notes)
    if (beatIndex % 4 !== 0) return;
    const stepIndex = (beatIndex / 4) % this.pattern.length;
    const semitoneOffset = this.pattern[stepIndex];
    const freq = 440 * Math.pow(2, (this.root + semitoneOffset - 69) / 12);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.0;
    osc.connect(gain);
    gain.connect(this.master);

    const attack = 0.02;
    const release = 0.25;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.9, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, time + attack + release);

    osc.start(time);
    osc.stop(time + attack + release + 0.02);
  }
}
