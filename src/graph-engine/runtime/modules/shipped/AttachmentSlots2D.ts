import type { GraphAttachmentSlotsStateV1, GraphEdgeAttachmentStatusV1, GraphNodeAttachmentV1, Vec3 } from '../../../contracts/v1/index.ts';
import { angularSpringStiffnessV1, connectionAngleErrorsV1 } from './ConnectionAngles.ts';

const TAU = Math.PI * 2;
const TOLERANCE = 1e-6;
type Point = { x: number; y: number; z: number };
type Positions = Record<string, Point>;
type Assignment = { edgeId: string; slot: number | null };
type Owner = { count: number; phase: number; locked: boolean; bindings: Map<string, number>; assignments: Map<string, Assignment> };
export type AttachmentEndpoint2D = { edgeId: string; ownerId: string; neighborId: string; endpoint: 'source' | 'target'; slot?: number | null };
type Binding = { ownerId: string; neighborId: string; slot: number };
export type AttachmentSpring2D = Binding & { error: number; stiffness: number };
export const wrapAttachmentAngle2D = (angle: number) => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** Stateful, finite-capacity bindings. Node declarations remain authoritative. */
export class AttachmentSlots2D {
  private owners = new Map<string, Owner>();
  private patterns: ReadonlyMap<string, GraphNodeAttachmentV1> = new Map();
  private feasiblePositions = new Map<string, Point>();
  private feasiblePhases = new Map<string, number>();
  private endpoints: readonly AttachmentEndpoint2D[] = [];
  private requestedEndpoints: readonly AttachmentEndpoint2D[] = [];
  private endpointGroups = new Map<string, Map<string, AttachmentEndpoint2D[]>>();
  rejectedBindings = 0;
  blockedMoves = 0;

  get hasLocks(): boolean { return [...this.owners.values()].some(owner => owner.locked && owner.bindings.size > 0); }

  prepare(
    patterns: ReadonlyMap<string, GraphNodeAttachmentV1>,
    neighbors: ReadonlyMap<string, readonly string[]>,
    positions: Positions,
    mobile: (id: string) => boolean,
    endpoints: readonly AttachmentEndpoint2D[] = [],
  ): AttachmentSpring2D[] {
    this.patterns = patterns;
    if (this.endpoints !== endpoints) {
      this.endpoints = endpoints;
      this.requestedEndpoints = endpoints.filter(endpoint => endpoint.slot !== undefined);
      this.endpointGroups.clear();
      for (const endpoint of endpoints) {
        if (endpoint.ownerId === endpoint.neighborId) continue;
        const owner = this.endpointGroups.get(endpoint.ownerId) ?? new Map<string, AttachmentEndpoint2D[]>();
        const group = owner.get(endpoint.neighborId) ?? [];
        group.push(endpoint); owner.set(endpoint.neighborId, group); this.endpointGroups.set(endpoint.ownerId, owner);
      }
      for (const owner of this.endpointGroups.values()) for (const group of owner.values()) group.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    }
    for (const id of this.owners.keys()) if (!patterns.has(id) || !positions[id]) this.owners.delete(id);
    const pending: Binding[] = [];
    const released = new Set<string>();
    for (const [id, pattern] of [...patterns].sort(([a], [b]) => a.localeCompare(b))) {
      const origin = positions[id];
      if (!origin) continue;
      const count = pattern.count ?? 1;
      const connected = (neighbors.get(id) ?? []).filter(neighbor => positions[neighbor]);
      const linked = connected.filter(neighbor => distance(origin, positions[neighbor]) > 1e-6);
      let owner = this.owners.get(id);
      if (!owner || owner.count !== count) {
        const angles = linked.map(neighbor => direction(origin, positions[neighbor]));
        const errors = connectionAngleErrorsV1(angles, { count });
        owner = { count, phase: angles.length ? angles[0] - errors[0] : 0, locked: false, bindings: new Map(), assignments: new Map() };
        this.owners.set(id, owner);
      }
      const available = new Set(connected);
      for (const neighbor of owner.bindings.keys()) if (!available.has(neighbor)) owner.bindings.delete(neighbor);
      this.synchronizeAssignments(id, owner);
      this.updatePhase(id, owner, positions);
      const locked = pattern.rigidity === 'locked';
      if (locked && !owner.locked) {
        for (const [neighborId, slot] of owner.bindings) pending.push({ ownerId: id, neighborId, slot });
        owner.bindings.clear();
      }
      owner.locked = locked;
      if (!locked) {
        const spacing = TAU / count;
        const stop = Math.max((pattern.openingDegrees ?? 0) * Math.PI / 360,
          spacing * (0.22 + 0.27 * angularSpringStiffnessV1(pattern)));
        for (const [neighbor, slot] of owner.bindings) {
          if (owner.assignments.has(neighbor)) continue;
          if (Math.abs(wrapAttachmentAngle2D(direction(origin, positions[neighbor]) - owner.phase - slot * spacing)) > stop) {
            owner.bindings.delete(neighbor);
            released.add(`${id}\0${neighbor}`);
          }
        }
      }
    }
    // Retained locks have priority over new binding requests.
    this.enforce(positions, mobile);
    for (const binding of pending) this.admit(binding, positions, mobile);
    // Persistent explicit requests precede automatic capture and reserve vacant slots.
    for (const [ownerId, owner] of [...this.owners].sort(([a], [b]) => a.localeCompare(b))) {
      for (const [neighborId, assignment] of [...owner.assignments].sort(([, a], [, b]) => a.edgeId.localeCompare(b.edgeId))) {
        if (assignment.slot === null || assignment.slot >= owner.count || !positions[neighborId]
          || distance(positions[ownerId], positions[neighborId]) <= 1e-6) continue;
        this.admit({ ownerId, neighborId, slot: assignment.slot }, positions, mobile);
      }
    }
    for (const [id, owner] of [...this.owners].sort(([a], [b]) => a.localeCompare(b))) {
      const origin = positions[id];
      const spacing = TAU / owner.count;
      const reserved = new Set([...owner.assignments.values()].flatMap(assignment =>
        assignment.slot !== null && assignment.slot < owner.count ? [assignment.slot] : []));
      const candidates = (neighbors.get(id) ?? []).filter(neighbor => positions[neighbor]
        && !owner.assignments.has(neighbor) && !owner.bindings.has(neighbor) && !released.has(`${id}\0${neighbor}`)
        && distance(origin, positions[neighbor]) > 1e-6)
        .map(neighborId => ({ neighborId, angle: direction(origin, positions[neighborId]) }))
        .sort((a, b) => Math.abs(wrapAttachmentAngle2D((a.angle - owner.phase) * owner.count) / owner.count)
          - Math.abs(wrapAttachmentAngle2D((b.angle - owner.phase) * owner.count) / owner.count) || a.neighborId.localeCompare(b.neighborId));
      for (const candidate of candidates) {
        if (owner.bindings.size >= owner.count) break;
        const occupied = new Set(owner.bindings.values());
        const nearest = Math.round(wrapAttachmentAngle2D(candidate.angle - owner.phase) / spacing);
        let slot: number | undefined;
        // Search only as far as existing occupants; never allocate an array of count slots.
        for (let offset = 0; offset <= occupied.size + reserved.size && offset < owner.count && slot === undefined; offset++) {
          for (const step of offset ? [offset, -offset] : [0]) {
            const index = ((nearest + step) % owner.count + owner.count) % owner.count;
            if (!occupied.has(index) && !reserved.has(index)) { slot = index; break; }
          }
        }
        if (slot === undefined) continue;
        if (!owner.locked && Math.abs(wrapAttachmentAngle2D(candidate.angle - owner.phase - slot * spacing)) > spacing * 0.18) continue;
        this.admit({ ownerId: id, neighborId: candidate.neighborId, slot }, positions, mobile);
      }
    }
    this.enforce(positions, mobile);
    const springs: AttachmentSpring2D[] = [];
    for (const [ownerId, owner] of this.owners) {
      if (owner.locked) continue;
      const pattern = patterns.get(ownerId)!;
      const halfOpening = (pattern.openingDegrees ?? 0) * Math.PI / 360;
      for (const [neighborId, slot] of owner.bindings) {
        const delta = wrapAttachmentAngle2D(direction(positions[ownerId], positions[neighborId]) - owner.phase - slot * TAU / owner.count);
        springs.push({ ownerId, neighborId, slot,
          error: Math.sign(delta) * Math.max(0, Math.abs(delta) - halfOpening), stiffness: angularSpringStiffnessV1(pattern) });
      }
    }
    return springs;
  }

  private synchronizeAssignments(id: string, owner: Owner): void {
    const groups = this.endpointGroups.get(id);
    for (const neighbor of owner.assignments.keys()) {
      if (!groups?.get(neighbor)?.some(endpoint => endpoint.slot !== undefined)) owner.assignments.delete(neighbor);
    }
    for (const [neighbor, group] of groups ?? []) {
      const requests = group.filter(endpoint => endpoint.slot !== undefined);
      if (!requests.length) continue;
      const previous = owner.assignments.get(neighbor);
      const request = requests.find(endpoint => endpoint.edgeId === previous?.edgeId) ?? requests[0];
      const slot = request.slot as number | null;
      if (previous ? previous.edgeId !== request.edgeId || previous.slot !== slot : owner.bindings.get(neighbor) !== slot) {
        // Changing this link's explicit request is an intentional endpoint reconfiguration.
        owner.bindings.delete(neighbor);
      }
      owner.assignments.set(neighbor, { edgeId: request.edgeId, slot });
      if (slot === null || slot >= owner.count) owner.bindings.delete(neighbor);
    }
  }

  private requestStatuses(): GraphEdgeAttachmentStatusV1[] {
    return this.requestedEndpoints.map(endpoint => {
      const owner = this.owners.get(endpoint.ownerId);
      const requestedSlot = endpoint.slot as number | null;
      const selected = owner?.assignments.get(endpoint.neighborId);
      let status: GraphEdgeAttachmentStatusV1['status'];
      if (!owner || endpoint.ownerId === endpoint.neighborId) status = 'inactive';
      else if (selected?.slot !== requestedSlot) status = 'conflicting';
      else if (requestedSlot === null) status = 'free';
      else if (requestedSlot >= owner.count) status = 'out-of-range';
      else if (owner.bindings.get(endpoint.neighborId) === requestedSlot) status = 'bound';
      else if ([...owner.bindings.values()].includes(requestedSlot)) status = 'occupied';
      else status = 'unbound';
      return { edgeId: endpoint.edgeId, endpoint: endpoint.endpoint, ownerId: endpoint.ownerId,
        neighborId: endpoint.neighborId, requestedSlot, status };
    });
  }

  private updatePhase(id: string, owner: Owner, positions: Positions): void {
    const orientation = this.patterns.get(id)?.orientation;
    if (orientation && orientation.mode !== 'free') {
      // 2D uses the quaternion's Z twist. Future 3D uses the full quaternion.
      const q = orientation.rotation;
      const target = Math.hypot(q.z, q.w) > 1e-10 ? 2 * Math.atan2(q.z, q.w) : 0;
      owner.phase = orientation.mode === 'locked' ? target
        : owner.phase + wrapAttachmentAngle2D(target - owner.phase) * (orientation.stiffness ?? 0.3) * 0.2;
    } else owner.phase = fitPhase(id, owner, positions, owner.phase);
  }

  private admit(binding: Binding, positions: Positions, mobile: (id: string) => boolean): void {
    const owner = this.owners.get(binding.ownerId)!;
    if (owner.bindings.has(binding.neighborId) || [...owner.bindings.values()].includes(binding.slot)) return;
    owner.bindings.set(binding.neighborId, binding.slot);
    if (owner.locked && !this.solve(positions, mobile)) {
      owner.bindings.delete(binding.neighborId);
      this.rejectedBindings++;
    }
  }

  /** Project positions onto accepted locks. Incompatible external moves are vetoed, not unlocked. */
  enforce(positions: Positions, mobile: (id: string) => boolean): number {
    if (!this.hasLocks) { this.feasiblePositions.clear(); this.feasiblePhases.clear(); return 0; }
    const ids = new Set(this.lockedIds());
    for (const id of this.feasiblePositions.keys()) if (!ids.has(id)) this.feasiblePositions.delete(id);
    for (const id of this.feasiblePhases.keys()) if (!this.owners.get(id)?.locked || !this.owners.get(id)?.bindings.size) this.feasiblePhases.delete(id);
    const before = new Map([...ids].map(id => [id, { ...positions[id] }]));
    if (!this.solve(positions, mobile)) {
      this.blockedMoves++;
      for (const [id, point] of this.feasiblePositions) if (positions[id]) Object.assign(positions[id], point);
      for (const [id, phase] of this.feasiblePhases) { const owner = this.owners.get(id); if (owner) owner.phase = phase; }
    }
    let movement = 0;
    for (const id of this.lockedIds()) {
      const point = positions[id];
      if (!point) continue;
      movement = Math.max(movement, distance(point, before.get(id) ?? point));
      this.feasiblePositions.set(id, { ...point });
    }
    for (const [id, owner] of this.owners) if (owner.locked) this.feasiblePhases.set(id, owner.phase);
    return movement;
  }

  private lockedIds(): string[] {
    const ids = new Set<string>();
    for (const [id, owner] of this.owners) if (owner.locked) for (const neighbor of owner.bindings.keys()) { ids.add(id); ids.add(neighbor); }
    return [...ids];
  }

  private solve(positions: Positions, mobile: (id: string) => boolean): boolean {
    const hard = [...this.owners].filter(([, owner]) => owner.locked && owner.bindings.size);
    if (!hard.length) return true;
    const work: Positions = Object.create(null) as Positions;
    for (const id of this.lockedIds()) { if (!positions[id]) return false; work[id] = { ...positions[id] }; }
    const phases = new Map(hard.map(([id, owner]) => [id, owner.phase]));
    let valid = false;
    for (let iteration = 0; iteration < 96; iteration++) {
      for (const [id, owner] of hard) {
        if ((this.patterns.get(id)?.orientation?.mode ?? 'free') === 'free') phases.set(id, fitPhase(id, owner, work, phases.get(id)!));
        const phase = phases.get(id)!;
        for (const [neighbor, slot] of owner.bindings) {
          const a = work[id], b = work[neighbor];
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          const angle = phase + slot * TAU / owner.count;
          const dx = r * Math.cos(angle) - (b.x - a.x), dy = r * Math.sin(angle) - (b.y - a.y);
          const ma = Number(mobile(id)), mb = Number(mobile(neighbor)), mobility = ma + mb;
          if (!mobility) continue;
          a.x -= dx * ma / mobility; a.y -= dy * ma / mobility;
          b.x += dx * mb / mobility; b.y += dy * mb / mobility;
        }
      }
      valid = hard.every(([id, owner]) => [...owner.bindings].every(([neighbor, slot]) => {
        const a = work[id], b = work[neighbor];
        return distance(a, b) > 1e-6 && Math.abs(wrapAttachmentAngle2D(direction(a, b) - phases.get(id)! - slot * TAU / owner.count)) <= TOLERANCE;
      }));
      if (valid) break;
    }
    if (!valid || Object.values(work).some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
    for (const [id, point] of Object.entries(work)) Object.assign(positions[id], point);
    for (const [id, phase] of phases) this.owners.get(id)!.phase = phase;
    return true;
  }

  /** Remove velocities that immediately fight a hard angular constraint; radial motion remains free. */
  constrainVelocities(positions: Positions, velocities: Map<string, Point>, mobile: (id: string) => boolean): void {
    for (const [id, owner] of this.owners) {
      if (!owner.locked || !owner.bindings.size) continue;
      const rates = [...owner.bindings].map(([neighbor]) => {
        const a = positions[id], b = positions[neighbor], va = velocities.get(id)!, vb = velocities.get(neighbor)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        return (dx * (vb.y - va.y) - dy * (vb.x - va.x)) / Math.max(1e-12, dx * dx + dy * dy);
      });
      const free = (this.patterns.get(id)?.orientation?.mode ?? 'free') === 'free';
      const rate = free ? rates.reduce((sum, value) => sum + value, 0) / rates.length : 0;
      for (const [neighbor] of owner.bindings) {
        const a = positions[id], b = positions[neighbor], va = velocities.get(id)!, vb = velocities.get(neighbor)!;
        const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
        const ma = Number(mobile(id)), mb = Number(mobile(neighbor)), mobility = ma + mb;
        if (!mobility || squared < 1e-12) continue;
        const excess = ((dx * (vb.y - va.y) - dy * (vb.x - va.x)) / squared - rate) / mobility;
        va.x -= dy * excess * ma; va.y += dx * excess * ma;
        vb.x += dy * excess * mb; vb.y -= dx * excess * mb;
      }
    }
  }

  snapshot(): GraphAttachmentSlotsStateV1 {
    const requests = this.requestStatuses();
    return { version: 1, ...(requests.length ? { requests } : {}), owners: Object.fromEntries([...this.owners].map(([id, owner]) => [id, {
      count: owner.count, phaseRadians: owner.phase,
      bindings: [...owner.bindings].map(([neighborId, slot]) => {
        const edgeIds = this.endpointGroups.get(id)?.get(neighborId)?.map(endpoint => endpoint.edgeId);
        return { neighborId, slot, ...(edgeIds?.length ? { edgeIds } : {}) };
      }),
      ...(owner.assignments.size ? { assignments: [...owner.assignments].map(([neighborId, assignment]) => ({ neighborId, ...assignment })) } : {}),
    }])) };
  }

  restore(value: unknown): void {
    this.clear();
    if (!record(value) || value.version !== 1 || !record(value.owners)) return;
    for (const [id, entry] of Object.entries(value.owners)) {
      if (!record(entry) || typeof entry.count !== 'number' || !Number.isSafeInteger(entry.count) || entry.count < 2
        || typeof entry.phaseRadians !== 'number' || !Number.isFinite(entry.phaseRadians) || !Array.isArray(entry.bindings)) continue;
      const bindings = new Map<string, number>(), slots = new Set<number>();
      let valid = true;
      for (const binding of entry.bindings as unknown[]) {
        if (!record(binding) || typeof binding.neighborId !== 'string' || !binding.neighborId || binding.neighborId === id
          || typeof binding.slot !== 'number' || !Number.isSafeInteger(binding.slot) || binding.slot < 0 || binding.slot >= entry.count
          || slots.has(binding.slot) || bindings.has(binding.neighborId)) { valid = false; break; }
        slots.add(binding.slot); bindings.set(binding.neighborId, binding.slot);
      }
      const assignments = new Map<string, Assignment>();
      if (entry.assignments !== undefined) {
        if (!Array.isArray(entry.assignments)) valid = false;
        else for (const assignment of entry.assignments as unknown[]) {
          if (!record(assignment) || typeof assignment.neighborId !== 'string' || !assignment.neighborId
            || typeof assignment.edgeId !== 'string' || !assignment.edgeId || assignments.has(assignment.neighborId)
            || !(assignment.slot === null || typeof assignment.slot === 'number' && Number.isSafeInteger(assignment.slot) && assignment.slot >= 0)) { valid = false; break; }
          assignments.set(assignment.neighborId, { edgeId: assignment.edgeId, slot: assignment.slot });
        }
      }
      if (valid) this.owners.set(id, { count: entry.count, phase: entry.phaseRadians, locked: false, bindings, assignments });
    }
  }

  clear(): void { this.owners.clear(); this.feasiblePositions.clear(); this.feasiblePhases.clear(); this.endpoints = []; this.requestedEndpoints = []; this.endpointGroups.clear(); }
}

function direction(a: Vec3, b: Vec3): number { return Math.atan2(b.y - a.y, b.x - a.x); }
function distance(a: Vec3, b: Vec3): number { return Math.hypot(b.x - a.x, b.y - a.y); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fitPhase(id: string, owner: Owner, positions: Positions, fallback: number): number {
  let x = 0, y = 0;
  for (const [neighbor, slot] of owner.bindings) {
    const angle = direction(positions[id], positions[neighbor]) - slot * TAU / owner.count;
    x += Math.cos(angle); y += Math.sin(angle);
  }
  return Math.hypot(x, y) > 1e-10 ? Math.atan2(y, x) : fallback;
}
