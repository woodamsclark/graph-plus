import type { GraphEngineProfileUpdateModeV1 } from '../../graph-engine/service/GraphEngineSessionUiHost.ts';
import { LatestStatePersistenceV1 } from './LatestStatePersistence.ts';

interface SettingsUpdateClock {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

/** One frame and one persistence debounce shared by all Quick Settings panels. */
export class GraphEngineSettingsUpdatesV1 {
  private frame?: number;
  private timer?: number;
  private dirty = false;
  private closed = false;
  private saves: Promise<void> = Promise.resolve();
  private readonly persistence = new LatestStatePersistenceV1<void>(() => this.persist());

  constructor(
    private readonly clock: SettingsUpdateClock,
    private readonly refresh: () => void,
    private readonly persist: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly debounceMs = 250,
  ) {}

  update(mode?: GraphEngineProfileUpdateModeV1): Promise<void> {
    if (this.closed) return this.saves;
    if (mode === 'commit') return this.flush();
    this.dirty = true;
    if (mode === 'live') {
      if (this.frame === undefined) this.frame = this.clock.requestAnimationFrame(() => {
        this.frame = undefined;
        try { this.refresh(); } catch (error) { this.onError(error); }
      });
      this.cancelTimer();
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(this.onError);
      }, this.debounceMs);
      return Promise.resolve();
    }
    // Discrete settings keep their existing awaited update/save behavior.
    this.cancelFrame();
    this.refresh();
    return this.flush();
  }

  flush(): Promise<void> {
    this.cancelTimer();
    if (this.frame !== undefined) {
      this.cancelFrame();
      this.refresh();
    }
    if (!this.dirty) return this.saves;
    this.dirty = false;
    this.saves = this.persistence.save(undefined).catch((error) => {
      this.dirty = true;
      throw error;
    });
    return this.saves;
  }

  close(): Promise<void> {
    this.closed = true;
    return this.flush();
  }

  private cancelFrame(): void {
    if (this.frame !== undefined) this.clock.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
