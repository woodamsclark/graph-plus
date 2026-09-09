# Graph+

Graph+ is an exploratory graph for Obsidian: a place to move through the ideas in
your vault, not just a dashboard about them.

Obsidian’s native graph is a useful map. Graph+ keeps that spirit and adds a more
spatial, interactive workflow for creating, returning, reflecting, and discovering:

- Open the whole vault in 2D or 3D.
- Keep meaningful node locations between sessions.
- Focus on a note and its neighborhood.
- Filter the graph while leaving your notes and links unchanged.
- Preview notes while you explore.
- Use Form, filters, regions, and layout controls to look at the same vault from
  different angles.

Graph+ is for Obsidian users who think through connections—writers, researchers,
students, knowledge workers, and anyone whose vault becomes more useful when they
can see relationships spatially. It is especially useful after notes and links have
accumulated and you want to return to the vault with a question: What connects to
this? Where are the clusters? What did I overlook?

Graph+ 2.0 is intentionally foundational. It establishes the persistent 2D/3D graph,
interaction model, rendering system, and plugin platform. Larger exploratory tools
are planned for future releases.

## How to use Graph+

### Open the global or local graph

Use any of these entry points:

- Click the network ribbon icon.
- Run the `open graph+` command from the command palette.
- Right-click a Markdown file and choose `show in graph+` to open the graph with
  that note available as the starting point.

Graph+ has two related views:

- **Global graph** shows the vault-wide graph. Use it to explore broad clusters,
  connections, orphan notes, and the overall shape of your knowledge base.
- **Local graph** shows a neighborhood around one note. Run `open local graph+` from
  the command palette, or use it from an active note, then adjust the neighborhood
  depth to expand or narrow what is around that note.

The global graph is the place for broad discovery and spatial organization. The local
graph is the place for following one idea, note, or thread without loading the entire
vault into your immediate view. Both views use the same Graph+ interaction model and
persist their own graph state.

### Explore and navigate

Select nodes to focus on them and reveal their neighborhood. Clear focus to return to
the broader graph. Drag nodes to arrange the space; Graph+ persists node placement,
camera framing, pins, focus, and selection as graph state for the vault.

On desktop, use pointer, wheel, keyboard, and modifier interactions. On touch devices,
use one- and two-finger gestures for graph movement and navigation. The exact gesture
behavior follows the active graph dimension and focus state.

### Refine what you see

Use the graph controls to:

- Search for nodes with `Filter nodes…`.
- Include or hide tag nodes and orphan notes.
- Reset the current filters.
- Switch between ordinary graph exploration and Form mode.
- Choose a relation and depth when using Form mode.
- Change display, force-layout, region, and dimension settings.

These are reversible views of your vault. They do not rewrite Markdown files, rename
notes, or change the canonical links between them.

### Change dimensions and recover a layout

Graph+ opens in 2D by default. Use the dimension control to switch to 3D. The graph
engine preserves the graph document while changing the presentation and camera.

If you want to regenerate placement and camera state for the vault, use **Settings →
Community plugins → Graph+ → Reset graph layout data**. This does not change notes,
links, filters, Form state, colors, labels, or settings.

## Default experience

These are the defaults for a new Graph+ profile. Settings can be changed globally or
for the Graph+ profile where supported.

| Area | Default |
| --- | --- |
| Graph dimensions | 2D; 3D is available from the dimension control |
| Layout | Topology-weighted force layout |
| Render quality | Automatic |
| Labels | Adaptive |
| Label position | Above nodes |
| Node size | 2× base radius |
| Link thickness | 0.1× base width |
| Link arrows | Off |
| Region boundaries | Off; region attraction remains enabled |
| Form | Off |
| Force layout | Enabled |
| Repulsion strength | 1000 |
| Link strength | 1 |
| Link distance | 250 |
| Center force | 0.1 |
| Motion damping | 0.4 |
| Collision spacing | 60 |
| 3D axial spring | Off |
| Quick settings | Collapsed |

## For plugin developers

Graph+ is the first priority consumer of `graph-engine`, a host-neutral graph platform.

The core engine is designed for plugins that already own meaningful data. A consumer
plugin passes graph nodes, edges, profiles, and view state to graph-engine; the engine
returns a presentable interactive graph surface inside an HTML element owned by that
plugin. The consumer keeps ownership of its data, domain meaning, and persistence.

Graph-engine owns generic graph layout, rendering, camera movement, hit testing,
gestures, filters, modules, and presentation state. This lets another plugin add a
graph without importing Graph+’s Obsidian-vault interpretation.

See [the graph-engine consumer guide](docs/graph-engine-consumer-guide.md) and the
[neutral consumer example](examples/neutral-consumer.ts) for the public boundary.

## Compatibility

Graph+ 2.0.0 has been tested on Obsidian 1.13.7. Desktop and mobile behavior should be
validated against your own vault and device before relying on it for daily work.

## Installation

Graph+ is available through the Obsidian community plugins browser. For manual
installation, place `main.js`, `manifest.json`, and `styles.css` in:

`.obsidian/plugins/graph-engine/`

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

Graph+ is available under the Mozilla Public License 2.0. See [LICENSE](LICENSE).
