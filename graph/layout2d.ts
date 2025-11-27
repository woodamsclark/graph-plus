import { GraphData, GraphNode } from './buildGraph';

export interface Layout2DOptions {
  width: number;
  height: number;
  margin?: number;
  // New optional centering options
  centerX?: number;
  centerY?: number;
  centerOnLargestNode?: boolean;
  // optional initial jitter (px) applied around center
  jitter?: number;
  // If provided, only layout this subset of nodes (useful when restoring saved positions)
  onlyNodes?: GraphNode[];
}

export function layoutGraph2D(graph: GraphData, options: Layout2DOptions): void {
  const { width, height, margin = 32 } = options;
  const allNodes = graph.nodes;
  if (!allNodes || allNodes.length === 0) return;

  const centerX = options.centerX ?? width / 2;
  const centerY = options.centerY ?? height / 2;
  const jitter = typeof options.jitter === 'number' ? options.jitter : 8;

  const nodes = options.onlyNodes ?? allNodes;
  if (!nodes || nodes.length === 0) return;

  // Place selected nodes initially very near the center with a small random
  // jitter so the physics simulation can separate them without being
  // perfectly overlapped. The jitter is intentionally small (default 8px).
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rx = (Math.random() * 2 - 1) * jitter; // -jitter..jitter
    const ry = (Math.random() * 2 - 1) * jitter;
    node.x = centerX + rx;
    node.y = centerY + ry;
    node.z = 0;
  }

  // If requested, place the largest node at the provided center only when laying out all nodes
  if (options.centerOnLargestNode && !options.onlyNodes) {
    let centerNode: typeof allNodes[0] | null = null;
    let maxDeg = -Infinity;
    for (const n of allNodes) {
      const d = (n.totalDegree || 0);
      if (d > maxDeg) {
        maxDeg = d;
        centerNode = n;
      }
    }
    if (centerNode) {
      centerNode.x = centerX;
      centerNode.y = centerY;
    }
  }
}
