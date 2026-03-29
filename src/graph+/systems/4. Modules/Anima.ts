import type { Command, CommandObserver } from "../../types/domain/commands.ts";
import type {
  ModuleWithSettings,
  SettingsFor,
} from "../../types/index.ts";
import type { AnimaDeps } from "../../deps/anima.deps.ts";

export class Anima implements ModuleWithSettings<'anima'>, CommandObserver {

  constructor(
    private settings: SettingsFor<'anima'>,
    private deps: AnimaDeps,
  ) {}


  initialize(): void {
    // No startup work yet.
  }

  updateSettings(settings: SettingsFor<'anima'>): void {
//    this.settings = settings;
  }

  destroy(): void {
    // Store is owned externally; nothing to dispose here yet.
  }

  tick(dt: number): void {
    const graphModule = this.deps.getGraph();
    const graph = graphModule;
    if (!graph) return;

    const store = this.deps.getAnimaStore();
    const validNodeIds = new Set(graph.nodes.map((n) => n.id));
    store.clearMissing(validNodeIds);

    for (const node of graph.nodes) {
      const anima = store.ensure(node.id, { level: 0, capacity: 100 });
      anima.level = Math.max(0, anima.level - this.settings.drainPerSecond * dt);
    }
  }

  afterCommandApplied(command: Command): void {
    const store = this.deps.getAnimaStore();

    switch (command.type) {
      case "OpenNode":
        store.add(command.nodeId, this.settings.openNodeGain);
        break;

      case "SetFollowedNode":
        if (command.nodeId) store.add(command.nodeId, this.settings.followNodeGain);
        break;

      case "PinNode":
        store.add(command.nodeId, this.settings.pinNodeGain);
        break;

      case "BeginDrag":
        store.add(command.nodeId, this.settings.dragNodeGain);
        break;

      default:
        break;
    }
  }
}