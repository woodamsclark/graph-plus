import type { LayoutSettings, PhysicsSettings } from '../settings/appSettings.ts';
import type { Vec3 } from './math.ts';

export interface Simulation {
  start(): void;
  stop(): void;
  reset(): void;
  tick(dt: number, physics: PhysicsSettings, layout: LayoutSettings): void;
  setPinnedNodes?(nodeIds: ReadonlySet<string>): void;
  beginDrag?(nodeId: string, target: Vec3): void;
  updateDragTarget?(target: Vec3): void;
  endDrag?(): void;
}