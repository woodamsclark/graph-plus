import type { GraphDimensionsV1, GraphDocumentV1, JsonValue, Vec3 } from '../../../contracts/v1/index.ts';
import {
  analyzeGraphTopologyV1,
  graphTopologyPairKeyV1,
  type GraphTopologyAnalysisV1,
  type GraphTopologyComponentV1,
  type GraphTopologyPairV1,
} from '../../../core/topology/index.ts';
import type {
  GraphModuleInstanceV1,
  GraphModulePipelineStateV1,
  GraphModuleTickResultV1,
} from '../GraphModuleTypes.ts';

export type GraphAxialSpringAxisV1 = 'off' | 'x' | 'y' | 'z';

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
  readonly collisionRadius: number;
  readonly collisionStrength: number;
  readonly axialSpringAxis: GraphAxialSpringAxisV1;
  readonly axialSpringStiffness: number;
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

const NATIVE_ACTIVE_DRAG_ALPHA = 0.3;
const FIXED_STEP_SECONDS = 1 / 60;
const RESTORED_SPEED_REJECTION_MULTIPLIER = 4;

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
  private accumulatorSeconds = 0;
  private alphaTarget = 0;
  private dragWasActive = false;
  private restoredStatePending = false;

  constructor(
    private readonly dimensions: GraphDimensionsV1,
    private settings: ForceSettings,
  ) {}

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = readForceSettings(settings);
    this.topologyDocumentSource = null;
    this.reheatForChange();
  }

  onDocumentChanged(): void {
    this.documentKey = '';
    this.topologyDocumentSource = null;
    this.reheatForChange();
  }

  onViewChanged(state: GraphModulePipelineStateV1['viewState']): void {
    this.synchronizePinnedNodes(state);
  }

  restoreState(state: JsonValue): void {
    if (state === null) return;
    if (!isRecord(state) || state.schemaVersion !== 1
      || typeof state.alpha !== 'number' || !Number.isFinite(state.alpha)
      || typeof state.running !== 'boolean' || !isRecord(state.velocities)) {
      throw new Error('Force layout state is not a valid V1 snapshot.');
    }
    if (state.forceModel !== undefined && state.forceModel !== 'd3-compatible') return;
    const restoredVelocities = new Map<string, MutableVec3>();
    let hostileMotion = false;
    for (const [id, value] of Object.entries(state.velocities)) {
      if (!isRecord(value) || !finiteCoordinate(value.x) || !finiteCoordinate(value.y) || !finiteCoordinate(value.z)) continue;
      const velocity = { x: value.x, y: value.y, z: this.dimensions === '2d' ? 0 : value.z };
      if (Math.hypot(velocity.x, velocity.y, velocity.z) > this.settings.maxSpeed * RESTORED_SPEED_REJECTION_MULTIPLIER) {
        hostileMotion = true;
        break;
      }
      restoredVelocities.set(id, velocity);
    }
    this.velocities.clear();
    if (hostileMotion) {
      this.alpha = 1;
      this.alphaTarget = 0;
      this.running = true;
      this.restoredStatePending = false;
      return;
    }
    for (const [id, velocity] of restoredVelocities) this.velocities.set(id, velocity);
    this.alpha = Math.max(0, state.alpha);
    this.alphaTarget = finiteCoordinate(state.alphaTarget) ? Math.max(0, state.alphaTarget) : 0;
    this.running = state.running;
    this.restoredStatePending = true;
  }

  exportState(): JsonValue {
    return {
      schemaVersion: 1,
      alpha: this.alpha,
      alphaTarget: this.alphaTarget,
      running: this.running,
      velocities: Object.fromEntries([...this.velocities].map(([id, value]) => [id, { ...value }])),
    };
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  tick(state: GraphModulePipelineStateV1, deltaSeconds: number) {
    // A restored view can reach the first tick before a view lifecycle event. Keep
    // pin state correct without requiring the session kernel to special-case force.
    this.synchronizePinnedNodes(state.viewState);
    this.synchronizeRegionLayout(state);
    if (state.document !== this.bufferDocumentSource) {
      if (this.restoredStatePending) this.restoredStatePending = false;
      else this.reheatForChange();
    }
    if (this.suspended || state.formActive || state.document.nodes.length < 2) return;
    const dragActive = state.draggedNodeId !== undefined
      && state.document.nodes.some((node) => node.id === state.draggedNodeId);
    if (dragActive) this.running = true;
    this.synchronizeBuffers(state);
    this.synchronizeTopology(state);
    if (!this.running) return;
    return this.tickD3Compatible(state, deltaSeconds, dragActive);
  }

  private synchronizePinnedNodes(state: GraphModulePipelineStateV1['viewState']): void {
    const nextPinnedKey = [...state.pinnedNodeIds].sort().join('\u0000');
    if (nextPinnedKey === this.pinnedKey) return;
    this.pinnedKey = nextPinnedKey;
    this.pinned = new Set(state.pinnedNodeIds);
    this.reheatForChange();
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
    this.reheatForChange();
  }

  private synchronizeTopology(state: GraphModulePipelineStateV1): void {
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

  private tickD3Compatible(
    state: GraphModulePipelineStateV1,
    deltaSeconds: number,
    dragActive: boolean,
  ): GraphModuleTickResultV1 | undefined {
    this.alphaTarget = dragActive ? NATIVE_ACTIVE_DRAG_ALPHA : 0;
    if (dragActive && !this.dragWasActive) this.alpha = Math.max(this.alpha, NATIVE_ACTIVE_DRAG_ALPHA);
    this.dragWasActive = dragActive;
    this.accumulatorSeconds += Math.max(0, Math.min(0.25, deltaSeconds || FIXED_STEP_SECONDS));
    if (this.accumulatorSeconds + 1e-12 < FIXED_STEP_SECONDS) return { requestNextFrame: true };
    this.accumulatorSeconds = Math.min(
      FIXED_STEP_SECONDS - 1e-12,
      Math.max(0, this.accumulatorSeconds - FIXED_STEP_SECONDS),
    );
    let changed = false;
    {
      this.alpha += (this.alphaTarget - this.alpha) * this.settings.alphaDecay;
      this.applyD3Origin(state);
      this.applyD3Links(state);
      this.applyD3ManyBody();
      this.applyD3RegionAndComponentForces(state);
      this.applyAxialSpring();
      this.applyD3Collision(state.document);
      for (const node of state.document.nodes) {
        const velocity = this.velocities.get(node.id)!;
        if (this.pinned.has(node.id) || node.id === state.draggedNodeId) {
          velocity.x = 0; velocity.y = 0; velocity.z = 0;
          continue;
        }
        velocity.x *= 1 - this.settings.velocityDecay;
        velocity.y *= 1 - this.settings.velocityDecay;
        velocity.z = this.dimensions === '2d' ? 0 : velocity.z * (1 - this.settings.velocityDecay);
        clampVelocity(velocity, this.settings.maxSpeed, this.dimensions);
        const position = this.positions[node.id];
        const movement = Math.hypot(velocity.x, velocity.y, velocity.z);
        if (movement > 0.00001) changed = true;
        position.x += velocity.x;
        position.y += velocity.y;
        position.z = this.dimensions === '2d' ? 0 : position.z + velocity.z;
      }
    }
    if (!dragActive && this.alpha < this.settings.alphaMin) {
      this.running = false;
      this.alpha = 0;
      this.accumulatorSeconds = 0;
    }
    return {
      ...(changed ? { positions: this.positions } : {}),
      requestNextFrame: this.running,
    };
  }

  private applyD3Origin(state: GraphModulePipelineStateV1): void {
    const strength = this.settings.centeringStrength * this.alpha;
    for (const node of state.document.nodes) {
      const position = this.positions[node.id];
      const velocity = this.velocities.get(node.id)!;
      if (strength > 0) {
        velocity.x += -position.x * strength;
        velocity.y += -position.y * strength;
        if (this.dimensions === '3d') velocity.z += -position.z * strength;
      }
      const target = state.motionTargets?.nodePositions?.[node.id];
      const offset = state.motionTargets?.nodePositionOffsets?.[node.id];
      if (target) {
        const targetStrength = clampNumber(state.motionTargets?.nodePositionStrength, 0, 1, 0.1) * this.alpha;
        velocity.x += (target.x - position.x) * targetStrength;
        velocity.y += (target.y - position.y) * targetStrength;
        if (this.dimensions === '3d') velocity.z += (target.z - position.z) * targetStrength;
      } else if (offset) {
        const targetStrength = clampNumber(state.motionTargets?.nodePositionStrength, 0, 1, 0.1) * this.alpha;
        velocity.x += offset.x * targetStrength;
        velocity.y += offset.y * targetStrength;
        if (this.dimensions === '3d') velocity.z += offset.z * targetStrength;
      }
    }
  }

  private applyD3Links(state: GraphModulePipelineStateV1): void {
    const pairs = (this.topology?.pairs ?? []).filter((pair) => pair.affinity > 0).map((pair) => ({
      sourceId: pair.sourceId,
      targetId: pair.targetId,
      edgeIds: pair.edgeIds,
      parameters: deriveWeightedSpringParametersV1(pair, this.settings),
    }));
    const degree = new Map<string, number>();
    for (const pair of pairs) {
      degree.set(pair.sourceId, (degree.get(pair.sourceId) ?? 0) + 1);
      degree.set(pair.targetId, (degree.get(pair.targetId) ?? 0) + 1);
    }
    for (const pair of pairs) {
      if (pair.sourceId === pair.targetId) continue;
      const source = this.positions[pair.sourceId];
      const target = this.positions[pair.targetId];
      const sourceVelocity = this.velocities.get(pair.sourceId);
      const targetVelocity = this.velocities.get(pair.targetId);
      if (!source || !target || !sourceVelocity || !targetVelocity) continue;
      let dx = target.x + targetVelocity.x - source.x - sourceVelocity.x;
      let dy = target.y + targetVelocity.y - source.y - sourceVelocity.y;
      let dz = this.dimensions === '2d' ? 0 : target.z + targetVelocity.z - source.z - sourceVelocity.z;
      let length = Math.hypot(dx, dy, dz);
      if (length < 1e-6) {
        const jitter = deterministicDirection(pair.sourceId, pair.targetId, this.dimensions);
        dx = jitter.x * 1e-6; dy = jitter.y * 1e-6; dz = jitter.z * 1e-6;
        length = Math.hypot(dx, dy, dz);
      }
      const sourceDegree = Math.max(1, degree.get(pair.sourceId) ?? 1);
      const targetDegree = Math.max(1, degree.get(pair.targetId) ?? 1);
      const bias = sourceDegree / (sourceDegree + targetDegree);
      const declaredStrengths = pair.edgeIds
        .map((id) => state.motionTargets?.edgeStrengthScales?.[id])
        .filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0);
      const strength = pair.parameters.strength / Math.min(sourceDegree, targetDegree)
        * finiteNonNegative(declaredStrengths[0], 1)
        * finiteNonNegative(state.motionTargets?.linkStrengthScale, 1);
      const declaredLengths = pair.edgeIds
        .map((id) => state.motionTargets?.edgeLengths?.[id])
        .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
      const targetLength = (declaredLengths[0] ?? pair.parameters.targetLength)
        * finitePositive(state.motionTargets?.linkLengthScale, 1);
      const amount = (length - targetLength) / length * this.alpha * strength;
      dx *= amount; dy *= amount; dz *= amount;
      targetVelocity.x -= dx * bias; targetVelocity.y -= dy * bias; targetVelocity.z -= dz * bias;
      sourceVelocity.x += dx * (1 - bias); sourceVelocity.y += dy * (1 - bias); sourceVelocity.z += dz * (1 - bias);
      clampVelocity(sourceVelocity, this.settings.maxSpeed, this.dimensions);
      clampVelocity(targetVelocity, this.settings.maxSpeed, this.dimensions);
    }
  }

  private applyD3ManyBody(): void {
    const root = buildOctree(this.positions, this.dimensions);
    if (!root) return;
    const minimumSquared = this.settings.repulsionMinDistance ** 2;
    const thetaSquared = this.settings.barnesHutTheta ** 2;
    for (const [id, position] of Object.entries(this.positions)) {
      this.accumulateD3Repulsion(id, position, root, this.velocities.get(id)!, minimumSquared, thetaSquared);
    }
  }

  private accumulateD3Repulsion(
    id: string,
    position: Vec3,
    cell: OctreeNode,
    velocity: MutableVec3,
    minimumSquared: number,
    thetaSquared: number,
  ): void {
    if (cell.mass === 0 || (!cell.children && cell.bodyId === id)) return;
    let dx = position.x - cell.centerOfMass.x;
    let dy = position.y - cell.centerOfMass.y;
    let dz = this.dimensions === '2d' ? 0 : position.z - cell.centerOfMass.z;
    let squared = dx * dx + dy * dy + dz * dz;
    if (squared < 1e-12) {
      const direction = deterministicDirection(id, cell.bodyId ?? `cell:${cell.center.x}:${cell.center.y}:${cell.center.z}`, this.dimensions);
      dx = direction.x * 1e-6; dy = direction.y * 1e-6; dz = direction.z * 1e-6;
      squared = dx * dx + dy * dy + dz * dz;
    }
    const size = cell.halfSize * 2;
    if (!cell.children || size * size / squared < thetaSquared) {
      if (squared < minimumSquared) squared = Math.sqrt(minimumSquared * squared);
      const factor = this.settings.repulsionStrength * cell.mass * this.alpha / squared;
      velocity.x += dx * factor;
      velocity.y += dy * factor;
      velocity.z += dz * factor;
      clampVelocity(velocity, this.settings.maxSpeed, this.dimensions);
      return;
    }
    for (const child of cell.children) if (child) {
      this.accumulateD3Repulsion(id, position, child, velocity, minimumSquared, thetaSquared);
    }
  }

  private applyD3RegionAndComponentForces(state: GraphModulePipelineStateV1): void {
    for (const force of this.forces.values()) { force.x = 0; force.y = 0; force.z = 0; }
    this.applyRegionMembershipForces(state);
    this.applyComponentCentering();
    for (const node of state.document.nodes) {
      const force = this.forces.get(node.id)!;
      const velocity = this.velocities.get(node.id)!;
      velocity.x += force.x; velocity.y += force.y; velocity.z += force.z;
      clampVelocity(velocity, this.settings.maxSpeed, this.dimensions);
    }
  }

  private applyAxialSpring(): void {
    if (this.dimensions !== '3d' || this.settings.axialSpringAxis === 'off') return;
    const amount = this.settings.axialSpringStiffness * 0.1 * this.alpha;
    if (amount <= 0) return;
    const axis = this.settings.axialSpringAxis;
    for (const [nodeId, position] of Object.entries(this.positions)) {
      if (this.pinned.has(nodeId)) continue;
      const velocity = this.velocities.get(nodeId);
      if (!velocity) continue;
      velocity[axis] += -position[axis] * amount;
      clampVelocity(velocity, this.settings.maxSpeed, this.dimensions);
    }
  }

  private applyD3Collision(document: GraphDocumentV1): void {
    const radius = this.settings.collisionRadius;
    const minimum = radius * 2;
    if (radius <= 0 || this.settings.collisionStrength <= 0) return;
    const cells = new Map<string, string[]>();
    const predicted = new Map<string, Vec3>();
    for (const node of document.nodes) {
      const position = this.positions[node.id];
      const velocity = this.velocities.get(node.id)!;
      const next = { x: position.x + velocity.x, y: position.y + velocity.y, z: this.dimensions === '2d' ? 0 : position.z + velocity.z };
      predicted.set(node.id, next);
      const key = collisionCellKey(next, minimum, this.dimensions);
      const bucket = cells.get(key);
      if (bucket) bucket.push(node.id); else cells.set(key, [node.id]);
    }
    const offsets = collisionForwardOffsets(this.dimensions);
    for (const bucket of cells.values()) {
      for (let index = 0; index < bucket.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < bucket.length; otherIndex += 1) {
          this.applyCollisionPair(bucket[index], bucket[otherIndex], predicted, minimum);
        }
      }
      const anchor = predicted.get(bucket[0]);
      if (!anchor) continue;
      const cell = collisionCell(anchor, minimum);
      for (const offset of offsets) {
        const key = `${cell.x + offset.x}:${cell.y + offset.y}:${this.dimensions === '2d' ? 0 : cell.z + offset.z}`;
        const neighbor = cells.get(key);
        if (!neighbor) continue;
        for (const nodeId of bucket) for (const otherId of neighbor) {
          this.applyCollisionPair(nodeId, otherId, predicted, minimum);
        }
      }
    }
  }

  private applyCollisionPair(
    nodeId: string,
    otherId: string,
    predicted: ReadonlyMap<string, Vec3>,
    minimum: number,
  ): void {
    const a = predicted.get(nodeId)!;
    const b = predicted.get(otherId)!;
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = this.dimensions === '2d' ? 0 : a.z - b.z;
    let distance = Math.hypot(dx, dy, dz);
    if (distance >= minimum) return;
    if (distance < 1e-6) {
      const jitter = deterministicDirection(nodeId, otherId, this.dimensions);
      dx = jitter.x * 1e-6; dy = jitter.y * 1e-6; dz = jitter.z * 1e-6;
      distance = Math.hypot(dx, dy, dz);
    }
    const amount = (minimum - distance) / distance * this.settings.collisionStrength * 0.5;
    const av = this.velocities.get(nodeId)!;
    const bv = this.velocities.get(otherId)!;
    av.x += dx * amount; av.y += dy * amount; av.z += dz * amount;
    bv.x -= dx * amount; bv.y -= dy * amount; bv.z -= dz * amount;
    clampVelocity(av, this.settings.maxSpeed, this.dimensions);
    clampVelocity(bv, this.settings.maxSpeed, this.dimensions);
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
      physicalSpringCount: this.topology?.pairs.filter((pair) => pair.affinity > 0).length ?? 0,
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

  private reheatForChange(): void {
    this.alpha = Math.max(this.alpha, 0.3);
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
    repulsionStrength: finiteNonNegative(settings.repulsionStrength, 1000),
    springStrength: finiteNonNegative(settings.springStrength, 1),
    springLength: finitePositive(settings.springLength, 250),
    centeringStrength: finiteNonNegative(settings.centeringStrength, 0.1),
    velocityDecay: clampNumber(settings.velocityDecay ?? settings.damping, 0, 1, 0.4),
    alphaDecay: clampNumber(settings.alphaDecay, 0, 1, 0.02276277904418933),
    alphaMin: finitePositive(settings.alphaMin, 0.001),
    repulsionMinDistance: finitePositive(settings.repulsionMinDistance, 30),
    barnesHutTheta: finitePositive(settings.barnesHutTheta, 0.9),
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
    collisionRadius: finiteNonNegative(settings.collisionRadius, 60),
    collisionStrength: clampNumber(settings.collisionStrength, 0, 1, 0.5),
    axialSpringAxis: readAxialSpringAxis(settings.axialSpringAxis),
    axialSpringStiffness: clampNumber(settings.axialSpringStiffness, 0, 0.9, 0),
  };
}

function readAxialSpringAxis(value: JsonValue | undefined): GraphAxialSpringAxisV1 {
  return value === 'x' || value === 'y' || value === 'z' ? value : 'off';
}

function collisionCell(position: Vec3, size: number): { x: number; y: number; z: number } {
  return {
    x: Math.floor(position.x / size),
    y: Math.floor(position.y / size),
    z: Math.floor(position.z / size),
  };
}

function clampVelocity(velocity: MutableVec3, maxSpeed: number, dimensions: GraphDimensionsV1): void {
  if (![velocity.x, velocity.y, velocity.z].every(Number.isFinite)) {
    velocity.x = 0; velocity.y = 0; velocity.z = 0;
    return;
  }
  if (dimensions === '2d') velocity.z = 0;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (speed <= maxSpeed || speed === 0) return;
  const scale = maxSpeed / speed;
  velocity.x *= scale;
  velocity.y *= scale;
  velocity.z *= scale;
}

function collisionCellKey(position: Vec3, size: number, dimensions: GraphDimensionsV1): string {
  const cell = collisionCell(position, size);
  return `${cell.x}:${cell.y}:${dimensions === '2d' ? 0 : cell.z}`;
}

function collisionForwardOffsets(dimensions: GraphDimensionsV1): readonly Vec3[] {
  const values: Vec3[] = [];
  for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) {
    if (dimensions === '2d') {
      if (x > 0 || (x === 0 && y > 0)) values.push({ x, y, z: 0 });
    } else for (let z = -1; z <= 1; z += 1) {
      if (x > 0 || (x === 0 && y > 0) || (x === 0 && y === 0 && z > 0)) values.push({ x, y, z });
    }
  }
  return values;
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

function finiteCoordinate(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampNumber(value: JsonValue | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
