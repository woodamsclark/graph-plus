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
}

export interface SimulationOptions {
  repulsionStrength: number;
  springStrength: number;
  springLength: number;
  centerPull: number;
  damping: number;
}

export function createSimulation(nodes: GraphNode[], edges: GraphEdge[], options?: Partial<SimulationOptions>): Simulation {
  // physics parameters (defaults)
  let repulsionStrength = options?.repulsionStrength ?? 4000;
  let springStrength = options?.springStrength ?? 0.08;
  let springLength = options?.springLength ?? 80;
  let centerPull = options?.centerPull ?? 0.02;
  let damping = options?.damping ?? 0.85;

  let running = false;

  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  function applyRepulsion() {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy + 0.01;
        const force = repulsionStrength / distSq;
        const dist = Math.sqrt(distSq);
        if (dist > 0) {
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
        } else {
          const fx = (Math.random() - 0.5) * 0.1;
          const fy = (Math.random() - 0.5) * 0.1;
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
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
      const f = springStrength * diff;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx = (a.vx || 0) + fx;
      a.vy = (a.vy || 0) + fy;
      b.vx = (b.vx || 0) - fx;
      b.vy = (b.vy || 0) - fy;
    }
  }

  function applyCentering() {
    for (const n of nodes) {
      n.vx = (n.vx || 0) + -n.x * centerPull;
      n.vy = (n.vy || 0) + -n.y * centerPull;
    }
  }

  function applyDamping() {
    for (const n of nodes) {
      n.vx = (n.vx || 0) * damping;
      n.vy = (n.vy || 0) * damping;
    }
  }

  function integrate(dt: number) {
    // scale by 60 so dt around 1/60 gives reasonable movement
    const scale = dt * 60;
    for (const n of nodes) {
      n.x += (n.vx || 0) * scale;
      n.y += (n.vy || 0) * scale;
    }
  }

  function tick(dt: number) {
    if (!running) return;
    applyRepulsion();
    applySprings();
    applyCentering();
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
  }

  return { start, stop, tick, reset, setOptions };
}
