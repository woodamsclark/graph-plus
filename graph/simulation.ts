import { GraphNode, GraphEdge, Simulation } from '../utils/interfaces.ts';
import { getSettings } from '../utils/SettingsStore.ts';


export function createSimulation(nodes: GraphNode[], edges: GraphEdge[]) {
  // If center not provided, compute bounding-box center from node positions
  let centerNode: GraphNode | null  = null;
  let running                       = false;

  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  // set of node ids that should be pinned (physics skip)
  let pinnedNodes = new Set<string>();

  function applyRepulsion() {
    const settings = getSettings();
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
        const force = settings.physics.repulsionStrength / (effectiveDist * effectiveDist);
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

  function applySprings() {
    const settings = getSettings();
    if (!edges) return;
    for (const e of edges) {
      const a = nodeById.get(e.sourceId);
      const b = nodeById.get(e.targetId);
      if (!a || !b) continue;
      const dx = (b.x - a.x);
      const dy = (b.y - a.y);
      const dz = ((b.z || 0) - (a.z || 0));
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const displacement = dist - (settings.physics.springLength || 0);
      const f = (settings.physics.springStrength || 0) * Math.tanh(displacement / 50);
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
      if ((n as any).type === 'note' && noteK > 0) {
        const dz = targetZ - n.z;
        n.vz = (n.vz || 0) + dz * noteK;
      } else if ((n as any).type === 'tag' && tagK > 0) {
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
      if ((n as any).isCenterNode) {
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
      if ((n as any).type === 'note' && Math.abs(n.z) < 0.0001) n.z = 0;
      if ((n as any).type === 'tag'  && Math.abs(n.x) < 0.0001) n.x = 0;
    }
  }

  function tick(dt: number) {
    if (!running) return;
    if (!nodes.length) return;
    applyRepulsion();
    applySprings();
    applyCentering();
    applyPlaneConstraints();
    //applyMouseAttraction();
    applyCenterNodeLock();
    applyDamping();
    integrate(dt);
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
}
