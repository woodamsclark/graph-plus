import type { GraphPerformanceSnapshotV1 } from '../../contracts/v1/index.ts';
import type { SessionInvalidationClassV1 } from './SessionFrameScheduler.ts';

type MutablePerformanceCounters = { -readonly [K in keyof NonNullable<GraphPerformanceSnapshotV1['counters']>]: number };

export class SessionDiagnosticsV1 {
  readonly counters: MutablePerformanceCounters = emptyCounters();
  private frameCount = 0;
  private latestFrame = emptyFramePerformance();
  private readonly samples: GraphPerformanceSnapshotV1['latestFrame'][] = [];
  private lastFrameInvalidations: readonly SessionInvalidationClassV1[] = [];
  private readonly invalidationCounts: Record<SessionInvalidationClassV1, number> = {
    geometry: 0,
    camera: 0,
    presentation: 0,
    content: 0,
    ui: 0,
  };

  recordFrame(
    frame: GraphPerformanceSnapshotV1['latestFrame'],
    invalidations: readonly SessionInvalidationClassV1[],
  ): number {
    this.frameCount += 1;
    this.latestFrame = { ...frame };
    this.samples.push({ ...frame });
    if (this.samples.length > 600) this.samples.shift();
    this.counters.renderedFrames += 1;
    this.lastFrameInvalidations = [...invalidations];
    for (const invalidation of new Set(invalidations)) this.invalidationCounts[invalidation] += 1;
    return this.frameCount;
  }

  reset(): void {
    this.samples.length = 0;
    this.latestFrame = emptyFramePerformance();
    Object.assign(this.counters, emptyCounters());
    this.lastFrameInvalidations = [];
    for (const key of Object.keys(this.invalidationCounts) as SessionInvalidationClassV1[]) {
      this.invalidationCounts[key] = 0;
    }
  }

  performanceSnapshot(): GraphPerformanceSnapshotV1 {
    return {
      frameCount: this.frameCount,
      latestFrame: { ...this.latestFrame },
      window: summarizePerformance(this.samples),
      counters: { ...this.counters },
    };
  }

  runtimeSnapshot(): {
    readonly frameCount: number;
    readonly counters: GraphPerformanceSnapshotV1['counters'];
    readonly lastFrameInvalidations: readonly SessionInvalidationClassV1[];
    readonly invalidationCounts: Readonly<Record<SessionInvalidationClassV1, number>>;
  } {
    return {
      frameCount: this.frameCount,
      counters: { ...this.counters },
      lastFrameInvalidations: [...this.lastFrameInvalidations],
      invalidationCounts: { ...this.invalidationCounts },
    };
  }
}

function emptyFramePerformance(): GraphPerformanceSnapshotV1['latestFrame'] {
  return {
    interactionMs: 0, hitTestMs: 0, moduleTickMs: 0, compositionMs: 0,
    projectionMs: 0, regionRenderMs: 0, edgeRenderMs: 0, nodeRenderMs: 0, labelLayoutMs: 0,
    labelDrawMs: 0, totalMs: 0,
  };
}

function emptyCounters(): MutablePerformanceCounters {
  return {
    documentExports: 0,
    viewExports: 0,
    projectionPasses: 0,
    hitTests: 0,
    moduleTicks: 0,
    frameCompositions: 0,
    renderedFrames: 0,
    scheduledFrames: 0,
  };
}

function summarizePerformance(
  samples: readonly GraphPerformanceSnapshotV1['latestFrame'][],
): NonNullable<GraphPerformanceSnapshotV1['window']> {
  const keys = Object.keys(emptyFramePerformance()) as (keyof GraphPerformanceSnapshotV1['latestFrame'])[];
  return Object.fromEntries(keys.map((key) => {
    const values = samples.map((sample) => sample[key] ?? 0).sort((a, b) => a - b);
    return [key, {
      sampleCount: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: values.length ? values[values.length - 1] : 0,
    }];
  })) as NonNullable<GraphPerformanceSnapshotV1['window']>;
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))];
}
