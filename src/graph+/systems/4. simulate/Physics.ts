import { createSimulation } from "./simulation.ts";
import type { GraphData, Simulation, TranslationState, PhysicsSystem } from "../../grammar/interfaces.ts";
import type { Camera } from "../5. render/Camera.ts";

export class Physics implements PhysicsSystem{
  private sim: Simulation | null = null;

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
}
