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
  // new optional fields
  centerX?: number;
  centerY?: number;
  centerNodeId?: string;
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

  // mouse attractor defaults
  let mouseAttractionRadius = options?.mouseAttractionRadius ?? 80;
  let mouseAttractionStrength = options?.mouseAttractionStrength ?? 0.15;
  let mouseAttractionExponent = options?.mouseAttractionExponent ?? 3.5;

  // center options: prefer explicitly provided values; otherwise compute
  // a reasonable default (bounding-box center of current node positions)
  let centerX: number | undefined = typeof options?.centerX === 'number' ? options!.centerX : undefined;
  let centerY: number | undefined = typeof options?.centerY === 'number' ? options!.centerY : undefined;
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
        let distSq = dx * dx + dy * dy + 0.01;
        // introduce a minimum separation distance to avoid huge forces
        const minDist = 40;
        let dist = Math.sqrt(distSq);
        if (dist < 0.01) dist = 0.01;
        const clamped = Math.max(dist, minDist);
        const force = repulsionStrength / (clamped * clamped);
        if (dist > 0) {
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          // apply to non-pinned nodes only
          if (!pinnedNodes.has(a.id)) {
            a.vx = (a.vx || 0) + fx;
            a.vy = (a.vy || 0) + fy;
          }
          if (!pinnedNodes.has(b.id)) {
            b.vx = (b.vx || 0) - fx;
            b.vy = (b.vy || 0) - fy;
          }
        } else {
          const fx = (Math.random() - 0.5) * 0.1;
          const fy = (Math.random() - 0.5) * 0.1;
          if (!pinnedNodes.has(a.id)) {
            a.vx = (a.vx || 0) + fx;
            a.vy = (a.vy || 0) + fy;
          }
          if (!pinnedNodes.has(b.id)) {
            b.vx = (b.vx || 0) - fx;
            b.vy = (b.vy || 0) - fy;
          }
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
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const diff = dist - springLength;
      // use a tamed/non-linear spring to avoid explosive forces
      const f = springStrength * Math.tanh(diff / 50);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      if (!pinnedNodes.has(a.id)) {
        a.vx = (a.vx || 0) + fx;
        a.vy = (a.vy || 0) + fy;
      }
      if (!pinnedNodes.has(b.id)) {
        b.vx = (b.vx || 0) - fx;
        b.vy = (b.vy || 0) - fy;
      }
    }
  }

  function applyCentering() {
    if (centerPull <= 0) return;
    // use local numeric center variables to avoid undefined checks
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;

    // 1) Pull every node gently toward the screen center
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      const x = (n.x || 0) - cx;
      const y = (n.y || 0) - cy;
      const r = Math.sqrt(x * x + y * y) + 0.001;
      const pull = centerPull * (r / 200);
      n.vx = (n.vx || 0) + -(x / r) * pull;
      n.vy = (n.vy || 0) + -(y / r) * pull;
    }

    // 2) Extra gentle correction to keep center node near screen center
    if (centerNode) {
      const dx = (centerNode.x || 0) - cx;
      const dy = (centerNode.y || 0) - cy;
      centerNode.vx = (centerNode.vx || 0) - dx * centerPull * 0.5;
      centerNode.vy = (centerNode.vy || 0) - dy * centerPull * 0.5;
    }
  }

  function applyDamping() {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      n.vx = (n.vx || 0) * damping;
      n.vy = (n.vy || 0) * damping;

      if (Math.abs(n.vx) < 0.001) n.vx = 0;
      if (Math.abs(n.vy) < 0.001) n.vy = 0;
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

  function integrate(dt: number) {
    // scale by 60 so dt around 1/60 gives reasonable movement
    const scale = dt * 60;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id)) continue;
      n.x += (n.vx || 0) * scale;
      n.y += (n.vy || 0) * scale;
    }
  }

  function tick(dt: number) {
    if (!running) return;
    applyRepulsion();
    applySprings();
    applyCentering();
    // local mouse attraction to hovered node
    applyMouseAttraction();
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
    if (typeof opts.centerNodeId === 'string') {
      centerNodeId = opts.centerNodeId;
      centerNode = nodes.find((n) => n.id === centerNodeId) || null;
    }

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
