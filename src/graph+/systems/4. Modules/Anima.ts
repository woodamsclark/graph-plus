import type { Command, CommandObserver } from "../../types/domain/commands.ts";
import type { GraphData } from "../../types/domain/graph.ts";
import type { ModuleWithSettings, SettingsFor } from "../../types/index.ts";
import type { AnimaDeps } from "../../deps/anima.deps.ts";
import type { AnimaState } from "./AnimaStateStore.ts";

const CONTAINER_2_MULTIPLIER = 2;
const CONTAINER_3_MULTIPLIER = 4;
const DISPLAY_BASELINE_PRESSURE = 0.75;
const MIN_CONTAINER_1_CAPACITY = 1;
const MAX_FOCUSED_LINK_COMPRESSION = 1;

export class Anima implements ModuleWithSettings<'anima'>, CommandObserver {
  private syncedGraph: GraphData | null = null;
  private focusedNodeId: string | null = null;

  constructor(
    private settings: SettingsFor<'anima'>,
    private deps: AnimaDeps,
  ) {}


  initialize(): void {
    // No startup work yet.
  }

  updateSettings(settings: SettingsFor<'anima'>): void {
    this.settings = settings;
  }

  destroy(): void {
    // Store is owned externally; nothing to dispose here yet.
    this.syncedGraph = null;
    this.focusedNodeId = null;
  }

  tick(dt: number): void {
    this.deps.animaStore.beginFlowFrame();

    const graph = this.deps.graph?.get();
    if (!graph) {
      this.syncedGraph = null;
      return;
    }

    this.syncStoreToGraph(graph);
    this.feedFocusedNode(dt);
    this.emitFromFocusedNode(graph, dt);
    this.burnFocusedNode(dt);
    this.updateDerivedState(graph);
  }

  afterCommandApplied(command: Command): void {
    switch (command.type) {
      case "SetFocusedNode":
        this.setFocusedNode(command.nodeId);
        if (command.nodeId) {
          this.injectFocusBurst(command.nodeId);
        }
        return;

      case "ResetCamera":
        this.setFocusedNode(null);
        return;

      default:
        return;
    }
  }

  // --- Implementation helpers ---

  private setFocusedNode(nodeId: string | null): void {
    this.focusedNodeId = nodeId ?? null;
  }

  private injectFocusBurst(nodeId: string): void {
    const graph = this.deps.graph?.get();
    if (graph) this.syncStoreToGraph(graph);

    const state = this.deps.animaStore.ensured_get(nodeId);
    state.level = Math.min(
      this.getMaxLevel(state),
      state.level + this.settings.focusBurst,
    );
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
      state.level = 0;
      state.capacity_modifier = 0;
      state.pressure = DISPLAY_BASELINE_PRESSURE;
      state.effective_pressure = 0;
      state.container_1_capacity = baseCapacity;
      state.container_2_capacity = baseCapacity * CONTAINER_2_MULTIPLIER;
      state.container_3_capacity = baseCapacity * CONTAINER_3_MULTIPLIER;
      state.container_1_level = 0;
      state.container_2_level = 0;
      state.container_3_level = 0;
      state.active = false;
      state.surplus_ratio = 0;
    }

    this.syncedGraph = graph;
  }

  private feedFocusedNode(dt: number): void {
    if (!this.focusedNodeId) return;

    const focused = this.deps.animaStore.get(this.focusedNodeId);
    if (!focused) return;

    focused.level = Math.min(
      this.getMaxLevel(focused),
      focused.level + Math.max(0, this.settings.focusFeedPerSecond) * Math.max(0, dt),
    );
  }

  private burnFocusedNode(dt: number): void {
    if (!this.focusedNodeId) return;

    const focused = this.deps.animaStore.get(this.focusedNodeId);
    if (!focused) return;

    focused.level = Math.max(
      0,
      focused.level - Math.max(0, this.settings.focusBurnPerSecond) * Math.max(0, dt),
    );
  }

  private computeBaseCapacity(nodeRadius: number): number {
    return Math.max(MIN_CONTAINER_1_CAPACITY, nodeRadius * 2);
  }

  private updateDerivedState(graph: GraphData): void {
    const store = this.deps.animaStore;

    for (const node of graph.nodes) {
      const state = store.get(node.id);
      if (!state) continue;

      state.capacity = this.computeBaseCapacity(node.radius);
      state.capacity_modifier = 0;
      state.container_1_capacity = state.capacity;
      state.container_2_capacity = state.capacity * CONTAINER_2_MULTIPLIER;
      state.container_3_capacity = state.capacity * CONTAINER_3_MULTIPLIER;
      state.level = Math.max(0, Math.min(this.getMaxLevel(state), state.level));

      const container1 = Math.min(state.level, state.container_1_capacity);
      const container2 = Math.min(
        Math.max(0, state.level - state.container_1_capacity),
        state.container_2_capacity,
      );
      const container3 = Math.min(
        Math.max(0, state.level - state.container_1_capacity - state.container_2_capacity),
        state.container_3_capacity,
      );

      state.container_1_level = container1;
      state.container_2_level = container2;
      state.container_3_level = container3;
      state.active = this.isNodeActive(state);
      state.surplus_ratio = this.getSurplusRatio(state);
      state.pressure = Math.min(
        2,
        DISPLAY_BASELINE_PRESSURE +
          this.getContainer1FillRatio(state) * (1 - DISPLAY_BASELINE_PRESSURE) +
          state.surplus_ratio,
      );
      state.effective_pressure = this.getTotalFillRatio(state);
      state.focus_link_compression =
        this.focusedNodeId === node.id && state.active
          ? Math.min(MAX_FOCUSED_LINK_COMPRESSION, state.surplus_ratio)
          : 0;
    }
  }

  private getUndirectedNeighborIds(graph: GraphData, nodeId: string): Set<string> {
    return new Set<string>([
      ...Object.keys(graph.linksIn[nodeId] || {}),
      ...Object.keys(graph.linksOut[nodeId] || {}),
    ]);
  }

  private emitFromFocusedNode(graph: GraphData, dt: number): void {
    if (!this.focusedNodeId) return;

    const store = this.deps.animaStore;
    const focused = store.get(this.focusedNodeId);
    if (!focused || !this.isNodeActive(focused)) return;

    const neighborIds = this.getUndirectedNeighborIds(graph, this.focusedNodeId);
    if (neighborIds.size === 0) return;

    const perLinkBudget = Math.max(0, this.settings.emissionPerLinkPerSecond) * Math.max(0, dt);
    if (perLinkBudget <= 0) return;

    for (const neighborId of neighborIds) {
      const target = store.get(neighborId);
      if (!target) continue;

      const availableSurplus = this.getSurplusLevel(focused);
      if (availableSurplus <= 0) break;

      const targetFreeSpace = this.getMaxLevel(target) - target.level;
      if (targetFreeSpace <= 0) continue;

      const drive = Math.max(0, 1 - this.getTotalFillRatio(target));
      if (drive <= 0) continue;

      const amount = Math.min(
        availableSurplus,
        targetFreeSpace,
        perLinkBudget * drive,
      );

      if (amount <= 0) continue;

      focused.level -= amount;
      target.level += amount;
      store.recordFlow({
        fromNodeId: this.focusedNodeId,
        toNodeId: neighborId,
        amount,
        strength: Math.min(1, amount / perLinkBudget),
      });
    }
  }

  private getMaxLevel(animaState: Pick<AnimaState, "capacity">): number {
    return animaState.capacity * (1 + CONTAINER_2_MULTIPLIER + CONTAINER_3_MULTIPLIER);
  }

  private getContainer1FillRatio(animaState: Pick<AnimaState, "level" | "capacity">): number {
    return Math.max(0, Math.min(1, animaState.level / Math.max(MIN_CONTAINER_1_CAPACITY, animaState.capacity)));
  }

  private getTotalFillRatio(animaState: Pick<AnimaState, "level" | "capacity">): number {
    return Math.max(0, Math.min(1, animaState.level / Math.max(MIN_CONTAINER_1_CAPACITY, this.getMaxLevel(animaState))));
  }

  private getSurplusLevel(animaState: Pick<AnimaState, "level" | "capacity">): number {
    return Math.max(0, animaState.level - animaState.capacity);
  }

  private getSurplusRatio(animaState: Pick<AnimaState, "level" | "capacity">): number {
    const surplusCapacity = animaState.capacity * (CONTAINER_2_MULTIPLIER + CONTAINER_3_MULTIPLIER);
    return Math.max(0, Math.min(1, this.getSurplusLevel(animaState) / Math.max(MIN_CONTAINER_1_CAPACITY, surplusCapacity)));
  }

  private isNodeActive(animaState: Pick<AnimaState, "level" | "capacity">): boolean {
    return animaState.level + 1e-6 >= animaState.capacity;
  }
}
