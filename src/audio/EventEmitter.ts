// ─────────────────────────────────────────────────────────────────────────────
// Tiny typed event emitter – zero dependencies
// ─────────────────────────────────────────────────────────────────────────────

type Listener<T> = (payload: T) => void;

/**
 * Generic typed event emitter.
 * Each event key maps to a specific payload type via the EventMap generic,
 * giving callers full type safety on both emit() and on().
 */
export class EventEmitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Listener<any>>>();

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function.
   */
  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /** Subscribe to an event for a single invocation only. */
  once<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    const wrapper: Listener<EventMap[K]> = (payload) => {
      unsub();
      listener(payload);
    };
    const unsub = this.on(event, wrapper);
    return unsub;
  }

  /** Emit an event, notifying all current subscribers. */
  protected emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventEmitter] Error in listener for "${String(event)}":`, err);
      }
    }
  }

  /** Remove all listeners (used during dispose). */
  protected removeAllListeners(): void {
    this.listeners.clear();
  }
}
