export type AnimaState = {
  level:    number;
  capacity: number;
  capacity_modifier: number; 
  pressure: number;
  effective_pressure: number;
  focus_link_compression: number;
};

// Experimental Anima constants (tunable without UI for now)
const INITIAL_CAPACITY            = 100;
const INITIAL_LEVEL               = 100;
const INITIAL_CAPACITY_MODIFIER   = 0;
const INITIAL_PRESSURE            = 1;
const INITIAL_EFFECTIVE_PRESSURE  = 1;
const INITIAL_FOCUS_LINK_COMPRESSION = 0;

export class AnimaStateStore {
  private state = new Map<string, AnimaState>();

  get(nodeId: string): AnimaState | null {
    return this.state.get(nodeId) ?? null;
  }

  ensured_get(nodeId: string ): AnimaState {
    let current = this.state.get(nodeId);
    if (!current) {
      current = {
        level:              INITIAL_LEVEL,
        capacity:           INITIAL_CAPACITY,
        capacity_modifier:  INITIAL_CAPACITY_MODIFIER,
        pressure:           INITIAL_PRESSURE,
        effective_pressure: INITIAL_EFFECTIVE_PRESSURE,
        focus_link_compression: INITIAL_FOCUS_LINK_COMPRESSION,
      };
      this.state.set(nodeId, current);
    }
    return current;
  }

  add(nodeId: string, amount: number): void {
    const current = this.ensured_get(nodeId);
    current.level = Math.max(0, Math.min(current.capacity, current.level + amount));
  }

  clearMissing(validNodeIds: Set<string>): void {
    for (const id of this.state.keys()) {
      if (!validNodeIds.has(id)) this.state.delete(id);
    }
  }
}
