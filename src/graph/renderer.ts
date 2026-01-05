import { Renderer, GraphData, CameraState, GraphNode, GraphEdge } from '../shared/interfaces.ts';
import { getSettings } from '../settings/settingsStore.ts';
import { CameraController } from './CameraController.ts';

type FontSlot = "text" | "interface" | "mono";

type ThemeFonts = {
  text      : string;
  interface : string;
  mono      : string;
};

type ThemeColors = {
  node      : string;
  tag       : string;
  edge      : string;
  label     : string;
  background: string;
  edgeAlpha : number;
};

type ThemeSnapshot = {
  fonts : ThemeFonts ;
  colors: ThemeColors;
};

export function createRenderer( canvas: HTMLCanvasElement, camera: CameraController): Renderer {
  const context                                       = canvas.getContext('2d');
  let settings                                        = getSettings();
  let mousePosition : { x: number; y: number } | null = null;
  let graph         : GraphData               | null  = null;
  let nodeById                                        = new Map<string, GraphNode>();
  let theme         : ThemeSnapshot                   = buildThemeSnapshot();
  const nodeMap = new Map<string, { x: number; y: number; depth: number }>();
  
  let cssW = 1;
  let cssH = 1;
  let dpr  = 1;


  function render() {
    if (!context) return;

    settings  = getSettings();

    context.fillStyle = theme.colors.background;
    //context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillRect(0, 0, cssW, cssH); // ✅ NOT canvas.width/height

    if (!graph) return;

    nodeMap.clear();
    for (const node of graph.nodes) {
      nodeMap.set(node.id, camera.worldToScreen(node));
    }

    drawEdges(nodeMap);
    drawNodes(nodeMap);
    drawLabels(nodeMap);
  }

  function destroy() {
    graph = null;
    nodeById.clear();
  }

  function drawEdges(nodeMap: Map<string, { x: number; y: number; depth: number }>) {
    if (!context || !graph || !graph.edges) return;

    const edges: GraphEdge[] = graph.edges;

    context.save();

    context.strokeStyle = theme.colors.edge;
    context.globalAlpha = theme.colors.edgeAlpha;
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

    const nodeColor = theme.colors.node;
    const tagColor  = theme.colors.tag;

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

  function drawLabels(nodeMap: Map<string, { x: number; y: number; depth: number }>) {
    if (!context || !graph || !graph.nodes || !mousePosition) return;

    if (!settings.graph.showLabels) return;

    const R               = settings.graph.labelRevealRadius;
    const baseAlpha       = 1;
    const sigma           = (R * 0.5);
    const inv2Sigma2      = 1 / (2 * sigma * sigma);
    const offsetY         = 10;

    const fontSize        = settings.graph.labelFontSize;

    context.save();
    context.font          = `${fontSize}px ${theme.fonts.interface}`;
    context.textAlign     = 'center';
    context.textBaseline  = 'top';
    context.fillStyle     = theme.colors.label;

    for (const node of graph.nodes) {
      const p = nodeMap.get(node.id);
      if (!p || p.depth < 0) continue;

      const dx = p.x - mousePosition.x;
      const dy = p.y - mousePosition.y;
      const d2 = dx*dx + dy*dy;

      if (d2 > R*R) continue;

      const a = baseAlpha * Math.exp(-d2 * inv2Sigma2);
      if (a < 0.01) continue;

      context.globalAlpha = a;
      context.fillText(node.label, p.x, p.y + node.radius + offsetY);
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

  }

  function buildThemeSnapshot(): ThemeSnapshot {
    return {
      fonts : readFonts(),
      colors: readColors(),
    };
  }

  function refreshTheme() {
    theme = buildThemeSnapshot();
  }

  function cssVar(name: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  function readFonts(): ThemeFonts {
    return {
      text      : cssVar("--font-text")       || "sans-serif",
      interface : cssVar("--font-interface")  || "sans-serif",
      mono      : cssVar("--font-monospace")  || "monospace",
    };
  }

  function readColors() {
    const s = getSettings(); // IMPORTANT: grab latest settings (don’t rely on the initial const)
    return {
      background: s.graph.backgroundColor ?? cssVar('--background-primary'      ),
      edge      : s.graph.edgeColor       ?? cssVar('--text-normal'             ),
      node      : s.graph.nodeColor       ?? cssVar('--interactive-accent'      ),
      tag       : s.graph.tagColor        ?? cssVar('--interactive-accent-hover'),
      label     : s.graph.labelColor      ?? cssVar('--text-muted'              ),

      edgeAlpha : 0.03,
    };
  }

  function resize(width: number, height: number) {
    dpr = window.devicePixelRatio || 1;

    // FIX: Do not floor the CSS dimensions. Keep full float precision.
    // This ensures the canvas matches the container size exactly (e.g. 390.5px)
    cssW = Math.max(1, width);
    cssH = Math.max(1, height);

    // Scale the internal backing store by DPR (integer pixels)
    canvas.width  = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    // Force the visual style to match the input float dimensions
    canvas.style.width  = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Update camera viewport with the exact float dimensions so the center point is correct
    camera.setViewport(cssW, cssH);
    render();
  }
  
  function setMouseScreenPosition(pos: { x: number; y: number } | null) {
    mousePosition = pos;
  }

 const renderer: Renderer = {
  resize,
  render,
  destroy,
  setGraph,
  refreshTheme,
  setMouseScreenPosition,
};

return renderer;
}