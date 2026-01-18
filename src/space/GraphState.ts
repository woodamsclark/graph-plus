import type { GraphData } from "../shared/interfaces.ts";

export class GraphState {
  private graph: GraphData | null = null;
  get(): GraphData | null { return this.graph; }
  set(graph: GraphData | null) { this.graph = graph; }
}
