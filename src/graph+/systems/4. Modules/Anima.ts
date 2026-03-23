import type { Tickable } from "../../grammar/interfaces.ts";
import type { Command, CommandObserver } from "../3. Module Commander/Commander.ts";
import { AnimaStateStore } from "./AnimaStateStore.ts";
import type { GraphData } from "../../grammar/interfaces.ts";

export class Anima implements Tickable, CommandObserver {
  constructor(private deps: {
    getGraph: () => GraphData | null;
    getStore: () => AnimaStateStore;
  }) {}

  tick(dt: number, _nowMs: number): void {
    const graph = this.deps.getGraph();
    if (!graph) return;

    const store = this.deps.getStore();
    const validNodeIds = new Set(graph.nodes.map((n) => n.id));
    store.clearMissing(validNodeIds);

    for (const node of graph.nodes) {
      const anima = store.ensure(node.id, { level: 0, capacity: 100 });
      anima.level = Math.max(0, anima.level - 10 * dt);
    }
  }

  afterCommandApplied(command: Command): void {
    const store = this.deps.getStore();

    switch (command.type) {
      case "OpenNode":
        store.add(command.nodeId, 20);
        break;

      case "SetFollowedNode":
        if (command.nodeId) store.add(command.nodeId, 10);
        break;

      case "PinNode":
        store.add(command.nodeId, 8);
        break;

      case "BeginDrag":
        store.add(command.nodeId, 6);
        break;

      default:
        break;
    }
  }
}