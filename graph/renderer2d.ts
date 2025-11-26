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

  function setGraph(g: GraphData) {
    graph = g;
    nodeById = new Map();
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        nodeById.set(n.id, n);
      }
    }
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
    const radius = 5;

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

    ctx.save();
    ctx.fillStyle = '#66ccff';
    ctx.strokeStyle = '#0d3b4e';
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const node of graph.nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // small label for debugging
      ctx.fillStyle = '#222';
      ctx.fillText(node.label, node.x, node.y + radius + 4);
      ctx.fillStyle = '#66ccff';
    }

    ctx.restore();
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
