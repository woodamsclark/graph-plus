export interface ConsciousObservationV1 {
  readonly type: string;
  readonly subjectId: string;
  readonly timestamp: number;
}

export interface MemoryBucketV1 {
  readonly type: string;
  /** Null after old subject-specific memories have faded into a global summary. */
  readonly subjectId: string | null;
  readonly level: number;
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly averageAt: number;
}

export interface MemorySnapshotV1 {
  readonly schemaVersion: 1;
  readonly observationCount: number;
  readonly buckets: readonly MemoryBucketV1[];
}

const BUCKETS_PER_LEVEL = 2;
export const MAX_CONSCIOUS_MEMORY_BUCKETS_V1 = 4_096;

/**
 * Presentation-scoped associative memory. Recent observations remain precise;
 * older observations collapse into exponential buckets containing count, range,
 * and weighted mean time. Storage is O(log n) per observation/subject key.
 */
export class MemoryV1 {
  private readonly bucketsByKey = new Map<string, MemoryBucketV1[]>();
  private totalObservations = 0;

  constructor(snapshot?: MemorySnapshotV1) {
    if (snapshot) this.restoreSnapshot(snapshot);
  }

  remember(observation: ConsciousObservationV1): void {
    requireObservation(observation);
    const key = memoryKey(observation.type, observation.subjectId);
    const buckets = this.bucketsByKey.get(key) ?? [];
    buckets.push({
      type: observation.type,
      subjectId: observation.subjectId,
      level: 0,
      count: 1,
      firstAt: observation.timestamp,
      lastAt: observation.timestamp,
      averageAt: observation.timestamp,
    });
    compact(buckets);
    this.bucketsByKey.set(key, buckets);
    this.totalObservations += 1;
    compactGlobally(this.bucketsByKey);
  }

  count(type: string, subjectId: string, now: number, withinMs?: number): number {
    const buckets = this.bucketsByKey.get(memoryKey(type, subjectId)) ?? [];
    const cutoff = withinMs === undefined ? Number.NEGATIVE_INFINITY : now - withinMs;
    return buckets.reduce((total, bucket) => total + estimatedCountSince(bucket, cutoff), 0);
  }

  snapshot(): MemorySnapshotV1 {
    return {
      schemaVersion: 1,
      observationCount: this.totalObservations,
      buckets: [...this.bucketsByKey.values()]
        .flat()
        .map((bucket) => ({ ...bucket }))
        .sort(compareBuckets),
    };
  }

  restoreSnapshot(snapshot: MemorySnapshotV1): void {
    this.bucketsByKey.clear();
    this.totalObservations = 0;
    if (snapshot.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.observationCount)
      || snapshot.observationCount < 0 || !isUnknownArray(snapshot.buckets)) return;
    for (const source of snapshot.buckets) {
      if (!validBucket(source)) continue;
      const bucket = { ...source };
      const key = memoryKey(bucket.type, bucket.subjectId);
      const buckets = this.bucketsByKey.get(key) ?? [];
      buckets.push(bucket);
      this.bucketsByKey.set(key, buckets);
    }
    for (const buckets of this.bucketsByKey.values()) compact(buckets);
    compactGlobally(this.bucketsByKey);
    this.totalObservations = [...this.bucketsByKey.values()]
      .flat()
      .reduce((total, bucket) => total + bucket.count, 0);
  }
}

function compact(buckets: MemoryBucketV1[]): void {
  for (let level = 0; level <= Math.max(0, ...buckets.map((bucket) => bucket.level));) {
    const atLevel = buckets
      .map((bucket, index) => ({ bucket, index }))
      .filter((entry) => entry.bucket.level === level)
      .sort((left, right) => left.bucket.firstAt - right.bucket.firstAt);
    if (atLevel.length <= BUCKETS_PER_LEVEL) {
      level += 1;
      continue;
    }
    const [left, right] = atLevel;
    const merged = mergeBuckets(left.bucket, right.bucket);
    buckets.splice(Math.max(left.index, right.index), 1);
    buckets.splice(Math.min(left.index, right.index), 1);
    buckets.push(merged);
  }
  buckets.sort(compareBuckets);
}

function mergeBuckets(left: MemoryBucketV1, right: MemoryBucketV1): MemoryBucketV1 {
  const count = left.count + right.count;
  return {
    type: left.type,
    subjectId: left.subjectId,
    level: left.level + 1,
    count,
    firstAt: Math.min(left.firstAt, right.firstAt),
    lastAt: Math.max(left.lastAt, right.lastAt),
    averageAt: ((left.averageAt * left.count) + (right.averageAt * right.count)) / count,
  };
}

function compactGlobally(bucketsByKey: Map<string, MemoryBucketV1[]>): void {
  while ([...bucketsByKey.values()].reduce((total, buckets) => total + buckets.length, 0)
    > MAX_CONSCIOUS_MEMORY_BUCKETS_V1) {
    const ordered = [...bucketsByKey.values()].flat().sort((left, right) =>
      left.lastAt - right.lastAt || left.firstAt - right.firstAt);
    let pair: readonly [MemoryBucketV1, MemoryBucketV1] | undefined;
    for (let leftIndex = 0; leftIndex < ordered.length - 1 && !pair; leftIndex += 1) {
      const right = ordered.slice(leftIndex + 1).find((candidate) =>
        candidate.type === ordered[leftIndex].type);
      if (right) pair = [ordered[leftIndex], right];
    }
    if (!pair) return;
    for (const bucket of pair) removeBucket(bucketsByKey, bucket);
    const merged = mergeAgedBuckets(pair[0], pair[1]);
    const key = memoryKey(merged.type, null);
    const target = bucketsByKey.get(key) ?? [];
    target.push(merged);
    compact(target);
    bucketsByKey.set(key, target);
  }
}

function mergeAgedBuckets(left: MemoryBucketV1, right: MemoryBucketV1): MemoryBucketV1 {
  const count = left.count + right.count;
  return {
    type: left.type,
    subjectId: null,
    level: Math.max(left.level, right.level) + 1,
    count,
    firstAt: Math.min(left.firstAt, right.firstAt),
    lastAt: Math.max(left.lastAt, right.lastAt),
    averageAt: ((left.averageAt * left.count) + (right.averageAt * right.count)) / count,
  };
}

function removeBucket(
  bucketsByKey: Map<string, MemoryBucketV1[]>,
  bucket: MemoryBucketV1,
): void {
  const key = memoryKey(bucket.type, bucket.subjectId);
  const buckets = bucketsByKey.get(key);
  if (!buckets) return;
  const index = buckets.indexOf(bucket);
  if (index >= 0) buckets.splice(index, 1);
  if (buckets.length === 0) bucketsByKey.delete(key);
}

function estimatedCountSince(bucket: MemoryBucketV1, cutoff: number): number {
  if (bucket.lastAt < cutoff) return 0;
  if (bucket.firstAt >= cutoff || bucket.firstAt === bucket.lastAt) return bucket.count;
  const fraction = (bucket.lastAt - cutoff) / (bucket.lastAt - bucket.firstAt);
  return Math.max(0, Math.min(bucket.count, bucket.count * fraction));
}

function memoryKey(type: string, subjectId: string | null): string {
  return `${type.length}:${type}${subjectId === null ? '!' : `:${subjectId}`}`;
}

function compareBuckets(left: MemoryBucketV1, right: MemoryBucketV1): number {
  return left.type.localeCompare(right.type)
    || (left.subjectId ?? '').localeCompare(right.subjectId ?? '')
    || left.level - right.level
    || left.firstAt - right.firstAt;
}

function requireObservation(observation: ConsciousObservationV1): void {
  if (!observation.type || !observation.subjectId || !Number.isFinite(observation.timestamp)) {
    throw new Error('A conscious observation requires type, subject, and finite timestamp.');
  }
}

function validBucket(bucket: MemoryBucketV1): boolean {
  return typeof bucket?.type === 'string' && bucket.type.length > 0
    && (bucket.subjectId === null || (typeof bucket.subjectId === 'string' && bucket.subjectId.length > 0))
    && Number.isSafeInteger(bucket.level) && bucket.level >= 0
    && Number.isSafeInteger(bucket.count) && bucket.count > 0
    && Number.isFinite(bucket.firstAt) && Number.isFinite(bucket.lastAt)
    && Number.isFinite(bucket.averageAt) && bucket.firstAt <= bucket.averageAt
    && bucket.averageAt <= bucket.lastAt;
}

/** Preserve unknown element types instead of the built-in any[] narrowing. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
