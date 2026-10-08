const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');

const outfile = path.join(os.tmpdir(), 'graph-plus-tests.cjs');

esbuild.buildSync({
  entryPoints: ['tests/run.ts'],
  bundle: true,
  outfile,
  format: 'cjs',
  platform: 'node',
  alias: { obsidian: path.resolve('tests/support/obsidianUi.ts') },
  external: ['obsidian', 'electron'],
});

require(outfile);
