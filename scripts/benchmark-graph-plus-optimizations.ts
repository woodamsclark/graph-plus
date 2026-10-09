import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { evaluateGraphFilterV1 } from '../src/graph-engine/core/filter/index.ts';
import { GraphEngineProviderCoreV1 } from '../src/graph-engine/service/index.ts';
import { GraphPlusApplicationV1, GraphPlusVaultModelV1 } from '../src/graph-plus/application/index.ts';
import { runtimeHarness, runtimeRegistration, InstrumentedPlatform } from '../tests/support/runtimeHarness.ts';
import type { GraphDocumentV1 } from '../src/graph-engine/contracts/v1/index.ts';

const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const results: unknown[] = [];
async function run() {
  for (const count of (process.env.GRAPH_PLUS_BENCHMARK_SIZES ?? '1000,5000,10000').split(',').map(Number)) {
    const document: GraphDocumentV1 = {
      schemaVersion: 1, documentId: 'benchmark', revision: 1,
      nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}` })),
      edges: Array.from({ length: count * 4 }, (_, i) => ({ id: `e${i}`, sourceId: `n${i % count}`, targetId: `n${(i + 7 + Math.floor(i / count)) % count}` })),
    };
    const filter = { schemaVersion: 1 as const, scope: 'render' as const,
      node: { op: 'id-in' as const, ids: document.nodes.filter((_, i) => i % 2 === 0).map(n => n.id) } };
    const timings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now(); evaluateGraphFilterV1(document, filter); timings.push(performance.now() - start);
    }
    for (const panes of (process.env.GRAPH_PLUS_BENCHMARK_PANES ?? '1,3').split(',').map(Number)) {
      const registration = runtimeRegistration();
      const runtime = runtimeHarness({ registration: { ...registration, consumerId: 'graph-plus' }, realTime: true });
      const core = new GraphEngineProviderCoreV1({ engineVersion: 'benchmark', engineInstanceId: 'benchmark',
        capabilities: ['render'], profiles: runtime.profiles, sessions: runtime.factory });
      const source = { vaultId: 'benchmark', notes: Array.from({ length: count }, (_, i) => ({
        file: { path: `n${i}.md` }, path: `n${i}.md`, basename: `n${i}`, extension: 'md', tags: [], properties: {},
      })), resolvedLinks: Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}.md`,
        Object.fromEntries([7,8,9,10].map(offset => [`n${(i + offset) % count}.md`, 1]))])) };
      const model = new GraphPlusVaultModelV1({ read: () => source }, { countDuplicateLinks: false });
      const clock = new InstrumentedPlatform(new Window());
      const options = { model, navigator: { openNote: async () => {}, openTag: async () => {} }, worldSyncClock: clock };
      const app = new GraphPlusApplicationV1(options);
      const presentations = [];
      for (let i = 0; i < panes; i++) {
        const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
        if (!lease.ok) throw new Error('lease');
        const presentation = app.createPresentation({ mode: 'global', vaultId: 'benchmark', checkpointStore: { load: async () => undefined, save: async () => {} }, lease: lease.lease, container: runtime.container, profileId: 'two-dimensional' });
        await presentation.open(); presentations.push(presentation);
      }
      const authority = presentations[0].getSession()!;
      let fullExports = 0; let positionExports = 0; let layoutStateExports = 0;
      const original = authority.exportWorldState.bind(authority);
      authority.exportWorldState = async () => { fullExports++; return original(); };
      const probe = authority as any;
      const exportLayout = probe.moduleHost.exportCapabilityState.bind(probe.moduleHost);
      probe.moduleHost.exportCapabilityState = (...args: any[]) => { layoutStateExports++; return exportLayout(...args); };
      const exportPositions = probe.exportWorldPositions?.bind(authority);
      if (exportPositions) probe.exportWorldPositions = async () => { positionExports++; return exportPositions(); };
      // Isolate notification/synchronization cost from force integration and rendering.
      const start = performance.now();
      for (let frame = 0; frame < 20; frame++) {
        for (let tick = 0; tick < 3; tick++) {
          const id = Object.keys(probe.viewState.positions)[0];
          probe.viewState = { ...probe.viewState, positions: { ...probe.viewState.positions,
            [id]: { x: frame * 3 + tick, y: 0, z: 0 } } };
          probe.emitWorldChanged('layout');
        }
        clock.flushFrame(); await settle();
      }
      const syncMs = performance.now() - start;
      const tickLayoutExports = layoutStateExports;
      const tickPositionExports = positionExports;
      const before = runtime.factory.getDiagnostics().sessions.map(s => s.counters?.projectionPasses ?? 0);
      const noOpStart = performance.now();
      for (let i = 0; i < 5; i++) await app.reconcile();
      const noOpReconcileMs = performance.now() - noOpStart;
      const after = runtime.factory.getDiagnostics().sessions.map(s => s.counters?.projectionPasses ?? 0);
      results.push({ nodes: count, edges: count * 4, panes, filterMs: timings.slice().sort((a,b) => a-b)[5],
        syncMs, fullExports, tickLayoutExports, tickPositionExports, noOpReconcileMs, noOpProjections: after.reduce((s,n,i) => s + n - before[i], 0) });
      await app.dispose(); await core.dispose();
      console.log(`Measured ${count} nodes, ${panes} pane(s).`);
    }
  }
  const report = { environment: { node: process.version, platform: process.platform, arch: process.arch },
    method: 'Synthetic host and canvas. Median of 10 ID-filter evaluations. 20 frames of 3 world invalidations and 5 unchanged reconciliations. Timings exclude force integration, real drawing, and Obsidian; operation counts measure avoided work.', results };
  writeFileSync(process.argv[2] ?? 'outputs/graph-plus-optimizations-benchmark.json', JSON.stringify(report, null, 2) + '\n');
}
void run();
