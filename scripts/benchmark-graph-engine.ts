import { performance } from 'node:perf_hooks';
import type {
  GraphDimensionsV1,
  GraphNodeRegionsDocumentV1,
} from '../src/graph-engine/contracts/v1/index.ts';
import { graphDocument, graphEdge, graphNode } from '../tests/support/contractFixtures.ts';
import { runtimeHarness, runtimeRegistration } from '../tests/support/runtimeHarness.ts';

interface BenchmarkScenario {
  readonly id: string;
  readonly nodes: number;
  readonly edges: number;
  readonly dimensions: GraphDimensionsV1;
  readonly warmupFrames: number;
  readonly measuredFrames: number;
  readonly regions?: { readonly count: number; readonly memberships: number };
  readonly topology?: 'weighted-stress';
}

const scenarios: readonly BenchmarkScenario[] = [
  { id: 'v16-native-1500-2d', nodes: 1_500, edges: 3_000, dimensions: '2d', warmupFrames: 20, measuredFrames: 180 },
  { id: 'vault-1500-2d', nodes: 1_500, edges: 3_000, dimensions: '2d', warmupFrames: 20, measuredFrames: 180 },
  { id: 'vault-1500-3d', nodes: 1_500, edges: 3_000, dimensions: '3d', warmupFrames: 20, measuredFrames: 180 },
  {
    id: 'regions-stress-1500-2d', nodes: 1_500, edges: 3_000, dimensions: '2d',
    warmupFrames: 20, measuredFrames: 180, regions: { count: 100, memberships: 1_000 },
  },
  { id: 'scale-5000-2d', nodes: 5_000, edges: 10_000, dimensions: '2d', warmupFrames: 10, measuredFrames: 180 },
  { id: 'scale-5000-3d', nodes: 5_000, edges: 10_000, dimensions: '3d', warmupFrames: 10, measuredFrames: 180 },
  {
    id: 'weighted-stress-10000-2d', nodes: 10_000, edges: 30_000, dimensions: '2d',
    warmupFrames: 5, measuredFrames: 60, topology: 'weighted-stress',
  },
];

async function main(): Promise<void> {
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario));
  console.log(JSON.stringify({
    benchmark: 'graph-engine-v1.6-headless',
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    results,
  }, null, 2));
}

async function runScenario(scenario: BenchmarkScenario) {
  const nodes = Array.from({ length: scenario.nodes }, (_, index) => graphNode(`vault-${index}`, {
    label: `Vault node ${index}`,
    positionHint: seededPosition(index, scenario.dimensions),
  }));
  const edges = scenario.topology === 'weighted-stress'
    ? createWeightedStressEdges(scenario.nodes, scenario.edges)
    : Array.from({ length: scenario.edges }, (_, index) => graphEdge(
      `vault-edge-${index}`,
      `vault-${index % nodes.length}`,
      `vault-${(index * 37 + 17) % nodes.length}`,
    ));
  const profileId = scenario.dimensions === '2d' ? 'two-dimensional' : 'three-dimensional';
  const nodeRegions = scenario.regions
    ? createNodeRegions(scenario.nodes, scenario.regions.count, scenario.regions.memberships)
    : undefined;
  const harness = runtimeHarness({
    profileId,
    document: graphDocument({
      documentId: `benchmark-${scenario.id}`,
      nodes,
      edges,
      ...(nodeRegions ? { nodeRegions } : {}),
    }),
    registration: benchmarkRegistration(),
    realTime: true,
  });
  harness.profiles.setUserOverrides('synthetic-consumer', profileId, {
    modules: {
      'force-layout': { enabled: true },
      'node-regions': { enabled: nodeRegions !== undefined },
      rendering: { settings: { labelMode: 'off' } },
    },
  });

  const mountStart = performance.now();
  const session = await harness.create();
  const mountMs = performance.now() - mountStart;
  const frameDuration = 1_000 / 60;
  for (let index = 0; index < scenario.warmupFrames; index += 1) {
    harness.platform.flushFrame((index + 1) * frameDuration);
  }
  await session.resetPerformanceMeasurements();
  const runStart = performance.now();
  for (let index = 0; index < scenario.measuredFrames; index += 1) {
    harness.platform.flushFrame((index + scenario.warmupFrames + 1) * frameDuration);
  }
  const wallMs = performance.now() - runStart;
  const snapshot = await session.exportPerformanceSnapshot();
  await session.dispose();

  return {
    fixture: {
      id: scenario.id,
      nodes: nodes.length,
      edges: edges.length,
      dimensions: scenario.dimensions,
      labels: 'off',
      regions: nodeRegions?.definitions.length ?? 0,
      directMemberships: nodeRegions?.definitions.reduce(
        (total, definition) => total + definition.directMemberNodeIds.length,
        0,
      ) ?? 0,
      topology: scenario.topology ?? 'regular',
      system: 'anima-native',
    },
    mountMs,
    requestedFrames: scenario.measuredFrames,
    measuredFrames: snapshot.window?.totalMs.sampleCount ?? 0,
    wallMs,
    totalMs: snapshot.window?.totalMs,
    moduleTickMs: snapshot.window?.moduleTickMs,
    renderProjectionMs: snapshot.window?.projectionMs,
    regionRenderMs: snapshot.window?.regionRenderMs,
    counters: snapshot.counters,
  };
}

function benchmarkRegistration() {
  const registration = runtimeRegistration();
  return {
    ...registration,
    profiles: registration.profiles.map((profile) => ({
      ...profile,
      modules: {
        ...profile.modules,
        rendering: {
          ...profile.modules.rendering,
          defaults: { labelMode: 'off', nodeRadiusScale: 1, edgeThicknessScale: 1, showArrows: false },
        },
        'force-layout': {
          ...profile.modules['force-layout'],
          defaultEnabled: true,
          defaults: {
            weightingMode: 'topology-weighted',
            repulsionStrength: 1000, springStrength: 1, springLength: 250,
            centeringStrength: 0.1, velocityDecay: 0.4,
            alphaDecay: 0.02276277904418933, alphaMin: 0.001,
            repulsionMinDistance: 30, barnesHutTheta: 0.9,
            collisionRadius: 60, collisionStrength: 0.5,
          },
        },
        anima: { ...profile.modules.anima, defaultEnabled: true },
      },
    })),
  };
}

function createWeightedStressEdges(nodeCount: number, edgeCount: number) {
  const ranges = createComponentRanges(nodeCount, 500, 2_000);
  const edges = [];
  for (let index = 1; index <= 1_500 && edges.length < edgeCount; index += 1) {
    edges.push(graphEdge(`weighted-edge-${edges.length}`, 'vault-0', `vault-${index}`, {
      directed: true,
      tokens: [`relation:channel-${index % 20}`],
    }));
  }
  let cursor = 0;
  while (edges.length < edgeCount) {
    const range = ranges[cursor % ranges.length];
    const size = range.end - range.start;
    let source = range.start + ((cursor * 37 + 3) % size);
    let target = range.start + ((cursor * 97 + 11) % size);
    if (cursor % 997 === 0) target = source;
    else if (target === source) target = range.start + ((target - range.start + 1) % size);
    if (cursor % 41 === 0 && edges.length) {
      const previous = edges[edges.length - 1];
      source = Number(previous.sourceId.slice('vault-'.length));
      target = Number(previous.targetId.slice('vault-'.length));
    }
    const relation = `relation:channel-${cursor % 20}`;
    edges.push(graphEdge(`weighted-edge-${edges.length}`, `vault-${source}`, `vault-${target}`, {
      directed: cursor % 7 !== 0,
      weight: cursor % 29 === 0 ? 3 : 1,
      tokens: [relation],
    }));
    if (cursor % 31 === 0 && source !== target && edges.length < edgeCount) {
      edges.push(graphEdge(`weighted-edge-${edges.length}`, `vault-${target}`, `vault-${source}`, {
        directed: true,
        tokens: [relation],
      }));
    }
    cursor += 1;
  }
  return edges;
}

function createComponentRanges(nodeCount: number, componentCount: number, firstSize: number) {
  const ranges = [{ start: 0, end: Math.min(nodeCount, firstSize) }];
  let cursor = ranges[0].end;
  for (let component = 1; component < componentCount && cursor < nodeCount; component += 1) {
    const remainingComponents = componentCount - component;
    const size = Math.max(2, Math.ceil((nodeCount - cursor) / remainingComponents));
    ranges.push({ start: cursor, end: Math.min(nodeCount, cursor + size) });
    cursor += size;
  }
  return ranges;
}

function createNodeRegions(
  nodeCount: number,
  regionCount: number,
  membershipCount: number,
): GraphNodeRegionsDocumentV1 {
  const members = Array.from({ length: regionCount }, () => new Set<string>());
  let relationships = 0;
  for (let child = 1; child < regionCount && relationships < membershipCount; child += 1) {
    const parent = Math.floor((child - 1) / 3);
    members[parent].add(`vault-${child}`);
    relationships += 1;
  }
  let cursor = 0;
  while (relationships < membershipCount) {
    const region = cursor % regionCount;
    const leaf = regionCount + ((cursor * 37 + Math.floor(cursor / regionCount) * 17) % (nodeCount - regionCount));
    const before = members[region].size;
    members[region].add(`vault-${leaf}`);
    if (members[region].size > before) relationships += 1;
    cursor += 1;
  }
  return {
    version: 1,
    definitions: members.map((directMembers, region) => ({
      regionNodeId: `vault-${region}`,
      directMemberNodeIds: [...directMembers].sort(),
    })),
  };
}

function seededPosition(index: number, dimensions: GraphDimensionsV1): { x: number; y: number; z: number } {
  const angle = index * 2.399963229728653;
  const radius = 25 + Math.sqrt(index + 1) * 18;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: dimensions === '3d' ? Math.sin(index * 0.37) * Math.sqrt(index + 1) * 4 : 0,
  };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
