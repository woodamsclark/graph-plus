export type AnimaState = {
  level: number;
  capacity: number;
  capacity_modifier: number;
  pressure: number;
  effective_pressure: number;
  focus_link_compression: number;
  container_1_level: number;
  container_2_level: number;
  container_3_level: number;
  container_1_capacity: number;
  container_2_capacity: number;
  container_3_capacity: number;
  active: boolean;
  surplus_ratio: number;
};

export type AnimaFlow = {
  fromNodeId: string;
  toNodeId: string;
  amount: number;
  strength: number;
};

// Experimental Anima constants (tunable without UI for now)
const INITIAL_CAPACITY = 100;
const INITIAL_LEVEL = 0;
const INITIAL_CAPACITY_MODIFIER = 0;
const INITIAL_PRESSURE = 0.75;
const INITIAL_EFFECTIVE_PRESSURE = 0;
const INITIAL_FOCUS_LINK_COMPRESSION = 0;
const INITIAL_CONTAINER_1_CAPACITY = INITIAL_CAPACITY;
const INITIAL_CONTAINER_2_CAPACITY = INITIAL_CAPACITY * 2;
const INITIAL_CONTAINER_3_CAPACITY = INITIAL_CAPACITY * 4;
const INITIAL_CONTAINER_LEVEL = 0;
const INITIAL_ACTIVE = false;
const INITIAL_SURPLUS_RATIO = 0;

export class AnimaStateStore {
  private state = new Map<string, AnimaState>();
  private currentFlows = new Map<string, AnimaFlow>();

  get(nodeId: string): AnimaState | null {
    return this.state.get(nodeId) ?? null;
  }

  ensured_get(nodeId: string ): AnimaState {
    let current = this.state.get(nodeId);
    if (!current) {
      current = {
        level: INITIAL_LEVEL,
        capacity: INITIAL_CAPACITY,
        capacity_modifier: INITIAL_CAPACITY_MODIFIER,
        pressure: INITIAL_PRESSURE,
        effective_pressure: INITIAL_EFFECTIVE_PRESSURE,
        focus_link_compression: INITIAL_FOCUS_LINK_COMPRESSION,
        container_1_level: INITIAL_CONTAINER_LEVEL,
        container_2_level: INITIAL_CONTAINER_LEVEL,
        container_3_level: INITIAL_CONTAINER_LEVEL,
        container_1_capacity: INITIAL_CONTAINER_1_CAPACITY,
        container_2_capacity: INITIAL_CONTAINER_2_CAPACITY,
        container_3_capacity: INITIAL_CONTAINER_3_CAPACITY,
        active: INITIAL_ACTIVE,
        surplus_ratio: INITIAL_SURPLUS_RATIO,
      };
      this.state.set(nodeId, current);
    }
    return current;
  }

  add(nodeId: string, amount: number): void {
    const current = this.ensured_get(nodeId);
    const maxLevel =
      current.container_1_capacity +
      current.container_2_capacity +
      current.container_3_capacity;
    current.level = Math.max(0, Math.min(maxLevel, current.level + amount));
  }

  beginFlowFrame(): void {
    this.currentFlows.clear();
  }

  recordFlow(flow: AnimaFlow): void {
    const key = `${flow.fromNodeId}\u0000${flow.toNodeId}`;
    const current = this.currentFlows.get(key);

    if (current) {
      current.amount += flow.amount;
      current.strength = Math.max(current.strength, flow.strength);
      return;
    }

    this.currentFlows.set(key, { ...flow });
  }

  getCurrentFlows(): readonly AnimaFlow[] {
    return Array.from(this.currentFlows.values());
  }

  clearMissing(validNodeIds: Set<string>): void {
    for (const id of this.state.keys()) {
      if (!validNodeIds.has(id)) this.state.delete(id);
    }
  }
}
