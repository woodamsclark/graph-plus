export type FrameTick = (dt: number, nowMs: number) => void;

export class Time {
  private rafId : number | null = null;
  private lastMs: number | null = null;

  private ticks = new Map<string, FrameTick>();

  constructor( private opts: { maxDtSeconds?: number } = {} ) {

  }

  /** Register a tick callback. Returns an unregister function. */
  register(id: string, fn: FrameTick): () => void {
    if (this.ticks.has(id)) {
      console.warn(`FrameLoop: replacing existing tick "${id}"`);
    }
    this.ticks.set(id, fn);

    return () => {
      // only remove if it’s still the same function
      const cur = this.ticks.get(id);
      if (cur === fn) this.ticks.delete(id);
    };
  }

  start(): void {
    if (this.rafId !== null) return;

    const step = (nowMs: number) => {
      if (this.lastMs === null) this.lastMs = nowMs;

      let dt = (nowMs - this.lastMs) / 1000;
      this.lastMs = nowMs;

      const maxDt = this.opts.maxDtSeconds ?? 0.05;
      if (dt > maxDt) dt = maxDt;
      if (dt < 0) dt = 0;

      // call through registered ticks
      for (const fn of this.ticks.values()) {
        fn(dt, nowMs);
      }

      this.rafId = requestAnimationFrame(step);
    };

    this.rafId = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastMs = null;
  }

  isRunning(): boolean {
    return this.rafId !== null;
  }
}
