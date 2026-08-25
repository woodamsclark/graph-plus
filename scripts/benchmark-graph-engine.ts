import { performance } from 'node:perf_hooks';
import type { GraphDimensionsV1 } from '../src/graph-engine/contracts/v1/index.ts';
import { graphDocument, graphEdge, graphNode } from '../tests/support/contractFixtures.ts';
import { runtimeHarness } from '../tests/support/runtimeHarness.ts';

interface BenchmarkScenario {
  readonly id: string;
  readonly nodes: number;
  readonly edges: number;
  readonly dimensions: GraphDimensionsV1;
  readonly warmupFrames: number;
  readonly measuredFrames: number;
}

const scenarios: readonly BenchmarkScenario[] = [
  { id: 'vault-1500-2d', nodes: 1_500, edges: 3_000, dimensions: '2d', warmupFrames: 20, measuredFrames: 180 },
  { id: 'vault-1500-3d', nodes: 1_500, edges: 3_000, dimensions: '3d', warmupFrames: 20, measuredFrames: 180 },
  { id: 'scale-5000-2d', nodes: 5_000, edges: 10_000, dimensions: '2d', warmupFrames: 10, measuredFrames: 180 },
  { id: 'scale-5000-3d', nodes: 5_000, edges: 10_000, dimensions: '3d', warmupFrames: 10, measuredFrames: 180 },
];

async function main(): Promise<void> {
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario));
  console.log(JSON.stringify({
    benchmark: 'graph-engine-v1.2-headless',
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
  const edges = Array.from({ length: scenario.edges }, (_, index) => graphEdge(
    `vault-edge-${index}`,
    `vault-${index % nodes.length}`,
    `vault-${(index * 37 + 17) % nodes.length}`,
  ));
  const profileId = scenario.dimensions === '2d' ? 'two-dimensional' : 'three-dimensional';
  const harness = runtimeHarness({
    profileId,
    document: graphDocument({ documentId: `benchmark-${scenario.id}`, nodes, edges }),
    realTime: true,
  });
  harness.profiles.setUserOverrides('synthetic-consumer', profileId, {
    modules: {
      'force-layout': { enabled: true },
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
    },
    mountMs,
    requestedFrames: scenario.measuredFrames,
    measuredFrames: snapshot.window?.totalMs.sampleCount ?? 0,
    wallMs,
    totalMs: snapshot.window?.totalMs,
    moduleTickMs: snapshot.window?.moduleTickMs,
    renderProjectionMs: snapshot.window?.projectionMs,
    counters: snapshot.counters,
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
