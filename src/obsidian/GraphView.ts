import type { Plugin, WorkspaceLeaf } from 'obsidian';
import { GraphPlusObsidianViewV1 } from './GraphPlusObsidianView.ts';

export const GRAPH_PLUS_TYPE = 'graph-plus';

/** Legacy view identity for the Global presentation of the shared Graph+ application. */
export class GraphPlusView extends GraphPlusObsidianViewV1 {
  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf, plugin, 'global');
  }

  getViewType(): string { return GRAPH_PLUS_TYPE; }
  getDisplayText(): string { return 'graph+'; }
  getIcon(): string { return 'dot-network'; }
}
