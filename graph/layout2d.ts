import { GraphData } from './buildGraph';

export interface Layout2DOptions {
  width: number;
  height: number;
  margin?: number;
  // New optional centering options
  centerX?: number;
  centerY?: number;
  centerOnLargestNode?: boolean;
}

export function layoutGraph2D(graph: GraphData, options: Layout2DOptions): void {
  const { width, height, margin = 32 } = options;
  const nodes = graph.nodes;
  if (!nodes || nodes.length === 0) return;

  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);

  const innerWidth = Math.max(1, width - 2 * margin);
  const innerHeight = Math.max(1, height - 2 * margin);

  const cellWidth = innerWidth / cols;
  const cellHeight = innerHeight / rows;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const row = Math.floor(i / cols);
    const col = i % cols;
    node.x = margin + col * cellWidth + cellWidth / 2;
    node.y = margin + row * cellHeight + cellHeight / 2;
    node.z = 0;
  }

  // If requested, place the largest node at the provided center
  if (options.centerOnLargestNode) {
    const centerX = options.centerX ?? width / 2;
    const centerY = options.centerY ?? height / 2;
    let centerNode: typeof nodes[0] | null = null;
    let maxDeg = -Infinity;
    for (const n of nodes) {
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
