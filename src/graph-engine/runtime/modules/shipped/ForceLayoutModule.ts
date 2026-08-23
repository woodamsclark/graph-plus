import type { GraphDimensionsV1, JsonValue, Vec3 } from '../../../contracts/v1/index.ts';
import type { GraphModuleInstanceV1, GraphModulePipelineStateV1 } from '../GraphModuleTypes.ts';

interface ForceSettings {
  readonly repulsionStrength: number;
  readonly springStrength: number;
  readonly springLength: number;
  readonly centeringStrength: number;
  readonly velocityDecay: number;
  readonly alphaDecay: number;
  readonly alphaMin: number;
  readonly repulsionMinDistance: number;
  readonly barnesHutTheta: number;
  readonly maxSpeed: number;
}

interface OctreeNode {
  readonly center: Vec3;
  readonly halfSize: number;
  mass: number;
  centerOfMass: Vec3;
  bodyId?: string;
  children?: Array<OctreeNode | undefined>;
}

export class ForceLayoutModule implements GraphModuleInstanceV1 {
  private readonly velocities = new Map<string, Vec3>();
  private suspended = false;
  private alpha = 1;
  private running = true;
  private pinnedKey = '';

  constructor(
    private readonly dimensions: GraphDimensionsV1,
    private settings: ForceSettings,
  ) {}

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = readForceSettings(settings);
    this.reheat();
  }

  onDocumentChanged(): void {
    this.velocities.clear();
    this.reheat();
  }

  onViewChanged(state: GraphModulePipelineStateV1['viewState']): void {
    const nextPinnedKey = [...state.pinnedNodeIds].sort().join('\u0000');
    if (nextPinnedKey === this.pinnedKey) return;
    this.pinnedKey = nextPinnedKey;
    this.reheat();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  tick(state: GraphModulePipelineStateV1, deltaSeconds: number) {
    if (this.suspended || state.formActive || state.document.nodes.length < 2 || !this.running) return;
    const dt = Math.min(1 / 20, Math.max(1 / 240, deltaSeconds || 1 / 60));
    this.alpha += (0 - this.alpha) * this.settings.alphaDecay;
    const positions: Record<string, Vec3> = Object.fromEntries(
      state.document.nodes.map((node) => [node.id, { ...(state.positions[node.id] ?? { x: 0, y: 0, z: 0 }) }]),
    );
    const forces = new Map(state.document.nodes.map((node) => [node.id, { x: 0, y: 0, z: 0 }]));
    this.applyBarnesHutRepulsion(positions, forces);
    for (const edge of state.document.edges) {
      const source = positions[edge.sourceId];
      const target = positions[edge.targetId];
      if (!source || !target) continue;
      const delta = subtract(target, source);
      const length = Math.max(0.001, magnitude(delta));
      const strength = this.settings.springStrength * Math.max(0.1, Math.abs(edge.weight ?? 1));
      const force = scale(delta, strength * Math.tanh((length - this.settings.springLength) / 50) * this.alpha / length);
      addInto(forces.get(edge.sourceId)!, force);
      addInto(forces.get(edge.targetId)!, scale(force, -1));
    }
    for (const node of state.document.nodes) {
      const position = positions[node.id];
      addInto(forces.get(node.id)!, scale(position, -this.settings.centeringStrength * this.alpha));
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
      let velocity = scale(add(previousVelocity, acceleration), 1 - this.settings.velocityDecay);
      if (this.dimensions === '2d') velocity = { ...velocity, z: 0 };
      const speed = magnitude(velocity);
      if (speed > this.settings.maxSpeed) velocity = scale(velocity, this.settings.maxSpeed / speed);
      this.velocities.set(node.id, velocity);
      const movement = scale(velocity, dt * 60);
      if (magnitude(movement) > 0.00001) changed = true;
      const nextPosition = add(positions[node.id], movement);
      positions[node.id] = this.dimensions === '2d' ? { ...nextPosition, z: 0 } : nextPosition;
    }
    if (this.alpha < this.settings.alphaMin || this.isSettled(pinned)) {
      this.running = false;
      this.alpha = 0;
      for (const node of state.document.nodes) this.velocities.set(node.id, { x: 0, y: 0, z: 0 });
    }
    return changed ? { positions: { ...state.viewState.positions, ...positions } } : undefined;
  }

  dispose(): void {
    this.velocities.clear();
  }

  private applyBarnesHutRepulsion(positions: Readonly<Record<string, Vec3>>, forces: Map<string, Vec3>): void {
    const root = buildOctree(positions, this.dimensions);
    if (!root) return;
    const minimumSquared = this.settings.repulsionMinDistance ** 2;
    const thetaSquared = this.settings.barnesHutTheta ** 2;
    for (const [id, position] of Object.entries(positions)) {
      this.accumulateRepulsion(id, position, root, forces.get(id)!, minimumSquared, thetaSquared);
    }
  }

  private accumulateRepulsion(
    id: string,
    position: Vec3,
    cell: OctreeNode,
    forceTarget: Vec3,
    minimumSquared: number,
    thetaSquared: number,
  ): void {
    if (cell.mass === 0 || (!cell.children && cell.bodyId === id)) return;
    let delta = subtract(position, cell.centerOfMass);
    let rawSquared = dot(delta, delta);
    if (rawSquared < 0.0001) {
      delta = deterministicDirection(id, cell.bodyId ?? `cell:${cell.center.x}:${cell.center.y}:${cell.center.z}`, this.dimensions);
      rawSquared = 0.0001;
    }
    const size = cell.halfSize * 2;
    if (!cell.children || (size * size / rawSquared) < thetaSquared) {
      const distance = Math.sqrt(rawSquared);
      const strength = this.settings.repulsionStrength * cell.mass * this.alpha / Math.max(rawSquared, minimumSquared);
      addInto(forceTarget, scale(delta, strength / distance));
      return;
    }
    for (const child of cell.children) {
      if (child) this.accumulateRepulsion(id, position, child, forceTarget, minimumSquared, thetaSquared);
    }
  }

  private isSettled(pinned: ReadonlySet<string>): boolean {
    for (const [id, velocity] of this.velocities) {
      if (!pinned.has(id) && Math.max(Math.abs(velocity.x), Math.abs(velocity.y), Math.abs(velocity.z)) >= 0.01) return false;
    }
    return true;
  }

  private reheat(): void {
    this.alpha = 1;
    this.running = true;
  }
}

export function readForceSettings(settings: Readonly<Record<string, JsonValue>>): ForceSettings {
  return {
    repulsionStrength: finiteNonNegative(settings.repulsionStrength, 7000),
    springStrength: finiteNonNegative(settings.springStrength, 0.25),
    springLength: finitePositive(settings.springLength, 100),
    centeringStrength: finiteNonNegative(settings.centeringStrength, 0.002),
    velocityDecay: clampNumber(settings.velocityDecay ?? settings.damping, 0, 1, 0.4),
    alphaDecay: clampNumber(settings.alphaDecay, 0, 1, 0.035),
    alphaMin: finitePositive(settings.alphaMin, 0.001),
    repulsionMinDistance: finitePositive(settings.repulsionMinDistance, 40),
    barnesHutTheta: finitePositive(settings.barnesHutTheta, 0.8),
    maxSpeed: finitePositive(settings.maxSpeed, 260),
  };
}

function buildOctree(
  positions: Readonly<Record<string, Vec3>>,
  dimensions: GraphDimensionsV1,
): OctreeNode | undefined {
  const entries = Object.entries(positions);
  if (!entries.length) return undefined;
  const min = { ...entries[0][1] };
  const max = { ...entries[0][1] };
  for (const [, position] of entries.slice(1)) {
    min.x = Math.min(min.x, position.x); min.y = Math.min(min.y, position.y); min.z = Math.min(min.z, position.z);
    max.x = Math.max(max.x, position.x); max.y = Math.max(max.y, position.y); max.z = Math.max(max.z, position.z);
  }
  if (dimensions === '2d') min.z = max.z = 0;
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const halfSize = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.001) / 2 + 0.001;
  const root = createOctreeNode(center, halfSize);
  for (const [id, position] of entries) insertOctreeBody(root, id, position, 0);
  return root;
}

function createOctreeNode(center: Vec3, halfSize: number): OctreeNode {
  return { center, halfSize, mass: 0, centerOfMass: { x: 0, y: 0, z: 0 } };
}

function insertOctreeBody(cell: OctreeNode, id: string, position: Vec3, depth: number): void {
  const previousMass = cell.mass;
  cell.mass += 1;
  cell.centerOfMass = scale(add(scale(cell.centerOfMass, previousMass), position), 1 / cell.mass);
  if (!cell.children && cell.bodyId === undefined) {
    cell.bodyId = id;
    return;
  }
  if (!cell.children && (depth >= 32 || cell.halfSize < 0.00001)) return;
  if (!cell.children) {
    const existingId = cell.bodyId!;
    cell.bodyId = undefined;
    cell.children = new Array<OctreeNode | undefined>(8);
    const existingPosition = positionForExistingBody(cell, existingId, position);
    insertIntoOctreeChild(cell, existingId, existingPosition, depth + 1);
  }
  insertIntoOctreeChild(cell, id, position, depth + 1);
}

// Coincident points are separated deterministically at the subdivision scale. This keeps
// the tree finite without changing the consumer-owned view positions.
function positionForExistingBody(cell: OctreeNode, id: string, fallback: Vec3): Vec3 {
  if (cell.mass <= 2) {
    const prior = scale(subtract(scale(cell.centerOfMass, cell.mass), fallback), 1 / Math.max(1, cell.mass - 1));
    if (Number.isFinite(prior.x) && Number.isFinite(prior.y) && Number.isFinite(prior.z)) return prior;
  }
  const direction = deterministicDirection(id, `${cell.center.x}:${cell.center.y}:${cell.center.z}`, '3d');
  return add(cell.center, scale(direction, cell.halfSize * 0.25));
}

function insertIntoOctreeChild(cell: OctreeNode, id: string, position: Vec3, depth: number): void {
  const index = (position.x >= cell.center.x ? 1 : 0)
    | (position.y >= cell.center.y ? 2 : 0)
    | (position.z >= cell.center.z ? 4 : 0);
  let child = cell.children![index];
  if (!child) {
    const halfSize = cell.halfSize / 2;
    child = createOctreeNode({
      x: cell.center.x + (index & 1 ? halfSize : -halfSize),
      y: cell.center.y + (index & 2 ? halfSize : -halfSize),
      z: cell.center.z + (index & 4 ? halfSize : -halfSize),
    }, halfSize);
    cell.children![index] = child;
  }
  insertOctreeBody(child, id, position, depth);
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
