import type { Plugin, WorkspaceLeaf } from 'obsidian';
import { GraphPlusObsidianViewV1 } from './GraphPlusObsidianView.ts';

export const LOCAL_GRAPH_PLUS_TYPE = 'graph-plus-local';

/** Legacy view identity for the Local presentation of the shared Graph+ application. */
export class LocalGraphPlusView extends GraphPlusObsidianViewV1 {
  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf, plugin, 'local');
  }

  getViewType(): string { return LOCAL_GRAPH_PLUS_TYPE; }
  getDisplayText(): string { return 'local graph+'; }
  getIcon(): string { return 'network'; }
}
