import { CameraController } from './CameraController.ts';
import { GraphNode, GraphData, PhysicsSettings, Simulation } from '../shared/interfaces.ts';
import { getSettings } from '../settings/settingsStore.ts';

export function createSimulation(graph: GraphData, camera : CameraController, getMousePos: () => { x: number, y: number } | null) : Simulation{
  // If center not provided, compute bounding-box center from node positions
  let centerNode: GraphNode | null  = null;
  if(graph.centerNode)  {centerNode = graph.centerNode;}
  const nodes                       = graph.nodes;
  const edges                       = graph.edges;
  let running                       = false;  
  let pinnedNodes                   = new Set<string>(); // set of node ids that should be pinned (physics skip)
  const nodeById                    = new Map<string, GraphNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  

  function setPinnedNodes(ids: Set<string>) {
    // create new Set to avoid external mutations
    pinnedNodes = new Set(ids);
  }

  function applyMouseGravity() {
    const settings = getSettings();
    if (!settings.physics.mouseGravityEnabled) return;

    const mousePos = getMousePos(); 
    if (!mousePos) return;
    const { x: mouseX, y: mouseY } = mousePos;

    // Radius in pixels on screen
    const radius    = settings.physics.mouseGravityRadius; 
    const strength  = settings.physics.mouseGravityStrength;

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
        const wx = targetWorld.x - node.x;
        const wy = targetWorld.y - node.y;
        const wz = targetWorld.z - node.z;

        // 5. Apply Force
        const dist = Math.sqrt(wx*wx + wy*wy + wz*wz) + 1e-6;
        const maxBoost = 1 / (node.radius);

        // aggressive near the target (asymptote-ish), capped
        const boost = Math.min(maxBoost, 1 / (dist*dist)); // or 1/(dist*dist)

        // effective strength
        const k = strength * boost;

        node.vx += wx * k;
        node.vy += wy * k;
        node.vz += wz * k;

    }
  }

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

  function tick(dt: number) {
    if (!running) return;
    if (!nodes.length) return;

    const settings = getSettings();
    const physicsSettings = settings.physics;
    

    applyRepulsion(physicsSettings);
    applySprings(physicsSettings);
    applyMouseGravity();

    applyCentering();
    applyPlaneConstraints();
    applyCenterNodeLock();

    applyDamping();
    integrate(dt);
  }

  return { start, stop, tick, reset, setPinnedNodes };

}
