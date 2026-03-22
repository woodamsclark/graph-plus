import type { GraphData, Tickable } from "../../grammar/interfaces.ts";

export class Anima implements Tickable {
  constructor(private deps: {
    getGraph: () => GraphData | null;
  }) {}

  public tick(dt: number, _nowMs: number): void {
  
  }

  add(nodeId: string | null, amount: number): void {
  const graph = this.deps.getGraph();
  if (!graph || !nodeId) return;
  const nodes = graph?.nodes.filter(n => n.id === nodeId);
  if (!nodes) return;

  for (const node of nodes) {
    node.anima.level = Math.min(node.anima.capacity, node.anima.level + amount);
  }
}
}