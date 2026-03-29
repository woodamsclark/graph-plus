import type { Simulation }        from '../../types/domain/physics.ts';
import type { PhysicsDeps }       from '../../deps/physics.deps.ts';
import      { createSimulation }  from './simulation.ts';
import type {
  ModuleWithSettings,
  SettingsFor,
} from '../../types/index.ts';

export class Physics implements ModuleWithSettings<'physics'> {
  private settings: SettingsFor<'physics'>;
  private deps:     PhysicsDeps;
  private sim:      Simulation | null = null;
  private pinned:   Set<string>       = new Set();

  constructor(
    settings:       SettingsFor<'physics'>,
    deps:           PhysicsDeps,
  ) {
    this.settings = settings;
    this.deps     = deps;
  }

  updateSettings(settings: SettingsFor<'physics'>): void {
    this.settings = settings;
  }

  initialize(): void {
    // Simulation is built lazily through rebuild().
  }

  // Call whenever the graph changes (rebuild/filter/etc.)
  public rebuild(): void {
    this.stop();
    const graph  = this.deps.graph?.get();
    const camera = this.deps.camera;
    if (!graph || !camera) {
      this.sim = null;
      return;
    }

    // Simulation wants a gravity center provider; we now read it from InteractionState
    this.sim = createSimulation(
      graph, 
      camera, 
      this.settings.tuning,
      this.settings.physics,
      ()        => this.deps.interactionState.gravityCenter,
      (nodeId)  => nodeId === this.deps.interactionState.followedNodeId
    );
    this.sim?.setPinnedNodes?.(new Set(this.pinned));
    this.sim?.start();
  }

  public tick(dt: number): void {
    this.sim?.tick(dt, this.settings.physics, this.settings.layout);
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
    this.pinned.add(nodeId);
    this.sim?.setPinnedNodes?.(new Set(this.pinned));
  }

  public unpinNode(nodeId: string): void {
    this.pinned.delete(nodeId);
    this.sim?.setPinnedNodes?.(new Set(this.pinned));
  }

  public getPinnedNodeIds(): ReadonlySet<string> {
    return this.pinned;
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