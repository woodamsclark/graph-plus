import { GraphSettings, PhysicsSettings, Renderer, GraphData, CameraState } from '../utils/interfaces';
import { getSettings } from '../utils/SettingsStore.ts';

// The renderer is responsible for rendering the 2D graph visualization onto an HTML canvas.
// The Graph Manager tells the renderer when and what to render
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const settings                                = getSettings();
  const context                                 = canvas.getContext('2d');
  let graph               : GraphData | null    = null;
  let nodeById            : Map<string, any>    = new Map();
  let minDegree           : number              = 0;
  let maxDegree           : number              = 0;
  let minEdgeCount        : number              = 1;
  let maxEdgeCount        : number              = 1;
  let innerRadius         : number              = 1.0; // fixed inner = 1×radius
  let hoveredNodeId       : string | null       = null;
  let hoverHighlightSet   : Set<string>         = new Set();
  let mouseX              : number              = 0;
  let mouseY              : number              = 0;
  const hoverScaleMax     : number              = 0.25; // +25% radius at full hover
  const hoverLerpSpeed    : number              = 0.2;  // how quickly hoverScale interpolates each frame (0-1)
  const nodeFocusMap      : Map<string, number> = new Map();
  let lastRenderTime      : number              = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  

  // theme-derived colors (updated each render)
  let themeNodeColor  = '#66ccff';
  let themeLabelColor = '#222';
  let themeEdgeColor  = '#888888';
  let themeTagColor   = '#8000ff';
  // resolved interface or monospace font families defined by theme
  let resolvedInterfaceFontFamily : string | null = null;
  let resolvedMonoFontFamily      : string | null = null;

  let camera: CameraState = { ...settings.camera.state };

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

  function setCameraState(newCamera : Partial<CameraState>) { camera = { ...camera, ...newCamera } as CameraState; }
  function getCameraState()         : CameraState           { return camera; }

  // Camera-based projection: returns projected world-plane coordinates
  function projectWorld(node: any): { x: number; y: number; depth: number } {
    const { yaw, pitch, distance, targetX, targetY, targetZ } = camera;
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
    const perspective = focal / safeDz;
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
    const oldWidth = canvas.width;
    const oldHeight = canvas.height;

    canvas.width  = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    canvas.style.width  = '100%';
    canvas.style.height = '100%';

    // Shift the offsets by half the delta.
    // This keeps the camera centered relative to the resize.
    // If width grows by 700px, we move the center right by 350px.
    camera.offsetX += (canvas.width  - oldWidth)  / 2;
    camera.offsetY += (canvas.height - oldHeight) / 2;

    render();
  }

  function getDegreeNormalized(node: any) {
    const d = (node.inDegree || 0);
    if (maxDegree <= minDegree) return 0.5;
    return (d - minDegree) / (maxDegree - minDegree);
  }

  function getNodeRadius(node: any) {
    const base = getBaseNodeRadius(node);
    // compute per-node hover scale factor
    let hoverScale   = 1;
    const isHovered  = hoveredNodeId === node.id;
    const isNeighbor = hoverHighlightSet && hoverHighlightSet.has(node.id);
    if (isHovered) {
      hoverScale = 1 + hoverScaleMax * settings.graph.hoverScale;
    } else if (isNeighbor) {
      hoverScale = 1 + (hoverScaleMax * 0.4) * settings.graph.hoverScale;
    }
    // Apply camera zoom scale so nodes grow/shrink as camera distance changes
    const zoomScale = settings.camera.state.distance / camera.distance;
    return base * hoverScale * zoomScale;
  }

  function getBaseNodeRadius(node: any) {
    const t = getDegreeNormalized(node);
    return settings.graph.minNodeRadius + t * (settings.graph.maxNodeRadius - settings.graph.minNodeRadius);
  }

  function getBaseCenterAlpha(node: any) {
    const t = getDegreeNormalized(node);
    return settings.graph.minCenterAlpha + t * (settings.graph.maxCenterAlpha - settings.graph.minCenterAlpha);
  }

  function getCenterAlpha(node: any) {
    const base = getBaseCenterAlpha(node);
    // CASE 1: No hovered node yet → only highlight profile based brightening
    if (!hoveredNodeId) {
      // Highlight factor based on highlight profile (0 far, 1 near)
      const hl = evalFalloff(node, buildHighlightProfile(node));
      // Interpolate between normal and highlighted brightness
      const normal = base;
      const highlighted = base;
      const blended = normal + (highlighted - normal) * hl;
      return clamp01(blended);
    }

    // CASE 2: There *is* a hovered node → apply depth + highlight profile
    const inDepth = hoverHighlightSet.has(node.id);
    const isHovered = node.id === hoveredNodeId;

    // Outside highlight depth → dimmed, no highlight effect
    if (!inDepth) return clamp01(base);

    // Inside highlight depth → use highlight profile
    const hl = evalFalloff(node, buildHighlightProfile(node)); // 0..1
    // Interpolate but without extra boost (legacy boosts removed)
    const normal = base;
    const highlighted = base;
    const blended = normal + (highlighted - normal) * hl;
    return clamp01(blended);
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

  type FalloffProfile = {
    inner: number;
    outer: number;
    curve: number;
  };

  function buildGravityProfile(node: any): FalloffProfile {
    const r = getNodeRadius(node);
    return {
      inner: r * innerRadius,
      outer: r * settings.physics.gravityRadius,
      curve: settings.physics.gravityFallOff,
    };
  }

  function buildLabelProfile(node: any): FalloffProfile {
    const r = getNodeRadius(node);
    return {
      inner: r * innerRadius,
      outer: r * settings.graph.labelRadius,
      curve: settings.physics.gravityFallOff,
    };
  }

  function buildHighlightProfile(node: any): FalloffProfile {
    const r = getNodeRadius(node);
    return {
      inner: r * innerRadius,
      outer: r * settings.graph.labelRadius,
      curve: settings.physics.gravityFallOff,
    };
  }

  function evalFalloff(node: any, profile: FalloffProfile): number {
    const { inner, outer, curve } = profile;

    if (outer <= inner || outer <= 0) return 0;

    const p  = projectWorld(node);
    const dx = mouseX - p.x;
    const dy = mouseY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= inner) return 1;
    if (dist >= outer) return 0;

    const t = (dist - inner) / (outer - inner);
    const proximity = 1 - t;
    return applySCurve(proximity, curve);
  }

  // removed unused getProjectedRadius helper

  function render() {
    if (!context) return;
    // compute time delta for smooth transitions
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    let dt = (now - lastRenderTime) / 1000;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    lastRenderTime = now;

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!graph) return;

    context.save();
      // Allow settings overrides first, then fall back to theme CSS vars
      if (settings.graph.nodeColor) themeNodeColor    = settings.graph.nodeColor;
      if (settings.graph.labelColor) themeLabelColor  = settings.graph.labelColor;
      if (settings.graph.edgeColor) themeEdgeColor    = settings.graph.edgeColor;
      try {
        const cs = window.getComputedStyle(canvas);
        const nodeVar  = cs.getPropertyValue('--interactive-accent' ) || cs.getPropertyValue('--accent-1'   ) || cs.getPropertyValue('--accent'     );
        const labelVar = cs.getPropertyValue('--text-normal'        ) || cs.getPropertyValue('--text');
        const edgeVar  = cs.getPropertyValue('--text-muted'         ) || cs.getPropertyValue('--text-faint' ) || cs.getPropertyValue('--text-normal');
        if (!settings.graph.nodeColor  && nodeVar  && nodeVar.trim()  ) themeNodeColor   = nodeVar.trim();
        if (!settings.graph.labelColor && labelVar && labelVar.trim() ) themeLabelColor  = labelVar.trim();
        if (!settings.graph.edgeColor  && edgeVar  && edgeVar.trim()  ) themeEdgeColor   = edgeVar.trim();
        // derive a theme tag color from secondary/accent vars (prefer explicit secondary accent if available)
        const tagVar = cs.getPropertyValue('--accent-2') || cs.getPropertyValue('--accent-secondary') || cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
        if (!settings.graph.tagColor && tagVar && tagVar.trim()) themeTagColor = tagVar.trim();
      } catch (e) {
        // ignore (e.g., server-side build environment)
      }

      // choose which font family to resolve based on setting: interface font or monospace
      try {
        const cs = window.getComputedStyle(canvas);
        if (settings.graph.useInterfaceFont) {
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
              el.style.left     = '-9999px';
              el.style.top      = '-9999px';
              el.textContent    = 'x';
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
              codeEl.style.left     = '-9999px';
              codeEl.style.top      = '-9999px';
              codeEl.textContent    = 'x';
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
        if (settings.graph.useInterfaceFont) resolvedInterfaceFontFamily = resolvedInterfaceFontFamily || 'sans-serif';
        else resolvedMonoFontFamily = resolvedMonoFontFamily || 'monospace';
      }

      context.save();
    context.translate(camera.offsetX, camera.offsetY);

    // Helper: determine whether a node is within the focused set (instant target)
    function isNodeTargetFocused(nodeId: string) {
      if (!hoveredNodeId) return true; // no hover -> everything focused
      if (nodeId === hoveredNodeId) return true;
      if (hoverHighlightSet && hoverHighlightSet.has(nodeId)) return true;
      return false;
    }

    // Smoothly update per-node focus factor towards target (exponential smoothing)
    function updateFocusMap() {
      if (!graph || !graph.nodes) return;
      for (const n of graph.nodes) {
        const id = n.id;
        const target = isNodeTargetFocused(id) ? 1 : 0;
        const cur = nodeFocusMap.get(id) ?? target;
        // exponential smoothing: alpha = 1 - exp(-rate * dt)
        const alpha = 1 - Math.exp(-settings.graph.focusSmoothing * dt);
        const next = cur + (target - cur) * alpha;
        nodeFocusMap.set(id, next);
      }
    }
    updateFocusMap();

    // Ease hoverScale towards target each frame (simple lerp)
    const targetHover                   = hoveredNodeId ? 1 : 0;
    settings.graph.hoverScale  += (targetHover - settings.graph.hoverScale) * hoverLerpSpeed;

    // Draw edges first so nodes appear on top. Draw per-edge so we can dim edges
    // that are outside the focus region (at least one endpoint not focused).
    if ((graph as any).edges && (graph as any).edges.length > 0) {
      const edgeRgb = colorToRgb(themeEdgeColor);
      for (const edge of (graph as any).edges) {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (!src || !tgt) continue;
        if (!settings.graph.showTags && (src.type === 'tag' || tgt.type === 'tag')) continue;
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
        const worldLineWidth = Math.max(0.4, screenW / Math.max(0.0001, 1));

        // compute alpha: when no hover, use default; otherwise interpolate between dim and strong
        let alpha = 0.65;
        if (!hoveredNodeId) alpha = 0.65;
        else alpha = 0.08 + (0.9 - 0.08) * edgeFocus; // interpolate
        // Do not force alpha here; we'll decide final alpha below using configured
        // per-color min/max alpha values so hover max can be customized.

        context.save();
      
        // Computer onHover alpha boost. Move to another function later. refactoring rn.
        let finalEdgeAlpha = settings.graph.edgeColorAlpha;
        if (hoveredNodeId) {
          const srcInDepth = hoverHighlightSet.has(edge.sourceId);
          const tgtInDepth = hoverHighlightSet.has(edge.targetId);
          const directlyIncident = edge.sourceId === hoveredNodeId || edge.targetId === hoveredNodeId;
          if ((srcInDepth && tgtInDepth) || directlyIncident) finalEdgeAlpha = 1.0;
        }
        context.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${finalEdgeAlpha})`;
        // mutual edges: draw two parallel lines offset perpendicular to the edge when enabled
        const isMutual = !!edge.bidirectional && settings.graph.drawDoubleLines;
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
          const offsetWorld = offsetPx;

          // first line (offset +)
          context.beginPath();
          context.moveTo(srcP.x + perpX * offsetWorld, srcP.y + perpY * offsetWorld);
          context.lineTo(tgtP.x + perpX * offsetWorld, tgtP.y + perpY * offsetWorld);
          context.lineWidth = worldLineWidth;
          context.stroke();

          // second line (offset -)
          context.beginPath();
          context.moveTo(srcP.x - perpX * offsetWorld, srcP.y - perpY * offsetWorld);
          context.lineTo(tgtP.x - perpX * offsetWorld, tgtP.y - perpY * offsetWorld);
          context.lineWidth = worldLineWidth;
          context.stroke();
        } else {
          context.beginPath();
          context.moveTo(srcP.x, srcP.y);
          context.lineTo(tgtP.x, tgtP.y);
          context.lineWidth = worldLineWidth;
          context.stroke();
        }

        context.restore();
      }
    }

    // Draw node glows (radial gradient), node bodies, and labels
    // Compute zoom-aware font sizing. Font size displayed on screen = baseFontSize * scale
    const baseFontSize    = settings.graph.labelBaseFontSize; // world-space base font size (configurable)
    const minFontSize     = 6; // px (screen)
    const maxFontSize     = 18; // px (screen)
    context.textAlign     = 'center';
    context.textBaseline  = 'top';

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
      if (!settings.graph.showTags && node.type === 'tag') continue;
      const p             = projectWorld(node);
      const baseRadius    = getBaseNodeRadius(node);
      const radius        = getNodeRadius(node);
      const centerAlpha   = getCenterAlpha(node);
      // Use the same outer radius as the gravity profile, so the visual glow
      // ring matches the outer limit of mouse attraction.
      const gravityProfile = buildGravityProfile(node);
      const gravityOuterR = gravityProfile.outer;


      const focus   = nodeFocusMap.get(node.id) ?? 1;
      const focused = focus > 0.01;

      if (focused) {
        // radial gradient glow: interpolate alpha between dim and centerAlpha
        const nodeColorOverride   = (node && node.type === 'tag') ? (settings.graph.tagColor ?? themeTagColor) : themeNodeColor; // tag color
        const accentRgb           = colorToRgb(nodeColorOverride);
        const useNodeAlpha        = (node && node.type === 'tag') ? (settings.graph.tagColorAlpha ?? settings.graph.tagColorAlpha) : (settings.graph.nodeColorAlpha ?? settings.graph.nodeColorAlpha);
        const dimCenter           = clamp01(getBaseCenterAlpha(node));
        const fullCenter          = centerAlpha;
        let blendedCenter         = dimCenter + (fullCenter - dimCenter) * focus;
        let effectiveUseNodeAlpha = settings.graph.tagColorAlpha;
        if (hoveredNodeId) {
          const inDepth = hoverHighlightSet.has(node.id);
          const isHovered = node.id === hoveredNodeId;
          if (isHovered || inDepth) {
            blendedCenter = 1;
            // Use max alpha for hovered/highlighted node glows
            effectiveUseNodeAlpha = 1.0;//(node && node.type==='tag') ? tagMaxAlpha : nodeMaxAlpha;
          }
        }

        const gradient = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * settings.physics.gravityRadius);
        gradient.addColorStop(0.0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.4, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.5 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.8, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.15 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(1.0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0)`);

        context.save();
        context.beginPath();
        context.arc(p.x, p.y, radius * settings.physics.gravityRadius, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();
        context.restore();

        // node body (focused -> blend alpha)
        const bodyAlpha = settings.graph.labelColorAlpha;// + (1 - labelAlphaMin) * focus;
        context.save();
        context.beginPath();
        context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        const bodyColorOverride = (node && node.type === 'tag') ? (settings.graph.tagColor ?? themeTagColor) : themeNodeColor;
        const accent = colorToRgb(bodyColorOverride);
        const useBodyAlpha = (node && node.type === 'tag') ? (settings.graph.tagColorAlpha ?? settings.graph.tagColorAlpha) : (settings.graph.nodeColorAlpha ?? settings.graph.nodeColorAlpha);
        // When hovered/highlighted, force body alpha to 1 for node/tag colors
        //let effectiveUseBodyAlpha = Math.max((node && node.type==='tag')?tagMinAlpha:nodeMinAlpha, useBodyAlpha);
        let effectiveUseBodyAlpha = useBodyAlpha;
        let finalBodyAlpha        = bodyAlpha;
        if (hoveredNodeId) {
          const inDepthBody   = hoverHighlightSet.has(node.id);
          const isHoveredBody = node.id === hoveredNodeId;
          if (isHoveredBody || inDepthBody) {
            finalBodyAlpha = 1;
            // Use max alpha for hovered/highlighted node bodies
            effectiveUseBodyAlpha = 1; //(node && node.type==='tag') ? tagMaxAlpha : nodeMaxAlpha;
          }
        }
        context.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${finalBodyAlpha * effectiveUseBodyAlpha})`;
        context.fill();
        context.restore();

        // label below node (zoom-aware) - grow with hover and fade with focus
        // incorporate camera zoom scale so labels scale with camera distance
        // Font size invariant to zoom
        const displayedFont   = settings.graph.labelBaseFontSize;
        const radiusScreenPx  = radius;
        let labelAlphaVis     = 1;
        const minR            = 0;
        const fadeRange       = Math.max(0, settings.graph.labelFadeRangePx);
        if (radiusScreenPx <= minR) {
          labelAlphaVis = 0;
        } else if (radiusScreenPx <= minR + fadeRange) {
          const t = (radiusScreenPx - minR) / Math.max(0.0001, fadeRange);
          labelAlphaVis = Math.max(0, Math.min(1, t));
        } else {
          labelAlphaVis = 1;
        }
        // Also allow mouse proximity to reveal labels: compute proximity (0..1)
        // and blend it with the radius-based visibility so labels start to appear
        // as the mouse approaches small nodes.
        const proximityFactor = evalFalloff(node, buildLabelProfile(node)); // 0..1
        // blend: if either screen-size or proximity suggests visibility, allow it
        labelAlphaVis = Math.max(labelAlphaVis, labelAlphaVis + proximityFactor * (1 - labelAlphaVis));
        // Always show label at full visibility if hovered or in highlight set
        const isHoverOrHighlight = hoveredNodeId === node.id || (hoverHighlightSet && hoverHighlightSet.has(node.id));
        if (isHoverOrHighlight) labelAlphaVis = 1;

        if (labelAlphaVis > 0) {
          const clampedDisplayed = Math.max(minFontSize, Math.min(maxFontSize, displayedFont));
          const fontToSet = Math.max(1, (clampedDisplayed));
          context.save();
          context.font = `${fontToSet}px ${resolvedInterfaceFontFamily || 'sans-serif'}`;
            // Compute final alpha from label visibility. For hovered/highlighted
            // nodes we force full alpha (1.0) so labels are never partially transparent.
            const isHoverOrHighlight = hoveredNodeId === node.id || (hoverHighlightSet && hoverHighlightSet.has(node.id));
            const centerA = isHoverOrHighlight ? 1.0 : clamp01(getCenterAlpha(node));
            // derive label alpha by focus state
            let labelA = Math.max(settings.graph.labelColorAlpha, labelAlphaVis * (settings.graph.labelColorAlpha));
            if (isHoverOrHighlight) labelA = settings.graph.labelColorAlpha;
            else if (hoveredNodeId && hoverHighlightSet.has(node.id)) labelA = Math.max(labelA, (settings.graph.labelColorAlpha));
            context.globalAlpha = Math.max(0, Math.min(1, labelA * centerA));
            // apply label alpha override if present, but force to 1.0 for hovered/highlighted
            const labelRgb = colorToRgb((settings.graph.labelColor) || '#ffffff');
            context.fillStyle = `rgba(${labelRgb.r},${labelRgb.g},${labelRgb.b},1.0)`;
          const verticalPadding = 4; // world units; will be scaled by transform
          context.fillText(node.label, p.x, p.y + radius + verticalPadding);
          context.restore();
        }
      } else {
        // dimmed node: draw a faint fill but allow smooth focus factor (should be near 0)
        const faintRgb = colorToRgb(themeLabelColor || '#999');
        const faintAlpha = 0.15 * (1 - focus) + 0.1 * focus; // slightly adjust
        // Modulate the faint fill by centerAlpha 
        const effectiveCenterAlpha = clamp01(getCenterAlpha(node));
        const finalAlpha = faintAlpha * effectiveCenterAlpha * (settings.graph.nodeColorAlpha);
        context.save();
        context.beginPath();
        context.arc(p.x, p.y, radius * 0.9, 0, Math.PI * 2);
        context.fillStyle = `rgba(${faintRgb.r},${faintRgb.g},${faintRgb.b},${finalAlpha})`;
        context.fill();
        context.restore();
      }
    }

    context.restore();
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

 

  function screenToWorld2D(screenX: number, screenY: number) {
    return { x: (screenX - camera.offsetX), y: (screenY - camera.offsetY) };
  }

  // Convert a screen point (pixels, canvas coords) to a world position at a given camera-space depth.
  // zCam is the distance along the camera forward axis from the camera to the point (camera-space Z).
  function screenToWorld3D(sx: number,sy: number,zCam: number,cam?: CameraState) {
    const { yaw, pitch, distance, targetX, targetY, targetZ } = cam || getCameraState();

    // first convert screen coords into projected px/py (same space as projectWorld produced)
    const px = (sx - camera.offsetX);
    const py = (sy - camera.offsetY);

    const focal = 800; // match projectWorld
    const perspective = (focal) / (zCam || 0.0001);

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
    return { x: p.x + camera.offsetX, y: p.y + camera.offsetY };
  }

  function getProjectedNode(node: any): { x: number; y: number; depth: number } {
    const p = projectWorld(node);
    return { x: p.x + camera.offsetX, y: p.y + camera.offsetY, depth: p.depth };
  }

  // Camera basis helper: returns right, up, forward unit vectors in world space
  function getCameraBasis(cam: CameraState) {
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
    const cam       = getCameraState();
    let newDistance = cam.distance / factor;
    newDistance     = Math.max(200, Math.min(5000, newDistance));
    setCameraState({ distance: newDistance });
    render();
  }

  function resetCamera(){
    camera = { ...settings.camera.state };
    recenterCamera();
  }
  
  function recenterCamera() {
    const w = canvas.width || 1;
    const h = canvas.height || 1;
    camera.offsetX = w / 2;
    camera.offsetY = h / 2;
    render();
  }

  return {
    setGraph,
    resize,
    render,
    destroy,
    setHoveredNode,
    getNodeRadiusForHit,
    zoomAt,
    screenToWorld2D: screenToWorld2D,
    screenToWorld3D: screenToWorld3D,
    getNodeScreenPosition,
    getProjectedNode,
    resetCamera: resetCamera,
    recenterCamera: recenterCamera,
    setCameraState     : setCameraState,
    getCameraState     : getCameraState,
    getCameraBasis,
  };
}

