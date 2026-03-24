import { createSimulation } from "./simulation.ts";
import type { Module, Simulation, UIState, PhysicsSystem, PhysicsSettings, GraphModule } from "../../grammar/interfaces.ts";
import { Graph } from "./Graph.ts";
import type { CameraController } from "../5. Render/CameraController.ts";

export class Physics implements Module, PhysicsSystem {
  private sim: Simulation | null = null;
  private pinnedNodeIds: Set<string> = new Set();

  constructor(private deps: {
    getGraph:             () => GraphModule;
    getCamera:            () => CameraController            | null;
    getInteractionState:  () => UIState;
    getPhysicsSettings: () => PhysicsSettings;
  }) {}

  initialize(): void {
    // Simulation is built lazily through rebuild().
  }

  dispose(): void {
    this.destroy();
  }

  // Call whenever the graph changes (rebuild/filter/etc.)
  public rebuild(): void {
    this.stop();
    const graphModule = this.deps.getGraph();
    const graph = graphModule.get();
    const camera = this.deps.getCamera();
    if (!graph || !camera) {
      this.sim = null;
      return;
    }

    // Simulation wants a gravity center provider; we now read it from InteractionState
    this.sim = createSimulation(
      graph, 
      camera, 
      () => this.deps.getInteractionState().gravityCenter,
      (nodeId) => nodeId === this.deps.getInteractionState().followedNodeId
    );
    this.sim?.setPinnedNodes?.(new Set(this.pinnedNodeIds));
    this.sim?.start();
  }

  public tick(dt: number): void {
  this.sim?.tick(dt, this.deps.getPhysicsSettings());
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

  public pinNode(nodeId: string): void {
    this.pinnedNodeIds.add(nodeId);
    this.sim?.setPinnedNodes?.(new Set(this.pinnedNodeIds));
  }

  public unpinNode(nodeId: string): void {
    this.pinnedNodeIds.delete(nodeId);
    this.sim?.setPinnedNodes?.(new Set(this.pinnedNodeIds));
  }

  public getPinnedNodeIds(): ReadonlySet<string> {
    return this.pinnedNodeIds;
  }

  beginDrag(nodeId: string, target: { x: number; y: number; z: number }): void {
    this.sim?.beginDrag?.(nodeId, target);
  }

  updateDragTarget(targetWorld: { x: number; y: number; z: number }): void {
    this.sim?.updateDragTarget?.(targetWorld);
  }

  endDrag(): void {
    this.sim?.endDrag?.();
  }

}