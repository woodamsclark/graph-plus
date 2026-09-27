const ACTIVE_LAYOUT_STEP_RATE_HZ = 30;
const ACTIVE_LAYOUT_INTERVAL_MS = 1_000 / ACTIVE_LAYOUT_STEP_RATE_HZ;

/** Active physics keeps a smooth fixed cadence; alpha scales the integration step. */
export function forceLayoutIntervalMsV1(_alpha: number, _dragActive: boolean): number {
  return ACTIVE_LAYOUT_INTERVAL_MS;
}

export function forceLayoutTargetStepRateHzV1(_alpha: number, running: boolean): 0 | 30 {
  return running ? ACTIVE_LAYOUT_STEP_RATE_HZ : 0;
}
