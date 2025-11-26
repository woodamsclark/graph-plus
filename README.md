# Greater Graph (v0) — minimal Obsidian plugin

This plugin provides a simple custom view `Greater Graph` that lays out your vault's Markdown files as nodes on a 2D canvas.

Build & install

1. Install dev dependencies (one-time):

```bash
npm install
```

2. Build the plugin (produces `main.js`):

```bash
npm run build
```

3. Enable the plugin in Obsidian (or copy the plugin folder into your `.obsidian/plugins/` and reload plugins). Use the command palette to run `Open Greater Graph`.

Notes
- The build uses `esbuild` to bundle `main.ts` into `main.js` (CommonJS). The `esbuild.config.js` treats `obsidian` and `electron` as external.
- The plugin is intentionally minimal; see `GraphView.ts` and the `graph/` modules for the data/layout/renderer separation.

Next suggestions
- Add devicePixelRatio scaling for crisp canvas rendering.
- Hook vault change events to auto-refresh the graph.
- Add click handlers to open notes from nodes.
