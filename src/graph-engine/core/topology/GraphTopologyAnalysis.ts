import type { GraphDocumentV1, GraphTopologyLayoutPolicyV1 } from '../../contracts/v1/index.ts';
import {
  DEFAULT_GRAPH_TOPOLOGY_LAYOUT_POLICY_V1,
  resolveGraphTopologyPairPolicyV1,
  type ResolvedGraphTopologyPairPolicyV1,
} from './GraphTopologyLayoutPolicy.ts';

export interface GraphTopologyConnectionV1 {
  readonly sourceId: string;
  readonly targetId: string;
}

export interface GraphTopologyPairV1 {
  readonly key: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly edgeIds: readonly string[];
  readonly evidenceMass: number;
  readonly multiplicity: number;
  readonly reciprocal: boolean;
  readonly undirected: boolean;
  readonly relationChannels: readonly string[];
  readonly sourceDegree: number;
  readonly targetDegree: number;
  readonly affinity: number;
  readonly layoutPolicy: ResolvedGraphTopologyPairPolicyV1;
}

export interface GraphTopologyComponentV1 {
  readonly id: string;
  readonly nodeIds: readonly string[];
}

export interface GraphTopologyAnalysisV1 {
  readonly pairs: readonly GraphTopologyPairV1[];
  readonly components: readonly GraphTopologyComponentV1[];
  readonly totalDegrees: ReadonlyMap<string, number>;
  readonly weightedDegrees: ReadonlyMap<string, number>;
  readonly inboundDegrees: ReadonlyMap<string, number>;
  readonly outboundDegrees: ReadonlyMap<string, number>;
  readonly relationDegrees: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

interface MutablePair {
  readonly key: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly edgeIds: string[];
  evidenceMass: number;
  multiplicity: number;
  forward: boolean;
  reverse: boolean;
  undirected: boolean;
  readonly relationChannels: Set<string>;
}

const DEFAULT_RELATION_CHANNEL = '';

export function analyzeGraphTopologyV1(
  document: GraphDocumentV1,
  additionalConnections: readonly GraphTopologyConnectionV1[] = [],
  policy: GraphTopologyLayoutPolicyV1 = DEFAULT_GRAPH_TOPOLOGY_LAYOUT_POLICY_V1,
): GraphTopologyAnalysisV1 {
  const nodeIds = document.nodes.map((node) => node.id).sort();
  const pairs = aggregatePairs(document);
  const neighborSets = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  const weightedDegrees = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const inboundSets = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  const outboundSets = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  const relationNeighborSets = new Map<string, Map<string, Set<string>>>();

  for (const edge of document.edges) {
    if (edge.sourceId === edge.targetId || Math.abs(edge.weight ?? 1) <= 0) continue;
    if (edge.directed !== true) {
      inboundSets.get(edge.sourceId)?.add(edge.targetId);
      inboundSets.get(edge.targetId)?.add(edge.sourceId);
      outboundSets.get(edge.sourceId)?.add(edge.targetId);
      outboundSets.get(edge.targetId)?.add(edge.sourceId);
    } else {
      outboundSets.get(edge.sourceId)?.add(edge.targetId);
      inboundSets.get(edge.targetId)?.add(edge.sourceId);
    }
  }

  for (const pair of pairs) {
    if (pair.evidenceMass <= 0) continue;
    neighborSets.get(pair.sourceId)?.add(pair.targetId);
    neighborSets.get(pair.targetId)?.add(pair.sourceId);
    weightedDegrees.set(pair.sourceId, (weightedDegrees.get(pair.sourceId) ?? 0) + pair.evidenceMass);
    weightedDegrees.set(pair.targetId, (weightedDegrees.get(pair.targetId) ?? 0) + pair.evidenceMass);
    for (const channel of pair.relationChannels) {
      const channelSets = getOrCreateRelationChannel(relationNeighborSets, channel);
      getOrCreateNeighborSet(channelSets, pair.sourceId).add(pair.targetId);
      getOrCreateNeighborSet(channelSets, pair.targetId).add(pair.sourceId);
    }
  }

  const totalDegrees = countSets(neighborSets);
  const inboundDegrees = countSets(inboundSets);
  const outboundDegrees = countSets(outboundSets);
  const relationDegrees = new Map<string, ReadonlyMap<string, number>>();
  for (const [channel, sets] of [...relationNeighborSets].sort(([left], [right]) => left.localeCompare(right))) {
    relationDegrees.set(channel, countSets(sets));
  }

  // Specialized relations must not move unrelated springs merely by changing the
  // normalization median. The reference therefore uses the universal default for
  // every pair; only the specialized pair's numerator and bounds are overridden.
  const baselineRawAffinities = pairs.map((pair) => rawAffinity(
    pair, totalDegrees, relationDegrees, policy.defaultPairPolicy,
  ));
  const reference = median(baselineRawAffinities.filter((value) => value > 0)) || 1;
  const analyzedPairs = pairs.map((pair): GraphTopologyPairV1 => ({
    key: pair.key,
    sourceId: pair.sourceId,
    targetId: pair.targetId,
    edgeIds: [...pair.edgeIds].sort(),
    evidenceMass: pair.evidenceMass,
    multiplicity: pair.multiplicity,
    reciprocal: pair.forward && pair.reverse,
    undirected: pair.undirected,
    relationChannels: [...pair.relationChannels].sort(),
    sourceDegree: effectiveDegree(pair.sourceId, pair.relationChannels, totalDegrees, relationDegrees),
    targetDegree: effectiveDegree(pair.targetId, pair.relationChannels, totalDegrees, relationDegrees),
    affinity: pairAffinity(pair, totalDegrees, relationDegrees, policy, reference),
    layoutPolicy: resolveGraphTopologyPairPolicyV1(pair.relationChannels, policy),
  }));

  const componentConnections: GraphTopologyConnectionV1[] = [
    ...analyzedPairs
      .filter((pair) => pair.evidenceMass > 0)
      .map((pair) => ({ sourceId: pair.sourceId, targetId: pair.targetId })),
    ...additionalConnections,
  ];

  return {
    pairs: analyzedPairs,
    components: connectedComponents(nodeIds, componentConnections),
    totalDegrees,
    weightedDegrees,
    inboundDegrees,
    outboundDegrees,
    relationDegrees,
  };
}

export function graphTopologyPairKeyV1(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function aggregatePairs(document: GraphDocumentV1): MutablePair[] {
  const result = new Map<string, MutablePair>();
  for (const edge of document.edges) {
    if (edge.sourceId === edge.targetId) continue;
    const sourceFirst = edge.sourceId.localeCompare(edge.targetId) <= 0;
    const sourceId = sourceFirst ? edge.sourceId : edge.targetId;
    const targetId = sourceFirst ? edge.targetId : edge.sourceId;
    const key = graphTopologyPairKeyV1(sourceId, targetId);
    let pair = result.get(key);
    if (!pair) {
      pair = {
        key,
        sourceId,
        targetId,
        edgeIds: [],
        evidenceMass: 0,
        multiplicity: 0,
        forward: false,
        reverse: false,
        undirected: false,
        relationChannels: new Set<string>(),
      };
      result.set(key, pair);
    }
    pair.edgeIds.push(edge.id);
    pair.evidenceMass += Math.abs(edge.weight ?? 1);
    pair.multiplicity += 1;
    if (edge.directed === true) {
      if (sourceFirst) pair.forward = true;
      else pair.reverse = true;
    } else pair.undirected = true;
    const channels = edge.tokens?.filter((token) => token.startsWith('relation:')) ?? [];
    if (!channels.length) pair.relationChannels.add(DEFAULT_RELATION_CHANNEL);
    else for (const channel of channels) pair.relationChannels.add(channel);
  }
  return [...result.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function rawAffinity(
  pair: MutablePair,
  totalDegrees: ReadonlyMap<string, number>,
  relationDegrees: ReadonlyMap<string, ReadonlyMap<string, number>>,
  settings: Pick<ResolvedGraphTopologyPairPolicyV1,
    'evidenceGrowth' | 'reciprocalBoost' | 'hubDiscountExponent'>,
): number {
  if (pair.evidenceMass <= 0) return 0;
  const evidence = settings.evidenceGrowth.curve === 'log2'
    ? 1 + settings.evidenceGrowth.coefficient * Math.log2(Math.max(1, pair.evidenceMass))
    : 1;
  const reciprocal = pair.forward && pair.reverse ? settings.reciprocalBoost : 1;
  const sourceDegree = effectiveDegree(pair.sourceId, pair.relationChannels, totalDegrees, relationDegrees);
  const targetDegree = effectiveDegree(pair.targetId, pair.relationChannels, totalDegrees, relationDegrees);
  const hubDiscount = 1 / Math.pow(Math.max(1, sourceDegree * targetDegree), settings.hubDiscountExponent);
  return evidence * reciprocal * hubDiscount;
}

function pairAffinity(
  pair: MutablePair,
  totalDegrees: ReadonlyMap<string, number>,
  relationDegrees: ReadonlyMap<string, ReadonlyMap<string, number>>,
  policy: GraphTopologyLayoutPolicyV1,
  reference: number,
): number {
  if (pair.evidenceMass <= 0) return 0;
  const resolved = resolveGraphTopologyPairPolicyV1(pair.relationChannels, policy);
  return clamp(
    rawAffinity(pair, totalDegrees, relationDegrees, resolved) / reference,
    resolved.minimumAffinity,
    resolved.maximumAffinity,
  );
}

function effectiveDegree(
  nodeId: string,
  channels: ReadonlySet<string>,
  totalDegrees: ReadonlyMap<string, number>,
  relationDegrees: ReadonlyMap<string, ReadonlyMap<string, number>>,
): number {
  let result = Math.max(1, totalDegrees.get(nodeId) ?? 0);
  for (const channel of channels) {
    result = Math.min(result, Math.max(1, relationDegrees.get(channel)?.get(nodeId) ?? 0));
  }
  return result;
}

function connectedComponents(
  nodeIds: readonly string[],
  connections: readonly GraphTopologyConnectionV1[],
): GraphTopologyComponentV1[] {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  for (const connection of connections) {
    if (connection.sourceId === connection.targetId) continue;
    if (!adjacency.has(connection.sourceId) || !adjacency.has(connection.targetId)) continue;
    adjacency.get(connection.sourceId)!.add(connection.targetId);
    adjacency.get(connection.targetId)!.add(connection.sourceId);
  }
  const visited = new Set<string>();
  const result: GraphTopologyComponentV1[] = [];
  for (const root of nodeIds) {
    if (visited.has(root)) continue;
    const queue = [root];
    const members: string[] = [];
    visited.add(root);
    for (let index = 0; index < queue.length; index += 1) {
      const nodeId = queue[index];
      members.push(nodeId);
      for (const neighbor of [...(adjacency.get(nodeId) ?? [])].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    members.sort();
    result.push({ id: members[0], nodeIds: members });
  }
  return result.sort((left, right) => right.nodeIds.length - left.nodeIds.length || left.id.localeCompare(right.id));
}

function getOrCreateRelationChannel(
  channels: Map<string, Map<string, Set<string>>>,
  channel: string,
): Map<string, Set<string>> {
  let result = channels.get(channel);
  if (!result) {
    result = new Map();
    channels.set(channel, result);
  }
  return result;
}

function getOrCreateNeighborSet(
  values: Map<string, Set<string>>,
  nodeId: string,
): Set<string> {
  let result = values.get(nodeId);
  if (!result) {
    result = new Set();
    values.set(nodeId, result);
  }
  return result;
}

function countSets(values: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, number> {
  return new Map([...values].map(([key, value]) => [key, value.size]));
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
