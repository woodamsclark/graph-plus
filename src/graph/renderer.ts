import { Renderer, GraphData, CameraState, GraphNode, GraphEdge } from '../shared/interfaces.ts';
import { getSettings } from '../settings/settingsStore.ts';
import { CameraController } from './CameraController.ts';

export function createRenderer( canvas: HTMLCanvasElement, cameraManager: CameraController): Renderer {
  const context   = canvas.getContext('2d');
  let settings    = getSettings();
  let colors      = resolveColors(); 

  let graph: GraphData | null = null;
  let nodeById = new Map<string, GraphNode>();

  function resize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    // Let CameraManager know the viewport so it can project correctly
    cameraManager.setViewport(w, h);

    // Render immediately with current camera state
    render();
  }

  function render() {
    if (!context) return;

    settings  = getSettings();
    colors    = resolveColors();

    context.fillStyle = colors.background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (!graph) return;

    const nodeMap = new Map<string, { x: number; y: number; depth: number }>();
    for (const node of graph.nodes) {
      const p = cameraManager.worldToScreen(node);
      nodeMap.set(node.id, p);
    }


    drawEdges(nodeMap);
    drawNodes(nodeMap);
    //drawLabels(nodeMap);
  }

  function destroy() {
    graph = null;
    nodeById.clear();
  }

  function drawEdges(nodeMap: Map<string, { x: number; y: number; depth: number }>) {
    if (!context || !graph || !graph.edges) return;

    const edges: GraphEdge[] = graph.edges;

    context.save();

    context.strokeStyle = colors.edge;
    context.globalAlpha = colors.edgeAlpha;
    context.lineWidth   = 1;
    context.lineCap     = 'round';

    for (const edge of edges) {
      const src = nodeById.get(edge.sourceId);
      const tgt = nodeById.get(edge.targetId);
      if (!src || !tgt) continue;

      const p1 = nodeMap.get(edge.sourceId);
      const p2 = nodeMap.get(edge.targetId);

      if (!p1 || !p2) continue;
      // Simple "behind camera" cull
      if (p1.depth < 0 || p2.depth < 0) continue;

      context.beginPath();
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.stroke();
    }

    context.restore();
  }

  function drawNodes(nodeMap: Map<string, { x: number; y: number; depth: number }>) {
    if (!context || !graph || !graph.nodes) return;

    const nodes: GraphNode[] = graph.nodes;

    context.save();

    const nodeColor = colors.node;
    const tagColor  = colors.tag;

    for (const node of nodes) {
      const p = nodeMap.get(node.id);
      if (!p || p.depth < 0) continue;

      let radius = node.radius;

      const isTag = node.type === 'tag';
      const fillColor = isTag ? tagColor : nodeColor;

      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fillStyle = fillColor;
      context.globalAlpha = 1;
      context.fill();
    }

    context.restore();
  }

  function drawLabels(nodeMap: Map<string, { x: number; y: number; depth: number }> ) {
    if (!context || !graph || !graph.nodes) return;

    const nodes : GraphNode[]= graph.nodes;
    const baseSize = settings.graph.labelBaseFontSize || 12;
    const labelColor = colors.label;

    context.save();
    context.font = `${baseSize}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = labelColor;
    context.globalAlpha = 1;

    const radius = settings.graph.minNodeRadius || 4;

    for (const node of nodes) {
      //const p = cameraManager.worldToScreen(node);
      const p = nodeMap.get(node.id);
      if (!p || p.depth < 0) continue;

      context.fillText(node.label, p.x, p.y + radius + 4);
    }

    context.restore();
  }

  function setGraph(data: GraphData | null) {
    graph = data;
    nodeById.clear();

    if (!data) return;

    for (const node of data.nodes) {
      nodeById.set(node.id, node);
    }

  const counts = data.nodes.reduce(
    (acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

    console.log("[GraphPlus] node.type counts:", counts);
    console.log(
    "[GraphPlus] first 20 nodes:",
    data.nodes.slice(0, 20).map(n => ({ id: n.id, label: n.label, type: n.type }))
  );

  }

  
  function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
  }

  function resolveColors() {
  const s = getSettings(); // IMPORTANT: grab latest settings (don’t rely on the initial const)
  return {
    background: s.graph.backgroundColor ?? cssVar('--background-primary', '#202020'),
    edge      : s.graph.edgeColor       ?? cssVar('--text-normal', '#ffffff'),
    node      : s.graph.nodeColor       ?? cssVar('--interactive-accent', '#66ccff'),
    tag       : s.graph.tagColor        ?? cssVar('--interactive-accent-hover', '#8000ff'),
    label     : s.graph.labelColor      ?? cssVar('--text-muted', '#dddddd'),

    edgeAlpha : typeof s.graph.edgeColorAlpha === 'number' ? s.graph.edgeColorAlpha : 0.3,
  };
  }

 const renderer: Renderer = {
  resize,
  render,
  destroy,
  setGraph,
};

return renderer;
}