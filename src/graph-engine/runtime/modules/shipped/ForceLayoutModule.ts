import type { GraphDimensionsV1, GraphDocumentV1, JsonValue, Vec3 } from '../../../contracts/v1/index.ts';
import {
  analyzeGraphTopologyV1,
  graphTopologyPairKeyV1,
  type GraphTopologyAnalysisV1,
  type GraphTopologyComponentV1,
  type GraphTopologyPairV1,
} from '../../../core/topology/index.ts';
import type { GraphModuleInstanceV1, GraphModulePipelineStateV1 } from '../GraphModuleTypes.ts';

export type GraphTopologyWeightingModeV1 = 'uniform' | 'topology-weighted';

interface ForceSettings {
  readonly weightingMode: GraphTopologyWeightingModeV1;
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
  readonly minimumAffinity: number;
  readonly maximumAffinity: number;
  readonly evidenceLogFactor: number;
  readonly reciprocalBoost: number;
  readonly hubDiscountExponent: number;
  readonly minimumSpringStrengthScale: number;
  readonly maximumSpringStrengthScale: number;
  readonly minimumSpringLengthScale: number;
  readonly maximumSpringLengthScale: number;
  readonly componentPadding: number;
}

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

interface OctreeNode {
  readonly center: Vec3;
  readonly halfSize: number;
  mass: number;
  centerOfMass: MutableVec3;
  bodyId?: string;
  children?: Array<OctreeNode | undefined>;
}

export interface WeightedSpringParametersV1 {
  readonly strength: number;
  readonly targetLength: number;
}

export interface ForceLayoutDiagnosticsV1 {
  readonly topologyAnalysisCount: number;
  readonly physicalSpringCount: number;
  readonly componentCount: number;
  readonly coordinatedMembershipPairCount: number;
  readonly alpha: number;
  readonly running: boolean;
}

const ACTIVE_DRAG_ALPHA = 0.35;

export class ForceLayoutModule implements GraphModuleInstanceV1 {
  private readonly velocities = new Map<string, MutableVec3>();
  private readonly forces = new Map<string, MutableVec3>();
  private positions: Record<string, MutableVec3> = {};
  private positionSource: Readonly<Record<string, Vec3>> | null = null;
  private bufferDocumentSource: GraphDocumentV1 | null = null;
  private topologyDocumentSource: GraphDocumentV1 | null = null;
  private topologyRegionKey = '';
  private topology?: GraphTopologyAnalysisV1;
  private membershipPairStrengths = new Map<string, number>();
  private componentTargets: ReadonlyMap<string, Vec3> = new Map();
  private documentKey = '';
  private pinned = new Set<string>();
  private suspended = false;
  private alpha = 1;
  private running = true;
  private pinnedKey = '';
  private regionLayoutKey = '';
  private topologyAnalysisCount = 0;

  constructor(
    private readonly dimensions: GraphDimensionsV1,
    private settings: ForceSettings,
  ) {}

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = readForceSettings(settings);
    this.topologyDocumentSource = null;
    this.reheat();
  }

  onDocumentChanged(): void {
    this.documentKey = '';
    this.topologyDocumentSource = null;
    this.reheat();
  }

  onViewChanged(state: GraphModulePipelineStateV1['viewState']): void {
    this.synchronizePinnedNodes(state);
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  tick(state: GraphModulePipelineStateV1, deltaSeconds: number) {
    // A restored view can reach the first tick before a view lifecycle event. Keep
    // pin state correct without requiring the session kernel to special-case force.
    this.synchronizePinnedNodes(state.viewState);
    this.synchronizeRegionLayout(state);
    if (state.document !== this.bufferDocumentSource) this.reheat();
    if (this.suspended || state.formActive || state.document.nodes.length < 2) return;
    const dragActive = state.draggedNodeId !== undefined
      && state.document.nodes.some((node) => node.id === state.draggedNodeId);
    if (dragActive) this.running = true;
    if (!this.running) return;
    this.synchronizeBuffers(state);
    this.synchronizeTopology(state);
    const dt = Math.min(1 / 20, Math.max(1 / 240, deltaSeconds || 1 / 60));
    this.alpha += (0 - this.alpha) * this.settings.alphaDecay;
    if (dragActive) this.alpha = Math.max(this.alpha, ACTIVE_DRAG_ALPHA);
    for (const node of state.document.nodes) {
      const force = this.forces.get(node.id)!;
      force.x = 0; force.y = 0; force.z = 0;
    }
    this.applyBarnesHutRepulsion(this.positions, this.forces);
    if (this.settings.weightingMode === 'topology-weighted') this.applyWeightedSprings();
    else this.applyUniformSprings(state.document);
    this.applyRegionMembershipForces(state);
    if (this.settings.weightingMode === 'topology-weighted') this.applyComponentCentering();
    else this.applyUniformCentering(state.document);
    let changed = false;
    for (const node of state.document.nodes) {
      const velocity = this.velocities.get(node.id)!;
      if (this.pinned.has(node.id)) {
        velocity.x = 0; velocity.y = 0; velocity.z = 0;
        continue;
      }
      const acceleration = this.forces.get(node.id)!;
      const decay = 1 - this.settings.velocityDecay;
      velocity.x = (velocity.x + acceleration.x) * decay;
      velocity.y = (velocity.y + acceleration.y) * decay;
      velocity.z = this.dimensions === '2d' ? 0 : (velocity.z + acceleration.z) * decay;
      const speed = magnitude(velocity);
      if (speed > this.settings.maxSpeed) {
        const scale = this.settings.maxSpeed / speed;
        velocity.x *= scale; velocity.y *= scale; velocity.z *= scale;
      }
      const movementScale = dt * 60;
      const movement = Math.hypot(velocity.x, velocity.y, velocity.z) * movementScale;
      if (movement > 0.00001) changed = true;
      const position = this.positions[node.id];
      position.x += velocity.x * movementScale;
      position.y += velocity.y * movementScale;
      position.z = this.dimensions === '2d' ? 0 : position.z + velocity.z * movementScale;
    }
    if (!dragActive && (this.alpha < this.settings.alphaMin || this.isSettled(this.pinned))) {
      this.running = false;
      this.alpha = 0;
      for (const velocity of this.velocities.values()) {
        velocity.x = 0; velocity.y = 0; velocity.z = 0;
      }
    }
    return changed ? { positions: this.positions } : undefined;
  }

  private synchronizePinnedNodes(state: GraphModulePipelineStateV1['viewState']): void {
    const nextPinnedKey = [...state.pinnedNodeIds].sort().join('\u0000');
    if (nextPinnedKey === this.pinnedKey) return;
    this.pinnedKey = nextPinnedKey;
    this.pinned = new Set(state.pinnedNodeIds);
    this.reheat();
  }

  private synchronizeRegionLayout(state: GraphModulePipelineStateV1): void {
    const nextKey = state.regionLayouts.map((region) => [
      region.regionNodeId,
      region.membershipStrength,
      region.membershipDistance,
      ...region.directMemberNodeIds,
    ].join('\u0001')).join('\u0000');
    if (nextKey === this.regionLayoutKey) return;
    this.regionLayoutKey = nextKey;
    this.topologyDocumentSource = null;
    this.reheat();
  }

  private synchronizeTopology(state: GraphModulePipelineStateV1): void {
    if (this.settings.weightingMode !== 'topology-weighted') {
      this.topology = undefined;
      this.topologyDocumentSource = null;
      this.membershipPairStrengths.clear();
      this.componentTargets = new Map();
      return;
    }
    if (state.document === this.topologyDocumentSource && this.regionLayoutKey === this.topologyRegionKey) return;
    const membershipConnections = state.regionLayouts.flatMap((region) => region.directMemberNodeIds.map((memberId) => ({
      sourceId: region.regionNodeId,
      targetId: memberId,
    })));
    this.topology = analyzeGraphTopologyV1(state.document, membershipConnections, {
      minimumAffinity: this.settings.minimumAffinity,
      maximumAffinity: this.settings.maximumAffinity,
      evidenceLogFactor: this.settings.evidenceLogFactor,
      reciprocalBoost: this.settings.reciprocalBoost,
      hubDiscountExponent: this.settings.hubDiscountExponent,
    });
    this.topologyAnalysisCount += 1;
    this.membershipPairStrengths = new Map();
    for (const region of state.regionLayouts) {
      for (const memberId of region.directMemberNodeIds) {
        const key = graphTopologyPairKeyV1(region.regionNodeId, memberId);
        this.membershipPairStrengths.set(key, Math.max(
          this.membershipPairStrengths.get(key) ?? 0,
          region.membershipStrength,
        ));
      }
    }
    this.componentTargets = buildComponentPackingTargetsV1(
      this.topology.components,
      this.settings.springLength,
      this.settings.componentPadding,
      this.dimensions,
    );
    this.topologyDocumentSource = state.document;
    this.topologyRegionKey = this.regionLayoutKey;
  }

  private applyWeightedSprings(): void {
    for (const pair of this.topology?.pairs ?? []) {
      if (pair.affinity <= 0) continue;
      const parameters = deriveWeightedSpringParametersV1(pair, this.settings);
      const membershipStrength = this.membershipPairStrengths.get(pair.key) ?? 0;
      this.applySpring(
        pair.sourceId,
        pair.targetId,
        coordinateWeightedSpringStrengthV1(parameters.strength, membershipStrength),
        parameters.targetLength,
      );
    }
  }

  private applyUniformSprings(document: GraphDocumentV1): void {
    for (const edge of document.edges) {
      this.applySpring(
        edge.sourceId,
        edge.targetId,
        this.settings.springStrength * Math.max(0.1, Math.abs(edge.weight ?? 1)),
        this.settings.springLength,
      );
    }
  }

  private applySpring(sourceId: string, targetId: string, strength: number, targetLength: number): void {
    if (strength <= 0 || sourceId === targetId) return;
    const source = this.positions[sourceId];
    const target = this.positions[targetId];
    if (!source || !target) return;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dz = this.dimensions === '2d' ? 0 : target.z - source.z;
    const length = Math.max(0.001, Math.hypot(dx, dy, dz));
    const amount = strength * Math.tanh((length - targetLength) / 50) * this.alpha / length;
    const sourceForce = this.forces.get(sourceId)!;
    const targetForce = this.forces.get(targetId)!;
    sourceForce.x += dx * amount; sourceForce.y += dy * amount; sourceForce.z += dz * amount;
    targetForce.x -= dx * amount; targetForce.y -= dy * amount; targetForce.z -= dz * amount;
  }

  private applyUniformCentering(document: GraphDocumentV1): void {
    const amount = -this.settings.centeringStrength * this.alpha;
    for (const node of document.nodes) {
      const position = this.positions[node.id];
      const force = this.forces.get(node.id)!;
      force.x += position.x * amount;
      force.y += position.y * amount;
      force.z += position.z * amount;
    }
  }

  private applyComponentCentering(): void {
    const amount = this.settings.centeringStrength * this.alpha;
    if (amount <= 0) return;
    for (const component of this.topology?.components ?? []) {
      if (component.nodeIds.some((nodeId) => this.pinned.has(nodeId))) continue;
      const centroid = { x: 0, y: 0, z: 0 };
      let count = 0;
      for (const nodeId of component.nodeIds) {
        const position = this.positions[nodeId];
        if (!position) continue;
        centroid.x += position.x; centroid.y += position.y; centroid.z += position.z;
        count += 1;
      }
      if (!count) continue;
      centroid.x /= count; centroid.y /= count; centroid.z /= count;
      const target = this.componentTargets.get(component.id) ?? { x: 0, y: 0, z: 0 };
      const dx = (target.x - centroid.x) * amount;
      const dy = (target.y - centroid.y) * amount;
      const dz = this.dimensions === '2d' ? 0 : (target.z - centroid.z) * amount;
      for (const nodeId of component.nodeIds) {
        const force = this.forces.get(nodeId);
        if (!force) continue;
        force.x += dx; force.y += dy; force.z += dz;
      }
    }
  }

  private applyRegionMembershipForces(state: GraphModulePipelineStateV1): void {
    if (!state.regionLayouts.length) return;
    const memberCounts = new Map<string, number>();
    for (const region of state.regionLayouts) {
      for (const memberId of region.directMemberNodeIds) {
        memberCounts.set(memberId, (memberCounts.get(memberId) ?? 0) + 1);
      }
    }
    for (const region of state.regionLayouts) {
      const owner = this.positions[region.regionNodeId];
      if (!owner) continue;
      const ownerForce = this.forces.get(region.regionNodeId);
      if (!ownerForce) continue;
      const ownerDivisor = Math.max(1, region.directMemberNodeIds.length);
      for (const memberId of region.directMemberNodeIds) {
        const member = this.positions[memberId];
        const memberForce = this.forces.get(memberId);
        if (!member || !memberForce) continue;
        const dx = member.x - owner.x;
        const dy = member.y - owner.y;
        const dz = this.dimensions === '2d' ? 0 : member.z - owner.z;
        const length = Math.max(0.001, Math.hypot(dx, dy, dz));
        const amount = region.membershipStrength
          * Math.tanh((length - region.membershipDistance) / 36)
          * this.alpha / length;
        const memberDivisor = Math.max(1, memberCounts.get(memberId) ?? 1);
        ownerForce.x += dx * amount / ownerDivisor;
        ownerForce.y += dy * amount / ownerDivisor;
        ownerForce.z += dz * amount / ownerDivisor;
        memberForce.x -= dx * amount / memberDivisor;
        memberForce.y -= dy * amount / memberDivisor;
        memberForce.z -= dz * amount / memberDivisor;
      }
    }
  }

  dispose(): void {
    this.velocities.clear();
    this.forces.clear();
    this.positions = {};
    this.positionSource = null;
    this.bufferDocumentSource = null;
    this.topologyDocumentSource = null;
    this.topology = undefined;
    this.membershipPairStrengths.clear();
    this.componentTargets = new Map();
    this.regionLayoutKey = '';
  }

  getDiagnostics(): ForceLayoutDiagnosticsV1 {
    return {
      topologyAnalysisCount: this.topologyAnalysisCount,
      physicalSpringCount: this.settings.weightingMode === 'topology-weighted'
        ? this.topology?.pairs.filter((pair) => pair.affinity > 0).length ?? 0
        : 0,
      componentCount: this.topology?.components.length ?? 0,
      coordinatedMembershipPairCount: this.membershipPairStrengths.size,
      alpha: this.alpha,
      running: this.running,
    };
  }

  private synchronizeBuffers(state: GraphModulePipelineStateV1): void {
    const key = `${state.document.documentId}\u0000${state.document.revision}`;
    const topologyChanged = key !== this.documentKey || state.document !== this.bufferDocumentSource;
    const sourceChanged = state.positions !== this.positionSource && state.positions !== this.positions;
    if (!topologyChanged && !sourceChanged) return;
    const known = new Set(state.document.nodes.map((node) => node.id));
    if (topologyChanged) {
      for (const id of Object.keys(this.positions)) if (!known.has(id)) delete this.positions[id];
      for (const id of [...this.velocities.keys()]) if (!known.has(id)) this.velocities.delete(id);
      for (const id of [...this.forces.keys()]) if (!known.has(id)) this.forces.delete(id);
    }
    for (const node of state.document.nodes) {
      const source = state.positions[node.id] ?? { x: 0, y: 0, z: 0 };
      let position = this.positions[node.id];
      if (!position) this.positions[node.id] = position = { ...source };
      else if (sourceChanged) {
        position.x = source.x; position.y = source.y; position.z = this.dimensions === '2d' ? 0 : source.z;
      }
      if (!this.velocities.has(node.id)) this.velocities.set(node.id, { x: 0, y: 0, z: 0 });
      if (!this.forces.has(node.id)) this.forces.set(node.id, { x: 0, y: 0, z: 0 });
    }
    this.documentKey = key;
    this.bufferDocumentSource = state.document;
    this.positionSource = this.positions;
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
    forceTarget: MutableVec3,
    minimumSquared: number,
    thetaSquared: number,
  ): void {
    if (cell.mass === 0 || (!cell.children && cell.bodyId === id)) return;
    let dx = position.x - cell.centerOfMass.x;
    let dy = position.y - cell.centerOfMass.y;
    let dz = position.z - cell.centerOfMass.z;
    let rawSquared = dx * dx + dy * dy + dz * dz;
    if (rawSquared < 0.0001) {
      const direction = deterministicDirection(id, cell.bodyId ?? `cell:${cell.center.x}:${cell.center.y}:${cell.center.z}`, this.dimensions);
      dx = direction.x; dy = direction.y; dz = direction.z;
      rawSquared = 0.0001;
    }
    const size = cell.halfSize * 2;
    if (!cell.children || (size * size / rawSquared) < thetaSquared) {
      const distance = Math.sqrt(rawSquared);
      const strength = this.settings.repulsionStrength * cell.mass * this.alpha / Math.max(rawSquared, minimumSquared);
      const factor = strength / distance;
      forceTarget.x += dx * factor;
      forceTarget.y += dy * factor;
      forceTarget.z += dz * factor;
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
  const minimumAffinity = finitePositive(settings.minimumAffinity, 0.2);
  const maximumAffinity = Math.max(minimumAffinity, finitePositive(settings.maximumAffinity, 2.5));
  const minimumSpringStrengthScale = finiteNonNegative(settings.minimumSpringStrengthScale, 0.35);
  const maximumSpringStrengthScale = Math.max(
    minimumSpringStrengthScale,
    finitePositive(settings.maximumSpringStrengthScale, 2),
  );
  const minimumSpringLengthScale = finitePositive(settings.minimumSpringLengthScale, 0.55);
  const maximumSpringLengthScale = Math.max(
    minimumSpringLengthScale,
    finitePositive(settings.maximumSpringLengthScale, 1.85),
  );
  return {
    weightingMode: settings.weightingMode === 'uniform' ? 'uniform' : 'topology-weighted',
    repulsionStrength: finiteNonNegative(settings.repulsionStrength, 7000),
    springStrength: finiteNonNegative(settings.springStrength, 0.25),
    springLength: finitePositive(settings.springLength, 120),
    centeringStrength: finiteNonNegative(settings.centeringStrength, 0.002),
    velocityDecay: clampNumber(settings.velocityDecay ?? settings.damping, 0, 1, 0.4),
    alphaDecay: clampNumber(settings.alphaDecay, 0, 1, 0.035),
    alphaMin: finitePositive(settings.alphaMin, 0.001),
    repulsionMinDistance: finitePositive(settings.repulsionMinDistance, 40),
    barnesHutTheta: finitePositive(settings.barnesHutTheta, 0.8),
    maxSpeed: finitePositive(settings.maxSpeed, 260),
    minimumAffinity,
    maximumAffinity,
    evidenceLogFactor: finiteNonNegative(settings.evidenceLogFactor, 0.35),
    reciprocalBoost: finitePositive(settings.reciprocalBoost, 1.25),
    hubDiscountExponent: finiteNonNegative(settings.hubDiscountExponent, 0.25),
    minimumSpringStrengthScale,
    maximumSpringStrengthScale,
    minimumSpringLengthScale,
    maximumSpringLengthScale,
    componentPadding: finiteNonNegative(settings.componentPadding, 80),
  };
}

export function deriveWeightedSpringParametersV1(
  pair: Pick<GraphTopologyPairV1, 'affinity'>,
  settings: ForceSettings,
): WeightedSpringParametersV1 {
  const strengthScale = clampNumber(
    Math.pow(Math.max(0, pair.affinity), 0.65),
    settings.minimumSpringStrengthScale,
    settings.maximumSpringStrengthScale,
    1,
  );
  const lengthScale = clampNumber(
    Math.pow(Math.max(0.001, pair.affinity), -0.55),
    settings.minimumSpringLengthScale,
    settings.maximumSpringLengthScale,
    1,
  );
  return {
    strength: settings.springStrength * strengthScale,
    targetLength: settings.springLength * lengthScale,
  };
}

export function coordinateWeightedSpringStrengthV1(
  ordinaryStrength: number,
  membershipStrength: number,
): number {
  return Math.max(0, ordinaryStrength - Math.max(0, membershipStrength));
}

export function buildComponentPackingTargetsV1(
  components: readonly GraphTopologyComponentV1[],
  springLength: number,
  padding: number,
  dimensions: GraphDimensionsV1,
): ReadonlyMap<string, Vec3> {
  const targets = new Map<string, Vec3>();
  if (!components.length) return targets;
  const radii = components.map((component) => Math.max(
    springLength * 0.35,
    Math.sqrt(component.nodeIds.length) * springLength * 0.65,
  ));
  targets.set(components[0].id, { x: 0, y: 0, z: 0 });
  let ringRadius = radii[0] + padding;
  let angle = 0;
  let ringMaximumRadius = 0;
  for (let index = 1; index < components.length; index += 1) {
    const radius = radii[index];
    ringRadius = Math.max(ringRadius, radii[0] + radius + padding);
    const angularSpan = 2 * Math.asin(Math.min(0.95, (radius + padding / 2) / Math.max(radius + padding, ringRadius)));
    if (angle > 0 && angle + angularSpan > Math.PI * 2) {
      ringRadius += ringMaximumRadius * 2 + padding;
      angle = 0;
      ringMaximumRadius = 0;
    }
    const centerAngle = angle + angularSpan / 2;
    targets.set(components[index].id, {
      x: Math.cos(centerAngle) * ringRadius,
      y: Math.sin(centerAngle) * ringRadius,
      z: dimensions === '3d' ? Math.sin(centerAngle * 0.7) * ringRadius * 0.25 : 0,
    });
    angle += angularSpan;
    ringMaximumRadius = Math.max(ringMaximumRadius, radius);
  }
  return targets;
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
  cell.centerOfMass.x = (cell.centerOfMass.x * previousMass + position.x) / cell.mass;
  cell.centerOfMass.y = (cell.centerOfMass.y * previousMass + position.y) / cell.mass;
  cell.centerOfMass.z = (cell.centerOfMass.z * previousMass + position.z) / cell.mass;
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
    const divisor = Math.max(1, cell.mass - 1);
    const prior = {
      x: (cell.centerOfMass.x * cell.mass - fallback.x) / divisor,
      y: (cell.centerOfMass.y * cell.mass - fallback.y) / divisor,
      z: (cell.centerOfMass.z * cell.mass - fallback.z) / divisor,
    };
    if (Number.isFinite(prior.x) && Number.isFinite(prior.y) && Number.isFinite(prior.z)) return prior;
  }
  const direction = deterministicDirection(id, `${cell.center.x}:${cell.center.y}:${cell.center.z}`, '3d');
  const amount = cell.halfSize * 0.25;
  return {
    x: cell.center.x + direction.x * amount,
    y: cell.center.y + direction.y * amount,
    z: cell.center.z + direction.z * amount,
  };
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
