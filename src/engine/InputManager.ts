// ─────────────────────────────────────────────────────────────────────────────
// InputManager – Keyboard input with precise timestamps
// ─────────────────────────────────────────────────────────────────────────────
//
//  Responsibilities:
//    • Listen to keydown / keyup events
//    • Map physical keys to logical lane indices via configurable bindings
//    • Queue timestamped press events for the game loop to consume
//    • Track per-lane held state (for rendering glow effects)
//    • Prevent duplicate key-repeat events
//
//  The game loop calls consumeQueue() once per tick to drain all input
//  events that arrived since the last tick.  This keeps input handling
//  decoupled from the frame rate.
//
// ─────────────────────────────────────────────────────────────────────────────

export interface InputEvent {
  /** Logical lane index (0-based). */
  lane: number;
  /** High-resolution timestamp from performance.now() (ms). */
  timestamp: number;
  /** Type of input. */
  type: 'press' | 'release';
}

export class InputManager {
  // key (lower-cased) → lane index
  private keyMap = new Map<string, number>();

  // Queued events waiting to be consumed by the game loop
  private queue: InputEvent[] = [];

  // Per-lane held state (true while key is held)
  private laneHeld: boolean[];

  // Track which keys are currently down (to suppress key-repeat)
  private keysDown = new Set<string>();

  // Bound handlers (so we can remove them on dispose)
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private attached = false;

  constructor(keyBindings: string[], laneCount: number) {
    this.laneHeld = new Array(laneCount).fill(false);
    this.setKeyBindings(keyBindings);

    // Bind handlers once
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);
  }

  // ── Configuration ────────────────────────────────────────────────────────

  /** Replace key bindings at runtime (e.g. from a settings screen). */
  setKeyBindings(bindings: string[]): void {
    this.keyMap.clear();
    for (let i = 0; i < bindings.length; i++) {
      this.keyMap.set(bindings[i].toLowerCase(), i);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Start listening for keyboard events. */
  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.attached = true;
  }

  /** Stop listening and release references. */
  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.attached = false;
    this.keysDown.clear();
    this.laneHeld.fill(false);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Drain and return all queued input events since the last call.
   * The game loop calls this once per tick.
   */
  consumeQueue(): InputEvent[] {
    if (this.queue.length === 0) return [];
    const events = this.queue;
    this.queue = [];
    return events;
  }

  /** Is a specific lane currently held down? */
  isLanePressed(lane: number): boolean {
    return this.laneHeld[lane] ?? false;
  }

  /** Snapshot of all lane held states (for the renderer). */
  getLanePressedSnapshot(): boolean[] {
    return [...this.laneHeld];
  }

  /** Flush all state (useful on pause/resume). */
  flush(): void {
    this.queue = [];
    this.keysDown.clear();
    this.laneHeld.fill(false);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  private handleKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const lane = this.keyMap.get(key);
    if (lane === undefined) return;

    // Suppress OS key-repeat
    if (this.keysDown.has(key)) return;
    this.keysDown.add(key);

    this.laneHeld[lane] = true;
    this.queue.push({
      lane,
      timestamp: performance.now(),
      type: 'press',
    });
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const lane = this.keyMap.get(key);
    if (lane === undefined) return;

    this.keysDown.delete(key);
    this.laneHeld[lane] = false;
    this.queue.push({
      lane,
      timestamp: performance.now(),
      type: 'release',
    });
  }
}
