import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const outfile = path.join(os.tmpdir(), 'graph-engine-v1.2-benchmark.cjs');

esbuild.buildSync({
  entryPoints: ['scripts/benchmark-graph-engine.ts'],
  bundle: true,
  outfile,
  format: 'cjs',
  platform: 'node',
  external: ['obsidian', 'electron'],
});

createRequire(import.meta.url)(outfile);
