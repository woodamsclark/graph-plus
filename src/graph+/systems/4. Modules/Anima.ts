import type { Command, CommandObserver } from "../../types/domain/commands.ts";
import type { GraphData } from "../../types/domain/graph.ts";
import type { ModuleWithSettings, SettingsFor } from "../../types/index.ts";
import type { AnimaDeps } from "../../deps/anima.deps.ts";



// Pressure-field model:
// - pressure = level / effectiveCapacity
// - Node radius defines baseline capacity
// - Commands change capacity_modifier, creating temporary wells
// - Anima flows from high pressure toward low pressure, conserving total anima

const FLOW_RATE = 8; // units per second maximum transfer per link
const PRESSURE_RESPONSE = 0.5;
const FOCUS_CAPACITY_MULTIPLIER = 1;
const MIN_EFFECTIVE_CAPACITY = 1;

export class Anima implements ModuleWithSettings<'anima'>, CommandObserver {
  private syncedGraph: GraphData | null = null;
  // The current focused/selected/opened/followed node acts as a temporary "sink".
  private focusedNodeId: string | null = null;

  constructor(
    private settings: SettingsFor<'anima'>,
    private deps: AnimaDeps,
  ) {}


  initialize(): void {
    // No startup work yet.
  }

  updateSettings(settings: SettingsFor<'anima'>): void {
    // Settings currently unused for the pressure-field prototype; keep signature for compatibility.
    this.settings = settings;
  }

  destroy(): void {
    // Store is owned externally; nothing to dispose here yet.
    this.syncedGraph = null;
    this.focusedNodeId = null;
  }

  tick(dt: number): void {
    const graph = this.deps.graph?.get();
    if (!graph) {
      this.syncedGraph = null;
      return;
    }

    this.syncStoreToGraph(graph);
    this.recomputePressureField(graph);

    this.equalizeAcrossLinks(graph, dt);
  }

  afterCommandApplied(command: Command): void {
    // Track focus sources: click/selection (SetFollowedNode) and open events.
    switch (command.type) {
      case "SetFocusedNode": // set to null if focused mode is exited
        // Null clears focus; non-null sets the current sink.
        this.setFocusedNode(command.nodeId);
        return;

      default:
        return;
    }
  }

  // --- Implementation helpers ---

  private setFocusedNode(nodeId: string | null): void {
    this.focusedNodeId = nodeId ?? null;
  }

  private syncStoreToGraph(graph: GraphData): void {
    if (graph === this.syncedGraph) return;

    const store         = this.deps.animaStore;
    const validNodeIds  = new Set(graph.nodes.map((node) => node.id));

    store.clearMissing(validNodeIds);
    if (this.focusedNodeId && !validNodeIds.has(this.focusedNodeId)) {
      this.focusedNodeId = null;
    }

    for (const node of graph.nodes) {
      const existing = store.get(node.id);
      if (existing) continue;

      const state = store.ensured_get(node.id);
      const baseCapacity = this.computeBaseCapacity(node.radius);
      state.capacity = baseCapacity;
      state.level = baseCapacity;
      state.capacity_modifier = 0;
    }

    this.syncedGraph = graph;
  }

  private recomputePressureField(graph: GraphData): void {
    const store = this.deps.animaStore;

    for (const node of graph.nodes) {
      const state = store.get(node.id);
      if (!state) continue;

      state.capacity_modifier = 0;
      state.capacity = this.computeBaseCapacity(node.radius);
    }

    if (this.focusedNodeId) {
      const focused = store.get(this.focusedNodeId);
      if (focused) {
        focused.capacity_modifier += focused.capacity * FOCUS_CAPACITY_MULTIPLIER;
      }
    }
  }

  private computeBaseCapacity(nodeRadius: number): number {
    return Math.max(MIN_EFFECTIVE_CAPACITY, nodeRadius*3);
  }

  private getEffectiveCapacity(animaState: { capacity: number; capacity_modifier: number }): number {
    return Math.max(MIN_EFFECTIVE_CAPACITY, animaState.capacity + animaState.capacity_modifier);
  }

  private getPressure(animaState: { level: number; capacity: number; capacity_modifier: number }): number {
    return Math.max(0, animaState.level) / this.getEffectiveCapacity(animaState);
  }

  // Move anima along links from higher pressure -> lower pressure.
  private equalizeAcrossLinks(graph: GraphData, dt: number): void {
    const store = this.deps.animaStore;

    const maxPerLink = Math.max(0, FLOW_RATE) * Math.max(0, dt);

    for (const link of graph.links) {
      const source = store.get(link.sourceId);
      const target = store.get(link.targetId);
      if (!source || !target) continue;

      const sourcePressure = this.getPressure(source);
      const targetPressure = this.getPressure(target);
      if (sourcePressure === targetPressure) continue;

      const flowFromSource  = sourcePressure > targetPressure;
      const from            = flowFromSource ? source : target;
      const to              = flowFromSource ? target : source;
      const pressureDelta   = Math.abs(sourcePressure - targetPressure);
      const demand          = pressureDelta * PRESSURE_RESPONSE * maxPerLink;
      const room            = Math.max(0, this.getEffectiveCapacity(to) - to.level);
      const supply          = Math.max(0, from.level);
      const amount          = Math.max(0, Math.min(demand, maxPerLink, room, supply));

      if (amount <= 0) continue;

      from.level -= amount;
      to.level += amount;
    }
  }
}
