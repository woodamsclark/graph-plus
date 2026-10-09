import type { SessionRuntimePlatformV1 } from '../platform/index.ts';

export type SessionInvalidationClass = 'geometry' | 'camera' | 'presentation' | 'content' | 'ui';

export interface SessionFrameSchedulerSnapshot {
  readonly frameScheduled: boolean;
  readonly animationFrameScheduled: boolean;
  readonly wakeTimerScheduled: boolean;
  readonly pendingInvalidations: readonly SessionInvalidationClass[];
}

/** Owns every animation-frame and delayed-wake resource for one graph session. */
export class SessionFrameScheduler {
  private animationFrame: number | null = null;
  private wakeTimer: number | null = null;
  private wakeDueAt: number | null = null;
  private readonly pendingInvalidations = new Set<SessionInvalidationClass>();

  constructor(
    private readonly platform: SessionRuntimePlatformV1,
    private readonly canSchedule: () => boolean,
    private readonly onFrame: FrameRequestCallback,
    private readonly onFrameScheduled: () => void,
  ) {}

  schedule(invalidation: SessionInvalidationClass, delayMs = 0): void {
    if (!this.canSchedule()) return;
    this.pendingInvalidations.add(invalidation);
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    if (delay <= 0) {
      this.clearWakeTimer();
      this.requestFrame();
      return;
    }
    if (this.animationFrame !== null) return;
    const dueAt = this.platform.now() + delay;
    if (this.wakeTimer !== null && this.wakeDueAt !== null && this.wakeDueAt <= dueAt + 0.5) return;
    this.clearWakeTimer();
    this.wakeDueAt = dueAt;
    this.wakeTimer = this.platform.setTimeout(() => {
      this.wakeTimer = null;
      this.wakeDueAt = null;
      if (this.canSchedule()) this.requestFrame();
    }, delay);
  }

  beginFrame(): readonly SessionInvalidationClass[] {
    const invalidations = [...this.pendingInvalidations];
    this.pendingInvalidations.clear();
    return invalidations;
  }

  clear(): void {
    this.clearWakeTimer();
    if (this.animationFrame !== null) this.platform.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.pendingInvalidations.clear();
  }

  snapshot(): SessionFrameSchedulerSnapshot {
    return {
      frameScheduled: this.animationFrame !== null || this.wakeTimer !== null,
      animationFrameScheduled: this.animationFrame !== null,
      wakeTimerScheduled: this.wakeTimer !== null,
      pendingInvalidations: [...this.pendingInvalidations],
    };
  }

  private requestFrame(): void {
    if (this.animationFrame !== null || !this.canSchedule()) return;
    this.onFrameScheduled();
    this.animationFrame = this.platform.requestAnimationFrame((timestamp) => {
      this.animationFrame = null;
      this.onFrame(timestamp);
    });
  }

  private clearWakeTimer(): void {
    if (this.wakeTimer !== null) this.platform.clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    this.wakeDueAt = null;
  }
}
