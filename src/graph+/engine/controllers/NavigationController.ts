

import type { GraphModule } from "../../grammar/interfaces.ts";

import { ObsidianNavigator } from "../../../obsidian/ObsidianNavigator.ts";

export class NavigationController {
  constructor(private deps: {
    navigator: ObsidianNavigator;
    getGraph: () => GraphModule;
  }) {}

  openNode(nodeId: string): void {
    const graph = this.deps.getGraph().get();
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.type.toLowerCase() === "tag") {
      void this.deps.navigator.openTagSearch(node.id);
    } else {
      void this.deps.navigator.openNodeById(node.id);
    }
  }
}