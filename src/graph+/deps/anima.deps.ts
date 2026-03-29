import type { GraphData }       from "../types/domain/graph.ts";
import type { AnimaStateStore } from "../systems/4. Modules/AnimaStateStore.ts";

export type AnimaDeps = {
  getGraph:       () => GraphData | null;
  getAnimaStore:  () => AnimaStateStore;
};