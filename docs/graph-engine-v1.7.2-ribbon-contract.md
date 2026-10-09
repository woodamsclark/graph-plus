# graph-engine V1.7.2 ribbon contract

Status: Implemented; live Obsidian acceptance pending.

Date: 2026-09-06

## Behavior

Graph+ registers one native Obsidian ribbon action using the `network` icon
and lowercase tooltip **open graph+**. Activating it uses the same global graph+
activation path as the **open graph+** command: an existing global graph+ leaf is
revealed, or exactly one is created when none exists.

The action does not open local graph+, duplicate an existing global leaf, change graph
state, or bypass the graph+ enabled setting. If graph+ is disabled, it reports that
state instead of opening a view.

## Versioning

The Obsidian plugin, root package, and bundled graph+ consumer are version `1.7.2`.
At the V1.7.2 milestone, the public V1 client remained version `1.7.1` because this host-only addition changed no
public contract. Downstream consumers therefore require no update.

## Acceptance

1. Obsidian shows a graph ribbon icon with tooltip **open graph+**.
2. Activating it with no global graph+ leaf creates and reveals one global graph+ view.
3. Activating it with an existing global graph+ leaf reveals that leaf without creating
   another.
4. The existing command and file-menu navigation continue to use the same activation
   path.
5. When graph+ is disabled, the ribbon action opens no leaf and displays a concise
   notice.
