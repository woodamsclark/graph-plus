var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  DEFAULT_SETTINGS: () => DEFAULT_SETTINGS,
  default: () => GreaterGraphPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// GraphView2.ts
var import_obsidian = require("obsidian");

// graph/buildGraph.ts
async function buildGraph(app, options) {
  const files = app.vault.getMarkdownFiles();
  const nodes = files.map((file) => ({
    id: file.path,
    filePath: file.path,
    file,
    label: file.basename,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    inDegree: 0,
    outDegree: 0,
    totalDegree: 0
  }));
  const nodeByPath = /* @__PURE__ */ new Map();
  for (const n of nodes)
    nodeByPath.set(n.id, n);
  const resolved = app.metadataCache.resolvedLinks || {};
  const edges = [];
  const edgeSet = /* @__PURE__ */ new Set();
  const countDuplicates = Boolean(options?.countDuplicates);
  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath] || {};
    for (const targetPath of Object.keys(targets)) {
      if (!nodeByPath.has(sourcePath) || !nodeByPath.has(targetPath))
        continue;
      const key = `${sourcePath}->${targetPath}`;
      if (!edgeSet.has(key)) {
        const rawCount = Number(targets[targetPath] || 1) || 1;
        const linkCount = countDuplicates ? rawCount : 1;
        edges.push({ id: key, sourceId: sourcePath, targetId: targetPath, linkCount, hasReverse: false });
        edgeSet.add(key);
      }
    }
  }
  for (const e of edges) {
    const src = nodeByPath.get(e.sourceId);
    const tgt = nodeByPath.get(e.targetId);
    if (!src || !tgt)
      continue;
    const c = Number(e.linkCount || 1) || 1;
    src.outDegree = (src.outDegree || 0) + c;
    tgt.inDegree = (tgt.inDegree || 0) + c;
  }
  for (const n of nodes) {
    n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0);
  }
  const edgeMap = /* @__PURE__ */ new Map();
  for (const e of edges) {
    edgeMap.set(`${e.sourceId}->${e.targetId}`, e);
  }
  for (const e of edges) {
    const reverseKey = `${e.targetId}->${e.sourceId}`;
    if (edgeMap.has(reverseKey)) {
      e.hasReverse = true;
      const other = edgeMap.get(reverseKey);
      other.hasReverse = true;
    }
  }
  return { nodes, edges };
}

// graph/layout2d.ts
function layoutGraph2D(graph, options) {
  const { width, height, margin = 32 } = options;
  const allNodes = graph.nodes;
  if (!allNodes || allNodes.length === 0)
    return;
  const centerX = options.centerX ?? width / 2;
  const centerY = options.centerY ?? height / 2;
  const jitter = typeof options.jitter === "number" ? options.jitter : 8;
  const nodes = options.onlyNodes ?? allNodes;
  if (!nodes || nodes.length === 0)
    return;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rx = (Math.random() * 2 - 1) * jitter;
    const ry = (Math.random() * 2 - 1) * jitter;
    node.x = centerX + rx;
    node.y = centerY + ry;
    node.z = 0;
  }
  if (options.centerOnLargestNode && !options.onlyNodes) {
    let centerNode = null;
    let maxDeg = -Infinity;
    for (const n of allNodes) {
      const d = n.totalDegree || 0;
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

// graph/renderer2d.ts
function createRenderer2D(options) {
  const canvas = options.canvas;
  const glowOptions = options.glow;
  const ctx = canvas.getContext("2d");
  let graph = null;
  let nodeById = /* @__PURE__ */ new Map();
  let minDegree = 0;
  let maxDegree = 0;
  let minEdgeCount = 1;
  let maxEdgeCount = 1;
  let minRadius = glowOptions?.minNodeRadius ?? 4;
  let maxRadius = glowOptions?.maxNodeRadius ?? 14;
  const DEFAULT_GLOW_MULTIPLIER = 2;
  let glowRadiusPx = glowOptions?.glowRadiusPx ?? null;
  let minCenterAlpha = glowOptions?.minCenterAlpha ?? 0.05;
  let maxCenterAlpha = glowOptions?.maxCenterAlpha ?? 0.35;
  let hoverBoost = glowOptions?.hoverBoostFactor ?? 1.5;
  let neighborBoost = glowOptions?.neighborBoostFactor ?? 1;
  let dimFactor = glowOptions?.dimFactor ?? 0.25;
  let hoverHighlightDepth = glowOptions?.hoverHighlightDepth ?? 1;
  let distanceInnerMultiplier = glowOptions?.distanceInnerRadiusMultiplier ?? 1;
  let distanceOuterMultiplier = glowOptions?.distanceOuterRadiusMultiplier ?? 2.5;
  let distanceCurveSteepness = glowOptions?.distanceCurveSteepness ?? 2;
  let hoveredNodeId = null;
  let hoverHighlightSet = /* @__PURE__ */ new Set();
  let mouseX = 0;
  let mouseY = 0;
  let hoverScale = 0;
  const hoverScaleMax = 0.25;
  const hoverLerpSpeed = 0.2;
  const nodeFocusMap = /* @__PURE__ */ new Map();
  let lastRenderTime = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  let focusSmoothingRate = glowOptions?.focusSmoothingRate ?? 8;
  let edgeDimMin = glowOptions?.edgeDimMin ?? 0.08;
  let edgeDimMax = glowOptions?.edgeDimMax ?? 0.9;
  let nodeMinBodyAlpha = glowOptions?.nodeMinBodyAlpha ?? 0.3;
  let themeNodeColor = "#66ccff";
  let themeLabelColor = "#222";
  let themeEdgeColor = "#888888";
  function parseHexColor(hex) {
    if (!hex)
      return null;
    hex = hex.trim();
    if (hex.startsWith("#"))
      hex = hex.slice(1);
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
  function parseRgbString(s) {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m)
      return null;
    const parts = m[1].split(",").map((p) => Number(p.trim()));
    if (parts.length < 3)
      return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  function colorToRgb(color) {
    if (!color)
      return { r: 102, g: 204, b: 255 };
    const fromHex = parseHexColor(color);
    if (fromHex)
      return fromHex;
    const fromRgb = parseRgbString(color);
    if (fromRgb)
      return fromRgb;
    return { r: 102, g: 204, b: 255 };
  }
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const minScale = 0.25;
  const maxScale = 4;
  function setGraph(g) {
    graph = g;
    nodeById = /* @__PURE__ */ new Map();
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        nodeById.set(n.id, n);
        if (!nodeFocusMap.has(n.id))
          nodeFocusMap.set(n.id, 1);
      }
    }
    minDegree = Infinity;
    maxDegree = -Infinity;
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        const d = n.inDegree || 0;
        if (d < minDegree)
          minDegree = d;
        if (d > maxDegree)
          maxDegree = d;
      }
    }
    minEdgeCount = Infinity;
    maxEdgeCount = -Infinity;
    if (graph && graph.edges) {
      for (const e of graph.edges) {
        const c = Number(e.linkCount || 1) || 1;
        if (c < minEdgeCount)
          minEdgeCount = c;
        if (c > maxEdgeCount)
          maxEdgeCount = c;
      }
    }
    if (!isFinite(minDegree))
      minDegree = 0;
    if (!isFinite(maxDegree))
      maxDegree = 0;
  }
  function resize(width, height) {
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    render();
  }
  function getDegreeNormalized(node) {
    const d = node.inDegree || 0;
    if (maxDegree <= minDegree)
      return 0.5;
    return (d - minDegree) / (maxDegree - minDegree);
  }
  function getNodeRadius(node) {
    const base = getBaseNodeRadius(node);
    let scaleFactor = 1;
    const isHovered = hoveredNodeId === node.id;
    const isNeighbor = hoverHighlightSet && hoverHighlightSet.has(node.id);
    if (isHovered) {
      scaleFactor = 1 + hoverScaleMax * hoverScale;
    } else if (isNeighbor) {
      scaleFactor = 1 + hoverScaleMax * 0.4 * hoverScale;
    }
    return base * scaleFactor;
  }
  function getBaseNodeRadius(node) {
    const t = getDegreeNormalized(node);
    return minRadius + t * (maxRadius - minRadius);
  }
  function getBaseCenterAlpha(node) {
    const t = getDegreeNormalized(node);
    return minCenterAlpha + t * (maxCenterAlpha - minCenterAlpha);
  }
  function getCenterAlpha(node) {
    const base = getBaseCenterAlpha(node);
    if (!hoveredNodeId) {
      const distFactor2 = getMouseDistanceFactor(node);
      const boost = 1 + (neighborBoost - 1) * distFactor2;
      return clamp01(base * boost);
    }
    const inDepth = hoverHighlightSet.has(node.id);
    const isHovered = node.id === hoveredNodeId;
    if (!inDepth)
      return clamp01(base * dimFactor);
    const distFactor = getMouseDistanceFactor(node);
    if (isHovered) {
      const boost = 1 + (hoverBoost - 1) * distFactor;
      return clamp01(base * boost);
    } else {
      const boost = 1 + (neighborBoost - 1) * distFactor;
      return clamp01(base * boost);
    }
  }
  function clamp01(v) {
    if (v <= 0)
      return 0;
    if (v >= 1)
      return 1;
    return v;
  }
  function applySCurve(p, steepness) {
    if (p <= 0)
      return 0;
    if (p >= 1)
      return 1;
    const k = steepness <= 0 ? 1e-4 : steepness;
    const a = Math.pow(p, k);
    const b = Math.pow(1 - p, k);
    if (a + b === 0)
      return 0.5;
    return a / (a + b);
  }
  function getMouseDistanceFactor(node) {
    const radius = getNodeRadius(node);
    const innerR = radius * distanceInnerMultiplier;
    const outerR = radius * distanceOuterMultiplier;
    if (outerR <= innerR || outerR <= 0)
      return 0;
    const dx = mouseX - node.x;
    const dy = mouseY - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= innerR)
      return 1;
    if (dist >= outerR)
      return 0;
    const t = (dist - innerR) / (outerR - innerR);
    const proximity = 1 - t;
    return applySCurve(proximity, distanceCurveSteepness);
  }
  function render() {
    if (!ctx)
      return;
    const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    let dt = (now - lastRenderTime) / 1e3;
    if (!isFinite(dt) || dt <= 0)
      dt = 0.016;
    if (dt > 0.1)
      dt = 0.1;
    lastRenderTime = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!graph)
      return;
    ctx.save();
    if (glowOptions?.nodeColor)
      themeNodeColor = glowOptions.nodeColor;
    if (glowOptions?.labelColor)
      themeLabelColor = glowOptions.labelColor;
    if (glowOptions?.edgeColor)
      themeEdgeColor = glowOptions.edgeColor;
    try {
      const cs = window.getComputedStyle(canvas);
      const nodeVar = cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
      const labelVar = cs.getPropertyValue("--text-normal") || cs.getPropertyValue("--text");
      const edgeVar = cs.getPropertyValue("--text-muted") || cs.getPropertyValue("--text-faint") || cs.getPropertyValue("--text-normal");
      if (!glowOptions?.nodeColor && nodeVar && nodeVar.trim())
        themeNodeColor = nodeVar.trim();
      if (!glowOptions?.labelColor && labelVar && labelVar.trim())
        themeLabelColor = labelVar.trim();
      if (!glowOptions?.edgeColor && edgeVar && edgeVar.trim())
        themeEdgeColor = edgeVar.trim();
    } catch (e) {
    }
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    function isNodeTargetFocused(nodeId) {
      if (!hoveredNodeId)
        return true;
      if (nodeId === hoveredNodeId)
        return true;
      if (hoverHighlightSet && hoverHighlightSet.has(nodeId))
        return true;
      return false;
    }
    function updateFocusFactors() {
      if (!graph || !graph.nodes)
        return;
      for (const n of graph.nodes) {
        const id = n.id;
        const target = isNodeTargetFocused(id) ? 1 : 0;
        const cur = nodeFocusMap.get(id) ?? target;
        const alpha = 1 - Math.exp(-focusSmoothingRate * dt);
        const next = cur + (target - cur) * alpha;
        nodeFocusMap.set(id, next);
      }
    }
    updateFocusFactors();
    const targetHover = hoveredNodeId ? 1 : 0;
    hoverScale += (targetHover - hoverScale) * hoverLerpSpeed;
    if (graph.edges && graph.edges.length > 0) {
      const edgeRgb = colorToRgb(themeEdgeColor);
      for (const edge of graph.edges) {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (!src || !tgt)
          continue;
        const srcF = nodeFocusMap.get(edge.sourceId) ?? 1;
        const tgtF = nodeFocusMap.get(edge.targetId) ?? 1;
        const edgeFocus = (srcF + tgtF) * 0.5;
        const c = Number(edge.linkCount || 1) || 1;
        let t = 0.5;
        if (maxEdgeCount > minEdgeCount)
          t = (c - minEdgeCount) / (maxEdgeCount - minEdgeCount);
        const minScreenW = 0.8;
        const maxScreenW = 6;
        const screenW = minScreenW + t * (maxScreenW - minScreenW);
        const worldLineWidth = Math.max(0.4, screenW / Math.max(1e-4, scale));
        let alpha = 0.65;
        if (!hoveredNodeId)
          alpha = 0.65;
        else
          alpha = 0.08 + (0.9 - 0.08) * edgeFocus;
        ctx.save();
        ctx.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${alpha})`;
        const isMutual = !!edge.hasReverse;
        if (isMutual) {
          const dx = tgt.x - src.x;
          const dy = tgt.y - src.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const perpX = -uy;
          const perpY = ux;
          const offsetPx = Math.max(2, screenW * 0.6);
          const offsetWorld = offsetPx / Math.max(1e-4, scale);
          ctx.beginPath();
          ctx.moveTo(src.x + perpX * offsetWorld, src.y + perpY * offsetWorld);
          ctx.lineTo(tgt.x + perpX * offsetWorld, tgt.y + perpY * offsetWorld);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(src.x - perpX * offsetWorld, src.y - perpY * offsetWorld);
          ctx.lineTo(tgt.x - perpX * offsetWorld, tgt.y - perpY * offsetWorld);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    const baseFontSize = 10;
    const minFontSize = 6;
    const maxFontSize = 18;
    const hideBelow = 7;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let labelCss = themeLabelColor;
    try {
      const cs = window.getComputedStyle(canvas);
      const v = cs.getPropertyValue("--text-normal");
      if (v && v.trim())
        labelCss = v.trim();
    } catch (e) {
    }
    for (const node of graph.nodes) {
      const baseRadius = getBaseNodeRadius(node);
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      const glowRadius = glowRadiusPx != null && isFinite(glowRadiusPx) && glowRadiusPx > 0 ? glowRadiusPx : radius * DEFAULT_GLOW_MULTIPLIER;
      const focus = nodeFocusMap.get(node.id) ?? 1;
      const focused = focus > 0.01;
      if (focused) {
        const accentRgb = colorToRgb(themeNodeColor);
        const dimCenter = clamp01(getBaseCenterAlpha(node) * dimFactor);
        const fullCenter = centerAlpha;
        const blendedCenter = dimCenter + (fullCenter - dimCenter) * focus;
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
        gradient.addColorStop(0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter})`);
        gradient.addColorStop(0.4, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.5})`);
        gradient.addColorStop(0.8, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.15})`);
        gradient.addColorStop(1, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0)`);
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
        const bodyAlpha = nodeMinBodyAlpha + (1 - nodeMinBodyAlpha) * focus;
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        const accent = colorToRgb(themeNodeColor);
        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${bodyAlpha})`;
        ctx.fill();
        ctx.restore();
        const displayedFontBase = baseFontSize * scale;
        const scaleFactor = baseRadius > 0 ? radius / baseRadius : 1;
        const displayedFont = displayedFontBase * scaleFactor;
        if (displayedFont >= hideBelow) {
          const clampedDisplayed = Math.max(minFontSize, Math.min(maxFontSize, displayedFont));
          const fontToSet = Math.max(1, clampedDisplayed / Math.max(1e-4, scale));
          ctx.save();
          ctx.font = `${fontToSet}px sans-serif`;
          ctx.globalAlpha = focus;
          ctx.fillStyle = labelCss || "#ffffff";
          const verticalPadding = 4;
          ctx.fillText(node.label, node.x, node.y + radius + verticalPadding);
          ctx.restore();
        }
      } else {
        const faintRgb = colorToRgb(themeLabelColor || "#999");
        const faintAlpha = 0.15 * (1 - focus) + 0.1 * focus;
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${faintRgb.r},${faintRgb.g},${faintRgb.b},${faintAlpha})`;
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }
  function destroy() {
    graph = null;
  }
  function setHoveredNode(nodeId) {
    hoveredNodeId = nodeId;
  }
  function getNodeRadiusForHit(node) {
    return getNodeRadius(node);
  }
  function setGlowSettings(glow) {
    if (!glow)
      return;
    minRadius = glow.minNodeRadius;
    maxRadius = glow.maxNodeRadius;
    glowRadiusPx = typeof glow.glowRadiusPx === "number" ? glow.glowRadiusPx : glowRadiusPx;
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
  }
  function setHoverState(hoveredId, highlightedIds, mx, my) {
    hoveredNodeId = hoveredId;
    hoverHighlightSet = highlightedIds ? new Set(highlightedIds) : /* @__PURE__ */ new Set();
    mouseX = mx || 0;
    mouseY = my || 0;
  }
  function screenToWorld(screenX, screenY) {
    return { x: (screenX - offsetX) / scale, y: (screenY - offsetY) / scale };
  }
  function zoomAt(screenX, screenY, factor) {
    if (factor <= 0)
      return;
    const worldBefore = screenToWorld(screenX, screenY);
    scale *= factor;
    if (scale < minScale)
      scale = minScale;
    if (scale > maxScale)
      scale = maxScale;
    const worldAfter = worldBefore;
    offsetX = screenX - worldAfter.x * scale;
    offsetY = screenY - worldAfter.y * scale;
    render();
  }
  function panBy(screenDx, screenDy) {
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
    screenToWorld
  };
}

// graph/simulation.ts
function createSimulation(nodes, edges, options) {
  let repulsionStrength = options?.repulsionStrength ?? 1500;
  let springStrength = options?.springStrength ?? 0.04;
  let springLength = options?.springLength ?? 100;
  let centerPull = options?.centerPull ?? 0;
  let damping = options?.damping ?? 0.9;
  let mouseAttractionRadius = options?.mouseAttractionRadius ?? 80;
  let mouseAttractionStrength = options?.mouseAttractionStrength ?? 0.15;
  let mouseAttractionExponent = options?.mouseAttractionExponent ?? 3.5;
  let centerX = typeof options?.centerX === "number" ? options.centerX : void 0;
  let centerY = typeof options?.centerY === "number" ? options.centerY : void 0;
  let centerNodeId = options?.centerNodeId ?? null;
  if (typeof centerX !== "number" || typeof centerY !== "number") {
    if (nodes && nodes.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        if (x < minX)
          minX = x;
        if (x > maxX)
          maxX = x;
        if (y < minY)
          minY = y;
        if (y > maxY)
          maxY = y;
      }
      if (!isFinite(minX) || !isFinite(maxX)) {
        centerX = 0;
      } else {
        centerX = (minX + maxX) / 2;
      }
      if (!isFinite(minY) || !isFinite(maxY)) {
        centerY = 0;
      } else {
        centerY = (minY + maxY) / 2;
      }
    } else {
      centerX = 0;
      centerY = 0;
    }
  }
  let centerNode = null;
  if (centerNodeId && nodes) {
    centerNode = nodes.find((n) => n.id === centerNodeId) || null;
  }
  let running = false;
  const nodeById = /* @__PURE__ */ new Map();
  for (const n of nodes)
    nodeById.set(n.id, n);
  let pinnedNodes = /* @__PURE__ */ new Set();
  let mouseX = null;
  let mouseY = null;
  let mouseHoveredNodeId = null;
  function applyRepulsion() {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy + 0.01;
        const minDist = 40;
        let dist = Math.sqrt(distSq);
        if (dist < 0.01)
          dist = 0.01;
        const clamped = Math.max(dist, minDist);
        const force = repulsionStrength / (clamped * clamped);
        if (dist > 0) {
          const fx = dx / dist * force;
          const fy = dy / dist * force;
          if (!pinnedNodes.has(a.id)) {
            a.vx = (a.vx || 0) + fx;
            a.vy = (a.vy || 0) + fy;
          }
          if (!pinnedNodes.has(b.id)) {
            b.vx = (b.vx || 0) - fx;
            b.vy = (b.vy || 0) - fy;
          }
        } else {
          const fx = (Math.random() - 0.5) * 0.1;
          const fy = (Math.random() - 0.5) * 0.1;
          if (!pinnedNodes.has(a.id)) {
            a.vx = (a.vx || 0) + fx;
            a.vy = (a.vy || 0) + fy;
          }
          if (!pinnedNodes.has(b.id)) {
            b.vx = (b.vx || 0) - fx;
            b.vy = (b.vy || 0) - fy;
          }
        }
      }
    }
  }
  function applySprings() {
    if (!edges)
      return;
    for (const e of edges) {
      const a = nodeById.get(e.sourceId);
      const b = nodeById.get(e.targetId);
      if (!a || !b)
        continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const diff = dist - springLength;
      const f = springStrength * Math.tanh(diff / 50);
      const fx = dx / dist * f;
      const fy = dy / dist * f;
      if (!pinnedNodes.has(a.id)) {
        a.vx = (a.vx || 0) + fx;
        a.vy = (a.vy || 0) + fy;
      }
      if (!pinnedNodes.has(b.id)) {
        b.vx = (b.vx || 0) - fx;
        b.vy = (b.vy || 0) - fy;
      }
    }
  }
  function applyCentering() {
    if (centerPull <= 0)
      return;
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      const x = (n.x || 0) - cx;
      const y = (n.y || 0) - cy;
      const r = Math.sqrt(x * x + y * y) + 1e-3;
      const pull = centerPull * (r / 200);
      n.vx = (n.vx || 0) + -(x / r) * pull;
      n.vy = (n.vy || 0) + -(y / r) * pull;
    }
    if (centerNode) {
      const dx = (centerNode.x || 0) - cx;
      const dy = (centerNode.y || 0) - cy;
      centerNode.vx = (centerNode.vx || 0) - dx * centerPull * 0.5;
      centerNode.vy = (centerNode.vy || 0) - dy * centerPull * 0.5;
    }
  }
  function applyDamping() {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      n.vx = (n.vx || 0) * damping;
      n.vy = (n.vy || 0) * damping;
      if (Math.abs(n.vx) < 1e-3)
        n.vx = 0;
      if (Math.abs(n.vy) < 1e-3)
        n.vy = 0;
    }
  }
  function applyMouseAttraction() {
    if (mouseX == null || mouseY == null)
      return;
    if (!mouseHoveredNodeId)
      return;
    const node = nodeById.get(mouseHoveredNodeId);
    if (!node)
      return;
    if (pinnedNodes.has(node.id))
      return;
    const radius = mouseAttractionRadius ?? 80;
    const strength = mouseAttractionStrength ?? 0.15;
    const exponent = mouseAttractionExponent ?? 3.5;
    const dx = mouseX - node.x;
    const dy = mouseY - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!dist || dist > radius)
      return;
    const t = 1 - dist / radius;
    const forceMag = strength * Math.pow(Math.max(0, t), exponent);
    const fx = dx / (dist || 1) * forceMag;
    const fy = dy / (dist || 1) * forceMag;
    node.vx = (node.vx || 0) + fx;
    node.vy = (node.vy || 0) + fy;
  }
  function integrate(dt) {
    const scale = dt * 60;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      n.x += (n.vx || 0) * scale;
      n.y += (n.vy || 0) * scale;
    }
  }
  function tick(dt) {
    if (!running)
      return;
    applyRepulsion();
    applySprings();
    applyCentering();
    applyMouseAttraction();
    applyDamping();
    integrate(dt);
  }
  function start() {
    running = true;
  }
  function stop() {
    running = false;
  }
  function reset() {
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }
  }
  function setOptions(opts) {
    if (!opts)
      return;
    if (typeof opts.repulsionStrength === "number")
      repulsionStrength = opts.repulsionStrength;
    if (typeof opts.springStrength === "number")
      springStrength = opts.springStrength;
    if (typeof opts.springLength === "number")
      springLength = opts.springLength;
    if (typeof opts.centerPull === "number")
      centerPull = opts.centerPull;
    if (typeof opts.damping === "number")
      damping = opts.damping;
    if (typeof opts.centerX === "number")
      centerX = opts.centerX;
    if (typeof opts.centerY === "number")
      centerY = opts.centerY;
    if (typeof opts.centerNodeId === "string") {
      centerNodeId = opts.centerNodeId;
      centerNode = nodes.find((n) => n.id === centerNodeId) || null;
    }
    if (typeof opts.mouseAttractionRadius === "number")
      mouseAttractionRadius = opts.mouseAttractionRadius;
    if (typeof opts.mouseAttractionStrength === "number")
      mouseAttractionStrength = opts.mouseAttractionStrength;
    if (typeof opts.mouseAttractionExponent === "number")
      mouseAttractionExponent = opts.mouseAttractionExponent;
  }
  function setPinnedNodes(ids) {
    pinnedNodes = new Set(ids || []);
  }
  function setMouseAttractor(x, y, nodeId) {
    mouseX = x;
    mouseY = y;
    mouseHoveredNodeId = nodeId;
  }
  return { start, stop, tick, reset, setOptions, setPinnedNodes, setMouseAttractor };
}

// GraphView2.ts
var GREATER_GRAPH_VIEW_TYPE = "greater-graph-view";
function debounce(fn, wait = 300, immediate = false) {
  let timeout = null;
  return (...args) => {
    const later = () => {
      timeout = null;
      if (!immediate)
        fn(...args);
    };
    const callNow = immediate && timeout === null;
    if (timeout)
      window.clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
    if (callNow)
      fn(...args);
  };
}
var GraphView = class extends import_obsidian.ItemView {
  controller = null;
  plugin;
  scheduleGraphRefresh = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return GREATER_GRAPH_VIEW_TYPE;
  }
  getDisplayText() {
    return "Greater Graph";
  }
  getIcon() {
    return "dot-network";
  }
  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: "greater-graph-view" });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
    if (this.controller) {
      this.controller.setNodeClickHandler((node) => void this.openNodeFile(node));
    }
    if (!this.scheduleGraphRefresh) {
      this.scheduleGraphRefresh = debounce(() => {
        try {
          this.controller?.refreshGraph();
        } catch (e) {
          console.error("Greater Graph: refreshGraph error", e);
        }
      }, 500, true);
    }
    this.registerEvent(this.app.vault.on("create", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
  }
  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.controller?.resize(rect.width, rect.height);
  }
  async onClose() {
    this.controller?.destroy();
    this.controller = null;
    this.containerEl.empty();
  }
  async openNodeFile(node) {
    if (!node)
      return;
    const app = this.app;
    let file = null;
    if (node.file)
      file = node.file;
    else if (node.filePath) {
      const af = app.vault.getAbstractFileByPath(node.filePath);
      if (af instanceof import_obsidian.TFile)
        file = af;
    }
    if (!file) {
      console.warn("Greater Graph: could not resolve file for node", node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      console.error("Greater Graph: failed to open file", e);
    }
  }
};
var Graph2DController = class {
  app;
  containerEl;
  canvas = null;
  renderer = null;
  graph = null;
  adjacency = null;
  onNodeClick = null;
  plugin;
  mouseMoveHandler = null;
  mouseLeaveHandler = null;
  mouseClickHandler = null;
  simulation = null;
  animationFrame = null;
  lastTime = null;
  running = false;
  settingsUnregister = null;
  wheelHandler = null;
  mouseDownHandler = null;
  mouseUpHandler = null;
  lastDragX = 0;
  lastDragY = 0;
  draggingNode = null;
  isPanning = false;
  lastPanX = 0;
  lastPanY = 0;
  // drag tracking for momentum and click suppression
  hasDragged = false;
  preventClick = false;
  downScreenX = 0;
  downScreenY = 0;
  lastWorldX = 0;
  lastWorldY = 0;
  lastDragTime = 0;
  dragVx = 0;
  dragVy = 0;
  momentumScale = 0.12;
  dragThreshold = 4;
  // persistence
  saveNodePositionsDebounced = null;
  saveNodePositions() {
    if (!this.graph)
      return;
    try {
      const allSaved = this.plugin.settings.nodePositions || {};
      const vaultId = this.app.vault.getName();
      if (!allSaved[vaultId])
        allSaved[vaultId] = {};
      const map = allSaved[vaultId];
      for (const node of this.graph.nodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y))
          continue;
        if (node.filePath)
          map[node.filePath] = { x: node.x, y: node.y };
      }
      this.plugin.settings.nodePositions = allSaved;
      try {
        this.plugin.saveSettings && this.plugin.saveSettings();
      } catch (e) {
        console.error("Failed to save node positions", e);
      }
    } catch (e) {
      console.error("Greater Graph: saveNodePositions error", e);
    }
  }
  constructor(app, containerEl, plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }
  async init() {
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;
    const initialGlow = Object.assign({}, this.plugin.settings?.glow || {});
    const initialPhys = this.plugin.settings?.physics || {};
    if (typeof initialPhys.mouseAttractionRadius === "number")
      initialGlow.glowRadiusPx = initialPhys.mouseAttractionRadius;
    this.renderer = createRenderer2D({ canvas, glow: initialGlow });
    this.graph = await buildGraph(this.app, { countDuplicates: Boolean(this.plugin.settings?.countDuplicateLinks) });
    const vaultId = this.app.vault.getName();
    const allSaved = this.plugin.settings?.nodePositions || {};
    const savedPositions = allSaved[vaultId] || {};
    const needsLayout = [];
    if (this.graph && this.graph.nodes) {
      for (const node of this.graph.nodes) {
        const s = savedPositions[node.filePath];
        if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
          node.x = s.x;
          node.y = s.y;
        } else {
          needsLayout.push(node);
        }
      }
    }
    this.adjacency = /* @__PURE__ */ new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!this.adjacency.has(e.sourceId))
          this.adjacency.set(e.sourceId, []);
        if (!this.adjacency.has(e.targetId))
          this.adjacency.set(e.targetId, []);
        this.adjacency.get(e.sourceId).push(e.targetId);
        this.adjacency.get(e.targetId).push(e.sourceId);
      }
    }
    const rect = this.containerEl.getBoundingClientRect();
    const centerX = (rect.width || 300) / 2;
    const centerY = (rect.height || 200) / 2;
    this.renderer.setGraph(this.graph);
    if (needsLayout.length > 0) {
      layoutGraph2D(this.graph, {
        width: rect.width || 300,
        height: rect.height || 200,
        margin: 32,
        centerX,
        centerY,
        centerOnLargestNode: true,
        onlyNodes: needsLayout
      });
    } else {
    }
    this.renderer.resize(rect.width || 300, rect.height || 200);
    let centerNodeId = void 0;
    if (this.graph && this.graph.nodes && this.graph.nodes.length > 0) {
      let maxDeg = -Infinity;
      for (const n of this.graph.nodes) {
        if ((n.totalDegree || 0) > maxDeg) {
          maxDeg = n.totalDegree || 0;
          centerNodeId = n.id;
        }
      }
    }
    this.simulation = createSimulation(
      this.graph.nodes,
      this.graph.edges,
      Object.assign({}, this.plugin.settings?.physics || {}, { centerX, centerY, centerNodeId })
    );
    try {
      const interaction = this.plugin.settings?.interaction || {};
      this.momentumScale = interaction.momentumScale ?? this.momentumScale;
      this.dragThreshold = interaction.dragThreshold ?? this.dragThreshold;
    } catch (e) {
    }
    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);
    if (!this.saveNodePositionsDebounced) {
      this.saveNodePositionsDebounced = debounce(() => this.saveNodePositions(), 2e3, true);
    }
    this.mouseMoveHandler = (ev) => {
      if (!this.canvas || !this.renderer)
        return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      if (this.draggingNode) {
        const now = performance.now();
        const world = this.renderer.screenToWorld(screenX, screenY);
        if (!this.hasDragged) {
          const dxs = screenX - this.downScreenX;
          const dys = screenY - this.downScreenY;
          if (Math.sqrt(dxs * dxs + dys * dys) > this.dragThreshold) {
            this.hasDragged = true;
            this.preventClick = true;
          }
        }
        const dt = Math.max((now - this.lastDragTime) / 1e3, 1e-6);
        this.dragVx = (world.x - this.lastWorldX) / dt;
        this.dragVy = (world.y - this.lastWorldY) / dt;
        this.draggingNode.x = world.x;
        this.draggingNode.y = world.y;
        this.draggingNode.vx = 0;
        this.draggingNode.vy = 0;
        this.lastWorldX = world.x;
        this.lastWorldY = world.y;
        this.lastDragTime = now;
        this.renderer.render();
        try {
          if (this.simulation && this.simulation.setMouseAttractor)
            this.simulation.setMouseAttractor(null, null, null);
        } catch (e) {
        }
        return;
      }
      if (this.isPanning) {
        const dx = screenX - this.lastPanX;
        const dy = screenY - this.lastPanY;
        this.renderer.panBy(dx, dy);
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        return;
      }
      this.handleHover(screenX, screenY);
    };
    this.mouseLeaveHandler = () => this.clearHover();
    this.mouseClickHandler = (ev) => {
      if (!this.canvas)
        return;
      if (ev.button !== 0)
        return;
      if (this.preventClick) {
        this.preventClick = false;
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };
    this.wheelHandler = (ev) => {
      if (!this.canvas || !this.renderer)
        return;
      ev.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const factor = ev.deltaY < 0 ? 1.1 : 0.9;
      this.renderer.zoomAt(x, y, factor);
      this.renderer.render();
    };
    this.mouseDownHandler = (ev) => {
      if (!this.canvas || ev.button !== 0 || !this.renderer)
        return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      const world = this.renderer.screenToWorld(screenX, screenY);
      this.hasDragged = false;
      this.preventClick = false;
      this.downScreenX = screenX;
      this.downScreenY = screenY;
      this.lastWorldX = world.x;
      this.lastWorldY = world.y;
      this.lastDragTime = performance.now();
      const hit = this.hitTestNode(world.x, world.y);
      if (hit) {
        this.draggingNode = hit;
        try {
          if (this.simulation && this.simulation.setPinnedNodes)
            this.simulation.setPinnedNodes(/* @__PURE__ */ new Set([hit.id]));
        } catch (e) {
        }
        this.canvas.style.cursor = "grabbing";
      } else {
        this.isPanning = true;
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        this.canvas.style.cursor = "grab";
      }
    };
    this.mouseUpHandler = (ev) => {
      if (!this.canvas)
        return;
      if (ev.button !== 0)
        return;
      if (this.draggingNode) {
        if (this.hasDragged) {
          try {
            this.draggingNode.vx = this.dragVx * this.momentumScale;
            this.draggingNode.vy = this.dragVy * this.momentumScale;
          } catch (e) {
          }
        }
        try {
          if (this.simulation && this.simulation.setPinnedNodes)
            this.simulation.setPinnedNodes(/* @__PURE__ */ new Set());
        } catch (e) {
        }
      }
      this.isPanning = false;
      this.draggingNode = null;
      this.canvas.style.cursor = "default";
      try {
        if (this.saveNodePositionsDebounced)
          this.saveNodePositionsDebounced();
      } catch (e) {
      }
    };
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.addEventListener("mouseleave", this.mouseLeaveHandler);
    this.canvas.addEventListener("click", this.mouseClickHandler);
    this.canvas.addEventListener("wheel", this.wheelHandler, { passive: false });
    this.canvas.addEventListener("mousedown", this.mouseDownHandler);
    window.addEventListener("mouseup", this.mouseUpHandler);
    if (this.plugin.registerSettingsListener) {
      this.settingsUnregister = this.plugin.registerSettingsListener(() => {
        if (this.plugin.settings) {
          const glow = this.plugin.settings.glow;
          if (this.renderer && this.renderer.setGlowSettings) {
            const phys2 = this.plugin.settings?.physics || {};
            const glowWithRadius = Object.assign({}, glow || {});
            if (typeof phys2.mouseAttractionRadius === "number")
              glowWithRadius.glowRadiusPx = phys2.mouseAttractionRadius;
            this.renderer.setGlowSettings(glowWithRadius);
            this.renderer.render();
          }
          const phys = this.plugin.settings.physics;
          if (this.simulation && phys && this.simulation.setOptions) {
            this.simulation.setOptions(phys);
          }
          try {
            const interaction = this.plugin.settings?.interaction || {};
            this.momentumScale = interaction.momentumScale ?? this.momentumScale;
            this.dragThreshold = interaction.dragThreshold ?? this.dragThreshold;
          } catch (e) {
          }
        }
      });
    }
  }
  animationLoop = (timestamp) => {
    if (!this.running)
      return;
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt = (timestamp - this.lastTime) / 1e3;
    if (dt > 0.05)
      dt = 0.05;
    this.lastTime = timestamp;
    if (this.simulation)
      this.simulation.tick(dt);
    if (this.renderer)
      this.renderer.render();
    try {
      if (this.saveNodePositionsDebounced)
        this.saveNodePositionsDebounced();
    } catch (e) {
    }
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };
  resize(width, height) {
    if (!this.renderer)
      return;
    this.renderer.resize(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && this.simulation.setOptions) {
      this.simulation.setOptions({ centerX, centerY });
    }
  }
  // Rebuilds the graph and restarts the simulation. Safe to call repeatedly.
  async refreshGraph() {
    if (!this.canvas)
      return;
    try {
      const newGraph = await buildGraph(this.app, { countDuplicates: Boolean(this.plugin.settings?.countDuplicateLinks) });
      this.graph = newGraph;
      const vaultId = this.app.vault.getName();
      const allSaved = this.plugin.settings?.nodePositions || {};
      const savedPositions = allSaved[vaultId] || {};
      const needsLayout = [];
      if (this.graph && this.graph.nodes) {
        for (const node of this.graph.nodes) {
          const s = savedPositions[node.filePath];
          if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
            node.x = s.x;
            node.y = s.y;
          } else {
            needsLayout.push(node);
          }
        }
      }
      this.adjacency = /* @__PURE__ */ new Map();
      if (this.graph && this.graph.edges) {
        for (const e of this.graph.edges) {
          if (!this.adjacency.has(e.sourceId))
            this.adjacency.set(e.sourceId, []);
          if (!this.adjacency.has(e.targetId))
            this.adjacency.set(e.targetId, []);
          this.adjacency.get(e.sourceId).push(e.targetId);
          this.adjacency.get(e.targetId).push(e.sourceId);
        }
      }
      const rect = this.containerEl.getBoundingClientRect();
      const width = rect.width || 300;
      const height = rect.height || 200;
      const centerX = width / 2;
      const centerY = height / 2;
      if (this.renderer && this.graph) {
        this.renderer.setGraph(this.graph);
        if (needsLayout.length > 0) {
          layoutGraph2D(this.graph, {
            width,
            height,
            margin: 32,
            centerX,
            centerY,
            centerOnLargestNode: true,
            onlyNodes: needsLayout
          });
        }
        this.renderer.resize(width, height);
      }
      if (this.simulation) {
        try {
          this.simulation.stop();
        } catch (e) {
        }
        this.simulation = null;
      }
      this.simulation = createSimulation(
        this.graph && this.graph.nodes || [],
        this.graph && this.graph.edges || [],
        Object.assign({}, this.plugin.settings?.physics || {}, { centerX, centerY })
      );
      this.simulation.start();
      if (this.renderer)
        this.renderer.render();
    } catch (e) {
      console.error("Greater Graph: failed to refresh graph", e);
    }
  }
  destroy() {
    try {
      this.saveNodePositions();
    } catch (e) {
    }
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement)
      this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.simulation) {
      try {
        this.simulation.stop();
      } catch (e) {
      }
      this.simulation = null;
    }
    if (this.animationFrame) {
      try {
        cancelAnimationFrame(this.animationFrame);
      } catch (e) {
      }
      this.animationFrame = null;
      this.lastTime = null;
      this.running = false;
    }
    this.onNodeClick = null;
    if (this.settingsUnregister) {
      try {
        this.settingsUnregister();
      } catch (e) {
      }
      this.settingsUnregister = null;
    }
  }
  setNodeClickHandler(handler) {
    this.onNodeClick = handler;
  }
  hitTestNode(x, y) {
    if (!this.graph || !this.renderer)
      return null;
    let closest = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      const distSq = dx * dx + dy * dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR * hitR && distSq < closestDist) {
        closestDist = distSq;
        closest = node;
      }
    }
    return closest;
  }
  handleClick(screenX, screenY) {
    if (!this.graph || !this.onNodeClick || !this.renderer)
      return;
    const world = this.renderer.screenToWorld(screenX, screenY);
    const node = this.hitTestNode(world.x, world.y);
    if (!node)
      return;
    try {
      this.onNodeClick(node);
    } catch (e) {
      console.error("Graph2DController.onNodeClick handler error", e);
    }
  }
  handleHover(screenX, screenY) {
    if (!this.graph || !this.renderer)
      return;
    const world = this.renderer.screenToWorld(screenX, screenY);
    let closest = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = world.x - node.x;
      const dy = world.y - node.y;
      const distSq = dx * dx + dy * dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR * hitR && distSq < closestDist) {
        closestDist = distSq;
        closest = node;
      }
    }
    const newId = closest ? closest.id : null;
    const depth = this.plugin.settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = /* @__PURE__ */ new Set();
    if (newId)
      highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q = [{ id: newId, d: 0 }];
      const seen = /* @__PURE__ */ new Set([newId]);
      while (q.length > 0) {
        const cur = q.shift();
        if (cur.d > 0)
          highlightSet.add(cur.id);
        if (cur.d >= depth)
          continue;
        const neighbors = this.adjacency.get(cur.id) || [];
        for (const nb of neighbors) {
          if (!seen.has(nb)) {
            seen.add(nb);
            q.push({ id: nb, d: cur.d + 1 });
          }
        }
      }
    }
    if (this.canvas)
      this.canvas.style.cursor = newId ? "pointer" : "default";
    if (this.renderer.setHoverState)
      this.renderer.setHoverState(newId, highlightSet, world.x, world.y);
    if (this.renderer.setHoveredNode)
      this.renderer.setHoveredNode(newId);
    this.renderer.render();
    try {
      if (this.simulation && this.simulation.setMouseAttractor)
        this.simulation.setMouseAttractor(world.x, world.y, newId);
    } catch (e) {
    }
  }
  clearHover() {
    if (!this.renderer)
      return;
    if (this.renderer.setHoverState)
      this.renderer.setHoverState(null, /* @__PURE__ */ new Set(), 0, 0);
    if (this.renderer.setHoveredNode)
      this.renderer.setHoveredNode(null);
    this.renderer.render();
    try {
      if (this.simulation && this.simulation.setMouseAttractor)
        this.simulation.setMouseAttractor(null, null, null);
    } catch (e) {
    }
  }
};

// main.ts
var DEFAULT_SETTINGS = {
  glow: {
    minNodeRadius: 4,
    maxNodeRadius: 14,
    minCenterAlpha: 0.1,
    maxCenterAlpha: 0.4,
    hoverBoostFactor: 1.6,
    neighborBoostFactor: 1.2,
    dimFactor: 0.3,
    hoverHighlightDepth: 1,
    distanceInnerRadiusMultiplier: 1,
    distanceOuterRadiusMultiplier: 2.5,
    distanceCurveSteepness: 2,
    // focus/dimming defaults
    focusSmoothingRate: 8,
    edgeDimMin: 0.08,
    edgeDimMax: 0.9,
    nodeMinBodyAlpha: 0.3,
    // color overrides left undefined by default to follow theme
    nodeColor: void 0,
    labelColor: void 0,
    edgeColor: void 0
  },
  physics: {
    // calmer, Obsidian-like defaults
    repulsionStrength: 10,
    springStrength: 0.04,
    springLength: 130,
    centerPull: 4e-4,
    damping: 0.92,
    mouseAttractionRadius: 80,
    mouseAttractionStrength: 0.15,
    mouseAttractionExponent: 3.5
  },
  interaction: {
    momentumScale: 0.12,
    dragThreshold: 4
  },
  nodePositions: {}
};
var GreaterGraphPlugin = class extends import_obsidian2.Plugin {
  settings = DEFAULT_SETTINGS;
  settingsListeners = [];
  async onload() {
    await this.loadSettings();
    this.registerView(GREATER_GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id: "open-greater-graph",
      name: "Open Greater Graph",
      callback: () => this.activateView()
    });
    this.addSettingTab(new GreaterGraphSettingTab(this.app, this));
  }
  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(GREATER_GRAPH_VIEW_TYPE);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: GREATER_GRAPH_VIEW_TYPE,
        active: true
      });
      this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }
  onunload() {
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
    if (!this.settings.glow)
      this.settings.glow = DEFAULT_SETTINGS.glow;
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.notifySettingsChanged();
  }
  registerSettingsListener(listener) {
    this.settingsListeners.push(listener);
    return () => {
      const idx = this.settingsListeners.indexOf(listener);
      if (idx !== -1)
        this.settingsListeners.splice(idx, 1);
    };
  }
  notifySettingsChanged() {
    for (const l of this.settingsListeners) {
      try {
        l();
      } catch (e) {
        console.error("Greater Graph settings listener error:", e);
      }
    }
  }
};
var GreaterGraphSettingTab = class extends import_obsidian2.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Greater Graph \u2013 Glow Settings" });
    const glow = this.plugin.settings.glow;
    new import_obsidian2.Setting(containerEl).setName("Minimum node radius").setDesc("Minimum radius for the smallest node (in pixels).").addText(
      (text) => text.setValue(String(glow.minNodeRadius)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > 0) {
          glow.minNodeRadius = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Maximum node radius").setDesc("Maximum radius for the most connected node (in pixels).").addText(
      (text) => text.setValue(String(glow.maxNodeRadius)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= glow.minNodeRadius) {
          glow.maxNodeRadius = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("");
    new import_obsidian2.Setting(containerEl).setName("Minimum center glow opacity").setDesc("Opacity (0\u20131) at the glow center for the least connected node.").addText(
      (text) => text.setValue(String(glow.minCenterAlpha)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          glow.minCenterAlpha = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Maximum center glow opacity").setDesc("Opacity (0\u20131) at the glow center for the most connected node.").addText(
      (text) => text.setValue(String(glow.maxCenterAlpha)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          glow.maxCenterAlpha = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Hover glow boost").setDesc("Multiplier applied to the center glow when a node is hovered.").addText(
      (text) => text.setValue(String(glow.hoverBoostFactor)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 1) {
          glow.hoverBoostFactor = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Neighbor glow boost").setDesc("Multiplier applied to nodes within the highlight depth (excluding hovered node).").addText(
      (text) => text.setValue(String(glow.neighborBoostFactor ?? 1.2)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 1) {
          glow.neighborBoostFactor = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Dim factor for distant nodes").setDesc("Multiplier (0\u20131) applied to nodes outside the highlight depth.").addText(
      (text) => text.setValue(String(glow.dimFactor ?? 0.3)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          glow.dimFactor = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Highlight depth").setDesc("Graph distance (in hops) from the hovered node that will be highlighted.").addText(
      (text) => text.setValue(String(glow.hoverHighlightDepth ?? 1)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && Number.isInteger(num) && num >= 0) {
          glow.hoverHighlightDepth = Math.max(0, Math.floor(num));
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Inner distance multiplier").setDesc("Distance (in node radii) where distance-based glow is fully active.").addText(
      (text) => text.setValue(String(glow.distanceInnerRadiusMultiplier ?? 1)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > 0) {
          glow.distanceInnerRadiusMultiplier = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Outer distance multiplier").setDesc("Distance (in node radii) beyond which the mouse has no effect on glow.").addText(
      (text) => text.setValue(String(glow.distanceOuterRadiusMultiplier ?? 2.5)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > (glow.distanceInnerRadiusMultiplier ?? 0)) {
          glow.distanceOuterRadiusMultiplier = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Distance curve steepness").setDesc("Controls how quickly glow ramps up as the cursor approaches a node. Higher values = steeper S-curve.").addText(
      (text) => text.setValue(String(glow.distanceCurveSteepness ?? 2)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > 0) {
          glow.distanceCurveSteepness = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Focus smoothing rate").setDesc("How quickly nodes fade in/out when hover focus changes (higher = faster, per second).").addText(
      (text) => text.setValue(String(glow.focusSmoothingRate ?? 8)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > 0) {
          glow.focusSmoothingRate = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Edge dim minimum alpha").setDesc("Minimum alpha used for dimmed edges (0-1).").addText(
      (text) => text.setValue(String(glow.edgeDimMin ?? 0.08)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          glow.edgeDimMin = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Edge dim maximum alpha").setDesc("Maximum alpha used for focused edges (0-1).").addText(
      (text) => text.setValue(String(glow.edgeDimMax ?? 0.9)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          glow.edgeDimMax = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Node minimum body alpha").setDesc("Minimum fill alpha for dimmed nodes (0-1).").addText(
      (text) => text.setValue(String(glow.nodeMinBodyAlpha ?? 0.3)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          glow.nodeMinBodyAlpha = num;
          await this.plugin.saveSettings();
        }
      })
    );
    containerEl.createEl("h2", { text: "Colors" });
    new import_obsidian2.Setting(containerEl).setName("Node color (override)").setDesc("Optional CSS color string to override the theme accent for node fill. Leave empty to use the active theme.").addText(
      (text) => text.setValue(String(glow.nodeColor ?? "")).onChange(async (value) => {
        const v = value.trim();
        glow.nodeColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Edge color (override)").setDesc("Optional CSS color string to override edge stroke color. Leave empty to use a theme-appropriate color.").addText(
      (text) => text.setValue(String(glow.edgeColor ?? "")).onChange(async (value) => {
        const v = value.trim();
        glow.edgeColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Label color (override)").setDesc("Optional CSS color string to override label text color. Leave empty to use the active theme text color.").addText(
      (text) => text.setValue(String(glow.labelColor ?? "")).onChange(async (value) => {
        const v = value.trim();
        glow.labelColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      })
    );
    const phys = this.plugin.settings.physics || {};
    containerEl.createEl("h2", { text: "Greater Graph \u2013 Physics" });
    new import_obsidian2.Setting(containerEl).setName("Repulsion strength").setDesc("Controls node-node repulsion strength (higher = more separation).").addText(
      (text) => text.setValue(String(phys.repulsionStrength ?? 4e3)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Spring strength").setDesc("Spring force constant for edges (higher = stiffer).").addText(
      (text) => text.setValue(String(phys.springStrength ?? 0.08)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springStrength = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Spring length").setDesc("Preferred length (px) for edge springs.").addText(
      (text) => text.setValue(String(phys.springLength ?? 80)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Center pull").setDesc("Force pulling nodes toward center (small value).").addText(
      (text) => text.setValue(String(phys.centerPull ?? 0.02)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Damping").setDesc("Velocity damping (0-1). Higher values reduce motion faster.").addText(
      (text) => text.setValue(String(phys.damping ?? 0.85)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0 && num <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Count duplicate links").setDesc("If enabled, multiple links between the same two files will be counted when computing in/out degrees.").addToggle((t) => t.setValue(Boolean(this.plugin.settings.countDuplicateLinks)).onChange(async (v) => {
      this.plugin.settings.countDuplicateLinks = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Mouse attraction radius (px)").setDesc("Maximum distance (in pixels) from cursor where the attraction applies.").addText(
      (text) => text.setValue(String(phys.mouseAttractionRadius ?? 80)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Mouse attraction strength").setDesc("Base force scale applied toward the cursor when within radius (higher = stronger pull).").addText(
      (text) => text.setValue(String(phys.mouseAttractionStrength ?? 0.15)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Mouse attraction exponent").setDesc("How sharply attraction ramps as the cursor approaches (typical values: 3\u20134).").addText(
      (text) => text.setValue(String(phys.mouseAttractionExponent ?? 3.5)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionExponent = num;
          await this.plugin.saveSettings();
        }
      })
    );
    containerEl.createEl("h2", { text: "Interaction" });
    const interaction = this.plugin.settings.interaction || {};
    new import_obsidian2.Setting(containerEl).setName("Drag momentum scale").setDesc("Multiplier applied to the sampled drag velocity when releasing a dragged node.").addText(
      (text) => text.setValue(String(interaction.momentumScale ?? 0.12)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.interaction = this.plugin.settings.interaction || {};
          this.plugin.settings.interaction.momentumScale = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Drag threshold (px)").setDesc("Screen-space movement (pixels) required to count as a drag rather than a click.").addText(
      (text) => text.setValue(String(interaction.dragThreshold ?? 4)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.interaction = this.plugin.settings.interaction || {};
          this.plugin.settings.interaction.dragThreshold = num;
          await this.plugin.saveSettings();
        }
      })
    );
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SETTINGS
});
