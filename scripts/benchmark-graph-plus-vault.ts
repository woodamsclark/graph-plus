import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { App, TFile } from 'obsidian';
import { ObsidianVaultGraphSourceV1 } from '../src/graph-plus/adapter/ObsidianVaultGraphSource.ts';
import { GraphPlusVaultModelV1 } from '../src/graph-plus/application/GraphPlusVaultModel.ts';
import { compileGraphPlusFilterV1, createDefaultGraphPlusLensV1 } from '../src/graph-plus/query/index.ts';

// This exercises the vault metadata/source/adapter path with a synthetic host.
// Search timing uses the same host double as tests, not the real Obsidian matcher.
export async function run(): Promise<void> {
  const results: unknown[] = [];
  for (const count of [1000, 5000, 10000]) {
    const files = Array.from({ length: count }, (_, index) => ({
      path: `note-${index}.md`, basename: `note-${index}`, extension: 'md', stat: { mtime: 1 },
    }));
    const links: Record<string, Record<string, number>> = {};
    for (let index = 0; index < count; index++) {
      const targets = [1, 7, 31, 97].map(offset => files[(index + offset) % count].path);
      links[files[index].path] = Object.fromEntries(targets.map((target, offset) => [target, offset === 0 ? 3 : 1]));
    }
    const samples: Record<string, number>[] = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      files[0].stat.mtime = repetition * 2 + 1;
      links[files[0].path][files[1].path] = 3;
      if (typeof global.gc === 'function') global.gc();
      const baseline = process.memoryUsage().heapUsed;
      let observedHeap = baseline;
      let reads = 0;
      const app = {
        vault: {
          getMarkdownFiles: () => files, getName: () => 'Synthetic benchmark vault',
          cachedRead: async () => { reads++; throw new Error('Graph metadata must not read note bodies.'); },
        },
        metadataCache: {
          resolvedLinks: links,
          getFileCache: (file: typeof files[number]) => ({
            frontmatter: { tags: [`topic/group-${Number(file.basename.slice(5)) % 20}`], status: 'draft' },
            tags: [],
          }),
          getFirstLinkpathDest: () => null,
        },
      } as unknown as App;
      const source = new ObsidianVaultGraphSourceV1(app);
      const model = new GraphPlusVaultModelV1<TFile>(source, { countDuplicateLinks: true });
      const measure = async (operation: () => unknown | Promise<unknown>) => {
        const start = performance.now();
        await operation();
        const elapsed = performance.now() - start;
        observedHeap = Math.max(observedHeap, process.memoryUsage().heapUsed);
        return elapsed;
      };
      const coldOpenMs = await measure(() => model.open());
      if (reads !== 0) throw new Error('Cold source must not read any note bodies.');
      const warmSourceMs = await measure(() => source.read());
      const initial = model.read()!;
      const noOpReconcileMs = await measure(() => model.reconcile());
      if (model.read()!.document !== initial.document || reads !== 0) throw new Error('Warm reconcile must retain revision without disk reads.');
      files[0].stat.mtime++;
      const contentEditMs = await measure(() => model.reconcile());
      if (model.read()!.document !== initial.document || reads !== 0) throw new Error('A body edit with unchanged metadata must retain the graph without reading content.');
      links[files[0].path][files[1].path] = 5;
      const topologyEditMs = await measure(() => model.reconcile());
      if (model.read()!.document.revision !== initial.document.revision + 1 || reads !== 0) throw new Error('Link edit must advance revision without re-reading bodies.');
      const lens = { ...createDefaultGraphPlusLensV1(false), query: '#topic/group-7' };
      let matched = 0;
      const searchMs = await measure(() => {
        const current = model.read()!;
        const result = compileGraphPlusFilterV1(current.document, lens, current.searchIndex);
        matched = result.visibleNodeIds.length;
      });
      if (matched !== count / 20) throw new Error(`Search fixture mismatch: ${matched}`);
      const current = model.read()!;
      const documentBytes = Buffer.byteLength(JSON.stringify(current.document));
      samples.push({ coldOpenMs, warmSourceMs, noOpReconcileMs, contentEditMs, topologyEditMs, searchMs,
        observedHeapGrowthMiB: (observedHeap - baseline) / 1048576,
        observedHeapMiB: observedHeap / 1048576, documentBytes, reads, matched,
        nodes: current.document.nodes.length, edges: current.document.edges.length });
    }
    results.push({ notes: count, samples });
    console.log(`Measured ${count} notes using metadata only.`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), osRelease: release(), cpu: cpus()[0]?.model,
      architecture: process.arch, gcBetweenSamples: typeof global.gc === 'function' },
    method: 'Three runs per size. Four outbound links with repeats, twenty nested tags, zero note-body reads. Stage-end heap observations are not peak or retained memory. Search uses a simple-search host double; timings do not measure the real Obsidian API. No renderer, physics, real Obsidian, or mobile.',
    results,
  };
  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/graph-plus-vault-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Saved outputs/graph-plus-vault-benchmark.json');
}
