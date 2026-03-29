import type { KeyedStore } from "../../grammar/interfaces.ts";

export type AnimaState = {
  level: number;
  capacity: number;
};

export class AnimaStateStore implements KeyedStore<string, AnimaState> {
  private state = new Map<string, AnimaState>();

  get(nodeId: string): AnimaState | null {
    return this.state.get(nodeId) ?? null;
  }

  ensure(nodeId: string, initial?: Partial<AnimaState>): AnimaState {
    let current = this.state.get(nodeId);
    if (!current) {
      current = {
        level: initial?.level ?? 0,
        capacity: initial?.capacity ?? 100,
      };
      this.state.set(nodeId, current);
    }
    return current;
  }

  add(nodeId: string, amount: number): void {
    const current = this.ensure(nodeId);
    current.level = Math.max(0, Math.min(current.capacity, current.level + amount));
  }

  clearMissing(validNodeIds: Set<string>): void {
    for (const id of this.state.keys()) {
      if (!validNodeIds.has(id)) this.state.delete(id);
    }
  }
}