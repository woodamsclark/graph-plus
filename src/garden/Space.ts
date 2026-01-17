// world/Space.ts
import type { Tickable } from "../shared/interfaces.ts";
import { Time } from "./Time.ts";

export class Space {
  private time: Time;
  private unregisters: Array<() => void> = [];

  constructor(opts?: { maxDtSeconds?: number }) {
    this.time = new Time(opts);
  }

  register(id: string, tickable: Tickable): void {
    const unreg = this.time.register(id, (dt, now) => {
      tickable.tick(dt, now);
    });
    this.unregisters.push(unreg);
  }

  start(): void {
    this.time.start();
  }

  stop(): void {
    this.time.stop();
    for (const u of this.unregisters) u();
    this.unregisters = [];
  }
}
