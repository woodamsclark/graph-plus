require('esbuild').build({
  entryPoints: ['main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'node',
  external: ['obsidian', 'electron'],
}).catch(() => process.exit(1));
