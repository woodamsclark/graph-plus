import { GraphData } from './buildGraph';

export interface GlowSettings {
  minNodeRadius: number;
  maxNodeRadius: number;
  glowRadiusMultiplier: number;
  minCenterAlpha: number;
  maxCenterAlpha: number;
  hoverBoostFactor: number;
  neighborBoostFactor?: number;
  dimFactor?: number;
  hoverHighlightDepth?: number;
  distanceInnerRadiusMultiplier?: number;
  distanceOuterRadiusMultiplier?: number;
  distanceCurveSteepness?: number;
  nodeColor?: string;
  labelColor?: string;
  edgeColor?: string;
}

export interface Renderer2DOptions {
  canvas: HTMLCanvasElement;
  glow?: GlowSettings;
}

export interface Renderer2D {
  setGraph(graph: GraphData): void;
  resize(width: number, height: number): void;
  render(): void;
  destroy(): void;
  setHoveredNode(nodeId: string | null): void;
  getNodeRadiusForHit(node: any): number;
  setGlowSettings(glow: GlowSettings): void;
  setHoverState(hoveredId: string | null, highlightedIds: Set<string>, mouseX: number, mouseY: number): void;
  zoomAt(screenX: number, screenY: number, factor: number): void;
  panBy(screenDx: number, screenDy: number): void;
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

export function createRenderer2D(options: Renderer2DOptions): Renderer2D {
  const canvas = options.canvas;
  const glowOptions = options.glow;
  const ctx = canvas.getContext('2d');
  let graph: GraphData | null = null;
  let nodeById: Map<string, any> = new Map();
  // degree-based styling params
  let minDegree = 0;
  let maxDegree = 0;

  let minRadius = glowOptions?.minNodeRadius ?? 4;
  let maxRadius = glowOptions?.maxNodeRadius ?? 14;
  let glowMultiplier = glowOptions?.glowRadiusMultiplier ?? 2.0;
  let minCenterAlpha = glowOptions?.minCenterAlpha ?? 0.05;
  let maxCenterAlpha = glowOptions?.maxCenterAlpha ?? 0.35;
  let hoverBoost = glowOptions?.hoverBoostFactor ?? 1.5;
  let neighborBoost = glowOptions?.neighborBoostFactor ?? 1.0;
  let dimFactor = glowOptions?.dimFactor ?? 0.25;
  let hoverHighlightDepth = glowOptions?.hoverHighlightDepth ?? 1;
  let distanceInnerMultiplier = glowOptions?.distanceInnerRadiusMultiplier ?? 1.0;
  let distanceOuterMultiplier = glowOptions?.distanceOuterRadiusMultiplier ?? 2.5;
  let distanceCurveSteepness = glowOptions?.distanceCurveSteepness ?? 2.0;
  let hoveredNodeId: string | null = null;
  let hoverHighlightSet: Set<string> = new Set();
  let mouseX = 0;
  let mouseY = 0;

  // theme-derived colors (updated each render)
  let themeNodeColor = '#66ccff';
  let themeLabelColor = '#222';
  let themeEdgeColor = '#888888';

  function parseHexColor(hex: string) {
    if (!hex) return null;
    hex = hex.trim();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }

  function parseRgbString(s: string) {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => Number(p.trim()));
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  function colorToRgb(color: string) {
    if (!color) return { r: 102, g: 204, b: 255 };
    const fromHex = parseHexColor(color);
    if (fromHex) return fromHex;
    const fromRgb = parseRgbString(color);
    if (fromRgb) return fromRgb;
    // fallback to default
    return { r: 102, g: 204, b: 255 };
  }
  // camera state
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const minScale = 0.25;
  const maxScale = 4;

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

//    if (graph) {
//      layoutGraph2D(graph, { width: canvas.width, height: canvas.height, margin: 32 });
//    }
    render();
  }

  function getDegreeNormalized(node: any) {
    const d = (node.totalDegree || 0);
    if (maxDegree <= minDegree) return 0.5;
    return (d - minDegree) / (maxDegree - minDegree);
  }

  function getNodeRadius(node: any) {
    const t = getDegreeNormalized(node);
    return minRadius + t * (maxRadius - minRadius);
  }

  function getBaseCenterAlpha(node: any) {
    const t = getDegreeNormalized(node);
    return minCenterAlpha + t * (maxCenterAlpha - minCenterAlpha);
  }

  function getCenterAlpha(node: any) {
    const base = getBaseCenterAlpha(node);

 // CASE 1: No hovered node yet → only distance-based glow, no depth/dimming
    if (!hoveredNodeId) {
        const distFactor = getMouseDistanceFactor(node); // 0 far, 1 near
        // use neighborBoost here (or hoverBoost if you prefer stronger)
        const boost = 1 + (neighborBoost - 1) * distFactor;
        return clamp01(base * boost);
  }

// CASE 2: There *is* a hovered node → apply depth + distance logic
    const inDepth = hoverHighlightSet.has(node.id);
    const isHovered = node.id === hoveredNodeId;

    // outside highlight depth -> dimmed, no distance effect
    if (!inDepth) return clamp01(base * dimFactor);

    // within depth -> apply distance-based factor
    const distFactor = getMouseDistanceFactor(node); // 0..1

    if (isHovered) {
      // hovered node reaches max hover as mouse approaches
      const boost = 1 + (hoverBoost - 1) * distFactor;
      return clamp01(base * boost);
    } else {
      // neighbor nodes get interpolated boost based on distance
      const boost = 1 + (neighborBoost - 1) * distFactor;
      return clamp01(base * boost);
    }
  }

  function clamp01(v: number) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }

  function applySCurve(p: number, steepness: number) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const k = steepness <= 0 ? 0.0001 : steepness;
    const a = Math.pow(p, k);
    const b = Math.pow(1 - p, k);
    if (a + b === 0) return 0.5;
    return a / (a + b);
  }

  function getMouseDistanceFactor(node: any) {
    const radius = getNodeRadius(node);
    const innerR = radius * distanceInnerMultiplier;
    const outerR = radius * distanceOuterMultiplier;
    if (outerR <= innerR || outerR <= 0) return 0;

    const dx = mouseX - node.x;
    const dy = mouseY - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= innerR) return 1;
    if (dist >= outerR) return 0;

    // normalize so 0 = outerR, 1 = innerR
    const t = (dist - innerR) / (outerR - innerR); // 0..1 where 0=inner,1=outer
    const proximity = 1 - t; // 1 near inner, 0 near outer
    return applySCurve(proximity, distanceCurveSteepness);
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!graph) return;

    ctx.save();
      // Allow settings overrides first, then fall back to theme CSS vars
      if (glowOptions?.nodeColor) themeNodeColor = glowOptions.nodeColor;
      if (glowOptions?.labelColor) themeLabelColor = glowOptions.labelColor;
      if (glowOptions?.edgeColor) themeEdgeColor = glowOptions.edgeColor;
      try {
        const cs = window.getComputedStyle(canvas);
        const nodeVar = cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
        const labelVar = cs.getPropertyValue('--text-normal') || cs.getPropertyValue('--text');
        const edgeVar = cs.getPropertyValue('--text-muted') || cs.getPropertyValue('--text-faint') || cs.getPropertyValue('--text-normal');
        if (!glowOptions?.nodeColor && nodeVar && nodeVar.trim()) themeNodeColor = nodeVar.trim();
        if (!glowOptions?.labelColor && labelVar && labelVar.trim()) themeLabelColor = labelVar.trim();
        if (!glowOptions?.edgeColor && edgeVar && edgeVar.trim()) themeEdgeColor = edgeVar.trim();
      } catch (e) {
        // ignore (e.g., server-side build environment)
      }

      ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

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
      const edgeRgb = colorToRgb(themeEdgeColor);
      ctx.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},0.65)`;
      // keep stroke visually ~1px regardless of zoom
      ctx.lineWidth = Math.max(1, 1 / Math.max(0.0001, scale));
      ctx.stroke();
      ctx.restore();
    }

    // Draw node glows (radial gradient), node bodies, and labels
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const node of graph.nodes) {
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      const glowRadius = radius * glowMultiplier;

      // radial gradient glow
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
      const accentRgb = colorToRgb(themeNodeColor);
      gradient.addColorStop(0.0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${centerAlpha})`);
      gradient.addColorStop(0.4, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${centerAlpha * 0.5})`);
      gradient.addColorStop(0.8, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${centerAlpha * 0.15})`);
      gradient.addColorStop(1.0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0)`);

      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();

      // node body
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = themeNodeColor;
      ctx.fill();
      ctx.restore();

      // label below node
      ctx.save();
      ctx.fillStyle = themeLabelColor;
      ctx.fillText(node.label, node.x, node.y + radius + 4);
      ctx.restore();
    }

    ctx.restore();
  }

  function destroy() {
    graph = null;
  }

  function setHoveredNode(nodeId: string | null) {
    hoveredNodeId = nodeId;
  }

  function getNodeRadiusForHit(node: any) {
    return getNodeRadius(node);
  }

  function setGlowSettings(glow: GlowSettings) {
    if (!glow) return;
    minRadius = glow.minNodeRadius;
    maxRadius = glow.maxNodeRadius;
    glowMultiplier = glow.glowRadiusMultiplier;
    minCenterAlpha = glow.minCenterAlpha;
    maxCenterAlpha = glow.maxCenterAlpha;
    hoverBoost = glow.hoverBoostFactor;
    neighborBoost = glow.neighborBoostFactor ?? neighborBoost;
    dimFactor = glow.dimFactor ?? dimFactor;
    hoverHighlightDepth = glow.hoverHighlightDepth ?? hoverHighlightDepth;
    distanceInnerMultiplier = glow.distanceInnerRadiusMultiplier ?? distanceInnerMultiplier;
    distanceOuterMultiplier = glow.distanceOuterRadiusMultiplier ?? distanceOuterMultiplier;
    distanceCurveSteepness = glow.distanceCurveSteepness ?? distanceCurveSteepness;
  }

  function setHoverState(hoveredId: string | null, highlightedIds: Set<string>, mx: number, my: number) {
    hoveredNodeId = hoveredId;
    hoverHighlightSet = highlightedIds ? new Set(highlightedIds) : new Set();
    mouseX = mx || 0;
    mouseY = my || 0;
  }

  function screenToWorld(screenX: number, screenY: number) {
    return { x: (screenX - offsetX) / scale, y: (screenY - offsetY) / scale };
  }

  function zoomAt(screenX: number, screenY: number, factor: number) {
    if (factor <= 0) return;
    const worldBefore = screenToWorld(screenX, screenY);
    scale *= factor;
    if (scale < minScale) scale = minScale;
    if (scale > maxScale) scale = maxScale;
    const worldAfter = worldBefore; // keep same world point under cursor
    offsetX = screenX - worldAfter.x * scale;
    offsetY = screenY - worldAfter.y * scale;
    render();
  }

  function panBy(screenDx: number, screenDy: number) {
    offsetX += screenDx;
    offsetY += screenDy;
    render();
  }

  return {
    setGraph,
    resize,
    render,
    destroy,
    setHoveredNode,
    getNodeRadiusForHit,
    setGlowSettings,
    setHoverState,
    zoomAt,
    panBy,
    screenToWorld,
  };
}

