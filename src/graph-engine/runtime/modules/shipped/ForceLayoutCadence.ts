const HOT_LAYOUT_ALPHA = 0.01;
const HOT_LAYOUT_INTERVAL_MS = 1_000 / 30;
const COOLING_LAYOUT_INTERVAL_MS = 1_000 / 15;

/** Pure cooling policy shared by scheduling and diagnostics. */
export function forceLayoutIntervalMsV1(alpha: number, dragActive: boolean): number {
  return dragActive || alpha >= HOT_LAYOUT_ALPHA
    ? HOT_LAYOUT_INTERVAL_MS
    : COOLING_LAYOUT_INTERVAL_MS;
}

export function forceLayoutTargetStepRateHzV1(alpha: number, running: boolean): 0 | 15 | 30 {
  if (!running) return 0;
  return alpha >= HOT_LAYOUT_ALPHA ? 30 : 15;
}
