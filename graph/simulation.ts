import { GraphNode, GraphEdge } from './buildGraph';

export interface Simulation {
  start(): void;
  stop(): void;
  tick(dt: number): void;
  reset(): void;
  setOptions(opts: Partial<{
    repulsionStrength: number;
    springStrength: number;
    springLength: number;
    centerPull: number;
    damping: number;
  }>): void;
  // pinned node control: prevent physics from moving these nodes
  setPinnedNodes?(ids: Set<string>): void;
  // allow the controller to provide mouse world coords and hovered node id
  setMouseAttractor?(x: number | null, y: number | null, nodeId: string | null): void;
}

export interface SimulationOptions {
  repulsionStrength: number;
  springStrength: number;
  springLength: number;
  centerPull: number;
  damping: number;
  // 3D center point
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  centerNodeId?: string;
  // plane constraint stiffness (soft springs to planes)
  notePlaneStiffness?: number; // pull notes toward z = 0
  tagPlaneStiffness?: number;  // pull tags toward x = 0
  // mouse attraction tuning
  mouseAttractionRadius?: number;
  mouseAttractionStrength?: number;
  mouseAttractionExponent?: number;
}

export function createSimulation(nodes: GraphNode[], edges: GraphEdge[], options?: Partial<SimulationOptions>): Simulation {
  // physics parameters (defaults)
  let repulsionStrength = options?.repulsionStrength ?? 1500;
  let springStrength = options?.springStrength ?? 0.04;
  let springLength = options?.springLength ?? 100;
  let centerPull = options?.centerPull ?? 0.00;
  let damping = options?.damping ?? 0.9;
  let notePlaneStiffness = options?.notePlaneStiffness ?? 0;
  let tagPlaneStiffness = options?.tagPlaneStiffness ?? 0;

  // mouse attractor defaults
  let mouseAttractionRadius = options?.mouseAttractionRadius ?? 80;
  let mouseAttractionStrength = options?.mouseAttractionStrength ?? 0.15;
  let mouseAttractionExponent = options?.mouseAttractionExponent ?? 3.5;

  // center options: prefer explicitly provided values; otherwise compute
  // a reasonable default (bounding-box center of current node positions)
  let centerX: number | undefined = typeof options?.centerX === 'number' ? options!.centerX : undefined;
  let centerY: number | undefined = typeof options?.centerY === 'number' ? options!.centerY : undefined;
  let centerZ: number | undefined = typeof options?.centerZ === 'number' ? options!.centerZ : 0;
  let centerNodeId = options?.centerNodeId ?? null;
  // If center not provided, compute bounding-box center from node positions
  if (typeof centerX !== 'number' || typeof centerY !== 'number') {
    if (nodes && nodes.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const x = (n.x ?? 0);
        const y = (n.y ?? 0);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!isFinite(minX) || !isFinite(maxX)) {
        centerX = 0;
      } else {
        centerX = (minX + maxX) / 2;
      }
      if (!isFinite(minY) || !isFinite(maxY)) {
        centerY = 0;
      } else {
        centerY = (minY + maxY) / 2;
      }
    } else {
      centerX = 0;
      centerY = 0;
    }
  }
  let centerNode: GraphNode | null = null;

  if (centerNodeId && nodes) {
    centerNode = nodes.find((n) => n.id === centerNodeId) || null;
  }

  let running = false;

  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  // set of node ids that should be pinned (physics skip)
  let pinnedNodes = new Set<string>();

  // mouse attractor runtime state (world coords)
  let mouseX: number | null = null;
  let mouseY: number | null = null;
  let mouseHoveredNodeId: string | null = null;

  function applyRepulsion() {
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
        const force = repulsionStrength / (effectiveDist * effectiveDist);
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
    if (!edges) return;
    for (const e of edges) {
      const a = nodeById.get(e.sourceId);
      const b = nodeById.get(e.targetId);
      if (!a || !b) continue;
      const dx = (b.x - a.x);
      const dy = (b.y - a.y);
      const dz = ((b.z || 0) - (a.z || 0));
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const displacement = dist - springLength;
      const f = springStrength * Math.tanh(displacement / 50);
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
    if (centerPull <= 0) return;
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;
    const cz = centerZ ?? 0;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      const dx = (cx - (n.x || 0));
      const dy = (cy - (n.y || 0));
      const dz = (cz - (n.z || 0));
      n.vx = (n.vx || 0) + dx * centerPull;
      n.vy = (n.vy || 0) + dy * centerPull;
      n.vz = (n.vz || 0) + dz * centerPull;
    }
    if (centerNode) {
      const dx = (centerX ?? 0) - (centerNode.x || 0);
      const dy = (centerY ?? 0) - (centerNode.y || 0);
      const dz = (centerZ ?? 0) - (centerNode.z || 0);
      centerNode.vx = (centerNode.vx || 0) + dx * centerPull * 0.5;
      centerNode.vy = (centerNode.vy || 0) + dy * centerPull * 0.5;
      centerNode.vz = (centerNode.vz || 0) + dz * centerPull * 0.5;
    }
  }

  function applyDamping() {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      n.vx = (n.vx || 0) * damping;
      n.vy = (n.vy || 0) * damping;
      n.vz = (n.vz || 0) * damping;
      if (Math.abs(n.vx) < 0.001) n.vx = 0;
      if (Math.abs(n.vy) < 0.001) n.vy = 0;
      if (Math.abs(n.vz) < 0.001) n.vz = 0;
    }
  }

  function applyMouseAttraction() {
    if (mouseX == null || mouseY == null) return;
    if (!mouseHoveredNodeId) return;
    const node = nodeById.get(mouseHoveredNodeId);
    if (!node) return;
    // don't tug on pinned nodes (e.g. while dragging)
    if (pinnedNodes.has(node.id)) return;

    const radius = mouseAttractionRadius ?? 80;
    const strength = mouseAttractionStrength ?? 0.15;
    const exponent = mouseAttractionExponent ?? 3.5;

    const dx = mouseX - node.x;
    const dy = mouseY - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!dist || dist > radius) return;

    const t = 1 - dist / radius;
    const forceMag = strength * Math.pow(Math.max(0, t), exponent);

    const fx = (dx / (dist || 1)) * forceMag;
    const fy = (dy / (dist || 1)) * forceMag;

    node.vx = (node.vx || 0) + fx;
    node.vy = (node.vy || 0) + fy;
  }

  function applyPlaneConstraints() {
    const noteK = notePlaneStiffness ?? 0;
    const tagK = tagPlaneStiffness ?? 0;
    if (noteK === 0 && tagK === 0) return;
    // Pull notes/tags toward the simulation center (not always world origin)
    const targetZ = centerZ ?? 0;
    const targetX = centerX ?? 0;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      if ((n as any).type === 'note' && noteK > 0) {
        const dz = (targetZ) - (n.z || 0);
        n.vz = (n.vz || 0) + dz * noteK;
      } else if ((n as any).type === 'tag' && tagK > 0) {
        const dx = (targetX) - (n.x || 0);
        n.vx = (n.vx || 0) + dx * tagK;
      }
    }
  }

  function applyCenterNodeLock() {
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;
    const cz = centerZ ?? 0;
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
      if ((n as any).type === 'tag' && Math.abs(n.x) < 0.0001) n.x = 0;
    }
  }

  function tick(dt: number) {
    if (!running) return;
    if (!nodes.length) return;
    applyRepulsion();
    applySprings();
    applyCentering();
    applyPlaneConstraints();
    applyMouseAttraction();
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

  function setOptions(opts: Partial<SimulationOptions>) {
    if (!opts) return;
    if (typeof opts.repulsionStrength === 'number') repulsionStrength = opts.repulsionStrength;
    if (typeof opts.springStrength === 'number') springStrength = opts.springStrength;
    if (typeof opts.springLength === 'number') springLength = opts.springLength;
    if (typeof opts.centerPull === 'number') centerPull = opts.centerPull;
    if (typeof opts.damping === 'number') damping = opts.damping;

    if (typeof opts.centerX === 'number') centerX = opts.centerX;
    if (typeof opts.centerY === 'number') centerY = opts.centerY;
    if (typeof opts.centerZ === 'number') centerZ = opts.centerZ;
    if (typeof opts.centerNodeId === 'string') {
      centerNodeId = opts.centerNodeId;
      centerNode = nodes.find((n) => n.id === centerNodeId) || null;
    }

    if (typeof opts.notePlaneStiffness === 'number') notePlaneStiffness = opts.notePlaneStiffness;
    if (typeof opts.tagPlaneStiffness === 'number') tagPlaneStiffness = opts.tagPlaneStiffness;

    if (typeof opts.mouseAttractionRadius === 'number') mouseAttractionRadius = opts.mouseAttractionRadius;
    if (typeof opts.mouseAttractionStrength === 'number') mouseAttractionStrength = opts.mouseAttractionStrength;
    if (typeof opts.mouseAttractionExponent === 'number') mouseAttractionExponent = opts.mouseAttractionExponent;
  }

  function setPinnedNodes(ids: Set<string>) {
    pinnedNodes = new Set(ids || []);
  }

  function setMouseAttractor(x: number | null, y: number | null, nodeId: string | null) {
    mouseX = x;
    mouseY = y;
    mouseHoveredNodeId = nodeId;
  }

  return { start, stop, tick, reset, setOptions, setPinnedNodes, setMouseAttractor };
}
