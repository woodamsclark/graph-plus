import { GraphData } from './buildGraph';
import { layoutGraph2D } from './layout2d';

export interface Renderer2DOptions {
  canvas: HTMLCanvasElement;
}

export interface Renderer2D {
  setGraph(graph: GraphData): void;
  resize(width: number, height: number): void;
  render(): void;
  destroy(): void;
}

export function createRenderer2D(options: Renderer2DOptions): Renderer2D {
  const canvas = options.canvas;
  const ctx = canvas.getContext('2d');
  let graph: GraphData | null = null;
  let nodeById: Map<string, any> = new Map();
  // degree-based styling params
  let minDegree = 0;
  let maxDegree = 0;

  const MIN_RADIUS = 4;
  const MAX_RADIUS = 14;
  const MIN_GLOW_ALPHA = 0.05;
  const MAX_GLOW_ALPHA = 0.35;

  function setGraph(g: GraphData) {
    graph = g;
    nodeById = new Map();
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        nodeById.set(n.id, n);
      }
    }
    // compute min/max totalDegree for normalization
    minDegree = Infinity;
    maxDegree = -Infinity;
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        const d = (n as any).totalDegree || 0;
        if (d < minDegree) minDegree = d;
        if (d > maxDegree) maxDegree = d;
      }
    }
    if (!isFinite(minDegree)) minDegree = 0;
    if (!isFinite(maxDegree)) maxDegree = 0;
  }

  function resize(width: number, height: number) {
    // set physical canvas size (pixels)
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    if (graph) {
      layoutGraph2D(graph, { width: canvas.width, height: canvas.height, margin: 32 });
    }
    render();
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!graph) return;
    function getDegreeNormalized(node: any) {
      const d = (node.totalDegree || 0);
      if (maxDegree <= minDegree) return 0.5;
      return (d - minDegree) / (maxDegree - minDegree);
    }

    function getNodeRadius(node: any) {
      const t = getDegreeNormalized(node);
      return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
    }

    function getGlowAlpha(node: any) {
      const t = getDegreeNormalized(node);
      return MIN_GLOW_ALPHA + t * (MAX_GLOW_ALPHA - MIN_GLOW_ALPHA);
    }


    // Draw edges first so nodes appear on top
    if ((graph as any).edges && (graph as any).edges.length > 0) {
      ctx.save();
      ctx.beginPath();
      for (const edge of (graph as any).edges) {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (!src || !tgt) continue;
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
      }
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    // Draw node glows, node bodies, and labels
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const node of graph.nodes) {
      const radius = getNodeRadius(node);
      const glowAlpha = getGlowAlpha(node);

      // glow halo
      const glowRadius = radius * 1.8;
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(102,204,255,${glowAlpha})`;
      ctx.fill();
      ctx.restore();

      // node body
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#66ccff';
      ctx.fill();
      ctx.strokeStyle = '#0d3b4e';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // label below node
      ctx.save();
      ctx.fillStyle = '#222';
      ctx.fillText(node.label, node.x, node.y + radius + 4);
      ctx.restore();
    }
  }

  function destroy() {
    graph = null;
  }

  return {
    setGraph,
    resize,
    render,
    destroy,
  };
}
