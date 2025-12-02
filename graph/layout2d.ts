import { GraphData, GraphNode } from './buildGraph';

export interface Layout2DOptions {
  width               : number;
  height              : number;
  margin?             : number;
  centerX?            : number;
  centerY?            : number;
  //centerZ?           : number; // wc-c enterZ was missing, I feel like it should be added
  centerOnLargestNode?: boolean;
  jitter?             : number; // optional initial jitter (px) applied around center
  onlyNodes?          : GraphNode[]; // If provided, only layout this subset of nodes (useful when restoring saved positions)
}

export function layoutGraph2D(graph: GraphData, options: Layout2DOptions): void {
  const { width, height, margin = 32 } = options;
  const allNodes = graph.nodes;
  if (!allNodes || allNodes.length === 0) return;

  const centerX = options.centerX ?? width / 2;
  const centerY = options.centerY ?? height / 2;
  const jitter  = typeof options.jitter === 'number' ? options.jitter : 8;

  const nodes = options.onlyNodes ?? allNodes;
  if (!nodes || nodes.length === 0) return;

  // Place selected nodes in a randomized radial spread around the center so
  // nodes initially load around the central node rather than stacked.
  const minRadius = Math.max(32, jitter * 4);
  const maxRadius = Math.max(minRadius + 40, Math.min(Math.max(width, height) / 2 - (options.margin || 32), 800));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if ((node as any).isCenterNode) {
      node.x = centerX; node.y = centerY; node.z = 0;
      continue;
    }
    const angle = Math.random() * Math.PI * 2;
    const r = minRadius + Math.random() * (maxRadius - minRadius);
    const rx = Math.cos(angle) * r;
    const ry = Math.sin(angle) * r;
    node.x = centerX + rx;
    node.y = centerY + ry;
    node.z = 0; // this should be updated to centerZ +rz once we have centerZ
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

export interface Layout3DOptions extends Layout2DOptions {
  // spread for tag plane along Z axis
  tagZSpread?: number; // default 400
}

// Phase 2 helper: layout notes in XY plane (z=0) and tags in ZY plane (x=0)
export function layoutGraph3D(graph: GraphData, options: Layout3DOptions): void {
  const { width, height } = options;
  const allNodes = graph.nodes;
  if (!allNodes || allNodes.length === 0) return;

  const centerX = options.centerX ?? width / 2;
  const centerY = options.centerY ?? height / 2;
  const jitter = typeof options.jitter === 'number' ? options.jitter : 8;
  const tagZSpread = typeof options.tagZSpread === 'number' ? options.tagZSpread : 400;

  const nodes = options.onlyNodes ?? allNodes;
  if (!nodes || nodes.length === 0) return;

  const minRadius3D = Math.max(32, jitter * 4);
  const maxRadius3D = Math.max(minRadius3D + 40, Math.min(Math.max(width, height) / 2 - (options.margin || 32), 800));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if ((node as any).isCenterNode) {
      // Keep the explicit center node at the requested center. For tag
      // center nodes we preserve the tag-plane convention (x=0) so they sit
      // on the ZY plane; for note center nodes place at XY center.
      if ((node as any).type === 'tag') {
        node.x = 0;
        node.y = centerY;
        node.z = 0;
      } else {
        node.x = centerX;
        node.y = centerY;
        node.z = 0;
      }
      continue;
    }
    const angle = Math.random() * Math.PI * 2;
    const r = minRadius3D + Math.random() * (maxRadius3D - minRadius3D);
    const rx = Math.cos(angle) * r;
    const ry = Math.sin(angle) * r;
    if ((node as any).type === 'tag') {
      // Place tag nodes in a ring around the view center (same center as
      // notes) so new tags visually appear around the center node rather
      // than off to the left. We still give tags Z spread so they occupy
      // the tag plane visually, but their X coordinate is centered on the
      // view center plus radial offset for a consistent initial distribution.
      node.x = centerX + rx;
      node.y = centerY + ry;
      node.z = (Math.random() - 0.5) * tagZSpread;
    } else {
      node.x = centerX + rx;
      node.y = centerY + ry;
      node.z = 0;
    }
  }

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
      if ((centerNode as any).type === 'tag') {
        centerNode.x = 0;
        centerNode.y = centerY;
        centerNode.z = 0;
      } else {
        centerNode.x = centerX;
        centerNode.y = centerY;
        centerNode.z = 0;
      }
    }
  }
}
