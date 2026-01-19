import type { Tickable } from "../../grammar/interfaces.ts";
import { Time } from "./Time.ts";

export type TickFn = (dt: number, now: number) => void;

type Entry = {
  id: string;
  priority: number;
  tick: TickFn;
};

// this class starts time and calls registered tickable systems each frame
// it is provides SPACE for time dependent systems to run in TIME
export class SpaceTime {
  private time: Time;
  private entries: Entry[] = [];
  private unreg: (() => void) | null = null;

  constructor(opts?: { maxDtSeconds?: number }) {
    this.time = new Time(opts);
  }

  // register systems to be ticked each frame
  register(id: string,  tickable: Tickable, priority = 0): void {
    const tick: TickFn = (dt, now) => tickable.tick(dt, now);
    this.entries.push({ id, priority, tick });
    this.entries.sort((a, b) => a.priority - b.priority);

    if (this.unreg) this.rebind();
  }

  private rebind() {
    this.unreg?.();
    this.unreg = this.time.register("spacetime", (dt, now) => {
      for (const e of this.entries) e.tick(dt, now);
    });
  }

  start(): void {
    if (!this.unreg) this.rebind();
    this.time.start();
  }

  stop(): void {
    this.time.stop();
    this.unreg?.();
    this.unreg = null;
    this.entries = [];
  }
}