# graph-engine V1.7.1 identity, global graph+, and local graph+ contract

Status: Implemented; automated suite passes, live Obsidian acceptance pending.

Date: 2026-09-06

## Purpose

V1.7.1 establishes the installed Obsidian plugin as **graph-engine** while retaining
**graph+** as its bundled first-party graph application. It separates full-vault and
active-note behavior into two explicit Obsidian views so moving a leaf never silently
changes the graph's data, physics, or camera semantics.

## Product identity and versions

- The Obsidian manifest ID is `graph-engine` and its display name is **graph-engine**.
- The root package is `graph-engine`.
- The installed plugin, root package, bundled graph+ consumer, and public client
  artifact use release version `1.7.1`.
- The public wire protocol remains version `1`.
- graph+ retains consumer ID `graph-plus` and full-vault view type `graph-plus`.
- local graph+ is a second view type, `graph-plus-local`, inside the same plugin and
  consumer namespace.
- User-facing commands are **open graph+**, **open local graph+**, and
  **show in graph+**.
- User-facing product names and command titles use lowercase **graph-engine** and
  **graph+** branding throughout Obsidian.
- Graph+ checkpoints, lens state, profile ownership, and stable node IDs remain in the
  `graph-plus` consumer namespace.

Changing the manifest ID makes Obsidian register the installation as graph-engine. It
does not rename graph+ data merely to make internal strings resemble the host ID.

## Global Graph+

Global Graph+ displays the saved full-vault projection and owns the durable Graph+
layout checkpoint. When a Markdown note becomes active, every visible Global Graph+
leaf selects and focuses the stable note node for that exact vault-relative path.

The follow action uses ordinary Graph Engine focus state, so Anima highlighting and
focus transfer share one authority. It temporarily reveals an active note excluded by
the saved Filter, but does not fit the camera to that one node, alter the Filter query,
enable Form, or mutate canonical graph data. Rapid note changes are coalesced so the
newest active file owns the final focus.

## Local Graph+

Local Graph+ is an explicit active-note graph intended for a sidebar or compact split.
It owns an independent, ephemeral Graph Engine session; it never loads from or writes
to the Global Graph+ layout checkpoint.

The local document contains the active Markdown note and eligible nodes reachable
within the selected undirected link depth. Depth defaults to `1`, is adjustable from
`1` through `8` in Quick Settings, and is saved as Local Graph+ view state. The saved
Graph+ Filter and tag/orphan preferences constrain eligible nodes, while the active
root is always retained. Changing depth does not rewrite the Filter or canonical graph.

Every active-root change creates a new local document identity. The root is ordered at
the generated origin, pinned there for the lifetime of that local document, selected,
and focused through ordinary Graph Engine state. The camera fits the newly derived
document rather than inheriting full-vault coordinates. While the new neighborhood's
physics settles, Local Graph+ periodically sizes the camera around the current node
positions while keeping the root at viewport center. Tracking stops after movement
stabilizes, after a bounded timeout, or immediately when the user manually changes the
viewport. This keeps layout, force settling, focus, Anima highlighting, and camera
framing aligned around the same root without changing shared link-force settings.

Global and Local Graph+ share the registered Graph+ profile and typed settings. They
remain separate sessions, so Local Graph+ navigation cannot move or overwrite Global
Graph+ positions or camera state. Their vault snapshot source and note-content cache
are shared and concurrent reads are coalesced, avoiding duplicate full-vault I/O when
both views are open.

## Host surface and translucency

Graph+ rendering clears its canvas transparently and its view containers do not paint
an opaque background. Obsidian therefore remains responsible for the visible main,
sidebar, mobile-drawer, and translucency materials. Graph Engine continues to resolve
the remaining theme roles at the mounted container for node, edge, label, and focus
styling.

## Lifecycle

Hidden Global and Local Graph+ leaves suspend animation, rendering, and physics work.
They remember only the newest active Markdown file and whether vault reconciliation is
pending. When shown again, they reconcile once and follow the newest file without
replaying intermediate activity.

Tags and non-Markdown active views do not become automatic roots. Note preview,
selection, focus, and node activation retain their existing Graph+ behavior in both
views.

## Acceptance

1. Obsidian lists the plugin as **graph-engine** under manifest ID `graph-engine`.
2. Manifest, root package, graph+ consumer, and client artifact report `1.7.1` while
   protocol version remains `1`.
3. **open graph+** opens or reveals a `graph-plus` full-vault view.
4. **open local graph+** opens or reveals a `graph-plus-local` view in the right sidebar.
5. A visible Global Graph+ follows active Markdown notes by focus without narrowing its
   saved projection or moving its camera to a single node.
6. Local Graph+ follows the same active note with a fresh rooted local document, root
   focus, root-centered layout, and neighbor-aware camera fit throughout initial settling.
7. Local depth `1` shows the root and direct eligible neighbors; larger values reveal
   successive connected layers up to `8` without changing the saved Filter.
8. Global checkpoint state and Local layout/camera state remain isolated.
9. Moving either view between a sidebar and main split does not change its identity or
   semantics.
10. Graph surfaces remain transparent so native Obsidian main/sidebar translucency is
    visible behind them.
11. Hidden leaves stay suspended, coalesce active-note changes, and show the newest note
    when revealed.
12. Tags and non-Markdown active views do not become follow roots.
13. Manual smoke verifies Global Graph+ in a main split and Local Graph+ in desktop and
    mobile sidebars, including root changes, depth changes, camera framing, and theme
    translucency.
14. **show in graph+** cancels or waits out automatic active-note following before it
    selects and focuses its explicit target; the camera follows that node as physics
    settles, and focused 3D navigation remains in orbit mode.
