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
  SETTINGS: () => SETTINGS,
  default: () => GreaterGraphPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// GraphView.ts
var import_obsidian = require("obsidian");

// graph/buildGraph.ts
async function buildGraph(app) {
  const files = app.vault.getMarkdownFiles();
  const { nodes, nodeByPath } = createNoteNodes(files);
  const { edges, edgeSet } = buildNoteEdgesFromResolvedLinks(app, nodeByPath);
  if (SETTINGS.graph.showTags !== false) {
    addTagNodesAndEdges(app, files, nodes, nodeByPath, edges, edgeSet);
  }
  computeNodeDegrees(nodes, nodeByPath, edges);
  markBidirectionalEdges(edges);
  const centerNode = pickCenterNode(app, nodes, SETTINGS);
  return { nodes, edges };
}
function createNoteNodes(files) {
  const nodes = [];
  for (const file of files) {
    const jitter = 50;
    const x0 = (Math.random() - 0.5) * jitter;
    const y0 = (Math.random() - 0.5) * jitter;
    const node = {
      id: file.path,
      filePath: file.path,
      file,
      label: file.basename,
      x: x0,
      y: y0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0
    };
    nodes.push(node);
  }
  const nodeByPath = /* @__PURE__ */ new Map();
  for (const n of nodes)
    nodeByPath.set(n.id, n);
  return { nodes, nodeByPath };
}
function buildNoteEdgesFromResolvedLinks(app, nodeByPath) {
  const resolved = app.metadataCache.resolvedLinks || {};
  const edges = [];
  const edgeSet = /* @__PURE__ */ new Set();
  const countDuplicates = Boolean(SETTINGS.graph.countDuplicateLinks);
  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath] || {};
    for (const targetPath of Object.keys(targets)) {
      if (!nodeByPath.has(sourcePath) || !nodeByPath.has(targetPath))
        continue;
      const key = `${sourcePath}->${targetPath}`;
      if (edgeSet.has(key))
        continue;
      const rawCount = Number(targets[targetPath] || 1) || 1;
      const linkCount = countDuplicates ? rawCount : 1;
      edges.push({
        id: key,
        sourceId: sourcePath,
        targetId: targetPath,
        linkCount,
        bidirectional: false
      });
      edgeSet.add(key);
    }
  }
  return { edges, edgeSet };
}
function computeNodeDegrees(nodes, nodeByPath, edges) {
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
}
function markBidirectionalEdges(edges) {
  const edgeMap = /* @__PURE__ */ new Map();
  for (const e of edges) {
    edgeMap.set(`${e.sourceId}->${e.targetId}`, e);
  }
  for (const e of edges) {
    const reverseKey = `${e.targetId}->${e.sourceId}`;
    if (edgeMap.has(reverseKey)) {
      e.bidirectional = true;
      const other = edgeMap.get(reverseKey);
      other.bidirectional = true;
    }
  }
}
function addTagNodesAndEdges(app, files, nodes, nodeByPath, edges, edgeSet) {
  const tagNodeByName = /* @__PURE__ */ new Map();
  const ensureTagNode = (tagName) => {
    let node = tagNodeByName.get(tagName);
    if (node)
      return node;
    node = {
      id: `tag:${tagName}`,
      label: `#${tagName}`,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      filePath: `tag:${tagName}`,
      type: "tag",
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0
    };
    nodes.push(node);
    tagNodeByName.set(tagName, node);
    nodeByPath.set(node.id, node);
    return node;
  };
}
function pickCenterNode(app, nodes, settings) {
  if (!settings.graph.useCenterNote)
    return null;
  if (SETTINGS.graph.centerNoteTitle) {
    const centerNode = nodes.find((n) => n.id === SETTINGS.graph.centerNoteTitle);
    SETTINGS.graph.centerNode = centerNode;
  }
  const onlyNotes = nodes.filter((n) => n.type !== "tag");
  const preferOut = Boolean(settings.graph.useOutlinkFallback);
  const metric = (n) => preferOut ? n.outDegree || 0 : n.inDegree || 0;
  const chooseBy = (predicate) => {
    let best = null;
    for (const n of onlyNotes) {
      if (!predicate(n))
        continue;
      if (!best || metric(n) > metric(best)) {
        best = n;
      }
    }
    return best;
  };
  let chosen = null;
  const raw = String(settings.graph.centerNoteTitle || "").trim();
  if (raw) {
    const mc = app.metadataCache;
    let resolved = null;
    try {
      resolved = mc?.getFirstLinkpathDest?.(raw, "");
      if (!resolved && !raw.endsWith(".md")) {
        resolved = mc?.getFirstLinkpathDest?.(raw + ".md", "");
      }
    } catch {
    }
    if (resolved?.path) {
      chosen = chooseBy((n) => n.filePath === resolved.path);
    }
    if (!chosen) {
      const normA = raw;
      const normB = raw.endsWith(".md") ? raw : raw + ".md";
      chosen = chooseBy((n) => n.filePath === normA || n.filePath === normB);
    }
    if (!chosen) {
      const base = raw.endsWith(".md") ? raw.slice(0, -3) : raw;
      chosen = chooseBy((n) => {
        const file = n.file;
        const bn = file?.basename || n.label;
        return String(bn) === base;
      });
    }
  }
  if (!chosen) {
    for (const n of onlyNotes) {
      if (!chosen || metric(n) > metric(chosen)) {
        chosen = n;
      }
    }
  }
  return chosen;
}

// graph/renderer.ts
function createRenderer(canvas) {
  const context = canvas.getContext("2d");
  let graph = null;
  let nodeById = /* @__PURE__ */ new Map();
  let minDegree = 0;
  let maxDegree = 0;
  let minEdgeCount = 1;
  let maxEdgeCount = 1;
  let innerRadius = 1;
  let hoveredNodeId = null;
  let hoverHighlightSet = /* @__PURE__ */ new Set();
  let mouseX = 0;
  let mouseY = 0;
  const hoverScaleMax = 0.25;
  const hoverLerpSpeed = 0.2;
  const nodeFocusMap = /* @__PURE__ */ new Map();
  let lastRenderTime = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  let themeNodeColor = "#66ccff";
  let themeLabelColor = "#222";
  let themeEdgeColor = "#888888";
  let themeTagColor = "#8000ff";
  let resolvedInterfaceFontFamily = null;
  let resolvedMonoFontFamily = null;
  let camera = { ...SETTINGS.camera.state };
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
  function setCameraState(newCamera) {
    camera = { ...camera, ...newCamera };
  }
  function getCameraState() {
    return camera;
  }
  function projectWorld(node) {
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
    const eps = 1e-4;
    const safeDz = dz < eps ? eps : dz;
    const focal = 800;
    const perspective = focal / safeDz;
    const px = xz * perspective;
    const py = yz * perspective;
    return { x: px, y: py, depth: dz };
  }
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
    const oldWidth = canvas.width;
    const oldHeight = canvas.height;
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    camera.offsetX += (canvas.width - oldWidth) / 2;
    camera.offsetY += (canvas.height - oldHeight) / 2;
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
    let hoverScale = 1;
    const isHovered = hoveredNodeId === node.id;
    const isNeighbor = hoverHighlightSet && hoverHighlightSet.has(node.id);
    if (isHovered) {
      hoverScale = 1 + hoverScaleMax * SETTINGS.graph.hoverScale;
    } else if (isNeighbor) {
      hoverScale = 1 + hoverScaleMax * 0.4 * SETTINGS.graph.hoverScale;
    }
    const zoomScale = SETTINGS.camera.state.distance / camera.distance;
    return base * hoverScale * zoomScale;
  }
  function getBaseNodeRadius(node) {
    const t = getDegreeNormalized(node);
    return SETTINGS.graph.minNodeRadius + t * (SETTINGS.graph.maxNodeRadius - SETTINGS.graph.minNodeRadius);
  }
  function getBaseCenterAlpha(node) {
    const t = getDegreeNormalized(node);
    return SETTINGS.graph.minCenterAlpha + t * (SETTINGS.graph.maxCenterAlpha - SETTINGS.graph.minCenterAlpha);
  }
  function getCenterAlpha(node) {
    const base = getBaseCenterAlpha(node);
    if (!hoveredNodeId) {
      const hl2 = evalFalloff(node, buildHighlightProfile(node));
      const normal2 = base;
      const highlighted2 = base;
      const blended2 = normal2 + (highlighted2 - normal2) * hl2;
      return clamp01(blended2);
    }
    const inDepth = hoverHighlightSet.has(node.id);
    const isHovered = node.id === hoveredNodeId;
    if (!inDepth)
      return clamp01(base);
    const hl = evalFalloff(node, buildHighlightProfile(node));
    const normal = base;
    const highlighted = base;
    const blended = normal + (highlighted - normal) * hl;
    return clamp01(blended);
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
  function buildGravityProfile(node) {
    const r = getNodeRadius(node);
    return {
      inner: r * innerRadius,
      outer: r * SETTINGS.physics.gravityRadius,
      curve: SETTINGS.physics.gravityFallOff
    };
  }
  function buildLabelProfile(node) {
    const r = getNodeRadius(node);
    return {
      inner: r * innerRadius,
      outer: r * SETTINGS.graph.labelRadius,
      curve: SETTINGS.physics.gravityFallOff
    };
  }
  function buildHighlightProfile(node) {
    const r = getNodeRadius(node);
    return {
      inner: r * innerRadius,
      outer: r * SETTINGS.graph.labelRadius,
      curve: SETTINGS.physics.gravityFallOff
    };
  }
  function evalFalloff(node, profile) {
    const { inner, outer, curve } = profile;
    if (outer <= inner || outer <= 0)
      return 0;
    const p = projectWorld(node);
    const dx = mouseX - p.x;
    const dy = mouseY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= inner)
      return 1;
    if (dist >= outer)
      return 0;
    const t = (dist - inner) / (outer - inner);
    const proximity = 1 - t;
    return applySCurve(proximity, curve);
  }
  function render() {
    if (!context)
      return;
    const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    let dt = (now - lastRenderTime) / 1e3;
    if (!isFinite(dt) || dt <= 0)
      dt = 0.016;
    if (dt > 0.1)
      dt = 0.1;
    lastRenderTime = now;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!graph)
      return;
    context.save();
    if (SETTINGS.graph.nodeColor)
      themeNodeColor = SETTINGS.graph.nodeColor;
    if (SETTINGS.graph.labelColor)
      themeLabelColor = SETTINGS.graph.labelColor;
    if (SETTINGS.graph.edgeColor)
      themeEdgeColor = SETTINGS.graph.edgeColor;
    try {
      const cs = window.getComputedStyle(canvas);
      const nodeVar = cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
      const labelVar = cs.getPropertyValue("--text-normal") || cs.getPropertyValue("--text");
      const edgeVar = cs.getPropertyValue("--text-muted") || cs.getPropertyValue("--text-faint") || cs.getPropertyValue("--text-normal");
      if (!SETTINGS.graph.nodeColor && nodeVar && nodeVar.trim())
        themeNodeColor = nodeVar.trim();
      if (!SETTINGS.graph.labelColor && labelVar && labelVar.trim())
        themeLabelColor = labelVar.trim();
      if (!SETTINGS.graph.edgeColor && edgeVar && edgeVar.trim())
        themeEdgeColor = edgeVar.trim();
      const tagVar = cs.getPropertyValue("--accent-2") || cs.getPropertyValue("--accent-secondary") || cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
      if (!SETTINGS.graph.tagColor && tagVar && tagVar.trim())
        themeTagColor = tagVar.trim();
    } catch (e) {
    }
    try {
      const cs = window.getComputedStyle(canvas);
      if (SETTINGS.graph.useInterfaceFont) {
        if (!resolvedInterfaceFontFamily) {
          const candidates = ["--font-family-interface", "--font-family", "--font-main", "--font-primary", "--font-family-sans", "--text-font"];
          let fam = null;
          for (const v of candidates) {
            const val = cs.getPropertyValue(v);
            if (val && val.trim()) {
              fam = val.trim();
              break;
            }
          }
          if (!fam) {
            const el = document.createElement("div");
            el.style.position = "absolute";
            el.style.left = "-9999px";
            el.style.top = "-9999px";
            el.textContent = "x";
            document.body.appendChild(el);
            try {
              const cs2 = window.getComputedStyle(el);
              fam = cs2.fontFamily || null;
            } finally {
              if (el.parentElement)
                el.parentElement.removeChild(el);
            }
          }
          resolvedInterfaceFontFamily = fam && fam.trim() ? fam.trim() : "sans-serif";
        }
      } else {
        if (!resolvedMonoFontFamily) {
          const candidates = ["--font-family-monospace", "--font-family-code", "--mono-font", "--code-font", "--font-mono", "--font-family-mono"];
          let fam = null;
          for (const v of candidates) {
            const val = cs.getPropertyValue(v);
            if (val && val.trim()) {
              fam = val.trim();
              break;
            }
          }
          if (!fam) {
            const codeEl = document.createElement("code");
            codeEl.style.position = "absolute";
            codeEl.style.left = "-9999px";
            codeEl.style.top = "-9999px";
            codeEl.textContent = "x";
            document.body.appendChild(codeEl);
            try {
              const cs2 = window.getComputedStyle(codeEl);
              fam = cs2.fontFamily || null;
            } finally {
              if (codeEl.parentElement)
                codeEl.parentElement.removeChild(codeEl);
            }
          }
          resolvedMonoFontFamily = fam && fam.trim() ? fam.trim() : "monospace";
        }
      }
    } catch (e) {
      if (SETTINGS.graph.useInterfaceFont)
        resolvedInterfaceFontFamily = resolvedInterfaceFontFamily || "sans-serif";
      else
        resolvedMonoFontFamily = resolvedMonoFontFamily || "monospace";
    }
    context.save();
    context.translate(camera.offsetX, camera.offsetY);
    function isNodeTargetFocused(nodeId) {
      if (!hoveredNodeId)
        return true;
      if (nodeId === hoveredNodeId)
        return true;
      if (hoverHighlightSet && hoverHighlightSet.has(nodeId))
        return true;
      return false;
    }
    function updateFocusMap() {
      if (!graph || !graph.nodes)
        return;
      for (const n of graph.nodes) {
        const id = n.id;
        const target = isNodeTargetFocused(id) ? 1 : 0;
        const cur = nodeFocusMap.get(id) ?? target;
        const alpha = 1 - Math.exp(-SETTINGS.graph.focusSmoothing * dt);
        const next = cur + (target - cur) * alpha;
        nodeFocusMap.set(id, next);
      }
    }
    updateFocusMap();
    const targetHover = hoveredNodeId ? 1 : 0;
    SETTINGS.graph.hoverScale += (targetHover - SETTINGS.graph.hoverScale) * hoverLerpSpeed;
    if (graph.edges && graph.edges.length > 0) {
      const edgeRgb = colorToRgb(themeEdgeColor);
      for (const edge of graph.edges) {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (!src || !tgt)
          continue;
        if (!SETTINGS.graph.showTags && (src.type === "tag" || tgt.type === "tag"))
          continue;
        const srcP = projectWorld(src);
        const tgtP = projectWorld(tgt);
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
        const worldLineWidth = Math.max(0.4, screenW / Math.max(1e-4, 1));
        let alpha = 0.65;
        if (!hoveredNodeId)
          alpha = 0.65;
        else
          alpha = 0.08 + (0.9 - 0.08) * edgeFocus;
        context.save();
        let finalEdgeAlpha = SETTINGS.graph.edgeColorAlpha;
        if (hoveredNodeId) {
          const srcInDepth = hoverHighlightSet.has(edge.sourceId);
          const tgtInDepth = hoverHighlightSet.has(edge.targetId);
          const directlyIncident = edge.sourceId === hoveredNodeId || edge.targetId === hoveredNodeId;
          if (srcInDepth && tgtInDepth || directlyIncident)
            finalEdgeAlpha = 1;
        }
        context.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${finalEdgeAlpha})`;
        const isMutual = !!edge.bidirectional && SETTINGS.graph.drawDoubleLines;
        if (isMutual) {
          const dx = tgtP.x - srcP.x;
          const dy = tgtP.y - srcP.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const perpX = -uy;
          const perpY = ux;
          const offsetPx = Math.max(2, screenW * 0.6);
          const offsetWorld = offsetPx;
          context.beginPath();
          context.moveTo(srcP.x + perpX * offsetWorld, srcP.y + perpY * offsetWorld);
          context.lineTo(tgtP.x + perpX * offsetWorld, tgtP.y + perpY * offsetWorld);
          context.lineWidth = worldLineWidth;
          context.stroke();
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
    const baseFontSize = SETTINGS.graph.labelBaseFontSize;
    const minFontSize = 6;
    const maxFontSize = 18;
    context.textAlign = "center";
    context.textBaseline = "top";
    let labelCss = themeLabelColor;
    try {
      const cs = window.getComputedStyle(canvas);
      const v = cs.getPropertyValue("--text-normal");
      if (v && v.trim())
        labelCss = v.trim();
    } catch (e) {
    }
    for (const node of graph.nodes) {
      if (!SETTINGS.graph.showTags && node.type === "tag")
        continue;
      const p = projectWorld(node);
      const baseRadius = getBaseNodeRadius(node);
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      const gravityProfile = buildGravityProfile(node);
      const gravityOuterR = gravityProfile.outer;
      const focus = nodeFocusMap.get(node.id) ?? 1;
      const focused = focus > 0.01;
      if (focused) {
        const nodeColorOverride = node && node.type === "tag" ? SETTINGS.graph.tagColor ?? themeTagColor : themeNodeColor;
        const accentRgb = colorToRgb(nodeColorOverride);
        const useNodeAlpha = node && node.type === "tag" ? SETTINGS.graph.tagColorAlpha ?? SETTINGS.graph.tagColorAlpha : SETTINGS.graph.nodeColorAlpha ?? SETTINGS.graph.nodeColorAlpha;
        const dimCenter = clamp01(getBaseCenterAlpha(node));
        const fullCenter = centerAlpha;
        let blendedCenter = dimCenter + (fullCenter - dimCenter) * focus;
        let effectiveUseNodeAlpha = SETTINGS.graph.tagColorAlpha;
        if (hoveredNodeId) {
          const inDepth = hoverHighlightSet.has(node.id);
          const isHovered = node.id === hoveredNodeId;
          if (isHovered || inDepth) {
            blendedCenter = 1;
            effectiveUseNodeAlpha = 1;
          }
        }
        const gradient = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * SETTINGS.physics.gravityRadius);
        gradient.addColorStop(0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.4, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.5 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.8, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.15 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(1, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0)`);
        context.save();
        context.beginPath();
        context.arc(p.x, p.y, radius * SETTINGS.physics.gravityRadius, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();
        context.restore();
        const bodyAlpha = SETTINGS.graph.labelColorAlpha;
        context.save();
        context.beginPath();
        context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        const bodyColorOverride = node && node.type === "tag" ? SETTINGS.graph.tagColor ?? themeTagColor : themeNodeColor;
        const accent = colorToRgb(bodyColorOverride);
        const useBodyAlpha = node && node.type === "tag" ? SETTINGS.graph.tagColorAlpha ?? SETTINGS.graph.tagColorAlpha : SETTINGS.graph.nodeColorAlpha ?? SETTINGS.graph.nodeColorAlpha;
        let effectiveUseBodyAlpha = useBodyAlpha;
        let finalBodyAlpha = bodyAlpha;
        if (hoveredNodeId) {
          const inDepthBody = hoverHighlightSet.has(node.id);
          const isHoveredBody = node.id === hoveredNodeId;
          if (isHoveredBody || inDepthBody) {
            finalBodyAlpha = 1;
            effectiveUseBodyAlpha = 1;
          }
        }
        context.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${finalBodyAlpha * effectiveUseBodyAlpha})`;
        context.fill();
        context.restore();
        const displayedFont = SETTINGS.graph.labelBaseFontSize;
        const radiusScreenPx = radius;
        let labelAlphaVis = 1;
        const minR = 0;
        const fadeRange = Math.max(0, SETTINGS.graph.labelFadeRangePx);
        if (radiusScreenPx <= minR) {
          labelAlphaVis = 0;
        } else if (radiusScreenPx <= minR + fadeRange) {
          const t = (radiusScreenPx - minR) / Math.max(1e-4, fadeRange);
          labelAlphaVis = Math.max(0, Math.min(1, t));
        } else {
          labelAlphaVis = 1;
        }
        const proximityFactor = evalFalloff(node, buildLabelProfile(node));
        labelAlphaVis = Math.max(labelAlphaVis, labelAlphaVis + proximityFactor * (1 - labelAlphaVis));
        const isHoverOrHighlight = hoveredNodeId === node.id || hoverHighlightSet && hoverHighlightSet.has(node.id);
        if (isHoverOrHighlight)
          labelAlphaVis = 1;
        if (labelAlphaVis > 0) {
          const clampedDisplayed = Math.max(minFontSize, Math.min(maxFontSize, displayedFont));
          const fontToSet = Math.max(1, clampedDisplayed);
          context.save();
          context.font = `${fontToSet}px ${resolvedInterfaceFontFamily || "sans-serif"}`;
          const isHoverOrHighlight2 = hoveredNodeId === node.id || hoverHighlightSet && hoverHighlightSet.has(node.id);
          const centerA = isHoverOrHighlight2 ? 1 : clamp01(getCenterAlpha(node));
          let labelA = Math.max(SETTINGS.graph.labelColorAlpha, labelAlphaVis * SETTINGS.graph.labelColorAlpha);
          if (isHoverOrHighlight2)
            labelA = SETTINGS.graph.labelColorAlpha;
          else if (hoveredNodeId && hoverHighlightSet.has(node.id))
            labelA = Math.max(labelA, SETTINGS.graph.labelColorAlpha);
          context.globalAlpha = Math.max(0, Math.min(1, labelA * centerA));
          const labelRgb = colorToRgb(SETTINGS.graph.labelColor || "#ffffff");
          context.fillStyle = `rgba(${labelRgb.r},${labelRgb.g},${labelRgb.b},1.0)`;
          const verticalPadding = 4;
          context.fillText(node.label, p.x, p.y + radius + verticalPadding);
          context.restore();
        }
      } else {
        const faintRgb = colorToRgb(themeLabelColor || "#999");
        const faintAlpha = 0.15 * (1 - focus) + 0.1 * focus;
        const effectiveCenterAlpha = clamp01(getCenterAlpha(node));
        const finalAlpha = faintAlpha * effectiveCenterAlpha * SETTINGS.graph.nodeColorAlpha;
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
  function setHoveredNode(nodeId) {
    hoveredNodeId = nodeId;
  }
  function getNodeRadiusForHit(node) {
    return getNodeRadius(node);
  }
  function screenToWorld2D(screenX, screenY) {
    return { x: screenX - camera.offsetX, y: screenY - camera.offsetY };
  }
  function screenToWorld3D(sx, sy, zCam, cam) {
    const { yaw, pitch, distance, targetX, targetY, targetZ } = cam || getCameraState();
    const px = sx - camera.offsetX;
    const py = sy - camera.offsetY;
    const focal = 800;
    const perspective = focal / (zCam || 1e-4);
    const xCam = px / perspective;
    const yCam = py / perspective;
    let cx = xCam;
    let cy = yCam;
    let cz = zCam;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const wy = cy * cosP + cz * sinP;
    const wz1 = -cy * sinP + cz * cosP;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const wx = cx * cosY + wz1 * sinY;
    const wz = -cx * sinY + wz1 * cosY;
    return { x: wx + targetX, y: wy + targetY, z: wz + targetZ };
  }
  function getNodeScreenPosition(node) {
    const p = projectWorld(node);
    return { x: p.x + camera.offsetX, y: p.y + camera.offsetY };
  }
  function getProjectedNode(node) {
    const p = projectWorld(node);
    return { x: p.x + camera.offsetX, y: p.y + camera.offsetY, depth: p.depth };
  }
  function getCameraBasis(cam) {
    const { yaw, pitch } = cam;
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const forward = {
      x: Math.sin(yaw) * cosPitch,
      y: sinPitch,
      z: Math.cos(yaw) * cosPitch
    };
    const right = {
      x: cosYaw,
      y: 0,
      z: -sinYaw
    };
    const up = {
      x: forward.y * right.z - forward.z * right.y,
      y: forward.z * right.x - forward.x * right.z,
      z: forward.x * right.y - forward.y * right.x
    };
    const len = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z) || 1;
    up.x /= len;
    up.y /= len;
    up.z /= len;
    return { right, up, forward };
  }
  function zoomAt(screenX, screenY, factor) {
    if (factor <= 0)
      return;
    const cam = getCameraState();
    let newDistance = cam.distance / factor;
    newDistance = Math.max(200, Math.min(5e3, newDistance));
    setCameraState({ distance: newDistance });
    render();
  }
  function resetCamera() {
    camera = { ...SETTINGS.camera.state };
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
    screenToWorld2D,
    screenToWorld3D,
    getNodeScreenPosition,
    getProjectedNode,
    resetCamera,
    recenterCamera,
    setCameraState,
    getCameraState,
    getCameraBasis
  };
}

// graph/simulation.ts
function createSimulation(nodes, edges) {
  let centerNode = null;
  let running = false;
  const nodeById = /* @__PURE__ */ new Map();
  for (const n of nodes)
    nodeById.set(n.id, n);
  let pinnedNodes = /* @__PURE__ */ new Set();
  function applyRepulsion() {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = (a.z || 0) - (b.z || 0);
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq === 0)
          distSq = 1e-4;
        const dist = Math.sqrt(distSq);
        const minDist = 40;
        const effectiveDist = Math.max(dist, minDist);
        const force = SETTINGS.physics.repulsionStrength / (effectiveDist * effectiveDist);
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        const fz = dz / dist * force;
        if (!pinnedNodes.has(a.id)) {
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          a.vz = (a.vz || 0) + fz;
        }
        if (!pinnedNodes.has(b.id)) {
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
          b.vz = (b.vz || 0) - fz;
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
      const dz = (b.z || 0) - (a.z || 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      const displacement = dist - (SETTINGS.physics.springLength || 0);
      const f = (SETTINGS.physics.springStrength || 0) * Math.tanh(displacement / 50);
      const fx = dx / dist * f;
      const fy = dy / dist * f;
      const fz = dz / dist * f;
      if (!pinnedNodes.has(a.id)) {
        a.vx = (a.vx || 0) + fx;
        a.vy = (a.vy || 0) + fy;
        a.vz = (a.vz || 0) + fz;
      }
      if (!pinnedNodes.has(b.id)) {
        b.vx = (b.vx || 0) - fx;
        b.vy = (b.vy || 0) - fy;
        b.vz = (b.vz || 0) - fz;
      }
    }
  }
  function applyCentering() {
    if (SETTINGS.physics.centerPull <= 0)
      return;
    const cx = SETTINGS.physics.worldCenterX;
    const cy = SETTINGS.physics.worldCenterY;
    const cz = SETTINGS.physics.worldCenterZ;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      const dx = cx - n.x;
      const dy = cy - n.y;
      const dz = cz - n.z;
      n.vx = (n.vx || 0) + dx * SETTINGS.physics.centerPull;
      n.vy = (n.vy || 0) + dy * SETTINGS.physics.centerPull;
      n.vz = (n.vz || 0) + dz * SETTINGS.physics.centerPull;
    }
    if (centerNode) {
      const dx = SETTINGS.physics.worldCenterX - centerNode.x;
      const dy = SETTINGS.physics.worldCenterY - centerNode.y;
      const dz = SETTINGS.physics.worldCenterZ - centerNode.z;
      centerNode.vx = (centerNode.vx || 0) + dx * SETTINGS.physics.centerPull * 0.5;
      centerNode.vy = (centerNode.vy || 0) + dy * SETTINGS.physics.centerPull * 0.5;
      centerNode.vz = (centerNode.vz || 0) + dz * SETTINGS.physics.centerPull * 0.5;
    }
  }
  function applyDamping() {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      const d = Math.max(0, Math.min(1, SETTINGS.physics.damping));
      n.vx = (n.vx ?? 0) * (1 - d);
      n.vy = (n.vy ?? 0) * (1 - d);
      n.vz = (n.vz ?? 0) * (1 - d);
      if (Math.abs(n.vx) < 1e-3)
        n.vx = 0;
      if (Math.abs(n.vy) < 1e-3)
        n.vy = 0;
      if (Math.abs(n.vz) < 1e-3)
        n.vz = 0;
    }
  }
  function applyPlaneConstraints() {
    const noteK = SETTINGS.physics.notePlaneStiffness;
    const tagK = SETTINGS.physics.tagPlaneStiffness;
    if (noteK === 0 && tagK === 0)
      return;
    const targetZ = SETTINGS.physics.worldCenterZ;
    const targetX = SETTINGS.physics.worldCenterX;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      if (n.type === "note" && noteK > 0) {
        const dz = targetZ - n.z;
        n.vz = (n.vz || 0) + dz * noteK;
      } else if (n.type === "tag" && tagK > 0) {
        const dx = targetX - (n.x || 0);
        n.vx = (n.vx || 0) + dx * tagK;
      }
    }
  }
  function applyCenterNodeLock() {
    const cx = SETTINGS.physics.worldCenterX;
    const cy = SETTINGS.physics.worldCenterY;
    const cz = SETTINGS.physics.worldCenterZ;
    for (const n of nodes) {
      if (n.isCenterNode) {
        n.x = cx;
        n.y = cy;
        n.z = cz;
        n.vx = 0;
        n.vy = 0;
        n.vz = 0;
      }
    }
  }
  function integrate(dt) {
    const scale = dt * 60;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      n.x += (n.vx || 0) * scale;
      n.y += (n.vy || 0) * scale;
      n.z = (n.z || 0) + (n.vz || 0) * scale;
      if (n.type === "note" && Math.abs(n.z) < 1e-4)
        n.z = 0;
      if (n.type === "tag" && Math.abs(n.x) < 1e-4)
        n.x = 0;
    }
  }
  function tick(dt) {
    if (!running)
      return;
    if (!nodes.length)
      return;
    applyRepulsion();
    applySprings();
    applyCentering();
    applyPlaneConstraints();
    applyCenterNodeLock();
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
  return { start, stop, tick, reset };
}

// utils/debounce.ts
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

// graph/InputManager.ts
var InputManager = class {
  canvas;
  callback;
  draggedNodeId = null;
  lastClientX = 0;
  // ((Client Space))
  lastClientY = 0;
  // ((Client Space))
  downClickX = 0;
  // [[Canvas Space]
  downClickY = 0;
  // [[Canvas Space]
  dragThreshold = 5;
  // Drag starts after 5 pixels of movement
  pointerMode = 0 /* Idle */;
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callback = callbacks;
    this.attachListeners();
  }
  attachListeners() {
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("wheel", this.onWheel);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    document.addEventListener("mousemove", this.onGlobalMouseMove);
    document.addEventListener("mouseup", this.onGlobalMouseUp);
  }
  onMouseDown = (e) => {
    const canvas = this.canvas.getBoundingClientRect();
    this.downClickX = e.clientX - canvas.left;
    this.downClickY = e.clientY - canvas.top;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    const isLeft = e.button === 0;
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    this.draggedNodeId = this.callback.detectClickedNode(this.downClickX, this.downClickY)?.id || null;
    if (isLeft && e.ctrlKey || isLeft && e.metaKey || isRight) {
      this.pointerMode = 3 /* RightClick */;
      return;
    }
    this.pointerMode = 2 /* Click */;
  };
  onGlobalMouseMove = (e) => {
    const clientX = e.clientX;
    const clientY = e.clientY;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const dx = clientX - this.lastClientX;
    const dy = clientY - this.lastClientY;
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    const dxScr = screenX - this.downClickX;
    const dyScr = screenY - this.downClickY;
    const distSq = dxScr * dxScr + dyScr * dyScr;
    const thresholdSq = this.dragThreshold * this.dragThreshold;
    switch (this.pointerMode) {
      case 0 /* Idle */:
      case 1 /* Hover */:
        return;
      case 2 /* Click */:
        if (distSq > thresholdSq) {
          if (this.draggedNodeId != null) {
            this.pointerMode = 4 /* DragNode */;
            this.callback.onDragStart(this.draggedNodeId, screenX, screenY);
          } else {
            this.pointerMode = 5 /* Pan */;
            this.callback.onPanStart(screenX, screenY);
          }
        }
        return;
      case 4 /* DragNode */:
        this.callback.onDragMove(screenX, screenY);
        return;
      case 5 /* Pan */:
        this.callback.onPanMove(screenX, screenY);
        return;
      case 3 /* RightClick */:
        if (distSq > thresholdSq) {
          this.pointerMode = 6 /* Orbit */;
          this.callback.onOrbitStart(screenX, screenY);
        }
        return;
      case 6 /* Orbit */:
        this.callback.onOrbitMove(screenX, screenY);
        return;
    }
  };
  onGlobalMouseUp = (e) => {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    switch (this.pointerMode) {
      case 4 /* DragNode */:
        this.callback.onDragEnd();
        break;
      case 5 /* Pan */:
        this.callback.onPanEnd();
        break;
      case 6 /* Orbit */:
        this.callback.onOrbitEnd();
        break;
      case 2 /* Click */:
        this.callback.onOpenNode(screenX, screenY);
        break;
      case 3 /* RightClick */:
        if (this.draggedNodeId != null) {
          this.callback.onFollowStart(this.draggedNodeId);
        } else {
          this.callback.resetCamera();
        }
        break;
    }
    this.pointerMode = 0 /* Idle */;
    this.draggedNodeId = null;
  };
  onMouseMove = (e) => {
  };
  onMouseLeave = () => {
    this.callback.onHover(-Infinity, -Infinity);
  };
  onWheel = (e) => {
    e.preventDefault();
    this.callback.onZoom(e.offsetX, e.offsetY, Math.sign(e.deltaY));
  };
  destroy() {
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    document.removeEventListener("mousemove", this.onGlobalMouseMove);
    document.removeEventListener("mouseup", this.onGlobalMouseUp);
  }
};

// graph/GraphManager.ts
var GraphManager = class {
  app;
  containerEl;
  plugin;
  running = false;
  canvas = null;
  renderer = null;
  graph = null;
  adjacency = null;
  simulation = null;
  animationFrame = null;
  lastTime = null;
  previewPollTimer = null;
  followedNode = null;
  inputManager = null;
  cameraSnapShot = null;
  worldAnchorPoint = null;
  screenAnchorPoint = null;
  openNodeFile = null;
  settingsUnregister = null;
  saveNodePositionsDebounced = null;
  constructor(app, containerEl, plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }
  async init() {
    const vaultId = this.app.vault.getName();
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.tabIndex = 0;
    this.renderer = createRenderer(canvas);
    this.containerEl.appendChild(canvas);
    this.graph = await buildGraph(this.app);
    this.inputManager = new InputManager(canvas, {
      onOrbitStart: (dx, dy) => this.startOrbit(dx, dy),
      onOrbitMove: (dx, dy) => this.updateOrbit(dx, dy),
      onOrbitEnd: () => this.endOrbit(),
      onPanStart: (screenX, screenY) => this.startPan(screenX, screenY),
      onPanMove: (screenX, screenY) => this.updatePan(screenX, screenY),
      onPanEnd: () => this.endPan(),
      onOpenNode: (screenX, screenY) => this.openNode(screenX, screenY),
      onHover: (screenX, screenY) => this.updateHover(screenX, screenY),
      onDragStart: (nodeId, screenX, screenY) => this.startDrag(nodeId, screenX, screenY),
      onDragMove: (screenX, screenY) => this.updateDrag(screenX, screenY),
      onDragEnd: () => this.endDrag(),
      onZoom: (x, y, delta) => this.updateZoom(x, y, delta),
      onFollowStart: (nodeId) => this.startFollow(nodeId),
      onFollowEnd: () => this.endFollow(),
      resetCamera: () => this.resetCamera(),
      detectClickedNode: (screenX, screenY) => {
        return this.nodeClicked(screenX, screenY);
      }
    });
    const rawSaved = SETTINGS.nodePositions || {};
    let allSaved = {};
    let savedPositions = {};
    if (rawSaved && typeof rawSaved === "object") {
      if (rawSaved[vaultId] && typeof rawSaved[vaultId] === "object") {
        allSaved = rawSaved;
        savedPositions = allSaved[vaultId] || {};
      } else {
        const hasPathLikeKeys = Object.keys(rawSaved).some((k) => typeof k === "string" && (k.includes("/") || k.startsWith("tag:") || k.endsWith(".md")));
        if (hasPathLikeKeys) {
          savedPositions = rawSaved;
          allSaved = {};
          allSaved[vaultId] = Object.assign({}, rawSaved);
          try {
            this.plugin.settings.nodePositions = allSaved;
            try {
              this.plugin.saveSettings && this.plugin.saveSettings();
            } catch (e) {
            }
          } catch (e) {
          }
        } else {
          allSaved = {};
          savedPositions = {};
        }
      }
    }
    this.buildAdjacencyMap();
    this.refreshGraph();
    this.resetCamera();
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);
    if (!this.saveNodePositionsDebounced) {
      this.saveNodePositionsDebounced = debounce(() => this.saveNodePositions(), 2e3, true);
    }
  }
  buildAdjacencyMap() {
    const adjacency = /* @__PURE__ */ new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!adjacency.has(e.sourceId))
          adjacency.set(e.sourceId, []);
        if (!adjacency.has(e.targetId))
          adjacency.set(e.targetId, []);
        adjacency.get(e.sourceId).push(e.targetId);
        adjacency.get(e.targetId).push(e.sourceId);
      }
    }
    this.adjacency = adjacency;
  }
  updateHover(screenX, screenY) {
    return;
  }
  startDrag(nodeId, screenX, screenY) {
    console.log("dragging", nodeId);
    return;
  }
  updateDrag(screenX, screenY) {
    return;
  }
  endDrag() {
    return;
  }
  updateZoom(screenX, screenY, delta) {
    this.renderer.zoomAt(screenX, screenY, 1 + delta * -0.1);
    this.renderer?.render();
  }
  startPan(screenX, screenY) {
    if (!this.renderer || !this.renderer.screenToWorld3D) {
      console.log("GM startPan: No renderer or screenToWorld3D method");
      return;
    }
    const renderer = this.renderer;
    this.cameraSnapShot = { ...renderer.getCameraState() };
    const depth = this.cameraSnapShot.distance;
    this.worldAnchorPoint = renderer.screenToWorld3D(screenX, screenY, depth, this.cameraSnapShot);
  }
  updatePan(screenX, screenY) {
    if (!this.renderer || !this.renderer.screenToWorld3D || this.worldAnchorPoint === null) {
      return;
    }
    const renderer = this.renderer;
    const camSnap = this.cameraSnapShot;
    const depth = camSnap.distance;
    if (this.worldAnchorPoint === null) {
      return;
    }
    const currentWorld = renderer.screenToWorld3D(screenX, screenY, depth, camSnap);
    const dx = currentWorld.x - this.worldAnchorPoint.x;
    const dy = currentWorld.y - this.worldAnchorPoint.y;
    const dz = currentWorld.z - this.worldAnchorPoint.z;
    const camera = renderer.getCameraState();
    this.renderer.setCameraState({
      targetX: camera.targetX - dx,
      targetY: camera.targetY - dy,
      targetZ: camera.targetZ - dz
    });
    this.worldAnchorPoint = currentWorld;
  }
  endPan() {
    this.worldAnchorPoint = null;
    this.cameraSnapShot = null;
  }
  startOrbit(screenX, screenY) {
    if (!this.renderer) {
      console.log("GM startOrbit: No renderer or screenToWorld3D method");
      return;
    }
    const renderer = this.renderer;
    this.cameraSnapShot = { ...renderer.getCameraState() };
    const depth = this.cameraSnapShot.distance;
    this.screenAnchorPoint = { x: screenX, y: screenY };
  }
  updateOrbit(screenX, screenY) {
    if (!this.renderer || this.screenAnchorPoint === null) {
      return;
    }
    const renderer = this.renderer;
    const camSnap = this.cameraSnapShot;
    const depth = camSnap.distance;
    const rotateSensitivityX = SETTINGS.camera.rotateSensitivityX;
    const rotateSensitivityY = SETTINGS.camera.rotateSensitivityY;
    const dx = screenX - this.screenAnchorPoint.x;
    const dy = screenY - this.screenAnchorPoint.y;
    let yaw = camSnap.yaw - dx * rotateSensitivityX;
    let pitch = camSnap.pitch - dy * rotateSensitivityY;
    const maxPitch = Math.PI / 2;
    const minPitch = -maxPitch;
    if (pitch > maxPitch)
      pitch = maxPitch;
    if (pitch < minPitch)
      pitch = minPitch;
    renderer.setCameraState({ yaw, pitch });
  }
  endOrbit() {
    this.screenAnchorPoint = null;
    this.cameraSnapShot = null;
  }
  openNode(screenX, screenY) {
    const node = this.nodeClicked(screenX, screenY);
    if (node && this.openNodeFile) {
      this.openNodeFile(node);
    }
  }
  setOnNodeClick(handler) {
    this.openNodeFile = handler;
  }
  startFollow(nodeId) {
    this.followedNode = nodeId;
    console.log("start follow", nodeId);
  }
  endFollow() {
    this.followedNode = null;
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
    try {
      this.updateCameraAnimation(timestamp);
    } catch (e) {
    }
    if (this.renderer)
      this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };
  resize(width, height) {
    if (!this.renderer)
      return;
    this.renderer.resize(width, height);
  }
  resetCamera() {
    if (!this.renderer)
      return;
    try {
      const renderer = this.renderer;
      if (renderer.resetCamera) {
        renderer.resetCamera();
      }
    } catch (e) {
    }
  }
  updateCameraAnimation(now) {
    return;
  }
  async refreshGraph() {
    this.stopSimulation();
    this.graph = await buildGraph(this.app);
    const { nodes, edges } = this.filterGraph(this.graph);
    this.simulation = this.buildSimulation(nodes, edges);
    this.buildAdjacencyMap();
    this.startSimulation();
    this.renderer.setGraph(this.graph);
    this.renderer?.render();
  }
  stopSimulation() {
    if (this.simulation) {
      try {
        this.simulation.stop();
      } catch {
      }
      this.simulation = null;
    }
  }
  buildSimulation(nodes, edges) {
    return createSimulation(nodes, edges);
  }
  startSimulation() {
    if (!this.simulation)
      return;
    try {
      this.simulation.start();
      this.running = true;
    } catch {
    }
  }
  filterGraph(graph, showTags = true) {
    if (showTags)
      return { nodes: graph.nodes, edges: graph.edges };
    const tagSet = new Set(graph.nodes.filter((n) => n.type === "tag").map((n) => n.id));
    const nodes = graph.nodes.filter((n) => !tagSet.has(n.id));
    const edges = graph.edges.filter((e) => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
    return { nodes, edges };
  }
  destroy() {
    try {
      this.saveNodePositions();
    } catch (e) {
    }
    try {
      if (this.previewPollTimer)
        window.clearInterval(this.previewPollTimer);
    } catch (e) {
    }
    this.previewPollTimer = null;
    this.renderer?.destroy();
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
    this.openNodeFile = null;
    if (this.settingsUnregister) {
      try {
        this.settingsUnregister();
      } catch (e) {
      }
      this.settingsUnregister = null;
    }
    this.inputManager?.destroy();
    this.inputManager = null;
  }
  nodeClicked(screenX, screenY) {
    if (!this.graph || !this.renderer)
      return null;
    let closest = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    const scale = this.renderer.getScale ? this.renderer.getScale() : 1;
    for (const node of this.graph.nodes) {
      const sp = this.renderer.getNodeScreenPosition ? this.renderer.getNodeScreenPosition(node) : null;
      if (!sp)
        continue;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius * Math.max(1e-4, scale) + hitPadding;
      const dx = screenX - sp.x;
      const dy = screenY - sp.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= hitR * hitR && distSq < closestDist) {
        closestDist = distSq;
        closest = node;
      }
    }
    return closest;
  }
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
};

// GraphView.ts
var GREATER_GRAPH_VIEW_TYPE = "graph-plus";
var GraphView = class extends import_obsidian.ItemView {
  manager = null;
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
    return "graph+";
  }
  getIcon() {
    return "dot-network";
  }
  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: "graph+" });
    this.manager = new GraphManager(this.app, container, this.plugin);
    await this.manager.init();
    if (this.manager) {
      this.manager.setOnNodeClick((node) => this.openNodeFile(node));
    }
    if (!this.scheduleGraphRefresh) {
      this.scheduleGraphRefresh = debounce(() => {
        try {
          this.manager?.refreshGraph();
        } catch (e) {
          console.error("Greater Graph: refreshGraph error", e);
        }
      }, 200, true);
    }
    this.registerEvent(this.app.vault.on("create", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
  }
  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.manager?.resize(rect.width, rect.height);
  }
  async onClose() {
    this.manager?.destroy();
    this.manager = null;
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

// main.ts
var SETTINGS = {
  graph: {
    minNodeRadius: 3,
    maxNodeRadius: 20,
    minCenterAlpha: 0.1,
    maxCenterAlpha: 0.6,
    highlightDepth: 1,
    focusSmoothing: 0.8,
    nodeColor: void 0,
    // color overrides left undefined by default to follow theme
    tagColor: void 0,
    labelColor: void 0,
    edgeColor: void 0,
    nodeColorAlpha: 0.1,
    tagColorAlpha: 0.1,
    labelBaseFontSize: 24,
    labelFadeRangePx: 8,
    labelColorAlpha: 1,
    labelRadius: 30,
    useInterfaceFont: true,
    edgeColorAlpha: 0.1,
    countDuplicateLinks: true,
    drawDoubleLines: true,
    showTags: true,
    hoverScale: 1,
    useCenterNote: false,
    centerNoteTitle: "",
    useOutlinkFallback: false
  },
  physics: {
    repulsionStrength: 5e3,
    springStrength: 1,
    springLength: 100,
    centerPull: 1e-3,
    damping: 0.7,
    notePlaneStiffness: 0,
    tagPlaneStiffness: 0,
    mouseGravityEnabled: true,
    gravityRadius: 6,
    gravityFallOff: 3,
    mouseGravityRadius: 15,
    // change these settings later
    mouseGravityStrength: 1,
    mouseGravityExponent: 2,
    worldCenterX: 0,
    worldCenterY: 0,
    worldCenterZ: 0
  },
  camera: {
    momentumScale: 0.12,
    dragThreshold: 4,
    rotateSensitivityX: 5e-3,
    rotateSensitivityY: 5e-3,
    cameraAnimDuration: 300,
    state: {
      yaw: Math.PI / 6,
      pitch: Math.PI / 8,
      distance: 1200,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      offsetX: 0,
      offsetY: 0
    }
  },
  nodePositions: {}
};
var GreaterGraphPlugin = class extends import_obsidian2.Plugin {
  settingsListeners = [];
  async onload() {
    this.registerView(GREATER_GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id: "open-graph+",
      name: "open graph+",
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
  async saveSettings() {
    await this.saveData(SETTINGS);
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
    containerEl.createEl("h2", { text: "Graph Settings" });
    const graph = SETTINGS.graph;
    const physics = SETTINGS.physics;
    const addSliderSetting = (parent, opts) => {
      const s = new import_obsidian2.Setting(parent).setName(opts.name).setDesc(opts.desc || "");
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(opts.min);
      range.max = String(opts.max);
      range.step = String(opts.step ?? (opts.step === 0 ? 0 : opts.step || 1));
      range.value = String(opts.value);
      range.style.flex = "1";
      const num = document.createElement("input");
      num.type = "number";
      num.min = String(opts.min);
      num.max = String(opts.max);
      num.step = String(opts.step ?? (opts.step === 0 ? 0 : opts.step || 1));
      num.value = String(opts.value);
      num.style.minWidth = "56px";
      num.style.textAlign = "right";
      num.style.width = "80px";
      range.addEventListener("input", (e) => {
        num.value = e.target.value;
      });
      num.addEventListener("input", (e) => {
        range.value = e.target.value;
      });
      range.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        await opts.onChange(v);
      });
      num.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        await opts.onChange(v);
      });
      const rbtn = document.createElement("button");
      rbtn.type = "button";
      rbtn.textContent = "\u21BA";
      rbtn.title = "Reset to default";
      rbtn.style.border = "none";
      rbtn.style.background = "transparent";
      rbtn.style.cursor = "pointer";
      rbtn.addEventListener("click", async () => {
        try {
          if (typeof opts.resetValue === "number") {
            range.value = String(opts.resetValue);
            num.value = range.value;
            await opts.onChange(Number(range.value));
          } else {
            await opts.onChange(NaN);
          }
        } catch (e) {
        }
      });
      wrap.appendChild(range);
      wrap.appendChild(num);
      wrap.appendChild(rbtn);
      s.controlEl.appendChild(wrap);
      return { range, num, reset: rbtn };
    };
    addSliderSetting(containerEl, {
      name: "Minimum node radius",
      desc: "Minimum radius for the smallest node (in pixels).",
      value: SETTINGS.graph.minNodeRadius ?? SETTINGS.graph.minNodeRadius,
      min: 1,
      max: 20,
      step: 1,
      resetValue: SETTINGS.graph.minNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          SETTINGS.graph.minNodeRadius = Math.round(v);
          if (typeof SETTINGS.graph.maxNodeRadius === "number" && SETTINGS.graph.maxNodeRadius < SETTINGS.graph.minNodeRadius + 2) {
            SETTINGS.graph.maxNodeRadius = SETTINGS.graph.minNodeRadius + 2;
          }
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.minNodeRadius = SETTINGS.graph.minNodeRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Maximum node radius",
      desc: "Maximum radius for the most connected node (in pixels).",
      value: SETTINGS.graph.maxNodeRadius ?? SETTINGS.graph.maxNodeRadius,
      min: 8,
      max: 80,
      step: 1,
      resetValue: SETTINGS.graph.maxNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v)) {
          SETTINGS.graph.maxNodeRadius = Math.round(v);
          if (typeof SETTINGS.graph.minNodeRadius === "number" && SETTINGS.graph.maxNodeRadius < SETTINGS.graph.minNodeRadius + 2)
            SETTINGS.graph.maxNodeRadius = SETTINGS.graph.minNodeRadius + 2;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.maxNodeRadius = SETTINGS.graph.maxNodeRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Minimum center glow opacity",
      desc: "Opacity (0\u20130.8) at the glow center for the least connected node.",
      value: SETTINGS.graph.minCenterAlpha ?? SETTINGS.graph.minCenterAlpha,
      min: 0,
      max: 0.8,
      step: 0.01,
      resetValue: SETTINGS.graph.minCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 0.8) {
          SETTINGS.graph.minCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.minCenterAlpha = SETTINGS.graph.minCenterAlpha;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Maximum center glow opacity",
      desc: "Opacity (0\u20131) at the glow center for the most connected node.",
      value: SETTINGS.graph.maxCenterAlpha ?? SETTINGS.graph.maxCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: SETTINGS.graph.maxCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          SETTINGS.graph.maxCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.maxCenterAlpha = SETTINGS.graph.maxCenterAlpha;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Highlight depth",
      desc: "Graph distance (in hops) from the hovered node that will be highlighted.",
      value: SETTINGS.graph.highlightDepth,
      min: 0,
      max: 5,
      step: 1,
      resetValue: SETTINGS.graph.highlightDepth,
      onChange: async (v) => {
        if (!Number.isNaN(v) && Number.isInteger(v) && v >= 0) {
          SETTINGS.graph.highlightDepth = Math.max(0, Math.floor(v));
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.highlightDepth = SETTINGS.graph.highlightDepth;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Gravity Radius",
      desc: "Scales each node's screen-space radius for glow/mouse gravity.",
      value: physics.gravityRadius ?? SETTINGS.physics.gravityRadius,
      min: 1,
      max: 20,
      step: 0.1,
      resetValue: SETTINGS.physics.gravityRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          physics.gravityRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.gravityRadius = SETTINGS.physics.gravityRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Gravity curve steepness",
      desc: "Controls falloff steepness; higher = stronger near cursor.",
      value: physics.gravityFallOff ?? SETTINGS.physics.gravityFallOff,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: SETTINGS.physics.gravityFallOff,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          physics.gravityFallOff = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.gravityFallOff = SETTINGS.physics.gravityFallOff;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Label Radius",
      desc: "Screen-space label reveal radius (\xD7 node size).",
      value: SETTINGS.graph.labelRadius ?? SETTINGS.graph.labelRadius,
      min: 0.5,
      max: 10,
      step: 0.1,
      resetValue: SETTINGS.graph.labelRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          SETTINGS.graph.labelRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.labelRadius = SETTINGS.graph.labelRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Focus smoothing rate",
      desc: "Smoothness of focus transitions (0 = very slow, 1 = fast). Internally used as a lerp factor.",
      value: SETTINGS.graph.focusSmoothing ?? SETTINGS.graph.focusSmoothing,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: SETTINGS.graph.focusSmoothing,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          SETTINGS.graph.focusSmoothing = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.focusSmoothing = SETTINGS.graph.focusSmoothing;
          await this.plugin.saveSettings();
        }
      }
    });
    containerEl.createEl("h2", { text: "Color Settings" });
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Node color (override)").setDesc("Optional color to override the theme accent for node fill. Leave unset to use the active theme.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = SETTINGS.graph.nodeColor ? String(SETTINGS.graph.nodeColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        SETTINGS.graph.nodeColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      const alphaInput = document.createElement("input");
      alphaInput.type = "number";
      alphaInput.min = "0.1";
      alphaInput.max = "1";
      alphaInput.step = "0.01";
      alphaInput.value = String(SETTINGS.graph.nodeColorAlpha ?? SETTINGS.graph.nodeColorAlpha);
      alphaInput.style.width = "68px";
      alphaInput.style.marginLeft = "8px";
      alphaInput.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        SETTINGS.graph.nodeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : SETTINGS.graph.nodeColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        SETTINGS.graph.nodeColor = void 0;
        SETTINGS.graph.nodeColorAlpha = SETTINGS.graph.nodeColorAlpha;
        await this.plugin.saveSettings();
        colorInput.value = "#000000";
        alphaInput.value = String(SETTINGS.graph.nodeColorAlpha);
      });
      s.controlEl.appendChild(rb);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(colorInput);
      s.controlEl.appendChild(alphaInput);
    }
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Edge color (override)").setDesc("Optional color to override edge stroke color. Leave unset to use a theme-appropriate color.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = SETTINGS.graph.edgeColor ? String(SETTINGS.graph.edgeColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        SETTINGS.graph.edgeColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      const edgeAlpha = document.createElement("input");
      edgeAlpha.type = "number";
      edgeAlpha.min = "0.1";
      edgeAlpha.max = "1";
      edgeAlpha.step = "0.01";
      edgeAlpha.value = String(SETTINGS.graph.edgeColorAlpha ?? SETTINGS.graph.edgeColorAlpha);
      edgeAlpha.style.width = "68px";
      edgeAlpha.style.marginLeft = "8px";
      edgeAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        SETTINGS.graph.edgeColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : SETTINGS.graph.edgeColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        SETTINGS.graph.edgeColor = void 0;
        SETTINGS.graph.edgeColorAlpha = SETTINGS.graph.edgeColorAlpha;
        await this.plugin.saveSettings();
        colorInput.value = "#000000";
        edgeAlpha.value = String(SETTINGS.graph.edgeColorAlpha);
      });
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(edgeAlpha);
    }
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Tag color (override)").setDesc("Optional color to override tag node color. Leave unset to use the active theme.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = SETTINGS.graph.tagColor ? String(SETTINGS.graph.tagColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        SETTINGS.graph.tagColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      const tagAlpha = document.createElement("input");
      tagAlpha.type = "number";
      tagAlpha.min = "0.1";
      tagAlpha.max = "1";
      tagAlpha.step = "0.01";
      tagAlpha.value = String(SETTINGS.graph.tagColorAlpha ?? SETTINGS.graph.tagColorAlpha);
      tagAlpha.style.width = "68px";
      tagAlpha.style.marginLeft = "8px";
      tagAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        SETTINGS.graph.tagColorAlpha = Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : SETTINGS.graph.tagColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        SETTINGS.graph.tagColor = void 0;
        SETTINGS.graph.tagColorAlpha = SETTINGS.graph.tagColorAlpha;
        await this.plugin.saveSettings();
        colorInput.value = "#000000";
        tagAlpha.value = String(SETTINGS.graph.tagColorAlpha);
      });
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(tagAlpha);
    }
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Label color (override)").setDesc("Optional color to override the label text color. Leave unset to use the active theme.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = SETTINGS.graph.labelColor ? String(SETTINGS.graph.labelColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        SETTINGS.graph.labelColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      const labelAlpha = document.createElement("input");
      labelAlpha.type = "number";
      labelAlpha.min = "0";
      labelAlpha.max = "1";
      labelAlpha.step = "0.01";
      labelAlpha.value = String(SETTINGS.graph.labelColorAlpha ?? SETTINGS.graph.labelColorAlpha);
      labelAlpha.style.width = "68px";
      labelAlpha.style.marginLeft = "8px";
      labelAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        SETTINGS.graph.labelColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : SETTINGS.graph.labelColorAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        SETTINGS.graph.labelColor = void 0;
        SETTINGS.graph.labelColorAlpha = SETTINGS.graph.labelColorAlpha;
        await this.plugin.saveSettings();
        colorInput.value = "#000000";
        labelAlpha.value = String(SETTINGS.graph.labelColorAlpha);
      });
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(labelAlpha);
    }
    new import_obsidian2.Setting(containerEl).setName("Use interface font for labels").setDesc("When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.").addToggle((t) => t.setValue(Boolean(SETTINGS.graph.useInterfaceFont)).onChange(async (v) => {
      SETTINGS.graph.useInterfaceFont = Boolean(v);
      await this.plugin.saveSettings();
    }));
    addSliderSetting(containerEl, {
      name: "Base label font size",
      desc: "Base font size for labels in pixels (before camera zoom scaling).",
      value: SETTINGS.graph.labelBaseFontSize ?? SETTINGS.graph.labelBaseFontSize,
      min: 6,
      max: 24,
      step: 1,
      resetValue: SETTINGS.graph.labelBaseFontSize,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 72) {
          SETTINGS.graph.labelBaseFontSize = Math.round(v);
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          SETTINGS.graph.labelBaseFontSize = SETTINGS.graph.labelBaseFontSize;
          await this.plugin.saveSettings();
        }
      }
    });
    containerEl.createEl("h2", { text: "Physics Settings" });
    const repulsionUi = (() => {
      const internal = physics.repulsionStrength ?? SETTINGS.physics.repulsionStrength;
      const ui = Math.sqrt(Math.max(0, internal / 2e3));
      return Math.min(1, Math.max(0, ui));
    })();
    addSliderSetting(containerEl, {
      name: "Repulsion strength",
      desc: "UI 0\u20131 (mapped internally). Higher = more node separation.",
      value: repulsionUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: repulsionUi,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          physics.repulsionStrength = v * v * 2e3;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.repulsionStrength = SETTINGS.physics.repulsionStrength;
          await this.plugin.saveSettings();
        }
      }
    });
    const springUi = Math.min(1, Math.max(0, (physics.springStrength ?? SETTINGS.physics.springStrength) / 0.5));
    addSliderSetting(containerEl, {
      name: "Spring strength",
      desc: "UI 0\u20131 mapped to internal spring constant (higher = stiffer).",
      value: springUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: springUi,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          physics.springStrength = v * 0.5;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.springStrength = SETTINGS.physics.springStrength;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Spring length",
      desc: "Preferred length (px) for edge springs.",
      value: physics.springLength ?? SETTINGS.physics.springLength,
      min: 20,
      max: 400,
      step: 1,
      resetValue: SETTINGS.physics.springLength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          physics.springLength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          physics.springLength = SETTINGS.physics.springLength;
          await this.plugin.saveSettings();
        }
      }
    });
    const centerUi = Math.min(1, Math.max(0, (physics.centerPull ?? SETTINGS.physics.centerPull) / 0.01));
    addSliderSetting(containerEl, {
      name: "Center pull",
      desc: "UI 0\u20131 mapped to a small centering force (internal scale).",
      value: centerUi,
      min: 0,
      max: 1,
      step: 1e-3,
      resetValue: 0.1,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          physics.centerPull = v * 0.01;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Damping",
      desc: "Velocity damping (0.7\u20131.0). Higher values reduce motion faster.",
      value: physics.damping ?? SETTINGS.physics.damping,
      min: 0.7,
      max: 1,
      step: 0.01,
      resetValue: SETTINGS.physics.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0.7 && v <= 1) {
          physics.damping = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          await this.plugin.saveSettings();
        }
      }
    });
    new import_obsidian2.Setting(containerEl).setName("Count duplicate links").setDesc("If enabled, multiple links between the same two files will be counted when computing in/out degrees.").addToggle((t) => t.setValue(Boolean(graph.countDuplicateLinks)).onChange(async (v) => {
      graph.countDuplicateLinks = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Double-line mutual links").setDesc("When enabled, mutual links (A \u2194 B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.").addToggle((t) => t.setValue(Boolean(graph.drawDoubleLines)).onChange(async (v) => {
      graph.drawDoubleLines = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Show tag nodes").setDesc("Toggle visibility of tag nodes and their edges in the graph.").addToggle((t) => t.setValue(graph.showTags !== false).onChange(async (v) => {
      graph.showTags = Boolean(v);
      await this.plugin.saveSettings();
    }));
    const notePlaneUi = Math.min(1, Math.max(0, (physics.notePlaneStiffness ?? SETTINGS.physics.notePlaneStiffness) / 0.02));
    addSliderSetting(containerEl, {
      name: "Note plane stiffness (z)",
      desc: "How strongly notes are pulled toward the z=0 plane (UI 0\u20131).",
      value: notePlaneUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: 0.2,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          physics.notePlaneStiffness = v * 0.02;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          await this.plugin.saveSettings();
        }
      }
    });
    const tagPlaneUi = Math.min(1, Math.max(0, (physics.tagPlaneStiffness ?? SETTINGS.physics.tagPlaneStiffness) / 0.02));
    addSliderSetting(containerEl, {
      name: "Tag plane stiffness (x)",
      desc: "How strongly tag nodes are pulled toward the x=0 plane (UI 0\u20131).",
      value: tagPlaneUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: 0.4,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          physics.tagPlaneStiffness = v * 0.02;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          await this.plugin.saveSettings();
        }
      }
    });
    new import_obsidian2.Setting(containerEl).setName("Mouse gravity").setDesc("Enable the mouse gravity well that attracts nearby nodes.").addToggle((t) => t.setValue(Boolean(physics.mouseGravityEnabled !== false)).onChange(async (v) => {
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h2", { text: "Center Node" });
    new import_obsidian2.Setting(containerEl).setName("Use pinned center note").setDesc("Prefer a specific note path as the graph center. Falls back to max in-links if not found.").addToggle((t) => t.setValue(Boolean(graph.useCenterNote)).onChange(async (v) => {
      graph.useCenterNote = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Pinned center note path").setDesc('e.g., "Home.md" or "Notes/Home" (vault-relative).').addText((txt) => txt.setPlaceholder("path/to/note").setValue(graph.centerNoteTitle || "").onChange(async (v) => {
      graph.centerNoteTitle = (v || "").trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Fallback: prefer out-links").setDesc("When picking a center by link count, prefer out-links (out-degree) instead of in-links (in-degree)").addToggle((t) => t.setValue(Boolean(graph.useOutlinkFallback)).onChange(async (v) => {
      graph.useOutlinkFallback = Boolean(v);
      await this.plugin.saveSettings();
    }));
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SETTINGS
});
