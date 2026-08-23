import type { GraphDimensionsV1, JsonValue, Vec3 } from '../../../contracts/v1/index.ts';
import type { GraphModuleInstanceV1, GraphModulePipelineStateV1 } from '../GraphModuleTypes.ts';

interface ForceSettings {
  readonly repulsionStrength: number;
  readonly springStrength: number;
  readonly springLength: number;
  readonly centeringStrength: number;
  readonly damping: number;
  readonly maxSpeed: number;
}

export class ForceLayoutModule implements GraphModuleInstanceV1 {
  private readonly velocities = new Map<string, Vec3>();
  private suspended = false;

  constructor(
    private readonly dimensions: GraphDimensionsV1,
    private settings: ForceSettings,
  ) {}

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = readForceSettings(settings);
  }

  onDocumentChanged(): void {
    this.velocities.clear();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  tick(state: GraphModulePipelineStateV1, deltaSeconds: number) {
    if (this.suspended || state.formActive || state.document.nodes.length < 2) return;
    const dt = Math.min(1 / 20, Math.max(1 / 240, deltaSeconds || 1 / 60));
    const positions: Record<string, Vec3> = Object.fromEntries(
      state.document.nodes.map((node) => [node.id, { ...(state.positions[node.id] ?? { x: 0, y: 0, z: 0 }) }]),
    );
    const forces = new Map(state.document.nodes.map((node) => [node.id, { x: 0, y: 0, z: 0 }]));
    this.applyLocalRepulsion(positions, forces);
    for (const edge of state.document.edges) {
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) continue;
      const delta = subtract(target, source);
      const length = Math.max(0.001, magnitude(delta));
      const strength = this.settings.springStrength * Math.max(0.1, Math.abs(edge.weight ?? 1));
      const force = scale(delta, strength * (length - this.settings.springLength) / length);
      addInto(forces.get(edge.sourceId)!, force);
      addInto(forces.get(edge.targetId)!, scale(force, -1));
    }
    for (const node of state.document.nodes) {
      const position = positions[node.id];
      addInto(forces.get(node.id)!, scale(position, -this.settings.centeringStrength));
    }
    const pinned = new Set(state.viewState.pinnedNodeIds);
    let changed = false;
    for (const node of state.document.nodes) {
      if (pinned.has(node.id)) {
        this.velocities.set(node.id, { x: 0, y: 0, z: 0 });
        continue;
      }
      const previousVelocity = this.velocities.get(node.id) ?? { x: 0, y: 0, z: 0 };
      const acceleration = forces.get(node.id)!;
      let velocity = scale(add(previousVelocity, scale(acceleration, dt)), this.settings.damping);
      if (this.dimensions === '2d') velocity = { ...velocity, z: 0 };
      const speed = magnitude(velocity);
      if (speed > this.settings.maxSpeed) velocity = scale(velocity, this.settings.maxSpeed / speed);
      this.velocities.set(node.id, velocity);
      const movement = scale(velocity, dt);
      if (magnitude(movement) > 0.00001) changed = true;
      const nextPosition = add(positions[node.id], movement);
      positions[node.id] = this.dimensions === '2d' ? { ...nextPosition, z: 0 } : nextPosition;
    }
    return changed ? { positions: { ...state.viewState.positions, ...positions } } : undefined;
  }

  dispose(): void {
    this.velocities.clear();
  }

  private applyLocalRepulsion(positions: Readonly<Record<string, Vec3>>, forces: Map<string, Vec3>): void {
    const cellSize = Math.max(24, this.settings.springLength);
    const cells = new Map<string, string[]>();
    for (const [id, position] of Object.entries(positions)) {
      const key = cellKey(position, cellSize, this.dimensions);
      const values = cells.get(key) ?? [];
      values.push(id);
      cells.set(key, values);
    }
    const ids = Object.keys(positions).sort();
    const order = new Map(ids.map((id, index) => [id, index]));
    const zOffsets = this.dimensions === '3d' ? [-1, 0, 1] : [0];
    for (const id of ids) {
      const position = positions[id];
      const baseX = Math.floor(position.x / cellSize);
      const baseY = Math.floor(position.y / cellSize);
      const baseZ = this.dimensions === '3d' ? Math.floor(position.z / cellSize) : 0;
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const dz of zOffsets) {
        for (const otherId of cells.get(`${baseX + dx}:${baseY + dy}:${baseZ + dz}`) ?? []) {
          if ((order.get(otherId) ?? 0) <= (order.get(id) ?? 0)) continue;
          const delta = subtract(position, positions[otherId]);
          const distanceSquared = Math.max(4, dot(delta, delta));
          const direction = distanceSquared <= 4.0001 ? deterministicDirection(id, otherId, this.dimensions) : scale(delta, 1 / Math.sqrt(distanceSquared));
          const force = scale(direction, this.settings.repulsionStrength / distanceSquared);
          addInto(forces.get(id)!, force);
          addInto(forces.get(otherId)!, scale(force, -1));
        }
      }
    }
  }
}

export function readForceSettings(settings: Readonly<Record<string, JsonValue>>): ForceSettings {
  return {
    repulsionStrength: finiteNonNegative(settings.repulsionStrength, 18000),
    springStrength: finiteNonNegative(settings.springStrength, 3.5),
    springLength: finitePositive(settings.springLength, 80),
    centeringStrength: finiteNonNegative(settings.centeringStrength, 0.45),
    damping: clampNumber(settings.damping, 0.5, 0.999, 0.9),
    maxSpeed: finitePositive(settings.maxSpeed, 260),
  };
}

function cellKey(position: Vec3, size: number, dimensions: GraphDimensionsV1): string {
  return `${Math.floor(position.x / size)}:${Math.floor(position.y / size)}:${dimensions === '3d' ? Math.floor(position.z / size) : 0}`;
}

function deterministicDirection(a: string, b: string, dimensions: GraphDimensionsV1): Vec3 {
  let hash = 2166136261;
  for (const value of `${a}:${b}`) {
    hash ^= value.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const angle = (hash >>> 0) / 0xffffffff * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle), z: dimensions === '3d' ? Math.sin(angle * 0.7) * 0.5 : 0 };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function addInto(target: { x: number; y: number; z: number }, value: Vec3): void {
  target.x += value.x;
  target.y += value.y;
  target.z += value.z;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function finitePositive(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clampNumber(value: JsonValue | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
