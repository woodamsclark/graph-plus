import { createSimulation } from "./simulation.ts";
import type { GraphData, Simulation } from "../../the garden/adam/interfaces.ts";
import type { CameraController } from "../render/CameraController.ts";
import type { InteractionState } from "../../the garden/adam/InteractionState.ts";

export class Physics {
  private sim: Simulation | null = null;

  constructor(private deps: {
    getGraph: () => GraphData | null;
    getCamera: () => CameraController | null;
    getInteraction: () => InteractionState;
  }) {}

  /** Call whenever the graph changes (rebuild/filter/etc.) */
  public rebuild(): void {
    this.stop();
    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera) {
      this.sim = null;
      return;
    }

    // Simulation wants a gravity center provider; we now read it from InteractionState
    this.sim = createSimulation(graph, camera, () => this.deps.getInteraction().gravityCenter);
    this.sim?.start();
  }

  public tick(dt: number): void {
    this.sim?.tick(dt);
  }

  public stop(): void {
    if (this.sim) this.sim.stop();
  }

  public destroy(): void {
    this.stop();
    this.sim = null;
  }

  public setPinnedNodes(ids: Set<string>) {
    this.sim?.setPinnedNodes?.(ids);
    }
}
