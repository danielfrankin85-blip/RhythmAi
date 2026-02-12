// ─────────────────────────────────────────────────────────────────────────────
// Engine module – barrel export
// ─────────────────────────────────────────────────────────────────────────────

export { GameEngine } from './GameEngine';
export { CanvasRenderer } from './CanvasRenderer';
export { ScoreEngine } from './ScoreEngine';
export { InputManager } from './InputManager';

export {
  GameState,
  GameEvent,
  NoteState,
  HitJudgment,
  TargetFPS,
  type ActiveNote,
  type HitWindow,
  type ScoreState,
  type GameEngineConfig,
  type GameEventMap,
  type RenderState,
  type RendererConfig,
} from './types';

export type { InputEvent } from './InputManager';
