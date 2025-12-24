require('esbuild').build({
  entryPoints: ['src/plugin/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'node',
  external: ['obsidian', 'electron'],
}).catch((e) => {
  console.error('esbuild error:', e && e.message ? e.message : e);
  if (e && e.errors) console.error(e.errors);
  process.exit(1);
});
