import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'graph-plus-vault-benchmark-'));
try {
  const outfile = join(temporary, 'benchmark.mjs');
  await esbuild.build({
    entryPoints: ['scripts/benchmark-graph-plus-vault.ts'], bundle: true,
    outfile, format: 'esm', platform: 'node',
    alias: { obsidian: join(process.cwd(), 'tests/support/obsidianSearch.ts') },
    external: ['obsidian', 'electron'],
  });
  const { run } = await import(pathToFileURL(outfile).href);
  await run();
} finally {
  await rm(temporary, { recursive: true, force: true });
}
