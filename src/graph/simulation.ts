import { CameraController } from './CameraController.ts';
import { GraphNode, GraphData, PhysicsSettings, Simulation } from '../shared/interfaces.ts';
import { getSettings } from '../settings/settingsStore.ts';
import type { ScreenPt } from "../shared/interfaces.ts";

export function createSimulation(
  graph: GraphData, 
  camera : CameraController, 
  getGravityCenter: () => ScreenPt | null
) : Simulation{
  // If center not provided, compute bounding-box center from node positions
  const nodes                       = graph.nodes;
  const edges                       = graph.edges;
  let running                       = false;  
  let pinnedNodes                   = new Set<string>(); // set of node ids that should be pinned (physics skip)
  const nodeById                    = new Map<string, GraphNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  

  ///////

  type OctNode = {
    cx: number; cy: number; cz: number; // cube center
    h: number;                          // half-size (cube half-width)

    mass: number;                       // number of bodies (or weighted)
    comX: number; comY: number; comZ: number; // center of mass

    body: GraphNode | null;             // if leaf with single body
    children: (OctNode | null)[] | null; // length 8 when subdivided
  };

  function makeOctNode(cx: number, cy: number, cz: number, h: number): OctNode {
    return {
      cx, cy, cz, h,
      mass: 0,
      comX: 0, comY: 0, comZ: 0,
      body: null,
      children: null,
    };
  }

  function childIndex(cell: OctNode, x: number, y: number, z: number): number {
    let idx = 0;
    if (x >= cell.cx) idx |= 1;
    if (y >= cell.cy) idx |= 2;
    if (z >= cell.cz) idx |= 4;
    return idx;
  }

  function ensureChildren(cell: OctNode): void {
    if (!cell.children) cell.children = new Array<OctNode | null>(8).fill(null);
  }

  function getOrCreateChild(cell: OctNode, idx: number): OctNode {
    ensureChildren(cell);

    let child = cell.children![idx];
    if (child) return child;

    const h2 = cell.h * 0.5;
    const ox = (idx & 1) ? h2 : -h2;
    const oy = (idx & 2) ? h2 : -h2;
    const oz = (idx & 4) ? h2 : -h2;

    child = makeOctNode(cell.cx + ox, cell.cy + oy, cell.cz + oz, h2);
    cell.children![idx] = child;
    return child;
  }


  function buildOctree(bodies: GraphNode[]): OctNode | null {
  if (!bodies.length) return null;

  // bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const n of bodies) {
    // If you ever allow NaN positions, guard here.
    if (n.location.x < minX) minX = n.location.x;
    if (n.location.y < minY) minY = n.location.y;
    if (n.location.z < minZ) minZ = n.location.z;

    if (n.location.x > maxX) maxX = n.location.x;
    if (n.location.y > maxY) maxY = n.location.y;
    if (n.location.z > maxZ) maxZ = n.location.z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;

  // cube half-size, padded
  const h = Math.max(dx, dy, dz) * 0.5 + 1e-3;

  const root = makeOctNode(cx, cy, cz, h);

  for (const b of bodies) {
    insertBody(root, b);
  }

  return root;
  }

  function insertBody(cell: OctNode, body: GraphNode): void {
    // update aggregate (mass + center of mass)
    const m0 = cell.mass;
    const m1 = m0 + 1;

    cell.comX = (cell.comX * m0 + body.location.x) / m1;
    cell.comY = (cell.comY * m0 + body.location.y) / m1;
    cell.comZ = (cell.comZ * m0 + body.location.z) / m1;
    cell.mass = m1;

    // If empty leaf: store body
    if (!cell.children && cell.body === null) {
      cell.body = body;
      return;
    }

    // If leaf with one body: subdivide, reinsert existing + new
    if (!cell.children && cell.body !== null) {
      const existing = cell.body;
      cell.body = null;
      ensureChildren(cell);

      // reinsert both
      insertIntoChild(cell, existing);
      insertIntoChild(cell, body);
      return;
    }

    // Otherwise, already subdivided
    insertIntoChild(cell, body);
  }

  function insertIntoChild(cell: OctNode, body: GraphNode): void {
    const idx = childIndex(cell, body.location.x, body.location.y, body.location.z);
    const child = getOrCreateChild(cell, idx);
    insertBody(child, body);
  }

  function applyRepulsionBarnesHut(physicsSettings: PhysicsSettings, root: OctNode): void {
    const strength = physicsSettings.repulsionStrength;

    // keep your existing "minimum separation" behavior
    const minDist = 40;
    const minDistSq = minDist * minDist;

    // BH tuning knobs (constants for now; you can expose later)
    const theta = 0.8;        // lower = more accurate; higher = faster (typical 0.5–1.2)
    const thetaSq = theta * theta;
    const eps = 1e-3;         // tiny softening to avoid 1/0

    for (const a of nodes) {
      if (pinnedNodes.has(a.id)) continue;
      accumulateBH(a, root, strength, thetaSq, minDistSq, eps);
    }
  }

  function accumulateBH(
    a: GraphNode,
    cell: OctNode,
    strength: number,
    thetaSq: number,
    minDistSq: number,
    eps: number
  ): void {
    if (cell.mass === 0) return;

    // If leaf with exactly this body, skip self
    if (!cell.children && cell.body === a) return;

    const dx = a.location.x - cell.comX;
    const dy = a.location.y - cell.comY;
    const dz = (a.location.z || 0) - (cell.comZ || 0);

    const distSqRaw = dx * dx + dy * dy + dz * dz + eps;

    // opening criterion: (size / distance)^2 < theta^2
    // size = cell width = 2h
    const size = cell.h * 2;
    const sizeSq = size * size;

    const isFarEnough = !cell.children || (sizeSq / distSqRaw) < thetaSq;

    if (isFarEnough) {
      // Match your naive force shape:
      // force = strength / max(dist, minDist)^2, direction normalized by dist
      const distSq = Math.max(distSqRaw, minDistSq);
      const dist = Math.sqrt(distSqRaw); // use raw dist for direction normalization
      const safeDist = dist > 0 ? dist : 1e-3;

      const force = (strength * cell.mass) / distSq;
      const fx = (dx / safeDist) * force;
      const fy = (dy / safeDist) * force;
      const fz = (dz / safeDist) * force;

      a.velocity.vx = (a.velocity.vx || 0) + fx;
      a.velocity.vy = (a.velocity.vy || 0) + fy;
      a.velocity.vz = (a.velocity.vz || 0) + fz;
      return;
    }

    // else recurse
    const kids = cell.children;
    if (!kids) return;

    for (let i = 0; i < 8; i++) {
      const c = kids[i];
      if (c) accumulateBH(a, c, strength, thetaSq, minDistSq, eps);
    }
  }


  ///////

  function setPinnedNodes(ids: Set<string>) {
    // create new Set to avoid external mutations
    pinnedNodes = new Set(ids);
  }

  function applyMouseGravity(physicsSettings: PhysicsSettings) {
    if (!physicsSettings.mouseGravityEnabled) return;

    const mousePos = getGravityCenter(); 
    if (!mousePos) return;
    const { x: mouseX, y: mouseY } = mousePos;

    // Radius in pixels on screen
    const radius    = physicsSettings.mouseGravityRadius; 
    const strength  = physicsSettings.mouseGravityStrength;

    for (const node of nodes) {
        if (pinnedNodes.has(node.id)) continue;

        // 1. Where is the node on screen?
        const nodePos = camera.worldToScreen(node);

        // Skip if behind camera
        if (nodePos.depth < 0) continue; 

        // 2. Distance check (Screen Space 2D)
        const dx = mouseX - nodePos.x;
        const dy = mouseY - nodePos.y;
        const distSq = dx * dx + dy * dy;

        // If outside the interaction radius, skip
        if (distSq > radius * radius) continue;

        // 3. Calculate "Ideal" World Position
        // We want the node to move to the position (x,y,z) that corresponds 
        // to the mouse's screen coordinates, BUT at the node's current depth.
        // This ensures the pull is purely "visual" relative to the camera angle.
        const targetWorld = camera.screenToWorld(mouseX, mouseY, nodePos.depth);

        // 4. Calculate Vector in World Space
        const wx = targetWorld.x - node.location.x;
        const wy = targetWorld.y - node.location.y;
        const wz = targetWorld.z - node.location.z;

        // 5. Apply Force
        const dist = Math.sqrt(wx*wx + wy*wy + wz*wz) + 1e-6;
        const maxBoost = 1 / (node.radius);

        // aggressive near the target (asymptote-ish), capped
        const boost = Math.min(maxBoost, 1 / (dist*dist)); // or 1/(dist*dist)

        // effective strength
        const k = strength * boost;

        node.velocity.vx += wx * k;
        node.velocity.vy += wy * k;
        node.velocity.vz += wz * k;

    }
  }

  function applyRepulsion(physicsSettings: PhysicsSettings) {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.location.x - b.location.x;
        let dy = a.location.y - b.location.y;
        let dz = (a.location.z || 0) - (b.location.z || 0);
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq === 0) distSq = 0.0001;
        const dist = Math.sqrt(distSq);
        // minimum separation to avoid extreme forces
        const minDist = 40;
        const effectiveDist = Math.max(dist, minDist);
        const force = physicsSettings.repulsionStrength / (effectiveDist * effectiveDist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;
        if (!pinnedNodes.has(a.id)) {
          a.velocity.vx = (a.velocity.vx || 0) + fx;
          a.velocity.vy = (a.velocity.vy || 0) + fy;
          a.velocity.vz = (a.velocity.vz || 0) + fz;
        }
        if (!pinnedNodes.has(b.id)) {
          b.velocity.vx = (b.velocity.vx || 0) - fx;
          b.velocity.vy = (b.velocity.vy || 0) - fy;
          b.velocity.vz = (b.velocity.vz || 0) - fz;
        }
      }
    }
  }

  function applySprings(physicsSettings: PhysicsSettings) {
    if (!edges) return;
    for (const e of edges) {
      const a = nodeById.get(e.sourceId);
      const b = nodeById.get(e.targetId);
      if (!a || !b) continue;
      const dx = (b.location.x - a.location.x);
      const dy = (b.location.y - a.location.y);
      const dz = ((b.location.z || 0) - (a.location.z || 0));
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const displacement = dist - (physicsSettings.edgeLength || 0);
      const f = (physicsSettings.edgeStrength || 0) * Math.tanh(displacement / 50);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      const fz = (dz / dist) * f;
      if (!pinnedNodes.has(a.id)) {
        a.velocity.vx = (a.velocity.vx || 0) + fx;
        a.velocity.vy = (a.velocity.vy || 0) + fy;
        a.velocity.vz = (a.velocity.vz || 0) + fz;
      }
      if (!pinnedNodes.has(b.id)) {
        b.velocity.vx = (b.velocity.vx || 0) - fx;
        b.velocity.vy = (b.velocity.vy || 0) - fy;
        b.velocity.vz = (b.velocity.vz || 0) - fz;
      }
    }
  }

  function applyCenteringForce(physicsSettings: PhysicsSettings) {
    if (physicsSettings.centerPull <= 0) return;
    const cx = physicsSettings.worldCenterX;
    const cy = physicsSettings.worldCenterY;
    const cz = physicsSettings.worldCenterZ;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      const dx = (cx - n.location.x);
      const dy = (cy - n.location.y);
      const dz = (cz - n.location.z);
      n.velocity.vx = (n.velocity.vx || 0) + dx * physicsSettings.centerPull;
      n.velocity.vy = (n.velocity.vy || 0) + dy * physicsSettings.centerPull;
      n.velocity.vz = (n.velocity.vz || 0) + dz * physicsSettings.centerPull;
    }
  }

  function applyDamping(physicsSettings: PhysicsSettings) {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
        const d = Math.max(0, Math.min(1, physicsSettings.damping));
        n.velocity.vx = (n.velocity.vx ?? 0) * (1 - d);
        n.velocity.vy = (n.velocity.vy ?? 0) * (1 - d);
        n.velocity.vz = (n.velocity.vz ?? 0) * (1 - d);
      if (Math.abs(n.velocity.vx) < 0.001) n.velocity.vx = 0;
      if (Math.abs(n.velocity.vy) < 0.001) n.velocity.vy = 0;
      if (Math.abs(n.velocity.vz) < 0.001) n.velocity.vz = 0;
    }
  }

  function applyPlaneConstraints(physicsSettings: PhysicsSettings) {
    const noteK = physicsSettings.notePlaneStiffness;
    const tagK  = physicsSettings.tagPlaneStiffness;
    if (noteK === 0 && tagK === 0) return;
    // Pull notes/tags toward the simulation center (not always world origin)
    const targetZ = physicsSettings.worldCenterZ;
    const targetX = physicsSettings.worldCenterX;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      if (isNote(n) && noteK > 0) {
        const dz = targetZ - n.location.z;
        n.velocity.vz = (n.velocity.vz || 0) + dz * noteK;
      } else if (isTag(n) && tagK > 0) {
        const dx = (targetX) - (n.location.x || 0);
        n.velocity.vx = (n.velocity.vx || 0) + dx * tagK;
      }
    }
  }

  function integrate(dt: number) {
    const scale = dt * 60;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      n.location.x += (n.velocity.vx || 0) * scale;
      n.location.y += (n.velocity.vy || 0) * scale;
      n.location.z = (n.location.z || 0) + (n.velocity.vz || 0) * scale;
      // optional gentle hard clamp epsilon
      //if (isNote(n) && Math.abs(n.location.z) < 0.0001) n.location.z = 0;
      if (isTag(n) && Math.abs(n.location.x) < 0.0001) n.location.x = 0;
    }
  }

  function start() {
    running = true;
  }

  function stop() {
    running = false;
  }

  function reset() {
    for (const n of nodes) {
      n.velocity.vx = 0;
      n.velocity.vy = 0;
    }
  }

  // Type guards
  function isTag(n: GraphNode): boolean {
    return n.type === "tag";
  }

  function isNote(n: GraphNode): boolean {
    return n.type === "note";
  }

  function tick(dt: number) {
    if (!running) return;
    if (!nodes.length) return;

    const settings = getSettings();
    const physicsSettings = settings.physics;
    
    // Build tree from all nodes (including pinned nodes is fine; they still repel others)
    // If you DON'T want pinned nodes to contribute to repulsion, filter them out here.
    const root = buildOctree(nodes);
    if (!root) return;


    //applyRepulsion(physicsSettings); O(N^2) old method
    applyRepulsionBarnesHut(physicsSettings, root);
    applySprings(physicsSettings);
    applyMouseGravity(physicsSettings);

    applyCenteringForce(physicsSettings);
    applyPlaneConstraints(physicsSettings);

    applyDamping(physicsSettings);
    integrate(dt);
  }

  return { start, stop, tick, reset, setPinnedNodes };

}
