// renderer.ts
import { Renderer, GraphData, CameraState } from '../utilities/interfaces.ts';
import { getSettings } from '../utilities/settingsStore.ts';
import { CameraManager } from '../CameraManager.ts';

/**
 * Bare-bones renderer:
 * - Delegates all camera math to CameraManager
 * - Draws a flat background, edges, and node circles
 * - Exposes helper methods used by GraphManager / CameraManager
 */
export function createRenderer( canvas: HTMLCanvasElement, cameraManager: CameraManager): Renderer {
  const context = canvas.getContext('2d');
  const settings = getSettings();

  let graph: GraphData | null = null;
  const nodeById = new Map<string, any>();

  let hoveredNodeId: string | null = null;
  let hoverNeighbors: Set<string> | null = null;

  function setGraph(g: GraphData | null) {
    graph = g;
    nodeById.clear();
    if (graph && graph.nodes) {
      for (const node of graph.nodes as any[]) {
        nodeById.set(node.id, node);
      }
    }
  }

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
    render(cameraManager.getState());
  }

  /**
   * Main render function.
   * Accepts CameraState to match the Renderer interface / GraphManager calls,
   * but uses CameraManager's internal state for projection.
   */
  function render(_cam?: CameraState) {
    if (!context) return;

    // Background
    context.fillStyle = '#202020';
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (!graph) return;

    drawEdges();
    drawNodes();
    drawLabels();
  }

  function destroy() {
    graph = null;
    nodeById.clear();
  }

  // ─────────────────────────────────────────────
  // Drawing helpers (bare minimum)
  // ─────────────────────────────────────────────

  function drawEdges() {
    if (!context || !graph || !graph.edges) return;

    const edges = graph.edges as any[];

    context.save();

    const edgeColor =
      settings.graph.edgeColor || '#888888';
    const edgeAlpha =
      typeof settings.graph.edgeColorAlpha === 'number'
        ? settings.graph.edgeColorAlpha
        : 0.3;

    context.strokeStyle = edgeColor;
    context.globalAlpha = edgeAlpha;
    context.lineWidth = 1;
    context.lineCap = 'round';

    for (const edge of edges) {
      const src = nodeById.get(edge.sourceId);
      const tgt = nodeById.get(edge.targetId);
      if (!src || !tgt) continue;

      const p1 = cameraManager.worldToScreen(src);
      const p2 = cameraManager.worldToScreen(tgt);

      // Simple "behind camera" cull
      if (p1.depth < 0 || p2.depth < 0) continue;

      context.beginPath();
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.stroke();
    }

    context.restore();
  }

  function drawNodes() {
    if (!context || !graph || !graph.nodes) return;

    const nodes = graph.nodes as any[];

    context.save();

    const defaultNodeColor = settings.graph.nodeColor || '#66ccff';
    const tagColor = settings.graph.tagColor || '#8000ff';
    const minRadius = settings.graph.minNodeRadius || 4;

    for (const node of nodes) {
      const p = cameraManager.worldToScreen(node);
      if (p.depth < 0) continue;

      // Base radius: flat, no degree scaling
      let radius = minRadius;

      // Simple hover bump (optional; still "bare" enough)
      if (hoveredNodeId && node.id === hoveredNodeId) {
        radius *= 1.25;
      }

      const isTag = (node as any).type === 'tag';
      const fillColor = isTag ? tagColor : defaultNodeColor;

      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fillStyle = fillColor;
      context.globalAlpha = 1;
      context.fill();
    }

    context.restore();
  }

  function drawLabels() {
    if (!context || !graph || !graph.nodes) return;

    const nodes = graph.nodes as any[];
    const baseSize = settings.graph.labelBaseFontSize || 12;
    const labelColor = settings.graph.labelColor || '#dddddd';

    context.save();
    context.font = `${baseSize}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = labelColor;
    context.globalAlpha = 1;

    const radius = settings.graph.minNodeRadius || 4;

    for (const node of nodes) {
      const label = (node as any).label || (node as any).name || node.id;
      if (!label) continue;

      const p = cameraManager.worldToScreen(node);
      if (p.depth < 0) continue;

      context.fillText(label, p.x, p.y + radius + 4);
    }

    context.restore();
  }

  // ─────────────────────────────────────────────
  // Helpers used externally
  // ─────────────────────────────────────────────

  /**
   * Called by GraphManager when hover state changes.
   * We just store it; render() uses a tiny radius bump for hovered node.
   */
  function setHoveredNode(
    nodeId: string | null,
    neighbors?: Set<string> | null
  ) {
    hoveredNodeId = nodeId;
    hoverNeighbors = neighbors ?? null;
    // (neighbors are not used visually yet, but kept for future)
  }

  /**
   * Return a stable radius for hit-testing.
   * (No hover bump; just the base radius.)
   */
  function getNodeRadiusForHit(_node: any): number {
    return settings.graph.minNodeRadius || 4;
  }

  /**
   * Return current screen position of a node via CameraManager.
   */
  function getNodeScreenPosition(node: any, _cam?: CameraState) {
    return cameraManager.worldToScreen(node);
  }

  /**
   * Simple scale helper; GraphManager uses this sometimes.
   * With CameraManager handling zoom, we can treat this as 1.
   */
  function getScale(): number {
    return 1;
  }



  // ─────────────────────────────────────────────
  // Return object matching the Renderer interface
  // ─────────────────────────────────────────────

  return {
    setGraph,
    resize,
    render,
    destroy,
    setHoveredNode,
    getNodeRadiusForHit,
    getNodeScreenPosition,
    getScale,
  } as unknown as Renderer;
}