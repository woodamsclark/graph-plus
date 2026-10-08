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
- Use filters, regions, and layout controls to look at the same vault from
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
- **Local graph** shows the same vault graph in a compact pane, starts in Focus on the
  active note, and follows subsequent active-note changes.

The global graph is the place for broad discovery and spatial organization. The local
graph is the place for following one idea, note, or thread through that same world.
They are two presentation modes of the same Graph+ application. Node coordinates and
pins are shared; each pane keeps its own camera, filters, View, selection, and Focus.
Global starts in Overview, while Local starts in Focus and follows the active note.

### Explore and navigate

Choose a constellation in Overview, then click one of its members to enter Focus.
Add visible candidates to build the constellation; click the background to move back
one View. Drag nodes to arrange the shared space; Graph+ persists node placement and
pins for the vault. Camera framing, filters, Focus, and selection belong to the
individual pane.

On desktop, use pointer, wheel, keyboard, and modifier interactions. On touch devices,
use one- and two-finger gestures for graph movement and navigation. The exact gesture
behavior follows the active graph dimension and focus state.

### Refine what you see

Use the graph controls to:

- Search for nodes with `Filter nodes…`.
- Include or hide tag nodes and orphan notes.
- Reset the current filters.
<!-- Mind Map deferred; retain these instructions for its return.
- Switch between ordinary graph exploration and Form mode.
- Choose a relation and depth when using Form mode.
-->
- Change display, force-layout, region, and dimension settings.

These are reversible views of your vault. They do not rewrite Markdown files, rename
notes, or change the canonical links between them.

### Change dimensions and recover a layout

Graph+ opens in 2D by default. Use the dimension control to switch to 3D. The graph
engine preserves the graph document while changing the presentation and camera.

If you want to regenerate placement and camera state for the vault, use **Settings →
Community plugins → Graph+ → Reset graph layout data**. This does not change notes,
links, filters, Form state, colors, labels, or settings.

For this release, keep exactly one **Global graph+** pane open before resetting.
Close any additional Global panes; opening only a Local pane does not enable reset.

### Customize graph colors

Use **Settings → Community plugins → Graph+ → Graph+ colors** to override the graph
background, ordinary note nodes, or tag nodes. Each color can be reset independently
to return that role to the active Obsidian theme. Changes apply to open Graph+ views.

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
| Velocity decay | 0.4 |
| Collision spacing | 60 |
| 3D axial spring | Off |
| Quick settings | Collapsed |
| Graph colors | Inherited from the active Obsidian theme |

## For plugin developers

Graph+ contains `graph-engine`, its host-neutral internal graph platform.

The core engine is designed for plugins that already own meaningful data. A consumer
plugin passes graph nodes, edges, profiles, and view state to the internal engine; the engine
returns a presentable interactive graph surface inside an HTML element owned by that
plugin. The consumer keeps ownership of its data, domain meaning, and persistence.

The internal Graph Engine owns generic graph layout, rendering, camera movement, hit testing,
gestures, filters, modules, and presentation state. This lets another plugin add a
graph without importing Graph+’s Obsidian-vault interpretation.

See [the graph-engine consumer guide](docs/graph-engine-consumer-guide.md) and the
[neutral consumer example](examples/neutral-consumer.ts) for the public boundary.

## Compatibility

Graph+ 2.0.0-rc.1 requires Obsidian 1.13.7 or newer. Automated checks cover desktop
and touch input paths; physical desktop and mobile acceptance is tracked in the
[release safety checklist](docs/graph-plus-release-safety.md).

## Installation

This release candidate uses manual installation. Extract its release ZIP and place
`main.js`, `manifest.json`, and `styles.css` in your vault's:

`.obsidian/plugins/graph-plus/`

Restart Obsidian or reload the plugin, then enable **Graph+** under **Settings →
Community plugins**. Community plugin browser availability is not assumed for this RC.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Use `npm run release` to create a validated RC package containing only the three
plugin assets. `npm run release:public` requires a stable release version. See
[release safety and recovery](docs/graph-plus-release-safety.md) for the packaging,
shutdown, and checkpoint recovery contracts.

## License

Graph+ is available under the Mozilla Public License 2.0. See [LICENSE](LICENSE).
