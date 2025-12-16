import { GraphNode, GraphData, PhysicsSettings, LayoutMode } from '../utilities/interfaces.ts';
import { getSettings } from '../utilities/settingsStore.ts';


export function createSimulation(graph: GraphData) {
  // If center not provided, compute bounding-box center from node positions
  let centerNode: GraphNode | null  = null;
  if(graph.centerNode) {centerNode = graph.centerNode;}
  const nodes                       = graph.nodes;
  const edges                       = graph.edges;
  let running                       = false;

  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  // set of node ids that should be pinned (physics skip)
  let pinnedNodes = new Set<string>();

  function applyRepulsion(physicsSettings: PhysicsSettings) {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = (a.z || 0) - (b.z || 0);
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
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          a.vz = (a.vz || 0) + fz;
        }
        if (!pinnedNodes.has(b.id)) {
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
          b.vz = (b.vz || 0) - fz;
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
      const dx = (b.x - a.x);
      const dy = (b.y - a.y);
      const dz = ((b.z || 0) - (a.z || 0));
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const displacement = dist - (physicsSettings.springLength || 0);
      const f = (physicsSettings.springStrength || 0) * Math.tanh(displacement / 50);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      const fz = (dz / dist) * f;
      if (!pinnedNodes.has(a.id)) {
        a.vx = (a.vx || 0) + fx;
        a.vy = (a.vy || 0) + fy;
        a.vz = (a.vz || 0) + fz;
      }
      if (!pinnedNodes.has(b.id)) {
        b.vx = (b.vx || 0) - fx;
        b.vy = (b.vy || 0) - fy;
        b.vz = (b.vz || 0) - fz;
      }
    }
  }

  function applyCentering() {
    const settings = getSettings();
    if (settings.physics.centerPull <= 0) return;
    const cx = settings.physics.worldCenterX;
    const cy = settings.physics.worldCenterY;
    const cz = settings.physics.worldCenterZ;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      const dx = (cx - n.x);
      const dy = (cy - n.y);
      const dz = (cz - n.z);
      n.vx = (n.vx || 0) + dx * settings.physics.centerPull;
      n.vy = (n.vy || 0) + dy * settings.physics.centerPull;
      n.vz = (n.vz || 0) + dz * settings.physics.centerPull;
    }
    if (centerNode) {
      const dx = settings.physics.worldCenterX - centerNode.x;
      const dy = settings.physics.worldCenterY - centerNode.y;
      const dz = settings.physics.worldCenterZ - centerNode.z;
      centerNode.vx = (centerNode.vx || 0) + dx * settings.physics.centerPull * 0.5;
      centerNode.vy = (centerNode.vy || 0) + dy * settings.physics.centerPull * 0.5;
      centerNode.vz = (centerNode.vz || 0) + dz * settings.physics.centerPull * 0.5;
    }
  }

  function applyDamping() {
    const settings = getSettings();
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
        const d = Math.max(0, Math.min(1, settings.physics.damping));
        n.vx = (n.vx ?? 0) * (1 - d);
        n.vy = (n.vy ?? 0) * (1 - d);
        n.vz = (n.vz ?? 0) * (1 - d);
      if (Math.abs(n.vx) < 0.001) n.vx = 0;
      if (Math.abs(n.vy) < 0.001) n.vy = 0;
      if (Math.abs(n.vz) < 0.001) n.vz = 0;
    }
  }

  function applyPlaneConstraints() {
    const settings = getSettings();
    const noteK = settings.physics.notePlaneStiffness;
    const tagK  = settings.physics.tagPlaneStiffness;
    if (noteK === 0 && tagK === 0) return;
    // Pull notes/tags toward the simulation center (not always world origin)
    const targetZ = settings.physics.worldCenterZ;
    const targetX = settings.physics.worldCenterX;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      if (isNote(n) && noteK > 0) {
        const dz = targetZ - n.z;
        n.vz = (n.vz || 0) + dz * noteK;
      } else if (isTag(n) && tagK > 0) {
        const dx = (targetX) - (n.x || 0);
        n.vx = (n.vx || 0) + dx * tagK;
      }
    }
  }

  function applyCenterNodeLock() {
    const settings = getSettings();
    const cx = settings.physics.worldCenterX;
    const cy = settings.physics.worldCenterY;
    const cz = settings.physics.worldCenterZ;
    for (const n of nodes) {
      if (isCenterNode(n)) {
        n.x = cx; n.y = cy; n.z = cz;
        n.vx = 0; n.vy = 0; n.vz = 0;
      }
    }
  }

  function integrate(dt: number) {
    const scale = dt * 60;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      n.x += (n.vx || 0) * scale;
      n.y += (n.vy || 0) * scale;
      n.z = (n.z || 0) + (n.vz || 0) * scale;
      // optional gentle hard clamp epsilon
      //if (isNote(n) && Math.abs(n.z) < 0.0001) n.z = 0;
      if (isTag(n) && Math.abs(n.x) < 0.0001) n.x = 0;
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
      n.vx = 0;
      n.vy = 0;
    }
  }

  return { start, stop, tick, reset };


  // Type guards
  function isTag(n: GraphNode): boolean {
    return n.type === "tag";
  }

  function isNote(n: GraphNode): boolean {
    return n.type === "note";
  }

  function isCenterNode(n: GraphNode): n is GraphNode & { isCenterNode: true } {
    return n === graph.centerNode;
    //return (n as any).isCenterNode === true;
  }

/*function applySphericalShell(dt: number) {
    const settings = getSettings();

    // You can expose these later as settings; hardcode for now.
    const rTarget = 400;   // shell radius in your world units
    const k       = 0.02;  // stiffness in "your velocity units"

    const cx = settings.physics.worldCenterX;
    const cy = settings.physics.worldCenterY;
    const cz = settings.physics.worldCenterZ;

    // Match your integrator convention (forces act as per-frame velocity nudges)
    const dtScale = dt * 60;
    const kScaled = k * dtScale;

    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;

      const dx = (n.x - cx);
      const dy = (n.y - cy);
      const dz = (n.z - cz);

      const lenSq = dx*dx + dy*dy + dz*dz;
      if (lenSq <= 1e-12) continue;

      const len = Math.sqrt(lenSq);
      const displacement = len - rTarget;

      // dir = (dx,dy,dz)/len
      // dv += (-k * displacement) * dir
      const scalar = (-kScaled * displacement) / len;

      n.vx = (n.vx || 0) + dx * scalar;
      n.vy = (n.vy || 0) + dy * scalar;
      n.vz = (n.vz || 0) + dz * scalar;
    }
  }*/

  function applySphericalBand(dt: number) {
    const settings = getSettings();
    const cx = settings.physics.worldCenterX;
    const cy = settings.physics.worldCenterY;
    const cz = settings.physics.worldCenterZ;

    // Tune these (later: put into settings)
    const rMin = settings.graph.minSphereRadius;
    const rMax = settings.graph.maxSphereRadius;
    const k    = 10;

    // match your integrator feel
    const kk = k * (dt * 60);

    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;

      const dx = n.x - cx;
      const dy = n.y - cy;
      const dz = (n.z || 0) - cz;

      const r2 = dx*dx + dy*dy + dz*dz;
      if (r2 < 1e-12) {
        // deterministic “kick” so we can normalize next frame
        n.vx += kk;
        continue;
      }

      const r = Math.sqrt(r2);

      // inside band => no constraint force
      if (r >= rMin && r <= rMax) continue;

      // normalize direction
      const invR = 1.0 / r;
      const nx = dx * invR;
      const ny = dy * invR;
      const nz = dz * invR;

      // displacement to nearest boundary
      const target = (r < rMin) ? rMin : rMax;
      const disp = r - target; // positive if outside max, negative if inside min
      const f = -kk * disp;    // pull toward boundary

      n.vx += nx * f;
      n.vy += ny * f;
      n.vz = (n.vz || 0) + nz * f;
    }
  }


  function tick(dt: number) {
    if (!running) return;
    if (!nodes.length) return;

    const settings = getSettings();
    const physicsSettings = settings.physics;
    const layoutMode = settings.camera.layoutMode;

    applyRepulsion(physicsSettings);
    applySprings(physicsSettings);

    if (layoutMode === "spherical") {
        applySphericalBand(dt);
    } else { // cartesian
        applyCentering();
        applyPlaneConstraints();
        applyCenterNodeLock();
    }

    applyDamping();
    integrate(dt);
  }

  return { start, stop, tick, reset };

}
