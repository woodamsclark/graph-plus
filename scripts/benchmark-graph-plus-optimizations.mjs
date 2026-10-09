import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import esbuild from 'esbuild';
const outfile = join(tmpdir(), `graph-plus-optimizations-benchmark-${process.pid}.cjs`);
process.on('exit', () => rmSync(outfile, { force: true }));
await esbuild.build({ entryPoints: ['scripts/benchmark-graph-plus-optimizations.ts'], bundle: true,
  outfile, platform: 'node', format: 'cjs', alias: { obsidian: join(process.cwd(), 'tests/support/obsidianUi.ts') } });
createRequire(import.meta.url)(outfile);
