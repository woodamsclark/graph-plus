import { GraphData } from './buildGraph';

export interface GlowSettings {
  minNodeRadius: number;
  maxNodeRadius: number;
  // removed: glowRadiusMultiplier (now driven by mouse attraction radius)
  minCenterAlpha: number;
  maxCenterAlpha: number;
  hoverBoostFactor: number;
  neighborBoostFactor?: number;
  dimFactor?: number;
  hoverHighlightDepth?: number;
  distanceInnerRadiusMultiplier?: number;
  distanceOuterRadiusMultiplier?: number;
  distanceCurveSteepness?: number;
  focusSmoothingRate?: number;
  edgeDimMin?: number;
  edgeDimMax?: number;
  nodeMinBodyAlpha?: number;
  nodeColor?: string;
  tagColor?: string;
  labelColor?: string;
  edgeColor?: string;
  // per-color alpha (0..1). If unset, treated as 1.0
  nodeColorAlpha?: number;
  tagColorAlpha?: number;
  labelColorAlpha?: number;
  edgeColorAlpha?: number;
  // maximum alpha to use for each color when hovered/highlighted
  nodeColorMaxAlpha?: number;
  tagColorMaxAlpha?: number;
  edgeColorMaxAlpha?: number;
  // optional explicit glow radius in world/pixel units. If provided, overrides multiplier-based radius.
  glowRadiusPx?: number;
  // whether to use Obsidian interface font for labels
  useInterfaceFont?: boolean;
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
  screenToWorldAtDepth?(screenX: number, screenY: number, zCam: number, width: number, height: number, cam: Camera): { x: number; y: number; z: number };
  setRenderOptions?(opts: { mutualDoubleLines?: boolean; showTags?: boolean }): void;
  // projection helpers for hit-testing
  getNodeScreenPosition?(node: any): { x: number; y: number };
  getProjectedNode?(node: any): { x: number; y: number; depth: number };
  getScale?(): number;
  // camera controls
  setCamera?(cam: Partial<Camera>): void;
  getCamera?(): Camera;
  getCameraBasis?(cam: Camera): { right: { x: number; y: number; z: number }; up: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } };
}

export interface Camera {
  yaw: number;      // rotation around Y axis
  pitch: number;    // rotation around X axis
  distance: number; // camera distance from target
  targetX: number;
  targetY: number;
  targetZ: number;
  zoom: number;     // additional zoom scalar
}

export function createRenderer2D(options: Renderer2DOptions): Renderer2D {
  const canvas = options.canvas;
  let glowOptions = options.glow;
  const ctx = canvas.getContext('2d');
  let graph: GraphData | null = null;
  let nodeById: Map<string, any> = new Map();
  // degree-based styling params
  let minDegree = 0;
  let maxDegree = 0;
  // edge count stats
  let minEdgeCount = 1;
  let maxEdgeCount = 1;
  // whether to draw mutual edges as double parallel lines
  let drawMutualDoubleLines = true;
  // whether to show tag nodes & tag-connected edges
  let showTags = true;

  let minRadius = glowOptions?.minNodeRadius ?? 4;
  let maxRadius = glowOptions?.maxNodeRadius ?? 14;
  const DEFAULT_GLOW_MULTIPLIER = 2.0;
  // explicit glow radius in world units (pixels). If set, this value is used instead of radius*DEFAULT_GLOW_MULTIPLIER
  let glowRadiusPx: number | null = glowOptions?.glowRadiusPx ?? null;
  let minCenterAlpha = glowOptions?.minCenterAlpha ?? 0.05;
  let maxCenterAlpha = glowOptions?.maxCenterAlpha ?? 0.35;
  // per-color alpha multipliers (0..1)
  let nodeColorAlpha = glowOptions?.nodeColorAlpha ?? 1.0;
  let tagColorAlpha = glowOptions?.tagColorAlpha ?? 1.0;
  let labelColorAlpha = glowOptions?.labelColorAlpha ?? 1.0;
  let edgeColorAlpha = glowOptions?.edgeColorAlpha ?? 1.0;
  let nodeColorMaxAlpha = glowOptions?.nodeColorMaxAlpha ?? nodeColorAlpha;
  let tagColorMaxAlpha = glowOptions?.tagColorMaxAlpha ?? tagColorAlpha;
  let edgeColorMaxAlpha = glowOptions?.edgeColorMaxAlpha ?? edgeColorAlpha;
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
  // Animated hover scale state: 0 = normal, 1 = full growth
  let hoverScale = 0;
  const hoverScaleMax = 0.25; // +25% radius at full hover
  const hoverLerpSpeed = 0.2; // how quickly hoverScale interpolates each frame (0-1)
  // per-node smooth focus factor (0 = dimmed, 1 = focused)
  const nodeFocusMap: Map<string, number> = new Map();
  let lastRenderTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  // Focus/dimming controls (configurable via glow settings)
  let focusSmoothingRate = glowOptions?.focusSmoothingRate ?? 8;
  let edgeDimMin = glowOptions?.edgeDimMin ?? 0.08;
  let edgeDimMax = glowOptions?.edgeDimMax ?? 0.9;
  let nodeMinBodyAlpha = glowOptions?.nodeMinBodyAlpha ?? 0.3;
  

  // theme-derived colors (updated each render)
  let themeNodeColor = '#66ccff';
  let themeLabelColor = '#222';
  let themeEdgeColor = '#888888';
  let themeTagColor = '#8000ff';
  // resolved interface or monospace font families defined by theme
  let resolvedInterfaceFontFamily: string | null = null;
  let resolvedMonoFontFamily: string | null = null;

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
  let scale = 1; // retained for 2D UI zoom/pan compositing
  let offsetX = 0;
  let offsetY = 0;
  const minScale = 0.25;
  const maxScale = 4;

  let camera: Camera = {
    yaw: Math.PI / 6,
    pitch: Math.PI / 8,
    distance: 1200,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    zoom: 1.0,
  };

  function setCamera(newCamera: Partial<Camera>) {
    camera = { ...camera, ...newCamera } as Camera;
  }
  function getCamera(): Camera { return camera; }

  // Camera-based projection: returns projected world-plane coordinates
  function projectWorld(node: any): { x: number; y: number; depth: number } {
    const { yaw, pitch, distance, targetX, targetY, targetZ, zoom } = camera;
    const wx = (node.x || 0) - targetX;
    const wy = (node.y || 0) - targetY;
    const wz = (node.z || 0) - targetZ;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const xz = wx * cosYaw - wz * sinYaw;
    const zz = wx * sinYaw + wz * cosYaw;
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const yz = wy * cosP - zz * sinP;
    const zz2 = wy * sinP + zz * cosP;
    const camZ = distance;
    const dz = camZ - zz2;
    const eps = 0.0001;
    const safeDz = dz < eps ? eps : dz;
    const focal = 800; // tune focal length
    const perspective = (zoom * focal) / safeDz;
    const px = xz * perspective;
    const py = yz * perspective;
    return { x: px, y: py, depth: dz };
  }

  function setGraph(g: GraphData) {
    graph = g;
    nodeById = new Map();
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        nodeById.set(n.id, n);
        // initialize focus map to fully focused by default
        if (!nodeFocusMap.has(n.id)) nodeFocusMap.set(n.id, 1);
      }
    }
    // compute min/max inDegree for normalization (node radius driven by in-degree)
    minDegree = Infinity;
    maxDegree = -Infinity;
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        const d = (n as any).inDegree || 0;
        if (d < minDegree) minDegree = d;
        if (d > maxDegree) maxDegree = d;
      }
    }
    // compute edge count stats for thickness mapping
    minEdgeCount = Infinity;
    maxEdgeCount = -Infinity;
    if (graph && (graph as any).edges) {
      for (const e of (graph as any).edges) {
        const c = Number(e.linkCount || 1) || 1;
        if (c < minEdgeCount) minEdgeCount = c;
        if (c > maxEdgeCount) maxEdgeCount = c;
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
    const d = (node.inDegree || 0);
    if (maxDegree <= minDegree) return 0.5;
    return (d - minDegree) / (maxDegree - minDegree);
  }

  function getNodeRadius(node: any) {
    const base = getBaseNodeRadius(node);
    // compute per-node hover scale factor: hovered node gets full effect, neighbors get a reduced effect
    let scaleFactor = 1;
    const isHovered = hoveredNodeId === node.id;
    const isNeighbor = hoverHighlightSet && hoverHighlightSet.has(node.id);
    if (isHovered) {
      scaleFactor = 1 + hoverScaleMax * hoverScale;
    } else if (isNeighbor) {
      scaleFactor = 1 + (hoverScaleMax * 0.4) * hoverScale;
    }
    return base * scaleFactor;
  }

  function getBaseNodeRadius(node: any) {
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
    const p = projectWorld(node);
    const dx = mouseX - p.x;
    const dy = mouseY - p.y;
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
    // compute time delta for smooth transitions
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    let dt = (now - lastRenderTime) / 1000;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    lastRenderTime = now;

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
        // derive a theme tag color from secondary/accent vars (prefer explicit secondary accent if available)
        const tagVar = cs.getPropertyValue('--accent-2') || cs.getPropertyValue('--accent-secondary') || cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
        if (!glowOptions?.tagColor && tagVar && tagVar.trim()) themeTagColor = tagVar.trim();
      } catch (e) {
        // ignore (e.g., server-side build environment)
      }

      // choose which font family to resolve based on setting: interface font or monospace
      try {
        const cs = window.getComputedStyle(canvas);
        if (glowOptions?.useInterfaceFont) {
          if (!resolvedInterfaceFontFamily) {
            const candidates = ['--font-family-interface', '--font-family', '--font-main', '--font-primary', '--font-family-sans', '--text-font'];
            let fam: string | null = null;
            for (const v of candidates) {
              const val = cs.getPropertyValue(v);
              if (val && val.trim()) { fam = val.trim(); break; }
            }
            if (!fam) {
              const el = document.createElement('div');
              el.style.position = 'absolute';
              el.style.left = '-9999px';
              el.style.top = '-9999px';
              el.textContent = 'x';
              document.body.appendChild(el);
              try {
                const cs2 = window.getComputedStyle(el);
                fam = cs2.fontFamily || null;
              } finally {
                if (el.parentElement) el.parentElement.removeChild(el);
              }
            }
            resolvedInterfaceFontFamily = fam && fam.trim() ? fam.trim() : 'sans-serif';
          }
        } else {
          if (!resolvedMonoFontFamily) {
            const candidates = ['--font-family-monospace', '--font-family-code', '--mono-font', '--code-font', '--font-mono', '--font-family-mono'];
            let fam: string | null = null;
            for (const v of candidates) {
              const val = cs.getPropertyValue(v);
              if (val && val.trim()) { fam = val.trim(); break; }
            }
            if (!fam) {
              const codeEl = document.createElement('code');
              codeEl.style.position = 'absolute';
              codeEl.style.left = '-9999px';
              codeEl.style.top = '-9999px';
              codeEl.textContent = 'x';
              document.body.appendChild(codeEl);
              try {
                const cs2 = window.getComputedStyle(codeEl);
                fam = cs2.fontFamily || null;
              } finally {
                if (codeEl.parentElement) codeEl.parentElement.removeChild(codeEl);
              }
            }
            resolvedMonoFontFamily = fam && fam.trim() ? fam.trim() : 'monospace';
          }
        }
      } catch (e) {
        if (glowOptions?.useInterfaceFont) resolvedInterfaceFontFamily = resolvedInterfaceFontFamily || 'sans-serif';
        else resolvedMonoFontFamily = resolvedMonoFontFamily || 'monospace';
      }

      ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Helper: determine whether a node is within the focused set (instant target)
    function isNodeTargetFocused(nodeId: string) {
      if (!hoveredNodeId) return true; // no hover -> everything focused
      if (nodeId === hoveredNodeId) return true;
      if (hoverHighlightSet && hoverHighlightSet.has(nodeId)) return true;
      return false;
    }

    // Smoothly update per-node focus factor towards target (exponential smoothing)
    function updateFocusFactors() {
      if (!graph || !graph.nodes) return;
      for (const n of graph.nodes) {
        const id = n.id;
        const target = isNodeTargetFocused(id) ? 1 : 0;
        const cur = nodeFocusMap.get(id) ?? target;
        // exponential smoothing: alpha = 1 - exp(-rate * dt)
        const alpha = 1 - Math.exp(-focusSmoothingRate * dt);
        const next = cur + (target - cur) * alpha;
        nodeFocusMap.set(id, next);
      }
    }
    updateFocusFactors();

    // Ease hoverScale towards target each frame (simple lerp)
    const targetHover = hoveredNodeId ? 1 : 0;
    hoverScale += (targetHover - hoverScale) * hoverLerpSpeed;

    // Draw edges first so nodes appear on top. Draw per-edge so we can dim edges
    // that are outside the focus region (at least one endpoint not focused).
    if ((graph as any).edges && (graph as any).edges.length > 0) {
      const edgeRgb = colorToRgb(themeEdgeColor);
      for (const edge of (graph as any).edges) {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (!src || !tgt) continue;
        if (!showTags && (src.type === 'tag' || tgt.type === 'tag')) continue;
        const srcP = projectWorld(src);
        const tgtP = projectWorld(tgt);

        const srcF = nodeFocusMap.get(edge.sourceId) ?? 1;
        const tgtF = nodeFocusMap.get(edge.targetId) ?? 1;
        const edgeFocus = (srcF + tgtF) * 0.5;

        // determine thickness based on linkCount (map to screen pixels, then scale to world units)
        const c = Number(edge.linkCount || 1) || 1;
        let t = 0.5;
        if (maxEdgeCount > minEdgeCount) t = (c - minEdgeCount) / (maxEdgeCount - minEdgeCount);
        // map t to desired screen px width
        const minScreenW = 0.8;
        const maxScreenW = 6.0;
        const screenW = minScreenW + t * (maxScreenW - minScreenW);
        const worldLineWidth = Math.max(0.4, screenW / Math.max(0.0001, scale));

        // compute alpha: when no hover, use default; otherwise interpolate between dim and strong
        let alpha = 0.65;
        if (!hoveredNodeId) alpha = 0.65;
        else alpha = 0.08 + (0.9 - 0.08) * edgeFocus; // interpolate
        // Do not force alpha here; we'll decide final alpha below using configured
        // per-color min/max alpha values so hover max can be customized.

        ctx.save();
        const useEdgeAlpha = glowOptions?.edgeColorAlpha ?? edgeColorAlpha;
        const useEdgeMax = glowOptions?.edgeColorMaxAlpha ?? glowOptions?.edgeColorAlpha ?? edgeColorMaxAlpha;
        // compute final edge alpha and bypass user edge alpha when hovered/highlighted.
        // Use the same reduced-propagation rule as above: require both endpoints
        // in the highlight set, except allow direct-hover incidence.
        let finalEdgeAlpha = alpha * useEdgeAlpha;
        if (hoveredNodeId) {
          const srcInDepth = hoverHighlightSet.has(edge.sourceId);
          const tgtInDepth = hoverHighlightSet.has(edge.targetId);
          const directlyIncident = edge.sourceId === hoveredNodeId || edge.targetId === hoveredNodeId;
          if ((srcInDepth && tgtInDepth) || directlyIncident) finalEdgeAlpha = useEdgeMax;
        }
        ctx.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${finalEdgeAlpha})`;
        // mutual edges: draw two parallel lines offset perpendicular to the edge when enabled
        const isMutual = !!edge.hasReverse && drawMutualDoubleLines;
        if (isMutual) {
          const dx = tgtP.x - srcP.x;
          const dy = tgtP.y - srcP.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const perpX = -uy;
          const perpY = ux;
          // offset in world units (aim for ~screenW/2 offset)
          const offsetPx = Math.max(2, screenW * 0.6);
          const offsetWorld = offsetPx / Math.max(0.0001, scale);

          // first line (offset +)
          ctx.beginPath();
          ctx.moveTo(srcP.x + perpX * offsetWorld, srcP.y + perpY * offsetWorld);
          ctx.lineTo(tgtP.x + perpX * offsetWorld, tgtP.y + perpY * offsetWorld);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();

          // second line (offset -)
          ctx.beginPath();
          ctx.moveTo(srcP.x - perpX * offsetWorld, srcP.y - perpY * offsetWorld);
          ctx.lineTo(tgtP.x - perpX * offsetWorld, tgtP.y - perpY * offsetWorld);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(srcP.x, srcP.y);
          ctx.lineTo(tgtP.x, tgtP.y);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    // Draw node glows (radial gradient), node bodies, and labels
    // Compute zoom-aware font sizing. Font size displayed on screen = baseFontSize * scale
    const baseFontSize = 10; // world-space base font size
    const minFontSize = 6; // px (screen)
    const maxFontSize = 18; // px (screen)
    const hideBelow = 7; // hide labels when displayed size < this (px)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Determine label color: prefer explicit override, otherwise read --text-normal
    let labelCss = themeLabelColor;
    try {
      const cs = window.getComputedStyle(canvas);
      const v = cs.getPropertyValue('--text-normal');
      if (v && v.trim()) labelCss = v.trim();
    } catch (e) {
      // ignore
    }

    for (const node of graph.nodes) {
      if (!showTags && node.type === 'tag') continue;
      const p = projectWorld(node);
      const baseRadius = getBaseNodeRadius(node);
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      // compute glow radius: explicit pixel radius wins, otherwise use multiplier * node radius
      const glowRadius = (glowRadiusPx != null && isFinite(glowRadiusPx) && glowRadiusPx > 0) ? glowRadiusPx : radius * DEFAULT_GLOW_MULTIPLIER;

      const focus = nodeFocusMap.get(node.id) ?? 1;
      const focused = focus > 0.01;

      if (focused) {
        // radial gradient glow: interpolate alpha between dim and centerAlpha
        const nodeColorOverride = (node && node.type === 'tag') ? (glowOptions?.tagColor ?? themeTagColor) : themeNodeColor; // tag color
        const accentRgb = colorToRgb(nodeColorOverride);
        const useNodeAlpha = (node && node.type === 'tag') ? (glowOptions?.tagColorAlpha ?? tagColorAlpha) : (glowOptions?.nodeColorAlpha ?? nodeColorAlpha);
        const useNodeMax = (node && node.type === 'tag') ? (glowOptions?.tagColorMaxAlpha ?? glowOptions?.tagColorAlpha ?? tagColorAlpha) : (glowOptions?.nodeColorMaxAlpha ?? glowOptions?.nodeColorAlpha ?? nodeColorAlpha);
        const dimCenter = clamp01(getBaseCenterAlpha(node) * dimFactor);
        const fullCenter = centerAlpha;
        let blendedCenter = dimCenter + (fullCenter - dimCenter) * focus;
        // When hovered/highlighted, force alpha to 1 for node/tag colors
        let effectiveUseNodeAlpha = useNodeAlpha;
        if (hoveredNodeId) {
          const inDepth = hoverHighlightSet.has(node.id);
          const isHovered = node.id === hoveredNodeId;
          if (isHovered || inDepth) {
            blendedCenter = 1;
            effectiveUseNodeAlpha = useNodeMax;
          }
        }
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
        gradient.addColorStop(0.0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.4, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.5 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.8, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.15 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(1.0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0)`);

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();

        // node body (focused -> blend alpha)
        const bodyAlpha = nodeMinBodyAlpha + (1 - nodeMinBodyAlpha) * focus;
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        const bodyColorOverride = (node && node.type === 'tag') ? (glowOptions?.tagColor ?? themeTagColor) : themeNodeColor;
        const accent = colorToRgb(bodyColorOverride);
        const useBodyAlpha = (node && node.type === 'tag') ? (glowOptions?.tagColorAlpha ?? tagColorAlpha) : (glowOptions?.nodeColorAlpha ?? nodeColorAlpha);
        const useBodyMax = (node && node.type === 'tag') ? (glowOptions?.tagColorMaxAlpha ?? glowOptions?.tagColorAlpha ?? tagColorAlpha) : (glowOptions?.nodeColorMaxAlpha ?? glowOptions?.nodeColorAlpha ?? nodeColorAlpha);
        // When hovered/highlighted, force body alpha to 1 for node/tag colors
        let effectiveUseBodyAlpha = useBodyAlpha;
        let finalBodyAlpha = bodyAlpha;
        if (hoveredNodeId) {
          const inDepthBody = hoverHighlightSet.has(node.id);
          const isHoveredBody = node.id === hoveredNodeId;
          if (isHoveredBody || inDepthBody) {
            finalBodyAlpha = 1;
            effectiveUseBodyAlpha = useBodyMax;
          }
        }
        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${finalBodyAlpha * effectiveUseBodyAlpha})`;
        ctx.fill();
        ctx.restore();

        // label below node (zoom-aware) - grow with hover and fade with focus
        const displayedFontBase = baseFontSize * scale; // px on screen without hover
        // compute scaleFactor from radius/baseRadius to match node growth
        const scaleFactor = baseRadius > 0 ? radius / baseRadius : 1;
        const displayedFont = displayedFontBase * scaleFactor;
        if (displayedFont >= hideBelow) {
          const clampedDisplayed = Math.max(minFontSize, Math.min(maxFontSize, displayedFont));
          const fontToSet = Math.max(1, (clampedDisplayed) / Math.max(0.0001, scale));
          ctx.save();
          ctx.font = `${fontToSet}px ${resolvedInterfaceFontFamily || 'sans-serif'}`;
          ctx.globalAlpha = focus; // fade label in/out
          // apply label alpha override if present
          const labelRgb = colorToRgb((glowOptions?.labelColor ?? labelCss) || '#ffffff');
          const useLabelAlpha = glowOptions?.labelColorAlpha ?? labelColorAlpha;
          ctx.fillStyle = `rgba(${labelRgb.r},${labelRgb.g},${labelRgb.b},${useLabelAlpha})`;
          const verticalPadding = 4; // world units; will be scaled by transform
          ctx.fillText(node.label, p.x, p.y + radius + verticalPadding);
          ctx.restore();
        }
      } else {
        // dimmed node: draw a faint fill but allow smooth focus factor (should be near 0)
        const faintRgb = colorToRgb(themeLabelColor || '#999');
        const faintAlpha = 0.15 * (1 - focus) + 0.1 * focus; // slightly adjust
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${faintRgb.r},${faintRgb.g},${faintRgb.b},${faintAlpha * (glowOptions?.nodeColorAlpha ?? nodeColorAlpha)})`;
        ctx.fill();
        ctx.restore();
      }
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

  function setRenderOptions(opts: { mutualDoubleLines?: boolean; showTags?: boolean }) {
    if (!opts) return;
    if (typeof opts.mutualDoubleLines === 'boolean') drawMutualDoubleLines = opts.mutualDoubleLines;
    if (typeof opts.showTags === 'boolean') showTags = opts.showTags;
  }

  function setGlowSettings(glow: GlowSettings) {
    if (!glow) return;
    // keep reference so render() reads up-to-date overrides (nodeColor/edgeColor/labelColor)
    glowOptions = glow;
    minRadius = glow.minNodeRadius;
    maxRadius = glow.maxNodeRadius;
    glowRadiusPx = (typeof glow.glowRadiusPx === 'number') ? glow.glowRadiusPx : glowRadiusPx;
    minCenterAlpha = glow.minCenterAlpha;
    maxCenterAlpha = glow.maxCenterAlpha;
    hoverBoost = glow.hoverBoostFactor;
    neighborBoost = glow.neighborBoostFactor ?? neighborBoost;
    dimFactor = glow.dimFactor ?? dimFactor;
    hoverHighlightDepth = glow.hoverHighlightDepth ?? hoverHighlightDepth;
    distanceInnerMultiplier = glow.distanceInnerRadiusMultiplier ?? distanceInnerMultiplier;
    distanceOuterMultiplier = glow.distanceOuterRadiusMultiplier ?? distanceOuterMultiplier;
    distanceCurveSteepness = glow.distanceCurveSteepness ?? distanceCurveSteepness;
    focusSmoothingRate = glow.focusSmoothingRate ?? focusSmoothingRate;
    edgeDimMin = glow.edgeDimMin ?? edgeDimMin;
    edgeDimMax = glow.edgeDimMax ?? edgeDimMax;
    nodeMinBodyAlpha = glow.nodeMinBodyAlpha ?? nodeMinBodyAlpha;
    nodeColorAlpha = (typeof glow.nodeColorAlpha === 'number') ? glow.nodeColorAlpha : nodeColorAlpha;
    tagColorAlpha = (typeof glow.tagColorAlpha === 'number') ? glow.tagColorAlpha : tagColorAlpha;
    labelColorAlpha = (typeof glow.labelColorAlpha === 'number') ? glow.labelColorAlpha : labelColorAlpha;
    edgeColorAlpha = (typeof glow.edgeColorAlpha === 'number') ? glow.edgeColorAlpha : edgeColorAlpha;
    nodeColorMaxAlpha = (typeof glow.nodeColorMaxAlpha === 'number') ? glow.nodeColorMaxAlpha : nodeColorMaxAlpha;
    tagColorMaxAlpha = (typeof glow.tagColorMaxAlpha === 'number') ? glow.tagColorMaxAlpha : tagColorMaxAlpha;
    edgeColorMaxAlpha = (typeof glow.edgeColorMaxAlpha === 'number') ? glow.edgeColorMaxAlpha : edgeColorMaxAlpha;
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

  // Convert a screen point (pixels, canvas coords) to a world position at a given camera-space depth.
  // zCam is the distance along the camera forward axis from the camera to the point (camera-space Z).
  function screenToWorldAtDepth(
    sx: number,
    sy: number,
    zCam: number,
    width: number,
    height: number,
    cam: Camera
  ) {
    const { yaw, pitch, distance, targetX, targetY, targetZ, zoom } = cam;

    // first convert screen coords into projected px/py (same space as projectWorld produced)
    const px = (sx - offsetX) / scale;
    const py = (sy - offsetY) / scale;

    const focal = 800; // match projectWorld
    const perspective = (zoom * focal) / (zCam || 0.0001);

    // camera-space x/y
    const xCam = px / perspective;
    const yCam = py / perspective;
    let cx = xCam;
    let cy = yCam;
    let cz = zCam;

    // Undo pitch (rotate around X axis by -pitch)
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const wy = cy * cosP + cz * sinP;
    const wz1 = -cy * sinP + cz * cosP;

    // Undo yaw (rotate around Y axis by -yaw)
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const wx = cx * cosY + wz1 * sinY;
    const wz = -cx * sinY + wz1 * cosY;

    return { x: wx + targetX, y: wy + targetY, z: wz + targetZ };
  }

  function getNodeScreenPosition(node: any): { x: number; y: number } {
    const p = projectWorld(node);
    return { x: p.x * scale + offsetX, y: p.y * scale + offsetY };
  }

  function getProjectedNode(node: any): { x: number; y: number; depth: number } {
    const p = projectWorld(node);
    return { x: p.x * scale + offsetX, y: p.y * scale + offsetY, depth: p.depth };
  }

  function getScale() { return scale; }

  // Camera basis helper: returns right, up, forward unit vectors in world space
  function getCameraBasis(cam: Camera) {
    const { yaw, pitch } = cam;

    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    const forward = {
      x: Math.sin(yaw) * cosPitch,
      y: sinPitch,
      z: Math.cos(yaw) * cosPitch,
    };

    const right = {
      x: cosYaw,
      y: 0,
      z: -sinYaw,
    };

    const up = {
      x: forward.y * right.z - forward.z * right.y,
      y: forward.z * right.x - forward.x * right.z,
      z: forward.x * right.y - forward.y * right.x,
    };

    const len = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z) || 1;
    up.x /= len; up.y /= len; up.z /= len;

    return { right, up, forward };
  }

  function zoomAt(screenX: number, screenY: number, factor: number) {
    if (factor <= 0) return;
    // prefer camera-based zoom by adjusting distance
    const cam = getCamera();
    let newDistance = cam.distance / factor;
    newDistance = Math.max(200, Math.min(5000, newDistance));
    setCamera({ distance: newDistance });
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
    setRenderOptions,
    zoomAt,
    panBy,
    screenToWorld,
      screenToWorldAtDepth,
    getNodeScreenPosition,
      getProjectedNode,
    getScale,
    setCamera,
    getCamera,
    getCameraBasis,
  };
}

