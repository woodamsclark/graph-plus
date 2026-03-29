import type { GraphAccessor }   from "../types/domain/graph.ts";
import type { AnimaStateStore } from "../systems/4. Modules/AnimaStateStore.ts";

export type AnimaDeps = {
  graph:      GraphAccessor | null;
  animaStore: AnimaStateStore;
};