import type {
  GraphRelationPolicyOverrideV1,
  GraphTopologyLayoutPolicyV1,
  GraphTopologyPairPolicyV1,
  JsonValue,
} from '../../contracts/v1/index.ts';

export interface ResolvedGraphTopologyPairPolicyV1 extends GraphTopologyPairPolicyV1 {
  readonly recursiveRegionSpacingEdgeToken?: string;
}

export const DEFAULT_GRAPH_TOPOLOGY_PAIR_POLICY_V1: GraphTopologyPairPolicyV1 = Object.freeze({
  minimumAffinity: 0.2,
  maximumAffinity: 2.5,
  evidenceGrowth: Object.freeze({ curve: 'log2', coefficient: 0.35 }),
  reciprocalBoost: 1.25,
  hubDiscountExponent: 0.25,
  spring: Object.freeze({
    strengthExponent: 0.65,
    lengthExponent: -0.55,
    minimumStrengthScale: 0.35,
    maximumStrengthScale: 2,
    minimumLengthScale: 0.55,
    maximumLengthScale: 1.85,
    strengthScale: 1,
    targetLengthScale: 1,
  }),
  recursiveRegionSpacing: Object.freeze({ mode: 'off' }),
});

export const DEFAULT_GRAPH_TOPOLOGY_LAYOUT_POLICY_V1: GraphTopologyLayoutPolicyV1 = Object.freeze({
  version: 1,
  defaultPairPolicy: DEFAULT_GRAPH_TOPOLOGY_PAIR_POLICY_V1,
  relationOverrides: Object.freeze([Object.freeze({
    id: 'tag-parent-structure',
    edgeToken: 'relation:tag-parent',
    priority: 100,
    override: Object.freeze({
      hubDiscountExponent: 0,
      spring: Object.freeze({ targetLengthScale: 0.5, strengthScale: 1.5 }),
      recursiveRegionSpacing: Object.freeze({ mode: 'target-region-closure' }),
    }),
  })]),
});

export function resolveGraphTopologyPairPolicyV1(
  relationChannels: ReadonlySet<string>,
  policy: GraphTopologyLayoutPolicyV1,
): ResolvedGraphTopologyPairPolicyV1 {
  let result: ResolvedGraphTopologyPairPolicyV1 = clonePairPolicy(policy.defaultPairPolicy);
  for (const candidate of [...policy.relationOverrides]
    .filter((entry) => relationChannels.has(entry.edgeToken))
    .sort(compareOverrides)) {
    result = mergePairPolicy(result, candidate);
  }
  return result;
}

export function readGraphTopologyLayoutPolicyV1(value: JsonValue | undefined): GraphTopologyLayoutPolicyV1 {
  return parseGraphTopologyLayoutPolicyV1(value) ?? cloneLayoutPolicy(DEFAULT_GRAPH_TOPOLOGY_LAYOUT_POLICY_V1);
}

export function parseGraphTopologyLayoutPolicyV1(value: JsonValue | undefined): GraphTopologyLayoutPolicyV1 | undefined {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.defaultPairPolicy)
    || !isUnknownArray(value.relationOverrides) || !validCompletePairPolicy(value.defaultPairPolicy)) return undefined;
  const base = readPairPolicy(value.defaultPairPolicy, DEFAULT_GRAPH_TOPOLOGY_PAIR_POLICY_V1);
  const overrides: GraphRelationPolicyOverrideV1[] = [];
  const ids = new Set<string>();
  for (const entry of value.relationOverrides) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id
      || typeof entry.edgeToken !== 'string' || !entry.edgeToken
      || typeof entry.priority !== 'number' || !Number.isFinite(entry.priority)
      || !isRecord(entry.override) || !validPairOverride(entry.override) || ids.has(entry.id)) return undefined;
    ids.add(entry.id);
    overrides.push({
      id: entry.id,
      edgeToken: entry.edgeToken,
      priority: entry.priority,
      override: readPairOverride(entry.override),
    });
  }
  return { version: 1, defaultPairPolicy: base, relationOverrides: overrides.sort(compareOverrides) };
}

export function cloneGraphTopologyLayoutPolicyV1(policy: GraphTopologyLayoutPolicyV1): GraphTopologyLayoutPolicyV1 {
  return cloneLayoutPolicy(policy);
}

function mergePairPolicy(
  current: ResolvedGraphTopologyPairPolicyV1,
  relation: GraphRelationPolicyOverrideV1,
): ResolvedGraphTopologyPairPolicyV1 {
  const override = relation.override;
  const recursiveRegionSpacing = { ...current.recursiveRegionSpacing, ...override.recursiveRegionSpacing };
  return normalizeResolvedPolicy({
    ...current,
    ...withoutNested(override),
    evidenceGrowth: { ...current.evidenceGrowth, ...override.evidenceGrowth },
    spring: { ...current.spring, ...override.spring },
    recursiveRegionSpacing,
    recursiveRegionSpacingEdgeToken: recursiveRegionSpacing.mode === 'target-region-closure'
      ? relation.edgeToken
      : undefined,
  });
}

function withoutNested(override: GraphRelationPolicyOverrideV1['override']): Pick<GraphRelationPolicyOverrideV1['override'],
  'minimumAffinity' | 'maximumAffinity' | 'reciprocalBoost' | 'hubDiscountExponent'> {
  const { evidenceGrowth: _evidence, spring: _spring, recursiveRegionSpacing: _spacing, ...scalars } = override;
  return scalars;
}

function readPairPolicy(value: Record<string, JsonValue>, fallback: GraphTopologyPairPolicyV1): GraphTopologyPairPolicyV1 {
  const evidence = isRecord(value.evidenceGrowth) ? value.evidenceGrowth : {};
  const spring = isRecord(value.spring) ? value.spring : {};
  const spacing = isRecord(value.recursiveRegionSpacing) ? value.recursiveRegionSpacing : {};
  const minimumAffinity = positive(value.minimumAffinity, fallback.minimumAffinity);
  const minimumStrengthScale = nonNegative(spring.minimumStrengthScale, fallback.spring.minimumStrengthScale);
  const minimumLengthScale = positive(spring.minimumLengthScale, fallback.spring.minimumLengthScale);
  return {
    minimumAffinity,
    maximumAffinity: Math.max(minimumAffinity, positive(value.maximumAffinity, fallback.maximumAffinity)),
    evidenceGrowth: {
      curve: evidence.curve === 'none' ? 'none' : fallback.evidenceGrowth.curve,
      coefficient: nonNegative(evidence.coefficient, fallback.evidenceGrowth.coefficient),
    },
    reciprocalBoost: positive(value.reciprocalBoost, fallback.reciprocalBoost),
    hubDiscountExponent: nonNegative(value.hubDiscountExponent, fallback.hubDiscountExponent),
    spring: {
      strengthExponent: finite(spring.strengthExponent, fallback.spring.strengthExponent),
      lengthExponent: finite(spring.lengthExponent, fallback.spring.lengthExponent),
      minimumStrengthScale,
      maximumStrengthScale: Math.max(minimumStrengthScale, positive(spring.maximumStrengthScale, fallback.spring.maximumStrengthScale)),
      minimumLengthScale,
      maximumLengthScale: Math.max(minimumLengthScale, positive(spring.maximumLengthScale, fallback.spring.maximumLengthScale)),
      strengthScale: nonNegative(spring.strengthScale, fallback.spring.strengthScale),
      targetLengthScale: positive(spring.targetLengthScale, fallback.spring.targetLengthScale),
    },
    recursiveRegionSpacing: {
      mode: spacing.mode === 'target-region-closure' ? 'target-region-closure' : fallback.recursiveRegionSpacing.mode,
    },
  };
}

function normalizeResolvedPolicy(policy: ResolvedGraphTopologyPairPolicyV1): ResolvedGraphTopologyPairPolicyV1 {
  return {
    ...policy,
    maximumAffinity: Math.max(policy.minimumAffinity, policy.maximumAffinity),
    spring: {
      ...policy.spring,
      maximumStrengthScale: Math.max(policy.spring.minimumStrengthScale, policy.spring.maximumStrengthScale),
      maximumLengthScale: Math.max(policy.spring.minimumLengthScale, policy.spring.maximumLengthScale),
    },
  };
}

function readPairOverride(value: Record<string, JsonValue>): GraphRelationPolicyOverrideV1['override'] {
  const result: Record<string, unknown> = {};
  copyPositive(value, result, 'minimumAffinity'); copyPositive(value, result, 'maximumAffinity');
  copyPositive(value, result, 'reciprocalBoost'); copyNonNegative(value, result, 'hubDiscountExponent');
  if (isRecord(value.evidenceGrowth)) {
    const nested: Record<string, unknown> = {};
    if (value.evidenceGrowth.curve === 'none' || value.evidenceGrowth.curve === 'log2') nested.curve = value.evidenceGrowth.curve;
    copyNonNegative(value.evidenceGrowth, nested, 'coefficient');
    result.evidenceGrowth = nested;
  }
  if (isRecord(value.spring)) {
    const nested: Record<string, unknown> = {};
    copyFinite(value.spring, nested, 'strengthExponent'); copyFinite(value.spring, nested, 'lengthExponent');
    copyNonNegative(value.spring, nested, 'minimumStrengthScale'); copyPositive(value.spring, nested, 'maximumStrengthScale');
    copyPositive(value.spring, nested, 'minimumLengthScale'); copyPositive(value.spring, nested, 'maximumLengthScale');
    copyNonNegative(value.spring, nested, 'strengthScale'); copyPositive(value.spring, nested, 'targetLengthScale');
    result.spring = nested;
  }
  if (isRecord(value.recursiveRegionSpacing)
    && (value.recursiveRegionSpacing.mode === 'off' || value.recursiveRegionSpacing.mode === 'target-region-closure')) {
    result.recursiveRegionSpacing = { mode: value.recursiveRegionSpacing.mode };
  }
  return result;
}

function validCompletePairPolicy(value: Record<string, JsonValue>): boolean {
  if (!positiveValue(value.minimumAffinity) || !positiveValue(value.maximumAffinity)
    || value.minimumAffinity > value.maximumAffinity || !positiveValue(value.reciprocalBoost)
    || !nonNegativeValue(value.hubDiscountExponent) || !isRecord(value.evidenceGrowth)
    || !isRecord(value.spring) || !isRecord(value.recursiveRegionSpacing)) return false;
  const evidence = value.evidenceGrowth;
  const spring = value.spring;
  return (evidence.curve === 'none' || evidence.curve === 'log2') && nonNegativeValue(evidence.coefficient)
    && finiteValue(spring.strengthExponent) && finiteValue(spring.lengthExponent)
    && nonNegativeValue(spring.minimumStrengthScale) && positiveValue(spring.maximumStrengthScale)
    && spring.minimumStrengthScale <= spring.maximumStrengthScale
    && positiveValue(spring.minimumLengthScale) && positiveValue(spring.maximumLengthScale)
    && spring.minimumLengthScale <= spring.maximumLengthScale
    && nonNegativeValue(spring.strengthScale) && positiveValue(spring.targetLengthScale)
    && (value.recursiveRegionSpacing.mode === 'off'
      || value.recursiveRegionSpacing.mode === 'target-region-closure');
}

function validPairOverride(value: Record<string, JsonValue>): boolean {
  if (value.minimumAffinity !== undefined && !positiveValue(value.minimumAffinity)) return false;
  if (value.maximumAffinity !== undefined && !positiveValue(value.maximumAffinity)) return false;
  if (value.minimumAffinity !== undefined && value.maximumAffinity !== undefined
    && value.minimumAffinity > value.maximumAffinity) return false;
  if (value.reciprocalBoost !== undefined && !positiveValue(value.reciprocalBoost)) return false;
  if (value.hubDiscountExponent !== undefined && !nonNegativeValue(value.hubDiscountExponent)) return false;
  if (value.evidenceGrowth !== undefined) {
    if (!isRecord(value.evidenceGrowth)) return false;
    if (value.evidenceGrowth.curve !== undefined
      && value.evidenceGrowth.curve !== 'none' && value.evidenceGrowth.curve !== 'log2') return false;
    if (value.evidenceGrowth.coefficient !== undefined && !nonNegativeValue(value.evidenceGrowth.coefficient)) return false;
  }
  if (value.spring !== undefined) {
    if (!isRecord(value.spring)) return false;
    const spring = value.spring;
    for (const key of ['strengthExponent', 'lengthExponent'] as const) {
      if (spring[key] !== undefined && !finiteValue(spring[key])) return false;
    }
    for (const key of ['minimumStrengthScale', 'strengthScale'] as const) {
      if (spring[key] !== undefined && !nonNegativeValue(spring[key])) return false;
    }
    for (const key of ['maximumStrengthScale', 'minimumLengthScale', 'maximumLengthScale', 'targetLengthScale'] as const) {
      if (spring[key] !== undefined && !positiveValue(spring[key])) return false;
    }
  }
  if (value.recursiveRegionSpacing !== undefined) {
    if (!isRecord(value.recursiveRegionSpacing)
      || (value.recursiveRegionSpacing.mode !== 'off'
        && value.recursiveRegionSpacing.mode !== 'target-region-closure')) return false;
  }
  return true;
}

function clonePairPolicy(policy: GraphTopologyPairPolicyV1): ResolvedGraphTopologyPairPolicyV1 {
  return { ...policy, evidenceGrowth: { ...policy.evidenceGrowth }, spring: { ...policy.spring }, recursiveRegionSpacing: { ...policy.recursiveRegionSpacing } };
}

function cloneLayoutPolicy(policy: GraphTopologyLayoutPolicyV1): GraphTopologyLayoutPolicyV1 {
  return { version: 1, defaultPairPolicy: clonePairPolicy(policy.defaultPairPolicy), relationOverrides: policy.relationOverrides.map((entry) => ({ ...entry, override: { ...entry.override, evidenceGrowth: entry.override.evidenceGrowth && { ...entry.override.evidenceGrowth }, spring: entry.override.spring && { ...entry.override.spring }, recursiveRegionSpacing: entry.override.recursiveRegionSpacing && { ...entry.override.recursiveRegionSpacing } } })) };
}

function compareOverrides(left: GraphRelationPolicyOverrideV1, right: GraphRelationPolicyOverrideV1): number { return left.priority - right.priority || left.id.localeCompare(right.id); }
function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> { return value !== null && typeof value === 'object' && !isUnknownArray(value); }
function finite(value: JsonValue | undefined, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function positive(value: JsonValue | undefined, fallback: number): number { const n = finite(value, fallback); return n > 0 ? n : fallback; }
function nonNegative(value: JsonValue | undefined, fallback: number): number { const n = finite(value, fallback); return n >= 0 ? n : fallback; }
function copyFinite(source: Record<string, JsonValue>, target: Record<string, unknown>, key: string): void { if (typeof source[key] === 'number' && Number.isFinite(source[key])) target[key] = source[key]; }
function copyPositive(source: Record<string, JsonValue>, target: Record<string, unknown>, key: string): void { if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] > 0) target[key] = source[key]; }
function copyNonNegative(source: Record<string, JsonValue>, target: Record<string, unknown>, key: string): void { if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= 0) target[key] = source[key]; }
function finiteValue(value: JsonValue | undefined): value is number { return typeof value === 'number' && Number.isFinite(value); }
function positiveValue(value: JsonValue | undefined): value is number { return finiteValue(value) && value > 0; }
function nonNegativeValue(value: JsonValue | undefined): value is number { return finiteValue(value) && value >= 0; }

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
