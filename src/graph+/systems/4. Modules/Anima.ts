import type { AnimaSettings, GraphModule, Module, SettingsAwareSystem, Tickable } from "../../grammar/interfaces.ts";
import type { Command, CommandObserver } from "../3. Module Commander/Commander.ts";
import { AnimaStateStore } from "./AnimaStateStore.ts";

export class Anima implements Module, Tickable, CommandObserver, SettingsAwareSystem<AnimaSettings> {

  constructor
  (
//    private settings: AnimaSettings,
    private deps: 
    { 
      getGraph: () => GraphModule; 
      getAnimaStore: () => AnimaStateStore 
    }
  )
  {
 //   this.settings = settings;
  }

  initialize(): void {
    // No startup work yet.
  }

  updateSettings(settings: AnimaSettings): void {
//    this.settings = settings;
  }

  dispose(): void {
    // Store is owned externally; nothing to dispose here yet.
  }

  tick(dt: number, _nowMs: number): void {
    const graph = this.deps.getGraph().get();
    if (!graph) return;

    const store = this.deps.getAnimaStore();
    const validNodeIds = new Set(graph.nodes.map((n) => n.id));
    store.clearMissing(validNodeIds);

    for (const node of graph.nodes) {
      const anima = store.ensure(node.id, { level: 0, capacity: 100 });
      anima.level = Math.max(0, anima.level - 10 * dt);
    }
  }

  afterCommandApplied(command: Command): void {
    const store = this.deps.getAnimaStore();

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