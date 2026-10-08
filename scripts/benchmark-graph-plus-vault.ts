import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { App, TFile } from 'obsidian';
import { ObsidianVaultGraphSourceV1 } from '../src/graph-plus/adapter/ObsidianVaultGraphSource.ts';
import { GraphPlusVaultModelV1 } from '../src/graph-plus/application/GraphPlusVaultModel.ts';
import { compileGraphPlusFilterV1, createDefaultGraphPlusLensV1 } from '../src/graph-plus/query/index.ts';

// This exercises the shipped vault/source/adapter/search path, with a disk-backed
// synthetic host. It deliberately excludes renderer, physics, and live vault data.
export async function run(): Promise<void> {
  const results: unknown[] = [];
  for (const count of [1000, 5000, 10000]) {
    const directory = await mkdtemp(join(tmpdir(), 'graph-plus-vault-fixture-'));
    try {
      const files = Array.from({ length: count }, (_, index) => ({
        path: `note-${index}.md`, basename: `note-${index}`, extension: 'md', stat: { mtime: 1 },
      }));
      const links: Record<string, Record<string, number>> = {};
      let fixtureBytes = 0;
      const bodies = files.map((file, index) => {
        const targets = [1, 7, 31, 97].map(offset => files[(index + offset) % count].path);
        links[file.path] = Object.fromEntries(targets.map((target, offset) => [target, offset === 0 ? 3 : 1]));
        const header = `---\ntags: [topic/group-${index % 20}]\nstatus: draft\n---\n# ${file.basename}\n`;
        const references = targets.map(target => `[[${target}]]`).join(' ');
        const prose = `Research reflection ${index % 10 === 0 ? 'needlebenchmark' : 'ordinary'} paragraph with ideas and context.\n`;
        const size = [1024, 4096, 8192][index % 3];
        const body = header + references + '\n' + prose.repeat(Math.ceil(size / prose.length)).slice(0, size);
        fixtureBytes += Buffer.byteLength(body);
        return body;
      });
      let cursor = 0;
      await Promise.all(Array.from({ length: 32 }, async () => {
        while (cursor < count) {
          const index = cursor++;
          await writeFile(join(directory, files[index].path), bodies[index]);
        }
      }));
      // Fixture construction is excluded from all timing and memory baselines.
      bodies.length = 0;
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
            cachedRead: async (file: typeof files[number]) => { reads++; return readFile(join(directory, file.path), 'utf8'); },
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
        if (reads !== count) throw new Error('Cold source must read each note once.');
        const warmSourceMs = await measure(() => source.read());
        const initial = model.read()!;
        const noOpReconcileMs = await measure(() => model.reconcile());
        if (model.read()!.document !== initial.document || reads !== count) throw new Error('Warm reconcile must retain revision without disk reads.');
        await writeFile(join(directory, files[0].path), 'needlebenchmark Edited content without topology changes.');
        files[0].stat.mtime++;
        const contentEditMs = await measure(() => model.reconcile());
        if (model.read()!.document !== initial.document || reads !== count + 1) throw new Error('Content-only edit should refresh one body without a graph revision.');
        links[files[0].path][files[1].path] = 5;
        const topologyEditMs = await measure(() => model.reconcile());
        if (model.read()!.document.revision !== initial.document.revision + 1 || reads !== count + 1) throw new Error('Link edit must advance revision without re-reading bodies.');
        const lens = { ...createDefaultGraphPlusLensV1(false), query: 'content:needlebenchmark' };
        let matched = 0;
        const searchMs = await measure(() => {
          const current = model.read()!;
          const result = compileGraphPlusFilterV1(current.document, lens, current.searchIndex);
          if (result.error) throw new Error(result.error);
          matched = result.visibleNodeIds.length;
        });
        if (matched !== count / 10) throw new Error(`Search fixture mismatch: ${matched}`);
        const current = model.read()!;
        const documentBytes = Buffer.byteLength(JSON.stringify(current.document));
        samples.push({ coldOpenMs, warmSourceMs, noOpReconcileMs, contentEditMs, topologyEditMs, searchMs,
          observedHeapGrowthMiB: (observedHeap - baseline) / 1048576,
          observedHeapMiB: observedHeap / 1048576, documentBytes, reads, matched,
          nodes: current.document.nodes.length, edges: current.document.edges.length });
      }
      results.push({ notes: count, fixtureBytes, samples });
      console.log(`Measured ${count} notes (${(fixtureBytes / 1048576).toFixed(1)} MiB of note content).`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), osRelease: release(), cpu: cpus()[0]?.model,
      architecture: process.arch, gcBetweenSamples: typeof global.gc === 'function' },
    method: 'Three runs per size. Source cache cold on each run; OS filesystem cache uncontrolled. 1/4/8 KiB note bodies, four outbound links with repeats, twenty nested tags. Stage-end heap observations are not peak or retained memory. Synthetic metadata host; no renderer, physics, real Obsidian, or mobile.',
    results,
  };
  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/graph-plus-vault-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Saved outputs/graph-plus-vault-benchmark.json');
}
