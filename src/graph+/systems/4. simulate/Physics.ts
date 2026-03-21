import { createSimulation } from "./simulation.ts";
import type { GraphData, Simulation, TranslationState, PhysicsSystem } from "../../grammar/interfaces.ts";
import type { Camera } from "../5. render/Camera.ts";

export class Physics implements PhysicsSystem{
  private sim: Simulation | null = null;
  private dragNodeId: string | null = null;
  private dragTarget: { x: number; y: number; z: number } | null = null;

  constructor(private deps: {
    getGraph:       () => GraphData         | null;
    getCamera:      () => Camera  | null;
    getInteraction: () => TranslationState;
  }) {}

  // Call whenever the graph changes (rebuild/filter/etc.)
  public rebuild(): void {
    this.stop();
    const graph  = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) {
      this.sim = null;
      return;
    }

    // Simulation wants a gravity center provider; we now read it from InteractionState
    this.sim = createSimulation(
      graph, 
      camera, 
      () => this.deps.getInteraction().gravityCenter,
      (nodeId) => nodeId === this.deps.getInteraction().followedNodeId
    );
    this.sim?.start();
  }

 public tick(dt: number): void {
  const graph = this.deps.getGraph();

  if (graph && this.dragNodeId && this.dragTarget) {
    const node = graph.nodes.find(n => n.id === this.dragNodeId);
    if (node) {
      node.location.x = this.dragTarget.x;
      node.location.y = this.dragTarget.y;
      node.location.z = this.dragTarget.z;
      node.velocity.vx = 0;
      node.velocity.vy = 0;
      node.velocity.vz = 0;
    }
  }

  this.sim?.tick(dt);
}

  public stop(): void {
    if (this.sim) this.sim.stop();
  }
  public start(): void {
    this.sim?.start();
  }

  public destroy(): void {
    this.stop();
    this.sim = null;
  }

  public setPinnedNodes(ids: Set<string>) {
    this.sim?.setPinnedNodes?.(ids);
    }

  beginDrag(nodeId: string): void {
  this.dragNodeId = nodeId;
  }

  setDragTarget(nodeId: string, target: { x: number; y: number; z: number }): void {
    if (this.dragNodeId !== nodeId) return;
    this.dragTarget = target;
  }

  endDrag(nodeId: string): void {
    if (this.dragNodeId !== nodeId) return;
    this.dragNodeId = null;
    this.dragTarget = null;
  }

}
