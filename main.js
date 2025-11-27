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
    vz: 0,
    type: "note",
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
  const tagNodeByName = /* @__PURE__ */ new Map();
  function ensureTagNode(tagName) {
    let n = tagNodeByName.get(tagName);
    if (n)
      return n;
    n = {
      id: `tag:${tagName}`,
      label: `#${tagName}`,
      x: 0,
      y: 0,
      z: 0,
      filePath: "",
      vx: 0,
      vy: 0,
      vz: 0,
      type: "tag",
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0
    };
    nodes.push(n);
    tagNodeByName.set(tagName, n);
    nodeByPath.set(n.id, n);
    return n;
  }
  function extractTags(cache) {
    if (!cache)
      return [];
    const found = [];
    try {
      const inline = cache.tags;
      if (Array.isArray(inline)) {
        for (const t of inline) {
          if (!t || !t.tag)
            continue;
          const raw = t.tag.startsWith("#") ? t.tag.slice(1) : t.tag;
          if (raw)
            found.push(raw);
        }
      }
    } catch {
    }
    try {
      const fm = cache.frontmatter || {};
      const vals = [];
      if (fm) {
        if (Array.isArray(fm.tags))
          vals.push(...fm.tags);
        else if (typeof fm.tags === "string")
          vals.push(fm.tags);
        if (Array.isArray(fm.tag))
          vals.push(...fm.tag);
        else if (typeof fm.tag === "string")
          vals.push(fm.tag);
      }
      for (const v of vals) {
        if (!v)
          continue;
        if (typeof v === "string") {
          const s = v.startsWith("#") ? v.slice(1) : v;
          if (s)
            found.push(s);
        }
      }
    } catch {
    }
    const uniq = Array.from(new Set(found));
    return uniq;
  }
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const tags = extractTags(cache);
    if (!tags || tags.length === 0)
      continue;
    const noteNode = nodeByPath.get(file.path);
    if (!noteNode)
      continue;
    for (const tagName of tags) {
      const tagNode = ensureTagNode(tagName);
      const key = `${noteNode.id}->${tagNode.id}`;
      if (!edgeSet.has(key)) {
        edges.push({ id: key, sourceId: noteNode.id, targetId: tagNode.id, linkCount: 1, hasReverse: false });
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
  function chooseCenterNode(nodesArr, opts) {
    if (!opts?.usePinnedCenterNote)
      return null;
    const onlyNotes = nodesArr.filter((n) => n.type !== "tag");
    let chosen = null;
    const preferOut = Boolean(opts?.useOutlinkFallback);
    const metric = (n) => preferOut ? n.outDegree || 0 : n.inDegree || 0;
    const chooseBy = (predicate) => {
      let best = null;
      for (const n of onlyNotes) {
        if (!predicate(n))
          continue;
        if (!best) {
          best = n;
          continue;
        }
        if (metric(n) > metric(best))
          best = n;
      }
      return best;
    };
    if (opts.usePinnedCenterNote && opts.pinnedCenterNotePath) {
      const raw = String(opts.pinnedCenterNotePath).trim();
      if (raw) {
        const mc = app.metadataCache;
        let resolved2 = null;
        try {
          resolved2 = mc?.getFirstLinkpathDest?.(raw, "");
        } catch {
        }
        if (!resolved2 && !raw.endsWith(".md")) {
          try {
            resolved2 = mc?.getFirstLinkpathDest?.(raw + ".md", "");
          } catch {
          }
        }
        if (resolved2 && resolved2.path) {
          chosen = chooseBy((n) => n.filePath === resolved2.path);
        }
        if (!chosen) {
          const normA = raw;
          const normB = raw.endsWith(".md") ? raw : raw + ".md";
          chosen = chooseBy((n) => n.filePath === normA || n.filePath === normB);
        }
        if (!chosen) {
          const base = raw.endsWith(".md") ? raw.slice(0, -3) : raw;
          chosen = chooseBy((n) => {
            const f = n.file;
            const bn = f?.basename || n.label;
            return String(bn) === base;
          });
        }
      }
    }
    if (!chosen) {
      for (const n of onlyNotes) {
        if (!chosen) {
          chosen = n;
          continue;
        }
        if (metric(n) > metric(chosen))
          chosen = n;
      }
    }
    return chosen;
  }
  for (const n of nodes)
    n.isCenterNode = false;
  const centerNode = chooseCenterNode(nodes, { usePinnedCenterNote: Boolean(options?.usePinnedCenterNote), pinnedCenterNotePath: options?.pinnedCenterNotePath || "" });
  if (centerNode)
    centerNode.isCenterNode = true;
  return { nodes, edges };
}

// graph/layout2d.ts
function layoutGraph3D(graph, options) {
  const { width, height } = options;
  const allNodes = graph.nodes;
  if (!allNodes || allNodes.length === 0)
    return;
  const centerX = options.centerX ?? width / 2;
  const centerY = options.centerY ?? height / 2;
  const jitter = typeof options.jitter === "number" ? options.jitter : 8;
  const tagZSpread = typeof options.tagZSpread === "number" ? options.tagZSpread : 400;
  const nodes = options.onlyNodes ?? allNodes;
  if (!nodes || nodes.length === 0)
    return;
  const minRadius3D = Math.max(32, jitter * 4);
  const maxRadius3D = Math.max(minRadius3D + 40, Math.min(Math.max(width, height) / 2 - (options.margin || 32), 800));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.isCenterNode) {
      if (node.type === "tag") {
        node.x = 0;
        node.y = centerY;
        node.z = 0;
      } else {
        node.x = centerX;
        node.y = centerY;
        node.z = 0;
      }
      continue;
    }
    const angle = Math.random() * Math.PI * 2;
    const r = minRadius3D + Math.random() * (maxRadius3D - minRadius3D);
    const rx = Math.cos(angle) * r;
    const ry = Math.sin(angle) * r;
    if (node.type === "tag") {
      node.x = 0;
      node.y = centerY + ry;
      node.z = (Math.random() - 0.5) * tagZSpread;
    } else {
      node.x = centerX + rx;
      node.y = centerY + ry;
      node.z = 0;
    }
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
      if (centerNode.type === "tag") {
        centerNode.x = 0;
        centerNode.y = centerY;
        centerNode.z = 0;
      } else {
        centerNode.x = centerX;
        centerNode.y = centerY;
        centerNode.z = 0;
      }
    }
  }
}

// graph/renderer2d.ts
function createRenderer2D(options) {
  const canvas = options.canvas;
  let glowOptions = options.glow;
  const ctx = canvas.getContext("2d");
  let graph = null;
  let nodeById = /* @__PURE__ */ new Map();
  let minDegree = 0;
  let maxDegree = 0;
  let minEdgeCount = 1;
  let maxEdgeCount = 1;
  let drawMutualDoubleLines = true;
  let showTags = true;
  let minRadius = glowOptions?.minNodeRadius ?? 4;
  let maxRadius = glowOptions?.maxNodeRadius ?? 14;
  const DEFAULT_GLOW_MULTIPLIER = 2;
  let glowRadiusPx = glowOptions?.glowRadiusPx ?? null;
  let minCenterAlpha = glowOptions?.minCenterAlpha ?? 0.05;
  let maxCenterAlpha = glowOptions?.maxCenterAlpha ?? 0.35;
  let nodeColorAlpha = glowOptions?.nodeColorAlpha ?? 1;
  let tagColorAlpha = glowOptions?.tagColorAlpha ?? 1;
  let labelColorAlpha = glowOptions?.labelColorAlpha ?? 1;
  let edgeColorAlpha = glowOptions?.edgeColorAlpha ?? 1;
  let nodeColorMaxAlpha = glowOptions?.nodeColorMaxAlpha ?? nodeColorAlpha;
  let tagColorMaxAlpha = glowOptions?.tagColorMaxAlpha ?? tagColorAlpha;
  let edgeColorMaxAlpha = glowOptions?.edgeColorMaxAlpha ?? edgeColorAlpha;
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
  let themeTagColor = "#8000ff";
  let resolvedInterfaceFontFamily = null;
  let resolvedMonoFontFamily = null;
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
  let camera = {
    yaw: Math.PI / 6,
    pitch: Math.PI / 8,
    distance: 1200,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    zoom: 1
  };
  function setCamera(newCamera) {
    camera = { ...camera, ...newCamera };
  }
  function getCamera() {
    return camera;
  }
  function projectWorld(node) {
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
    const eps = 1e-4;
    const safeDz = dz < eps ? eps : dz;
    const focal = 800;
    const perspective = zoom * focal / safeDz;
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
    const p = projectWorld(node);
    const dx = mouseX - p.x;
    const dy = mouseY - p.y;
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
      const tagVar = cs.getPropertyValue("--accent-2") || cs.getPropertyValue("--accent-secondary") || cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
      if (!glowOptions?.tagColor && tagVar && tagVar.trim())
        themeTagColor = tagVar.trim();
    } catch (e) {
    }
    try {
      const cs = window.getComputedStyle(canvas);
      if (glowOptions?.useInterfaceFont) {
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
      if (glowOptions?.useInterfaceFont)
        resolvedInterfaceFontFamily = resolvedInterfaceFontFamily || "sans-serif";
      else
        resolvedMonoFontFamily = resolvedMonoFontFamily || "monospace";
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
        if (!showTags && (src.type === "tag" || tgt.type === "tag"))
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
        const worldLineWidth = Math.max(0.4, screenW / Math.max(1e-4, scale));
        let alpha = 0.65;
        if (!hoveredNodeId)
          alpha = 0.65;
        else
          alpha = 0.08 + (0.9 - 0.08) * edgeFocus;
        ctx.save();
        const useEdgeAlpha = glowOptions?.edgeColorAlpha ?? edgeColorAlpha;
        const useEdgeMax = glowOptions?.edgeColorMaxAlpha ?? glowOptions?.edgeColorAlpha ?? edgeColorMaxAlpha;
        let finalEdgeAlpha = alpha * useEdgeAlpha;
        if (hoveredNodeId) {
          const srcInDepth = hoverHighlightSet.has(edge.sourceId);
          const tgtInDepth = hoverHighlightSet.has(edge.targetId);
          const directlyIncident = edge.sourceId === hoveredNodeId || edge.targetId === hoveredNodeId;
          if (srcInDepth && tgtInDepth || directlyIncident)
            finalEdgeAlpha = useEdgeMax;
        }
        ctx.strokeStyle = `rgba(${edgeRgb.r},${edgeRgb.g},${edgeRgb.b},${finalEdgeAlpha})`;
        const isMutual = !!edge.hasReverse && drawMutualDoubleLines;
        if (isMutual) {
          const dx = tgtP.x - srcP.x;
          const dy = tgtP.y - srcP.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const perpX = -uy;
          const perpY = ux;
          const offsetPx = Math.max(2, screenW * 0.6);
          const offsetWorld = offsetPx / Math.max(1e-4, scale);
          ctx.beginPath();
          ctx.moveTo(srcP.x + perpX * offsetWorld, srcP.y + perpY * offsetWorld);
          ctx.lineTo(tgtP.x + perpX * offsetWorld, tgtP.y + perpY * offsetWorld);
          ctx.lineWidth = worldLineWidth;
          ctx.stroke();
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
      if (!showTags && node.type === "tag")
        continue;
      const p = projectWorld(node);
      const baseRadius = getBaseNodeRadius(node);
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      const glowRadius = glowRadiusPx != null && isFinite(glowRadiusPx) && glowRadiusPx > 0 ? glowRadiusPx : radius * DEFAULT_GLOW_MULTIPLIER;
      const focus = nodeFocusMap.get(node.id) ?? 1;
      const focused = focus > 0.01;
      if (focused) {
        const nodeColorOverride = node && node.type === "tag" ? glowOptions?.tagColor ?? themeTagColor : themeNodeColor;
        const accentRgb = colorToRgb(nodeColorOverride);
        const useNodeAlpha = node && node.type === "tag" ? glowOptions?.tagColorAlpha ?? tagColorAlpha : glowOptions?.nodeColorAlpha ?? nodeColorAlpha;
        const useNodeMax = node && node.type === "tag" ? glowOptions?.tagColorMaxAlpha ?? glowOptions?.tagColorAlpha ?? tagColorAlpha : glowOptions?.nodeColorMaxAlpha ?? glowOptions?.nodeColorAlpha ?? nodeColorAlpha;
        const dimCenter = clamp01(getBaseCenterAlpha(node) * dimFactor);
        const fullCenter = centerAlpha;
        let blendedCenter = dimCenter + (fullCenter - dimCenter) * focus;
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
        gradient.addColorStop(0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.4, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.5 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(0.8, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${blendedCenter * 0.15 * effectiveUseNodeAlpha})`);
        gradient.addColorStop(1, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0)`);
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
        const bodyAlpha = nodeMinBodyAlpha + (1 - nodeMinBodyAlpha) * focus;
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        const bodyColorOverride = node && node.type === "tag" ? glowOptions?.tagColor ?? themeTagColor : themeNodeColor;
        const accent = colorToRgb(bodyColorOverride);
        const useBodyAlpha = node && node.type === "tag" ? glowOptions?.tagColorAlpha ?? tagColorAlpha : glowOptions?.nodeColorAlpha ?? nodeColorAlpha;
        const useBodyMax = node && node.type === "tag" ? glowOptions?.tagColorMaxAlpha ?? glowOptions?.tagColorAlpha ?? tagColorAlpha : glowOptions?.nodeColorMaxAlpha ?? glowOptions?.nodeColorAlpha ?? nodeColorAlpha;
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
        const displayedFontBase = baseFontSize * scale;
        const scaleFactor = baseRadius > 0 ? radius / baseRadius : 1;
        const displayedFont = displayedFontBase * scaleFactor;
        if (displayedFont >= hideBelow) {
          const clampedDisplayed = Math.max(minFontSize, Math.min(maxFontSize, displayedFont));
          const fontToSet = Math.max(1, clampedDisplayed / Math.max(1e-4, scale));
          ctx.save();
          ctx.font = `${fontToSet}px ${resolvedInterfaceFontFamily || "sans-serif"}`;
          ctx.globalAlpha = focus;
          const labelRgb = colorToRgb((glowOptions?.labelColor ?? labelCss) || "#ffffff");
          const useLabelAlpha = glowOptions?.labelColorAlpha ?? labelColorAlpha;
          ctx.fillStyle = `rgba(${labelRgb.r},${labelRgb.g},${labelRgb.b},${useLabelAlpha})`;
          const verticalPadding = 4;
          ctx.fillText(node.label, p.x, p.y + radius + verticalPadding);
          ctx.restore();
        }
      } else {
        const faintRgb = colorToRgb(themeLabelColor || "#999");
        const faintAlpha = 0.15 * (1 - focus) + 0.1 * focus;
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
  function setHoveredNode(nodeId) {
    hoveredNodeId = nodeId;
  }
  function getNodeRadiusForHit(node) {
    return getNodeRadius(node);
  }
  function setRenderOptions(opts) {
    if (!opts)
      return;
    if (typeof opts.mutualDoubleLines === "boolean")
      drawMutualDoubleLines = opts.mutualDoubleLines;
    if (typeof opts.showTags === "boolean")
      showTags = opts.showTags;
  }
  function setGlowSettings(glow) {
    if (!glow)
      return;
    glowOptions = glow;
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
    nodeColorAlpha = typeof glow.nodeColorAlpha === "number" ? glow.nodeColorAlpha : nodeColorAlpha;
    tagColorAlpha = typeof glow.tagColorAlpha === "number" ? glow.tagColorAlpha : tagColorAlpha;
    labelColorAlpha = typeof glow.labelColorAlpha === "number" ? glow.labelColorAlpha : labelColorAlpha;
    edgeColorAlpha = typeof glow.edgeColorAlpha === "number" ? glow.edgeColorAlpha : edgeColorAlpha;
    nodeColorMaxAlpha = typeof glow.nodeColorMaxAlpha === "number" ? glow.nodeColorMaxAlpha : nodeColorMaxAlpha;
    tagColorMaxAlpha = typeof glow.tagColorMaxAlpha === "number" ? glow.tagColorMaxAlpha : tagColorMaxAlpha;
    edgeColorMaxAlpha = typeof glow.edgeColorMaxAlpha === "number" ? glow.edgeColorMaxAlpha : edgeColorMaxAlpha;
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
  function screenToWorldAtDepth(sx, sy, zCam, width, height, cam) {
    const { yaw, pitch, distance, targetX, targetY, targetZ, zoom } = cam;
    const px = (sx - offsetX) / scale;
    const py = (sy - offsetY) / scale;
    const focal = 800;
    const perspective = zoom * focal / (zCam || 1e-4);
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
    return { x: p.x * scale + offsetX, y: p.y * scale + offsetY };
  }
  function getProjectedNode(node) {
    const p = projectWorld(node);
    return { x: p.x * scale + offsetX, y: p.y * scale + offsetY, depth: p.depth };
  }
  function getScale() {
    return scale;
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
    const cam = getCamera();
    let newDistance = cam.distance / factor;
    newDistance = Math.max(200, Math.min(5e3, newDistance));
    setCamera({ distance: newDistance });
    render();
  }
  function panBy(screenDx, screenDy) {
    offsetX += screenDx;
    offsetY += screenDy;
    render();
  }
  function resetPanToCenter() {
    const w = canvas.width || 1;
    const h = canvas.height || 1;
    offsetX = w / 2;
    offsetY = h / 2;
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
    resetPanToCenter,
    screenToWorld,
    screenToWorldAtDepth,
    getNodeScreenPosition,
    getProjectedNode,
    getScale,
    setCamera,
    getCamera,
    getCameraBasis
  };
}

// graph/simulation.ts
function createSimulation(nodes, edges, options) {
  let repulsionStrength = options?.repulsionStrength ?? 1500;
  let springStrength = options?.springStrength ?? 0.04;
  let springLength = options?.springLength ?? 100;
  let centerPull = options?.centerPull ?? 0;
  let damping = options?.damping ?? 0.9;
  let notePlaneStiffness = options?.notePlaneStiffness ?? 0;
  let tagPlaneStiffness = options?.tagPlaneStiffness ?? 0;
  let mouseAttractionRadius = options?.mouseAttractionRadius ?? 80;
  let mouseAttractionStrength = options?.mouseAttractionStrength ?? 0.15;
  let mouseAttractionExponent = options?.mouseAttractionExponent ?? 3.5;
  let centerX = typeof options?.centerX === "number" ? options.centerX : void 0;
  let centerY = typeof options?.centerY === "number" ? options.centerY : void 0;
  let centerZ = typeof options?.centerZ === "number" ? options.centerZ : 0;
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
        let dz = (a.z || 0) - (b.z || 0);
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq === 0)
          distSq = 1e-4;
        const dist = Math.sqrt(distSq);
        const minDist = 40;
        const effectiveDist = Math.max(dist, minDist);
        const force = repulsionStrength / (effectiveDist * effectiveDist);
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
      const displacement = dist - springLength;
      const f = springStrength * Math.tanh(displacement / 50);
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
    if (centerPull <= 0)
      return;
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;
    const cz = centerZ ?? 0;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      const dx = cx - (n.x || 0);
      const dy = cy - (n.y || 0);
      const dz = cz - (n.z || 0);
      n.vx = (n.vx || 0) + dx * centerPull;
      n.vy = (n.vy || 0) + dy * centerPull;
      n.vz = (n.vz || 0) + dz * centerPull;
    }
    if (centerNode) {
      const dx = (centerX ?? 0) - (centerNode.x || 0);
      const dy = (centerY ?? 0) - (centerNode.y || 0);
      const dz = (centerZ ?? 0) - (centerNode.z || 0);
      centerNode.vx = (centerNode.vx || 0) + dx * centerPull * 0.5;
      centerNode.vy = (centerNode.vy || 0) + dy * centerPull * 0.5;
      centerNode.vz = (centerNode.vz || 0) + dz * centerPull * 0.5;
    }
  }
  function applyDamping() {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      n.vx = (n.vx || 0) * damping;
      n.vy = (n.vy || 0) * damping;
      n.vz = (n.vz || 0) * damping;
      if (Math.abs(n.vx) < 1e-3)
        n.vx = 0;
      if (Math.abs(n.vy) < 1e-3)
        n.vy = 0;
      if (Math.abs(n.vz) < 1e-3)
        n.vz = 0;
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
  function applyPlaneConstraints() {
    const noteK = notePlaneStiffness ?? 0;
    const tagK = tagPlaneStiffness ?? 0;
    if (noteK === 0 && tagK === 0)
      return;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      if (n.type === "note" && noteK > 0) {
        const dz = 0 - (n.z || 0);
        n.vz = (n.vz || 0) + dz * noteK;
      } else if (n.type === "tag" && tagK > 0) {
        const dx = 0 - (n.x || 0);
        n.vx = (n.vx || 0) + dx * tagK;
      }
    }
  }
  function applyCenterNodeLock() {
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;
    const cz = centerZ ?? 0;
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
    applyMouseAttraction();
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
    if (typeof opts.centerZ === "number")
      centerZ = opts.centerZ;
    if (typeof opts.centerNodeId === "string") {
      centerNodeId = opts.centerNodeId;
      centerNode = nodes.find((n) => n.id === centerNodeId) || null;
    }
    if (typeof opts.notePlaneStiffness === "number")
      notePlaneStiffness = opts.notePlaneStiffness;
    if (typeof opts.tagPlaneStiffness === "number")
      tagPlaneStiffness = opts.tagPlaneStiffness;
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
      }, 200, true);
    }
    this.registerEvent(this.app.vault.on("create", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
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
  dragStartDepth = 0;
  dragOffsetWorld = { x: 0, y: 0, z: 0 };
  isPanning = false;
  lastPanX = 0;
  lastPanY = 0;
  // Camera interaction (Phase 4)
  isOrbiting = false;
  lastOrbitX = 0;
  lastOrbitY = 0;
  isMiddlePanning = false;
  panStartX = 0;
  panStartY = 0;
  panStartTargetX = 0;
  panStartTargetY = 0;
  // pending right-click focus state
  pendingFocusNode = null;
  pendingFocusDownX = 0;
  pendingFocusDownY = 0;
  // camera follow / animation state
  cameraAnimStart = null;
  cameraAnimDuration = 300;
  // ms
  cameraAnimFrom = null;
  cameraAnimTo = null;
  isCameraFollowing = false;
  cameraFollowNode = null;
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
  // last node id that we triggered a hover preview for (to avoid retriggering)
  lastPreviewedNodeId = null;
  // When a hover preview has been triggered and is visible, lock highlighting
  // to that node (and neighbors) until the popover disappears.
  previewLockNodeId = null;
  previewPollTimer = null;
  controlsEl = null;
  controlsVisible = false;
  // start minimized by default
  // Screen-space tracking for cursor attractor
  lastMouseX = null;
  lastMouseY = null;
  // When true, skip running the cursor attractor until the next mousemove event
  suppressAttractorUntilMouseMove = false;
  // Simple camera follow flag
  followLockedNodeId = null;
  // Center node and camera defaults
  centerNode = null;
  defaultCameraDistance = 1200;
  lastUsePinnedCenterNote = false;
  lastPinnedCenterNotePath = "";
  viewCenterX = 0;
  viewCenterY = 0;
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
  // Recreate the physics simulation, optionally excluding tag nodes.
  recreateSimulation(showTags, extraOpts) {
    try {
      if (this.simulation) {
        try {
          this.simulation.stop();
        } catch (e) {
        }
      }
      if (!this.graph)
        return;
      const physOpts = Object.assign({}, this.plugin.settings?.physics || {});
      const rect = this.containerEl.getBoundingClientRect();
      const centerX = extraOpts && typeof extraOpts.centerX === "number" ? extraOpts.centerX : rect.width / 2;
      const centerY = extraOpts && typeof extraOpts.centerY === "number" ? extraOpts.centerY : rect.height / 2;
      const centerNodeId = extraOpts?.centerNodeId;
      let simNodes = this.graph.nodes;
      let simEdges = this.graph.edges || [];
      if (!showTags) {
        const tagSet = /* @__PURE__ */ new Set();
        simNodes = this.graph.nodes.filter((n) => {
          if (n.type === "tag") {
            tagSet.add(n.id);
            return false;
          }
          return true;
        });
        simEdges = (this.graph.edges || []).filter((e) => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
      }
      this.simulation = createSimulation(simNodes, simEdges, Object.assign({}, physOpts, { centerX, centerY, centerNodeId }));
      try {
        this.simulation.start();
      } catch (e) {
      }
    } catch (e) {
      console.error("Failed to recreate simulation", e);
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
    this.createControlsPanel();
    const initialGlow = Object.assign({}, this.plugin.settings?.glow || {});
    const initialPhys = this.plugin.settings?.physics || {};
    if (typeof initialPhys.mouseAttractionRadius === "number")
      initialGlow.glowRadiusPx = initialPhys.mouseAttractionRadius;
    this.renderer = createRenderer2D({ canvas, glow: initialGlow });
    try {
      const cam0 = this.renderer.getCamera?.();
      if (cam0 && typeof cam0.distance === "number")
        this.defaultCameraDistance = cam0.distance;
    } catch (e) {
    }
    try {
      const drawDouble = Boolean(this.plugin.settings?.mutualLinkDoubleLine);
      const showTags = this.plugin.settings?.showTags !== false;
      if (this.renderer && this.renderer.setRenderOptions)
        this.renderer.setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
    } catch (e) {
    }
    this.lastUsePinnedCenterNote = Boolean(this.plugin.settings?.usePinnedCenterNote);
    this.lastPinnedCenterNotePath = String(this.plugin.settings?.pinnedCenterNotePath || "");
    this.graph = await buildGraph(this.app, {
      countDuplicates: Boolean(this.plugin.settings?.countDuplicateLinks),
      usePinnedCenterNote: Boolean(this.plugin.settings?.usePinnedCenterNote),
      pinnedCenterNotePath: String(this.plugin.settings?.pinnedCenterNotePath || ""),
      useOutlinkFallback: Boolean(this.plugin.settings?.useOutlinkFallback)
    });
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
      this.centerNode = this.graph.nodes.find((n) => n.isCenterNode) || null;
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
    this.viewCenterX = centerX;
    this.viewCenterY = centerY;
    this.renderer.setGraph(this.graph);
    if (needsLayout.length > 0) {
      layoutGraph3D(this.graph, {
        width: rect.width || 300,
        height: rect.height || 200,
        margin: 32,
        centerX,
        centerY,
        centerOnLargestNode: Boolean(this.plugin.settings?.usePinnedCenterNote),
        onlyNodes: needsLayout
      });
    } else {
    }
    if (this.centerNode) {
      this.centerNode.x = centerX;
      this.centerNode.y = centerY;
      this.centerNode.z = 0;
    }
    this.renderer.resize(rect.width || 300, rect.height || 200);
    const centerNodeId = this.centerNode ? this.centerNode.id : void 0;
    const showTagsInitial = this.plugin.settings?.showTags !== false;
    this.recreateSimulation(showTagsInitial, { centerX, centerY, centerNodeId });
    try {
      const interaction = this.plugin.settings?.interaction || {};
      this.momentumScale = interaction.momentumScale ?? this.momentumScale;
      this.dragThreshold = interaction.dragThreshold ?? this.dragThreshold;
    } catch (e) {
    }
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
      this.lastMouseX = screenX;
      this.lastMouseY = screenY;
      this.suppressAttractorUntilMouseMove = false;
      if (this.draggingNode) {
        const now = performance.now();
        let world = null;
        try {
          const cam = this.renderer.getCamera();
          const width = this.canvas ? this.canvas.width : this.containerEl.getBoundingClientRect().width || 300;
          const height = this.canvas ? this.canvas.height : this.containerEl.getBoundingClientRect().height || 200;
          if (this.renderer.screenToWorldAtDepth) {
            world = this.renderer.screenToWorldAtDepth(screenX, screenY, this.dragStartDepth, width, height, cam);
          } else {
            world = this.renderer.screenToWorld(screenX, screenY);
          }
        } catch (e) {
          world = this.renderer.screenToWorld(screenX, screenY);
        }
        if (!this.hasDragged) {
          const dxs = screenX - this.downScreenX;
          const dys = screenY - this.downScreenY;
          if (Math.sqrt(dxs * dxs + dys * dys) > this.dragThreshold) {
            this.hasDragged = true;
            this.preventClick = true;
          }
        }
        const dt = Math.max((now - this.lastDragTime) / 1e3, 1e-6);
        this.dragVx = (world.x + this.dragOffsetWorld.x - this.lastWorldX) / dt;
        this.dragVy = (world.y + this.dragOffsetWorld.y - this.lastWorldY) / dt;
        this.draggingNode.x = world.x + this.dragOffsetWorld.x;
        this.draggingNode.y = world.y + this.dragOffsetWorld.y;
        this.draggingNode.z = (world.z || 0) + this.dragOffsetWorld.z;
        this.draggingNode.vx = 0;
        this.draggingNode.vy = 0;
        this.draggingNode.vz = 0;
        this.lastWorldX = this.draggingNode.x;
        this.lastWorldY = this.draggingNode.y;
        this.lastDragTime = now;
        this.renderer.render();
        try {
          if (this.simulation && this.simulation.setMouseAttractor)
            this.simulation.setMouseAttractor(null, null, null);
        } catch (e) {
        }
        return;
      }
      try {
        if ((ev.buttons & 2) === 2 && this.pendingFocusNode) {
          const dx = screenX - this.pendingFocusDownX;
          const dy = screenY - this.pendingFocusDownY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const dragThreshold = 8;
          if (dist > dragThreshold) {
            this.isOrbiting = true;
            this.lastOrbitX = this.pendingFocusDownX;
            this.lastOrbitY = this.pendingFocusDownY;
            this.pendingFocusNode = null;
            if (this.isCameraFollowing) {
              this.isCameraFollowing = false;
              this.cameraFollowNode = null;
            }
          }
        }
      } catch (e) {
      }
      if (this.isOrbiting) {
        const dx = screenX - this.lastOrbitX;
        const dy = screenY - this.lastOrbitY;
        this.lastOrbitX = screenX;
        this.lastOrbitY = screenY;
        try {
          const cam = this.renderer.getCamera();
          const yawSpeed = 5e-3;
          const pitchSpeed = 5e-3;
          let newYaw = cam.yaw - dx * yawSpeed;
          let newPitch = cam.pitch - dy * pitchSpeed;
          const maxPitch = Math.PI / 2 - 0.1;
          const minPitch = -maxPitch;
          newPitch = Math.max(minPitch, Math.min(maxPitch, newPitch));
          this.renderer.setCamera({ yaw: newYaw, pitch: newPitch });
          this.renderer.render();
        } catch (e) {
        }
        return;
      }
      if (this.isMiddlePanning) {
        if (this.isCameraFollowing) {
          this.isCameraFollowing = false;
          this.cameraFollowNode = null;
        }
        const dx = screenX - this.panStartX;
        const dy = screenY - this.panStartY;
        try {
          const cam = this.renderer.getCamera();
          const panSpeed = cam.distance * 1e-3 / Math.max(1e-4, cam.zoom);
          const newTargetX = this.panStartTargetX - dx * panSpeed;
          const newTargetY = this.panStartTargetY + dy * panSpeed;
          this.renderer.setCamera({ targetX: newTargetX, targetY: newTargetY });
          this.renderer.render();
        } catch (e) {
        }
        return;
      }
      if (this.isPanning) {
        this.followLockedNodeId = null;
        this.previewLockNodeId = null;
        const dx = screenX - this.lastPanX;
        const dy = screenY - this.lastPanY;
        this.renderer.panBy(dx, dy);
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        return;
      }
      this.updateHoverFromCoords(screenX, screenY, ev);
    };
    this.mouseLeaveHandler = () => {
      this.clearHover();
      this.lastPreviewedNodeId = null;
    };
    this.lastMouseX = null;
    this.lastMouseY = null;
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
      try {
        this.followLockedNodeId = null;
        const cam = this.renderer.getCamera();
        const zoomSpeed = 15e-4;
        const factor = Math.exp(ev.deltaY * zoomSpeed);
        let distance = (cam.distance || 1e3) * factor;
        distance = Math.max(200, Math.min(8e3, distance));
        this.renderer.setCamera({ distance });
        this.renderer.render();
      } catch (e) {
      }
    };
    this.mouseDownHandler = (ev) => {
      if (!this.canvas || !this.renderer)
        return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      if (ev.button === 2) {
        const hitNode = this.hitTestNodeScreen(screenX, screenY);
        if (hitNode) {
          this.pendingFocusNode = hitNode;
          this.pendingFocusDownX = screenX;
          this.pendingFocusDownY = screenY;
          ev.preventDefault();
          return;
        } else {
          this.pendingFocusNode = "__origin__";
          this.pendingFocusDownX = screenX;
          this.pendingFocusDownY = screenY;
          ev.preventDefault();
          return;
        }
      }
      if (ev.button === 1) {
        try {
          const cam = this.renderer.getCamera();
          this.isMiddlePanning = true;
          this.panStartX = screenX;
          this.panStartY = screenY;
          this.panStartTargetX = cam.targetX;
          this.panStartTargetY = cam.targetY;
          ev.preventDefault();
          return;
        } catch (e) {
        }
      }
      if (ev.button !== 0)
        return;
      const world = this.renderer.screenToWorld(screenX, screenY);
      this.hasDragged = false;
      this.preventClick = false;
      this.downScreenX = screenX;
      this.downScreenY = screenY;
      this.lastWorldX = world.x;
      this.lastWorldY = world.y;
      this.lastDragTime = performance.now();
      const hit = this.hitTestNodeScreen(screenX, screenY);
      if (hit) {
        if (hit.type === "tag") {
          this.isPanning = true;
          this.lastPanX = screenX;
          this.lastPanY = screenY;
          this.canvas.style.cursor = "grab";
        } else {
          this.draggingNode = hit;
          try {
            const cam = this.renderer.getCamera();
            const proj = this.renderer.getProjectedNode ? this.renderer.getProjectedNode(hit) : null;
            const depth = proj ? proj.depth : 1e3;
            this.dragStartDepth = depth;
            const width = this.canvas ? this.canvas.width : this.containerEl.getBoundingClientRect().width || 300;
            const height = this.canvas ? this.canvas.height : this.containerEl.getBoundingClientRect().height || 200;
            const screenXClient = proj ? proj.x : screenX;
            const screenYClient = proj ? proj.y : screenY;
            const worldAtCursor = this.renderer.screenToWorldAtDepth ? this.renderer.screenToWorldAtDepth(screenXClient, screenYClient, depth, width, height, cam) : this.renderer.screenToWorld(screenXClient, screenYClient);
            this.dragOffsetWorld = {
              x: (hit.x || 0) - (worldAtCursor.x || 0),
              y: (hit.y || 0) - (worldAtCursor.y || 0),
              z: (hit.z || 0) - (worldAtCursor.z || 0)
            };
            try {
              if (this.simulation && this.simulation.setPinnedNodes)
                this.simulation.setPinnedNodes(/* @__PURE__ */ new Set([hit.id]));
            } catch (e) {
            }
          } catch (e) {
            this.dragOffsetWorld = { x: 0, y: 0, z: 0 };
          }
          this.canvas.style.cursor = "grabbing";
        }
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
      if (ev.button === 2) {
        if (this.pendingFocusNode) {
          const dx = ev.clientX - (this.canvas.getBoundingClientRect().left + this.pendingFocusDownX);
          const dy = ev.clientY - (this.canvas.getBoundingClientRect().top + this.pendingFocusDownY);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clickThreshold = 8;
          if (dist <= clickThreshold) {
            try {
              if (this.pendingFocusNode === "__origin__") {
                try {
                  this.renderer.setCamera({ targetX: this.viewCenterX ?? 0, targetY: this.viewCenterY ?? 0, targetZ: 0, distance: this.defaultCameraDistance });
                } catch (e) {
                }
                try {
                  if (this.renderer.resetPanToCenter)
                    this.renderer.resetPanToCenter();
                } catch (e) {
                }
                this.followLockedNodeId = null;
                this.previewLockNodeId = null;
                try {
                  if (this.renderer.setHoverState)
                    this.renderer.setHoverState(null, /* @__PURE__ */ new Set(), 0, 0);
                  if (this.renderer.setHoveredNode)
                    this.renderer.setHoveredNode(null);
                  this.renderer.render?.();
                } catch (e) {
                }
                this.suppressAttractorUntilMouseMove = true;
              } else {
                const n = this.pendingFocusNode;
                try {
                  this.renderer.setCamera({ targetX: n.x ?? 0, targetY: n.y ?? 0, targetZ: n.z ?? 0 });
                } catch (e) {
                }
                try {
                  if (this.renderer.resetPanToCenter)
                    this.renderer.resetPanToCenter();
                } catch (e) {
                }
                this.followLockedNodeId = n.id;
                this.previewLockNodeId = n.id;
                this.suppressAttractorUntilMouseMove = true;
              }
            } catch (e) {
            }
          }
          this.pendingFocusNode = null;
        }
        this.isOrbiting = false;
      }
      if (ev.button === 1)
        this.isMiddlePanning = false;
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
    this.canvas.addEventListener("contextmenu", (e) => {
      if (this.isOrbiting || this.pendingFocusNode)
        e.preventDefault();
    });
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
            try {
              const drawDouble = Boolean(this.plugin.settings?.mutualLinkDoubleLine);
              const showTags = this.plugin.settings?.showTags !== false;
              if (this.renderer && this.renderer.setRenderOptions)
                this.renderer.setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
            } catch (e) {
            }
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
          try {
            const usePinned = Boolean(this.plugin.settings?.usePinnedCenterNote);
            const pinnedPath = String(this.plugin.settings?.pinnedCenterNotePath || "");
            if (usePinned !== this.lastUsePinnedCenterNote || pinnedPath !== this.lastPinnedCenterNotePath) {
              this.lastUsePinnedCenterNote = usePinned;
              this.lastPinnedCenterNotePath = pinnedPath;
              this.refreshGraph();
            }
          } catch (e) {
          }
        }
      });
    }
  }
  // Create floating controls panel in top-right and a gear toggle in the view
  createControlsPanel() {
    try {
      const panel = document.createElement("div");
      panel.style.position = "absolute";
      panel.style.top = "8px";
      panel.style.right = "8px";
      panel.style.zIndex = "10";
      panel.style.background = "var(--background-secondary)";
      panel.style.color = "var(--text-normal)";
      panel.style.border = "1px solid var(--interactive-border)";
      panel.style.padding = "8px";
      panel.style.borderRadius = "6px";
      panel.style.minWidth = "220px";
      panel.style.fontSize = "12px";
      panel.style.boxShadow = "var(--translucent-shadow)";
      const title = document.createElement("div");
      title.style.display = "flex";
      title.style.justifyContent = "space-between";
      title.style.alignItems = "center";
      title.style.marginBottom = "6px";
      const titleText = document.createElement("div");
      titleText.textContent = "Graph Controls";
      titleText.style.fontWeight = "600";
      titleText.style.fontSize = "12px";
      title.appendChild(titleText);
      const closeBtn = document.createElement("button");
      closeBtn.setAttribute("aria-label", "Toggle graph controls");
      closeBtn.style.background = "transparent";
      closeBtn.style.border = "none";
      closeBtn.style.color = "var(--text-normal)";
      closeBtn.style.cursor = "pointer";
      closeBtn.textContent = "\u2699";
      closeBtn.addEventListener("click", () => this.toggleControlsVisibility());
      title.appendChild(closeBtn);
      panel.appendChild(title);
      const makeRow = (labelText, inputEl, resetCb) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.marginBottom = "6px";
        const label = document.createElement("label");
        label.textContent = labelText;
        label.style.marginRight = "8px";
        label.style.flex = "1";
        const rightWrap = document.createElement("div");
        rightWrap.style.display = "flex";
        rightWrap.style.alignItems = "center";
        rightWrap.style.gap = "6px";
        inputEl.style.flex = "0 0 auto";
        rightWrap.appendChild(inputEl);
        if (resetCb) {
          const rbtn = document.createElement("button");
          rbtn.type = "button";
          rbtn.title = "Reset to default";
          rbtn.textContent = "\u21BA";
          rbtn.style.border = "none";
          rbtn.style.background = "transparent";
          rbtn.style.cursor = "pointer";
          rbtn.addEventListener("click", (e) => {
            e.preventDefault();
            try {
              resetCb();
            } catch (err) {
            }
          });
          rightWrap.appendChild(rbtn);
        }
        row.appendChild(label);
        row.appendChild(rightWrap);
        return row;
      };
      const nodeColor = document.createElement("input");
      nodeColor.type = "color";
      let themeNodeColor = "#66ccff";
      try {
        const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
        const nodeVar = cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
        if (nodeVar && nodeVar.trim())
          themeNodeColor = nodeVar.trim();
      } catch (e) {
      }
      nodeColor.value = this.plugin.settings?.glow?.nodeColor || themeNodeColor;
      const nodeColorWrap = document.createElement("div");
      nodeColorWrap.style.display = "flex";
      nodeColorWrap.style.alignItems = "center";
      nodeColorWrap.style.gap = "6px";
      const nodeAlpha = document.createElement("input");
      nodeAlpha.type = "number";
      nodeAlpha.min = "0";
      nodeAlpha.max = "1";
      nodeAlpha.step = "0.01";
      nodeAlpha.value = String(this.plugin.settings?.glow?.nodeColorAlpha ?? 1);
      nodeAlpha.style.width = "64px";
      const nodeMaxAlpha = document.createElement("input");
      nodeMaxAlpha.type = "number";
      nodeMaxAlpha.min = "0";
      nodeMaxAlpha.max = "1";
      nodeMaxAlpha.step = "0.01";
      nodeMaxAlpha.value = String(this.plugin.settings?.glow?.nodeColorMaxAlpha ?? 1);
      nodeMaxAlpha.style.width = "64px";
      nodeMaxAlpha.style.marginLeft = "6px";
      nodeColor.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          this.plugin.settings.glow.nodeColor = e.target.value;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      nodeAlpha.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.nodeColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      nodeMaxAlpha.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.nodeColorMaxAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      nodeColorWrap.appendChild(nodeColor);
      nodeColorWrap.appendChild(nodeAlpha);
      nodeColorWrap.appendChild(nodeMaxAlpha);
      panel.appendChild(makeRow("Node color", nodeColorWrap, async () => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          delete this.plugin.settings.glow.nodeColor;
          delete this.plugin.settings.glow.nodeColorAlpha;
          delete this.plugin.settings.glow.nodeColorMaxAlpha;
          await this.plugin.saveSettings();
          try {
            const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
            const nodeVar = cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
            nodeColor.value = nodeVar && nodeVar.trim() ? nodeVar.trim() : "#66ccff";
            nodeAlpha.value = String(1);
            nodeMaxAlpha.value = String(1);
          } catch (e) {
            nodeColor.value = "#66ccff";
          }
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e) {
          }
        } catch (e) {
        }
      }));
      const edgeColor = document.createElement("input");
      edgeColor.type = "color";
      let themeEdgeColor = "#888888";
      try {
        const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
        const edgeVar = cs.getPropertyValue("--text-muted") || cs.getPropertyValue("--text-faint") || cs.getPropertyValue("--text-normal");
        if (edgeVar && edgeVar.trim())
          themeEdgeColor = edgeVar.trim();
      } catch (e) {
      }
      edgeColor.value = this.plugin.settings?.glow?.edgeColor || themeEdgeColor;
      const edgeColorWrap = document.createElement("div");
      edgeColorWrap.style.display = "flex";
      edgeColorWrap.style.alignItems = "center";
      edgeColorWrap.style.gap = "6px";
      const edgeAlpha = document.createElement("input");
      edgeAlpha.type = "number";
      edgeAlpha.min = "0";
      edgeAlpha.max = "1";
      edgeAlpha.step = "0.01";
      edgeAlpha.value = String(this.plugin.settings?.glow?.edgeColorAlpha ?? 1);
      edgeAlpha.style.width = "64px";
      const edgeMaxAlpha = document.createElement("input");
      edgeMaxAlpha.type = "number";
      edgeMaxAlpha.min = "0";
      edgeMaxAlpha.max = "1";
      edgeMaxAlpha.step = "0.01";
      edgeMaxAlpha.value = String(this.plugin.settings?.glow?.edgeColorMaxAlpha ?? 1);
      edgeMaxAlpha.style.width = "64px";
      edgeMaxAlpha.style.marginLeft = "6px";
      edgeColor.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          this.plugin.settings.glow.edgeColor = e.target.value;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      edgeAlpha.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.edgeColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      edgeMaxAlpha.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.edgeColorMaxAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      edgeColorWrap.appendChild(edgeColor);
      edgeColorWrap.appendChild(edgeAlpha);
      edgeColorWrap.appendChild(edgeMaxAlpha);
      panel.appendChild(makeRow("Edge color", edgeColorWrap, async () => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          delete this.plugin.settings.glow.edgeColor;
          delete this.plugin.settings.glow.edgeColorAlpha;
          delete this.plugin.settings.glow.edgeColorMaxAlpha;
          await this.plugin.saveSettings();
          try {
            const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
            const edgeVar = cs.getPropertyValue("--text-muted") || cs.getPropertyValue("--text-faint") || cs.getPropertyValue("--text-normal");
            edgeColor.value = edgeVar && edgeVar.trim() ? edgeVar.trim() : "#888888";
            edgeAlpha.value = String(1);
            edgeMaxAlpha.value = String(1);
          } catch (e) {
            edgeColor.value = "#888888";
          }
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e) {
          }
        } catch (e) {
        }
      }));
      const tagColor = document.createElement("input");
      tagColor.type = "color";
      let themeTagColor = "#8000ff";
      try {
        const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
        const nodeVar = cs.getPropertyValue("--accent-2") || cs.getPropertyValue("--accent-secondary") || cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
        if (nodeVar && nodeVar.trim())
          themeTagColor = nodeVar.trim();
      } catch (e) {
      }
      tagColor.value = this.plugin.settings?.glow?.tagColor || themeTagColor;
      const tagWrap = document.createElement("div");
      tagWrap.style.display = "flex";
      tagWrap.style.alignItems = "center";
      tagWrap.style.gap = "6px";
      const tagAlpha = document.createElement("input");
      tagAlpha.type = "number";
      tagAlpha.min = "0";
      tagAlpha.max = "1";
      tagAlpha.step = "0.01";
      tagAlpha.value = String(this.plugin.settings?.glow?.tagColorAlpha ?? 1);
      tagAlpha.style.width = "64px";
      const tagMaxAlpha = document.createElement("input");
      tagMaxAlpha.type = "number";
      tagMaxAlpha.min = "0";
      tagMaxAlpha.max = "1";
      tagMaxAlpha.step = "0.01";
      tagMaxAlpha.value = String(this.plugin.settings?.glow?.tagColorMaxAlpha ?? 1);
      tagMaxAlpha.style.width = "64px";
      tagMaxAlpha.style.marginLeft = "6px";
      tagColor.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          this.plugin.settings.glow.tagColor = e.target.value;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      tagAlpha.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.tagColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      tagMaxAlpha.addEventListener("input", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.tagColorMaxAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      tagWrap.appendChild(tagColor);
      tagWrap.appendChild(tagAlpha);
      tagWrap.appendChild(tagMaxAlpha);
      panel.appendChild(makeRow("Tag color", tagWrap, async () => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          delete this.plugin.settings.glow.tagColor;
          delete this.plugin.settings.glow.tagColorAlpha;
          await this.plugin.saveSettings();
          try {
            const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
            const nodeVar = cs.getPropertyValue("--accent-2") || cs.getPropertyValue("--accent-secondary") || cs.getPropertyValue("--interactive-accent") || cs.getPropertyValue("--accent-1") || cs.getPropertyValue("--accent");
            tagColor.value = nodeVar && nodeVar.trim() ? nodeVar.trim() : "#8000ff";
            tagAlpha.value = String(1);
          } catch (e) {
            tagColor.value = "#8000ff";
          }
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e) {
          }
        } catch (e) {
        }
      }));
      const hoverDepthWrap = document.createElement("div");
      hoverDepthWrap.style.display = "flex";
      hoverDepthWrap.style.alignItems = "center";
      hoverDepthWrap.style.gap = "6px";
      const hoverDepthRange = document.createElement("input");
      hoverDepthRange.type = "range";
      hoverDepthRange.min = "0";
      hoverDepthRange.max = "4";
      hoverDepthRange.step = "1";
      const curHoverDepth = this.plugin.settings?.glow?.hoverHighlightDepth ?? 1;
      hoverDepthRange.value = String(curHoverDepth);
      const hoverDepthInput = document.createElement("input");
      hoverDepthInput.type = "number";
      hoverDepthInput.min = hoverDepthRange.min;
      hoverDepthInput.max = hoverDepthRange.max;
      hoverDepthInput.step = hoverDepthRange.step;
      hoverDepthInput.value = String(hoverDepthRange.value);
      hoverDepthInput.style.width = "56px";
      hoverDepthInput.style.textAlign = "right";
      hoverDepthRange.addEventListener("input", (e) => {
        hoverDepthInput.value = e.target.value;
      });
      hoverDepthRange.addEventListener("change", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.hoverHighlightDepth = Number.isFinite(v) ? Math.max(0, Math.min(4, Math.floor(v))) : 1;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      hoverDepthInput.addEventListener("input", (e) => {
        hoverDepthRange.value = e.target.value;
      });
      hoverDepthInput.addEventListener("change", (e) => {
        hoverDepthRange.dispatchEvent(new Event("change"));
      });
      hoverDepthWrap.appendChild(hoverDepthRange);
      hoverDepthWrap.appendChild(hoverDepthInput);
      panel.appendChild(makeRow("Hover highlight depth", hoverDepthWrap, async () => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          delete this.plugin.settings.glow.hoverHighlightDepth;
          await this.plugin.saveSettings();
          hoverDepthRange.value = String(1);
          hoverDepthInput.value = String(1);
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e) {
          }
        } catch (e) {
        }
      }));
      const minSizeWrap = document.createElement("div");
      minSizeWrap.style.display = "flex";
      minSizeWrap.style.alignItems = "center";
      minSizeWrap.style.gap = "6px";
      const minRange = document.createElement("input");
      minRange.type = "range";
      minRange.min = "1";
      minRange.max = "60";
      minRange.step = "1";
      const curMin = this.plugin.settings?.glow?.minNodeRadius ?? 4;
      minRange.value = String(curMin);
      const minInput = document.createElement("input");
      minInput.type = "number";
      minInput.min = minRange.min;
      minInput.max = minRange.max;
      minInput.step = minRange.step;
      minInput.value = String(minRange.value);
      minInput.style.width = "56px";
      minInput.style.textAlign = "right";
      minRange.addEventListener("input", (e) => {
        minInput.value = e.target.value;
      });
      minRange.addEventListener("change", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.minNodeRadius = v;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      minInput.addEventListener("input", (e) => {
        minRange.value = e.target.value;
      });
      minInput.addEventListener("change", (e) => {
        minRange.dispatchEvent(new Event("change"));
      });
      minSizeWrap.appendChild(minRange);
      minSizeWrap.appendChild(minInput);
      const maxSizeWrap = document.createElement("div");
      maxSizeWrap.style.display = "flex";
      maxSizeWrap.style.alignItems = "center";
      maxSizeWrap.style.gap = "6px";
      const maxRange = document.createElement("input");
      maxRange.type = "range";
      maxRange.min = "4";
      maxRange.max = "120";
      maxRange.step = "1";
      const curMax = this.plugin.settings?.glow?.maxNodeRadius ?? 14;
      maxRange.value = String(curMax);
      const maxInput = document.createElement("input");
      maxInput.type = "number";
      maxInput.min = maxRange.min;
      maxInput.max = maxRange.max;
      maxInput.step = maxRange.step;
      maxInput.value = String(maxRange.value);
      maxInput.style.width = "56px";
      maxInput.style.textAlign = "right";
      maxRange.addEventListener("input", (e) => {
        maxInput.value = e.target.value;
      });
      maxRange.addEventListener("change", async (e) => {
        try {
          this.plugin.settings.glow = this.plugin.settings.glow || {};
          const v = Number(e.target.value);
          this.plugin.settings.glow.maxNodeRadius = v;
          await this.plugin.saveSettings();
          try {
            if (this.renderer && this.renderer.setGlowSettings)
              this.renderer.setGlowSettings(this.plugin.settings.glow);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      maxInput.addEventListener("input", (e) => {
        maxRange.value = e.target.value;
      });
      maxInput.addEventListener("change", (e) => {
        maxRange.dispatchEvent(new Event("change"));
      });
      maxSizeWrap.appendChild(maxRange);
      maxSizeWrap.appendChild(maxInput);
      panel.appendChild(makeRow("Node min radius", minSizeWrap, async () => {
        try {
          delete this.plugin.settings.glow.minNodeRadius;
          await this.plugin.saveSettings();
          minRange.value = String(4);
          try {
            if (minSizeWrap && minSizeWrap.querySelector("input[type=number]")) {
              minSizeWrap.querySelector("input[type=number]").value = String(4);
            }
          } catch (e) {
          }
          if (this.renderer && this.renderer.setGlowSettings)
            this.renderer.setGlowSettings(this.plugin.settings.glow);
          if (this.renderer && this.renderer.render)
            this.renderer.render();
        } catch (e) {
        }
      }));
      panel.appendChild(makeRow("Node max radius", maxSizeWrap, async () => {
        try {
          delete this.plugin.settings.glow.maxNodeRadius;
          await this.plugin.saveSettings();
          maxRange.value = String(14);
          try {
            if (maxSizeWrap && maxSizeWrap.querySelector("input[type=number]")) {
              maxSizeWrap.querySelector("input[type=number]").value = String(14);
            }
          } catch (e) {
          }
          if (this.renderer && this.renderer.setGlowSettings)
            this.renderer.setGlowSettings(this.plugin.settings.glow);
          if (this.renderer && this.renderer.render)
            this.renderer.render();
        } catch (e) {
        }
      }));
      const countDup = document.createElement("input");
      countDup.type = "checkbox";
      countDup.checked = Boolean(this.plugin.settings?.countDuplicateLinks);
      countDup.addEventListener("change", async (e) => {
        try {
          this.plugin.settings.countDuplicateLinks = e.target.checked;
          await this.plugin.saveSettings();
          try {
            this.graph = await buildGraph(this.app, { countDuplicates: Boolean(this.plugin.settings?.countDuplicateLinks), usePinnedCenterNote: Boolean(this.plugin.settings?.usePinnedCenterNote), pinnedCenterNotePath: String(this.plugin.settings?.pinnedCenterNotePath || ""), useOutlinkFallback: Boolean(this.plugin.settings?.useOutlinkFallback) });
            if (this.renderer)
              this.renderer.setGraph(this.graph);
          } catch (e2) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      panel.appendChild(makeRow("Count duplicate links", countDup, async () => {
        try {
          this.plugin.settings.countDuplicateLinks = void 0;
          await this.plugin.saveSettings();
          try {
            this.graph = await buildGraph(this.app, { countDuplicates: Boolean(this.plugin.settings?.countDuplicateLinks), usePinnedCenterNote: Boolean(this.plugin.settings?.usePinnedCenterNote), pinnedCenterNotePath: String(this.plugin.settings?.pinnedCenterNotePath || ""), useOutlinkFallback: Boolean(this.plugin.settings?.useOutlinkFallback) });
            if (this.renderer)
              this.renderer.setGraph(this.graph);
          } catch (e) {
          }
          try {
            if (this.renderer && this.renderer.render)
              this.renderer.render();
          } catch (e) {
          }
        } catch (e) {
        }
      }));
      const showTagsChk = document.createElement("input");
      showTagsChk.type = "checkbox";
      showTagsChk.checked = this.plugin.settings?.showTags !== false;
      showTagsChk.addEventListener("change", async (e) => {
        try {
          this.plugin.settings.showTags = e.target.checked;
          await this.plugin.saveSettings();
          const drawDouble = Boolean(this.plugin.settings?.mutualLinkDoubleLine);
          const showTags = this.plugin.settings?.showTags !== false;
          if (this.renderer && this.renderer.setRenderOptions)
            this.renderer.setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
          if (this.renderer && this.renderer.render)
            this.renderer.render();
          try {
            this.recreateSimulation(showTags);
          } catch (e2) {
          }
        } catch (e2) {
        }
      });
      panel.appendChild(makeRow("Show tag nodes", showTagsChk, async () => {
        try {
          this.plugin.settings.showTags = true;
          await this.plugin.saveSettings();
          const drawDouble = Boolean(this.plugin.settings?.mutualLinkDoubleLine);
          const showTags = this.plugin.settings?.showTags !== false;
          if (this.renderer && this.renderer.setRenderOptions)
            this.renderer.setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
          if (this.renderer && this.renderer.render)
            this.renderer.render();
          try {
            this.recreateSimulation(showTags);
          } catch (e) {
          }
        } catch (e) {
        }
      }));
      const phys = this.plugin.settings?.physics || {};
      const physFields = [
        { key: "repulsionStrength", label: "Repulsion", step: "1" },
        { key: "springStrength", label: "Spring", step: "0.01" },
        { key: "springLength", label: "Spring len", step: "1" },
        { key: "centerPull", label: "Center pull", step: "0.0001" },
        { key: "damping", label: "Damping", step: "0.01" },
        { key: "mouseAttractionRadius", label: "Attract radius", step: "1" },
        { key: "mouseAttractionStrength", label: "Attract strength", step: "0.01" },
        { key: "mouseAttractionExponent", label: "Attract exponent", step: "0.1" }
      ];
      for (const f of physFields) {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "6px";
        const range = document.createElement("input");
        range.type = "range";
        switch (f.key) {
          case "repulsionStrength":
            range.min = "0";
            range.max = "10000";
            range.step = "1";
            break;
          case "springStrength":
            range.min = "0";
            range.max = "1.0";
            range.step = "0.001";
            break;
          case "springLength":
            range.min = "10";
            range.max = "500";
            range.step = "1";
            break;
          case "centerPull":
            range.min = "0";
            range.max = "0.01";
            range.step = "0.0001";
            break;
          case "damping":
            range.min = "0";
            range.max = "1";
            range.step = "0.01";
            break;
          case "mouseAttractionRadius":
            range.min = "0";
            range.max = "400";
            range.step = "1";
            break;
          case "mouseAttractionStrength":
            range.min = "0";
            range.max = "1";
            range.step = "0.01";
            break;
          case "mouseAttractionExponent":
            range.min = "0.1";
            range.max = "10";
            range.step = "0.1";
            break;
          default:
            range.min = "0";
            range.max = "100";
            range.step = "1";
        }
        const current = phys[f.key];
        if (f.key === "springStrength") {
          const ui = Number.isFinite(current) ? Math.min(1, Math.max(0, Number(current) / 0.5)) : Number(range.min);
          range.value = String(ui);
        } else {
          range.value = String(Number.isFinite(current) ? current : Number(range.min));
        }
        range.style.width = "120px";
        const valueInput = document.createElement("input");
        valueInput.type = "number";
        valueInput.min = range.min;
        valueInput.max = range.max;
        valueInput.step = range.step;
        valueInput.value = String(range.value);
        valueInput.style.width = "64px";
        valueInput.style.textAlign = "right";
        range.addEventListener("input", (e) => {
          valueInput.value = e.target.value;
        });
        range.addEventListener("change", async (e) => {
          try {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            const val = Number(e.target.value);
            if (f.key === "springStrength") {
              this.plugin.settings.physics[f.key] = Number.isFinite(val) ? val * 0.5 : this.plugin.settings.physics[f.key];
            } else {
              this.plugin.settings.physics[f.key] = Number.isFinite(val) ? val : this.plugin.settings.physics[f.key];
            }
            await this.plugin.saveSettings();
            try {
              if (this.simulation && this.simulation.setOptions)
                this.simulation.setOptions(this.plugin.settings.physics);
            } catch (e2) {
            }
            try {
              if (this.renderer && this.renderer.setGlowSettings)
                this.renderer.setGlowSettings(this.plugin.settings.glow);
            } catch (e2) {
            }
            try {
              if (this.renderer && this.renderer.render)
                this.renderer.render();
            } catch (e2) {
            }
          } catch (e2) {
          }
        });
        valueInput.addEventListener("input", (e) => {
          range.value = e.target.value;
        });
        valueInput.addEventListener("change", (e) => {
          range.dispatchEvent(new Event("change"));
        });
        wrap.appendChild(range);
        wrap.appendChild(valueInput);
        panel.appendChild(makeRow(f.label, wrap, async () => {
          try {
            this.plugin.settings.physics = this.plugin.settings.physics || {};
            delete this.plugin.settings.physics[f.key];
            await this.plugin.saveSettings();
            const def = this.plugin.settings.physics[f.key];
            if (f.key === "springStrength") {
              const ui = def !== void 0 ? String(Math.min(1, Math.max(0, Number(def) / 0.5))) : String(range.min);
              range.value = ui;
            } else {
              range.value = def !== void 0 ? String(def) : String(range.min);
            }
            valueInput.value = range.value;
            try {
              if (this.simulation && this.simulation.setOptions)
                this.simulation.setOptions(this.plugin.settings.physics);
            } catch (e) {
            }
            try {
              if (this.renderer && this.renderer.render)
                this.renderer.render();
            } catch (e) {
            }
          } catch (e) {
          }
        }));
      }
      this.containerEl.style.position = "relative";
      this.containerEl.appendChild(panel);
      this.controlsEl = panel;
      if (!this.controlsVisible) {
        for (let i = 1; i < panel.children.length; i++) {
          const ch = panel.children[i];
          ch.dataset["__savedDisplay"] = ch.style.display || "";
          ch.style.display = "none";
        }
        panel.style.overflow = "hidden";
        panel.style.maxHeight = "36px";
      }
      try {
        const headerActions = this.containerEl.closest(".workspace-leaf")?.querySelector(".view-header .view-actions");
        if (headerActions) {
          const hbtn = document.createElement("button");
          hbtn.className = "mod-quiet";
          hbtn.style.marginLeft = "6px";
          hbtn.textContent = "\u2699";
          hbtn.setAttribute("aria-label", "Toggle graph controls");
          hbtn.addEventListener("click", () => this.toggleControlsVisibility());
          headerActions.appendChild(hbtn);
        }
      } catch (e) {
      }
    } catch (e) {
    }
  }
  toggleControlsVisibility() {
    try {
      this.controlsVisible = !this.controlsVisible;
      if (!this.controlsEl)
        return;
      const panel = this.controlsEl;
      if (!this.controlsVisible) {
        for (let i = 1; i < panel.children.length; i++) {
          const ch = panel.children[i];
          ch.dataset["__savedDisplay"] = ch.style.display || "";
          ch.style.display = "none";
        }
        panel.style.overflow = "hidden";
        panel.style.maxHeight = "36px";
      } else {
        for (let i = 1; i < panel.children.length; i++) {
          const ch = panel.children[i];
          const prev = ch.dataset["__savedDisplay"] || "";
          ch.style.display = prev || "";
          delete ch.dataset["__savedDisplay"];
        }
        panel.style.overflow = "";
        panel.style.maxHeight = "";
      }
    } catch (e) {
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
    try {
      this.applyCursorAttractor();
    } catch (e) {
    }
    try {
      if (this.followLockedNodeId && this.graph && this.renderer) {
        const n = this.graph.nodes.find((x) => x.id === this.followLockedNodeId);
        if (n) {
          const cam = this.renderer.getCamera();
          const alpha = 0.12;
          const tx = cam.targetX + ((n.x ?? 0) - (cam.targetX ?? 0)) * alpha;
          const ty = cam.targetY + ((n.y ?? 0) - (cam.targetY ?? 0)) * alpha;
          const tz = cam.targetZ + ((n.z ?? 0) - (cam.targetZ ?? 0)) * alpha;
          this.renderer.setCamera({ targetX: tx, targetY: ty, targetZ: tz });
        }
      }
    } catch (e) {
    }
    if (this.simulation)
      this.simulation.tick(dt);
    try {
      if (this.lastMouseX != null && this.lastMouseY != null) {
        this.updateHoverFromCoords(this.lastMouseX, this.lastMouseY);
      }
    } catch (e) {
    }
    try {
      this.updateCameraAnimation(timestamp);
    } catch (e) {
    }
    if (this.renderer)
      this.renderer.render();
    try {
      if (this.saveNodePositionsDebounced)
        this.saveNodePositionsDebounced();
    } catch (e) {
    }
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };
  // Camera-plane cursor attractor: screen-aligned, O(N) per-frame
  applyCursorAttractor() {
    const physics = this.plugin.settings?.physics || {};
    if (physics.mouseAttractionEnabled === false)
      return;
    if (this.suppressAttractorUntilMouseMove)
      return;
    if (this.lastMouseX == null || this.lastMouseY == null)
      return;
    if (!this.renderer || !this.graph)
      return;
    const radius = physics.mouseAttractionRadius;
    const baseStrength = physics.mouseAttractionStrength;
    const exponent = physics.mouseAttractionExponent ?? 3;
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(baseStrength) || baseStrength === 0)
      return;
    const cam = this.renderer.getCamera();
    const basis = this.renderer.getCameraBasis ? this.renderer.getCameraBasis(cam) : null;
    if (!basis)
      return;
    const { right, up } = basis;
    const width = (this.canvas ? this.canvas.width : this.containerEl.getBoundingClientRect().width) || 1;
    const height = (this.canvas ? this.canvas.height : this.containerEl.getBoundingClientRect().height) || 1;
    for (const node of this.graph.nodes) {
      const proj = this.renderer.getProjectedNode ? this.renderer.getProjectedNode(node) : null;
      if (!proj)
        continue;
      const dxScreen = this.lastMouseX - proj.x;
      const dyScreen = this.lastMouseY - proj.y;
      const distScreen = Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen);
      if (distScreen > radius || distScreen === 0)
        continue;
      const deadzone = Math.max(1, radius * 0.06);
      if (distScreen < deadzone) {
        node.vx = (node.vx || 0) * 0.6;
        node.vy = (node.vy || 0) * 0.6;
        node.vz = (node.vz || 0) * 0.6;
        continue;
      }
      const nx = dxScreen / distScreen;
      const ny = dyScreen / distScreen;
      let wx = right.x * nx + up.x * ny;
      let wy = right.y * nx + up.y * ny;
      let wz = right.z * nx + up.z * ny;
      const len = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
      wx /= len;
      wy /= len;
      wz /= len;
      const t = 1 - distScreen / radius;
      const strength = baseStrength * Math.pow(t, exponent);
      node.vx = (node.vx || 0) + wx * strength;
      node.vy = (node.vy || 0) + wy * strength;
      node.vz = (node.vz || 0) + wz * strength;
    }
  }
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
  focusCameraOnNode(node) {
    if (!this.renderer || !node)
      return;
    try {
      const cam = this.renderer.getCamera();
      const from = {
        targetX: cam.targetX ?? 0,
        targetY: cam.targetY ?? 0,
        targetZ: cam.targetZ ?? 0,
        distance: cam.distance ?? 1e3,
        yaw: cam.yaw ?? 0,
        pitch: cam.pitch ?? 0
      };
      const toDistance = Math.max(200, Math.min(3e3, (from.distance || 1e3) * 0.6));
      const to = {
        targetX: node.x ?? 0,
        targetY: node.y ?? 0,
        targetZ: node.z ?? 0,
        distance: toDistance,
        yaw: from.yaw,
        pitch: from.pitch
      };
      this.cameraAnimStart = performance.now();
      this.cameraAnimDuration = 300;
      this.cameraAnimFrom = from;
      this.cameraAnimTo = to;
      this.isCameraFollowing = true;
      this.cameraFollowNode = node;
    } catch (e) {
    }
  }
  updateCameraAnimation(now) {
    if (!this.renderer)
      return;
    if (this.cameraAnimStart == null) {
      if (this.isCameraFollowing && this.cameraFollowNode) {
        const n = this.cameraFollowNode;
        try {
          const cam = this.renderer.getCamera();
          const followAlpha = 0.12;
          const curX = cam.targetX ?? 0;
          const curY = cam.targetY ?? 0;
          const curZ = cam.targetZ ?? 0;
          const newX = curX + ((n.x ?? 0) - curX) * followAlpha;
          const newY = curY + ((n.y ?? 0) - curY) * followAlpha;
          const newZ = curZ + ((n.z ?? 0) - curZ) * followAlpha;
          this.renderer.setCamera({ targetX: newX, targetY: newY, targetZ: newZ });
        } catch (e) {
        }
      }
      return;
    }
    const t = Math.min(1, (now - this.cameraAnimStart) / this.cameraAnimDuration);
    const ease = 1 - (1 - t) * (1 - t);
    const from = this.cameraAnimFrom || {};
    const to = this.cameraAnimTo || {};
    const lerp = (a, b) => a + (b - a) * ease;
    const cameraState = {};
    if (typeof from.targetX === "number" && typeof to.targetX === "number")
      cameraState.targetX = lerp(from.targetX, to.targetX);
    if (typeof from.targetY === "number" && typeof to.targetY === "number")
      cameraState.targetY = lerp(from.targetY, to.targetY);
    if (typeof from.targetZ === "number" && typeof to.targetZ === "number")
      cameraState.targetZ = lerp(from.targetZ, to.targetZ);
    if (typeof from.distance === "number" && typeof to.distance === "number")
      cameraState.distance = lerp(from.distance, to.distance);
    if (typeof from.yaw === "number" && typeof to.yaw === "number")
      cameraState.yaw = lerp(from.yaw, to.yaw);
    if (typeof from.pitch === "number" && typeof to.pitch === "number")
      cameraState.pitch = lerp(from.pitch, to.pitch);
    try {
      this.renderer.setCamera(cameraState);
    } catch (e) {
    }
    if (t >= 1) {
      this.cameraAnimStart = null;
      this.cameraAnimFrom = null;
      this.cameraAnimTo = null;
    }
  }
  // Rebuilds the graph and restarts the simulation. Safe to call repeatedly.
  async refreshGraph() {
    if (!this.canvas)
      return;
    try {
      const newGraph = await buildGraph(this.app, {
        countDuplicates: Boolean(this.plugin.settings?.countDuplicateLinks),
        usePinnedCenterNote: Boolean(this.plugin.settings?.usePinnedCenterNote),
        pinnedCenterNotePath: String(this.plugin.settings?.pinnedCenterNotePath || ""),
        useOutlinkFallback: Boolean(this.plugin.settings?.useOutlinkFallback)
      });
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
        this.centerNode = this.graph.nodes.find((n) => n.isCenterNode) || null;
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
      this.viewCenterX = centerX;
      this.viewCenterY = centerY;
      if (this.renderer && this.graph) {
        this.renderer.setGraph(this.graph);
        if (needsLayout.length > 0) {
          layoutGraph3D(this.graph, {
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
        if (this.centerNode) {
          this.centerNode.x = centerX;
          this.centerNode.y = centerY;
          this.centerNode.z = 0;
        }
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
    try {
      if (this.previewPollTimer)
        window.clearInterval(this.previewPollTimer);
    } catch (e) {
    }
    this.previewPollTimer = null;
    this.previewLockNodeId = null;
    this.lastPreviewedNodeId = null;
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
  hitTestNodeScreen(screenX, screenY) {
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
  isPreviewModifier(event) {
    try {
      if (import_obsidian.Platform && import_obsidian.Platform.isMacOS)
        return Boolean(event.metaKey);
    } catch (e) {
    }
    return Boolean(event.ctrlKey);
  }
  // Start a small poll to detect when Obsidian's hover popover is removed from DOM.
  // While the popover exists we keep the preview lock active; when it's gone we clear it.
  startPreviewLockMonitor() {
    try {
      if (this.previewPollTimer)
        window.clearInterval(this.previewPollTimer);
    } catch (e) {
    }
    this.previewPollTimer = window.setInterval(() => {
      try {
        const sel = ".popover.hover-popover, .hover-popover, .internal-link-popover, .internal-link-hover";
        const found = document.querySelector(sel);
        if (!found) {
          this.clearPreviewLock();
        }
      } catch (e) {
      }
    }, 250);
  }
  clearPreviewLock() {
    try {
      if (this.previewPollTimer)
        window.clearInterval(this.previewPollTimer);
    } catch (e) {
    }
    this.previewPollTimer = null;
    this.previewLockNodeId = null;
    this.lastPreviewedNodeId = null;
    try {
      if (this.renderer && this.renderer.setHoverState)
        this.renderer.setHoverState(null, /* @__PURE__ */ new Set(), 0, 0);
      if (this.renderer && this.renderer.setHoveredNode)
        this.renderer.setHoveredNode(null);
      if (this.renderer && this.renderer.render)
        this.renderer.render();
    } catch (e) {
    }
  }
  handleClick(screenX, screenY) {
    if (!this.graph || !this.onNodeClick || !this.renderer)
      return;
    const node = this.hitTestNodeScreen(screenX, screenY);
    if (!node)
      return;
    try {
      this.onNodeClick(node);
    } catch (e) {
      console.error("Graph2DController.onNodeClick handler error", e);
    }
  }
  // Reusable hover updater: computes hover from screen coords and respects
  // existing preview/drag/pan locks. Accepts an optional MouseEvent so the
  // preview modifier detection can still run when available.
  updateHoverFromCoords(screenX, screenY, ev) {
    if (!this.graph || !this.renderer)
      return;
    if (this.draggingNode || this.isPanning)
      return;
    if (this.previewLockNodeId)
      return;
    try {
      this.handleHover(screenX, screenY, ev);
    } catch (e) {
    }
  }
  handleHover(screenX, screenY, ev) {
    if (!this.graph || !this.renderer)
      return;
    if (this.draggingNode || this.isPanning) {
      return;
    }
    const world = this.renderer.screenToWorld(screenX, screenY);
    let closest = null;
    if (this.previewLockNodeId && this.graph && this.graph.nodes) {
      closest = this.graph.nodes.find((n) => n.id === this.previewLockNodeId) || null;
    } else {
      let closestDist = Infinity;
      const hitPadding = 6;
      for (const node of this.graph.nodes) {
        const screenPos = this.renderer.getNodeScreenPosition ? this.renderer.getNodeScreenPosition(node) : null;
        if (!screenPos)
          continue;
        const radiusWorld = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
        const scale = this.renderer.getScale ? this.renderer.getScale() : 1;
        const r = radiusWorld * Math.max(1e-4, scale) + hitPadding;
        const dxs = screenPos.x - screenX;
        const dys = screenPos.y - screenY;
        const d = Math.sqrt(dxs * dxs + dys * dys);
        if (d < r && d < closestDist) {
          closest = node;
          closestDist = d;
        }
      }
    }
    const newId = closest ? closest.id : null;
    const depth = this.plugin.settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = /* @__PURE__ */ new Set();
    if (newId)
      highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q = [newId];
      const seen = /* @__PURE__ */ new Set([newId]);
      let curDepth = 0;
      while (q.length > 0 && curDepth < depth) {
        const levelSize = q.length;
        for (let i = 0; i < levelSize; i++) {
          const nid = q.shift();
          const neigh = this.adjacency?.get(nid) || [];
          for (const nb of neigh) {
            if (!seen.has(nb)) {
              seen.add(nb);
              highlightSet.add(nb);
              q.push(nb);
            }
          }
        }
        curDepth++;
      }
    }
    let hoverWorldX = world.x;
    let hoverWorldY = world.y;
    if (this.previewLockNodeId) {
      const lockedNode = this.graph.nodes.find((n) => n.id === this.previewLockNodeId);
      if (lockedNode) {
        hoverWorldX = lockedNode.x;
        hoverWorldY = lockedNode.y;
      }
    }
    if (this.canvas)
      this.canvas.style.cursor = newId ? "pointer" : "default";
    if (this.renderer.setHoverState)
      this.renderer.setHoverState(newId, highlightSet, hoverWorldX, hoverWorldY);
    if (this.renderer.setHoveredNode)
      this.renderer.setHoveredNode(newId);
    this.renderer.render();
    try {
      if (this.simulation && this.simulation.setMouseAttractor)
        this.simulation.setMouseAttractor(hoverWorldX, hoverWorldY, newId);
    } catch (e) {
    }
    try {
      if (ev) {
        const previewModifier = this.isPreviewModifier(ev);
        const currentId = closest ? closest.id : null;
        if (previewModifier && closest && currentId !== this.lastPreviewedNodeId && !this.previewLockNodeId) {
          this.lastPreviewedNodeId = currentId;
          try {
            this.app.workspace.trigger("hover-link", {
              event: ev,
              source: "greater-graph",
              hoverParent: this.containerEl,
              targetEl: this.canvas,
              linktext: closest.filePath || closest.label,
              sourcePath: closest.filePath
            });
          } catch (e) {
          }
          this.previewLockNodeId = currentId;
          this.startPreviewLockMonitor();
        }
        if (!previewModifier || !closest) {
          if (!this.previewLockNodeId)
            this.lastPreviewedNodeId = null;
        }
      }
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
    minNodeRadius: 6,
    maxNodeRadius: 24,
    minCenterAlpha: 0.15,
    maxCenterAlpha: 0.6,
    hoverBoostFactor: 2,
    neighborBoostFactor: 1.5,
    dimFactor: 0.2,
    hoverHighlightDepth: 2,
    distanceInnerRadiusMultiplier: 1.5,
    distanceOuterRadiusMultiplier: 4,
    distanceCurveSteepness: 2,
    // focus/dimming defaults
    focusSmoothingRate: 0.15,
    edgeDimMin: 0.1,
    edgeDimMax: 0.7,
    nodeMinBodyAlpha: 0.3,
    // color overrides left undefined by default to follow theme
    nodeColor: void 0,
    nodeColorAlpha: 1,
    nodeColorMaxAlpha: 1,
    tagColor: void 0,
    tagColorAlpha: 1,
    tagColorMaxAlpha: 1,
    labelColor: void 0,
    labelColorAlpha: 1,
    useInterfaceFont: true,
    edgeColor: void 0,
    edgeColorAlpha: 1,
    edgeColorMaxAlpha: 0.5
  },
  physics: {
    // INTERNAL defaults (mapped from UI defaults)
    // Repulsion mapping: internal = ui^2 * 2000 (UI default 0.2 -> 80)
    repulsionStrength: 80,
    // Spring strength: internal = ui * 0.5 (UI default 0.4 -> 0.2)
    springStrength: 0.2,
    springLength: 100,
    // Center pull: internal = ui * 0.01 (UI default 0.1 -> 0.001)
    centerPull: 1e-3,
    // Damping internal (0..1)
    damping: 0.9,
    notePlaneStiffness: 4e-3,
    tagPlaneStiffness: 8e-3,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    mouseAttractionRadius: 160,
    // mouse attraction strength: internal = ui * 0.1 (UI default 0.2 -> 0.02)
    mouseAttractionStrength: 0.02,
    mouseAttractionExponent: 3
  },
  interaction: {
    momentumScale: 0.12,
    dragThreshold: 4
  },
  nodePositions: {},
  mutualLinkDoubleLine: true,
  showTags: true,
  usePinnedCenterNote: false,
  pinnedCenterNotePath: "",
  useOutlinkFallback: false
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
    try {
      const g = this.settings.glow;
      if (typeof g.maxNodeRadius === "number" && typeof g.minNodeRadius === "number") {
        if (g.maxNodeRadius < g.minNodeRadius + 2)
          g.maxNodeRadius = g.minNodeRadius + 2;
      }
    } catch (e) {
    }
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
      range.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        await opts.onChange(v);
      });
      num.addEventListener("input", (e) => {
        range.value = e.target.value;
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
      value: glow.minNodeRadius ?? DEFAULT_SETTINGS.glow.minNodeRadius,
      min: 2,
      max: 20,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.minNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.minNodeRadius = Math.round(v);
          if (typeof glow.maxNodeRadius === "number" && glow.maxNodeRadius < glow.minNodeRadius + 2) {
            glow.maxNodeRadius = glow.minNodeRadius + 2;
          }
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.minNodeRadius = DEFAULT_SETTINGS.glow.minNodeRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Maximum node radius",
      desc: "Maximum radius for the most connected node (in pixels).",
      value: glow.maxNodeRadius ?? DEFAULT_SETTINGS.glow.maxNodeRadius,
      min: 8,
      max: 80,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.maxNodeRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v)) {
          glow.maxNodeRadius = Math.round(v);
          if (typeof glow.minNodeRadius === "number" && glow.maxNodeRadius < glow.minNodeRadius + 2)
            glow.maxNodeRadius = glow.minNodeRadius + 2;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.maxNodeRadius = DEFAULT_SETTINGS.glow.maxNodeRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    new import_obsidian2.Setting(containerEl).setName("");
    addSliderSetting(containerEl, {
      name: "Minimum center glow opacity",
      desc: "Opacity (0\u20130.8) at the glow center for the least connected node.",
      value: glow.minCenterAlpha ?? DEFAULT_SETTINGS.glow.minCenterAlpha,
      min: 0,
      max: 0.8,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.minCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 0.8) {
          glow.minCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.minCenterAlpha = DEFAULT_SETTINGS.glow.minCenterAlpha;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Maximum center glow opacity",
      desc: "Opacity (0\u20131) at the glow center for the most connected node.",
      value: glow.maxCenterAlpha ?? DEFAULT_SETTINGS.glow.maxCenterAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.maxCenterAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.maxCenterAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.maxCenterAlpha = DEFAULT_SETTINGS.glow.maxCenterAlpha;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Hover glow boost",
      desc: "Multiplier applied to the center glow when a node is hovered.",
      value: glow.hoverBoostFactor ?? DEFAULT_SETTINGS.glow.hoverBoostFactor,
      min: 1,
      max: 4,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.hoverBoostFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 4) {
          glow.hoverBoostFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.hoverBoostFactor = DEFAULT_SETTINGS.glow.hoverBoostFactor;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Neighbor glow boost",
      desc: "Multiplier applied to nodes within the highlight depth (excluding hovered node).",
      value: glow.neighborBoostFactor ?? DEFAULT_SETTINGS.glow.neighborBoostFactor,
      min: 1,
      max: 3,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.neighborBoostFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 3) {
          glow.neighborBoostFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.neighborBoostFactor = DEFAULT_SETTINGS.glow.neighborBoostFactor;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Dim factor for distant nodes",
      desc: "Multiplier (0\u20131) applied to nodes outside the highlight depth.",
      value: glow.dimFactor ?? DEFAULT_SETTINGS.glow.dimFactor,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.dimFactor,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.dimFactor = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.dimFactor = DEFAULT_SETTINGS.glow.dimFactor;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Highlight depth",
      desc: "Graph distance (in hops) from the hovered node that will be highlighted.",
      value: glow.hoverHighlightDepth ?? 1,
      min: 0,
      max: 5,
      step: 1,
      resetValue: DEFAULT_SETTINGS.glow.hoverHighlightDepth,
      onChange: async (v) => {
        if (!Number.isNaN(v) && Number.isInteger(v) && v >= 0) {
          glow.hoverHighlightDepth = Math.max(0, Math.floor(v));
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.hoverHighlightDepth = DEFAULT_SETTINGS.glow.hoverHighlightDepth;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Inner distance multiplier",
      desc: "Distance (in node radii) where distance-based glow is fully active.",
      value: glow.distanceInnerRadiusMultiplier ?? 1,
      min: 0.5,
      max: 4,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.distanceInnerRadiusMultiplier,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.distanceInnerRadiusMultiplier = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.distanceInnerRadiusMultiplier = DEFAULT_SETTINGS.glow.distanceInnerRadiusMultiplier;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Outer distance multiplier",
      desc: "Distance (in node radii) beyond which the mouse has no effect on glow.",
      value: glow.distanceOuterRadiusMultiplier ?? 2.5,
      min: 1,
      max: 8,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.distanceOuterRadiusMultiplier,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > (glow.distanceInnerRadiusMultiplier ?? 0)) {
          glow.distanceOuterRadiusMultiplier = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.distanceOuterRadiusMultiplier = DEFAULT_SETTINGS.glow.distanceOuterRadiusMultiplier;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Distance curve steepness",
      desc: "Controls how quickly glow ramps up as the cursor approaches a node. Higher values = steeper S-curve.",
      value: glow.distanceCurveSteepness ?? 2,
      min: 0.5,
      max: 5,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.distanceCurveSteepness,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v > 0) {
          glow.distanceCurveSteepness = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.distanceCurveSteepness = DEFAULT_SETTINGS.glow.distanceCurveSteepness;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Focus smoothing rate",
      desc: "Smoothness of focus transitions (0 = very slow, 1 = fast). Internally used as a lerp factor.",
      value: glow.focusSmoothingRate ?? DEFAULT_SETTINGS.glow.focusSmoothingRate,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.focusSmoothingRate,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.focusSmoothingRate = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.focusSmoothingRate = DEFAULT_SETTINGS.glow.focusSmoothingRate;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Edge dim minimum alpha",
      desc: "Minimum alpha used for dimmed edges (0-0.8).",
      value: glow.edgeDimMin ?? DEFAULT_SETTINGS.glow.edgeDimMin,
      min: 0,
      max: 0.8,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.edgeDimMin,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 0.8) {
          glow.edgeDimMin = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.edgeDimMin = DEFAULT_SETTINGS.glow.edgeDimMin;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Edge dim maximum alpha",
      desc: "Maximum alpha used for focused edges (0-1).",
      value: glow.edgeDimMax ?? DEFAULT_SETTINGS.glow.edgeDimMax,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.edgeDimMax,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.edgeDimMax = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.edgeDimMax = DEFAULT_SETTINGS.glow.edgeDimMax;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Node minimum body alpha",
      desc: "Minimum fill alpha for dimmed nodes (0-1).",
      value: glow.nodeMinBodyAlpha ?? DEFAULT_SETTINGS.glow.nodeMinBodyAlpha,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.glow.nodeMinBodyAlpha,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          glow.nodeMinBodyAlpha = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          glow.nodeMinBodyAlpha = DEFAULT_SETTINGS.glow.nodeMinBodyAlpha;
          await this.plugin.saveSettings();
        }
      }
    });
    containerEl.createEl("h2", { text: "Colors" });
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Node color (override)").setDesc("Optional CSS color string to override the theme accent for node fill. Leave empty to use the active theme.");
      let txt = null;
      s.addText((t) => {
        txt = t;
        return t.setValue(String(glow.nodeColor ?? "")).onChange(async (value) => {
          const v = value.trim();
          glow.nodeColor = v === "" ? void 0 : v;
          await this.plugin.saveSettings();
        });
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
      alphaInput.min = "0";
      alphaInput.max = "1";
      alphaInput.step = "0.01";
      alphaInput.value = String(glow.nodeColorAlpha ?? DEFAULT_SETTINGS.glow.nodeColorAlpha);
      alphaInput.style.width = "68px";
      alphaInput.style.marginLeft = "8px";
      alphaInput.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.nodeColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.nodeColorAlpha;
        await this.plugin.saveSettings();
      });
      const maxAlphaInput = document.createElement("input");
      maxAlphaInput.type = "number";
      maxAlphaInput.min = "0";
      maxAlphaInput.max = "1";
      maxAlphaInput.step = "0.01";
      maxAlphaInput.value = String(glow.nodeColorMaxAlpha ?? DEFAULT_SETTINGS.glow.nodeColorMaxAlpha);
      maxAlphaInput.style.width = "68px";
      maxAlphaInput.style.marginLeft = "6px";
      maxAlphaInput.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.nodeColorMaxAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.nodeColorMaxAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        glow.nodeColor = void 0;
        glow.nodeColorAlpha = void 0;
        glow.nodeColorMaxAlpha = void 0;
        await this.plugin.saveSettings();
        if (txt)
          txt.setValue("");
        alphaInput.value = String(DEFAULT_SETTINGS.glow.nodeColorAlpha);
        maxAlphaInput.value = String(DEFAULT_SETTINGS.glow.nodeColorMaxAlpha);
      });
      s.controlEl.appendChild(rb);
      const hint = document.createElement("span");
      hint.textContent = "(alpha: min|max)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(alphaInput);
      s.controlEl.appendChild(maxAlphaInput);
    }
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Edge color (override)").setDesc("Optional CSS color string to override edge stroke color. Leave empty to use a theme-appropriate color.");
      let txt = null;
      s.addText((t) => {
        txt = t;
        return t.setValue(String(glow.edgeColor ?? "")).onChange(async (value) => {
          const v = value.trim();
          glow.edgeColor = v === "" ? void 0 : v;
          await this.plugin.saveSettings();
        });
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
      edgeAlpha.min = "0";
      edgeAlpha.max = "1";
      edgeAlpha.step = "0.01";
      edgeAlpha.value = String(glow.edgeColorAlpha ?? DEFAULT_SETTINGS.glow.edgeColorAlpha);
      edgeAlpha.style.width = "68px";
      edgeAlpha.style.marginLeft = "8px";
      edgeAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.edgeColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.edgeColorAlpha;
        await this.plugin.saveSettings();
      });
      const edgeMaxAlpha = document.createElement("input");
      edgeMaxAlpha.type = "number";
      edgeMaxAlpha.min = "0";
      edgeMaxAlpha.max = "1";
      edgeMaxAlpha.step = "0.01";
      edgeMaxAlpha.value = String(glow.edgeColorMaxAlpha ?? DEFAULT_SETTINGS.glow.edgeColorMaxAlpha);
      edgeMaxAlpha.style.width = "68px";
      edgeMaxAlpha.style.marginLeft = "6px";
      edgeMaxAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.edgeColorMaxAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.edgeColorMaxAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        glow.edgeColor = void 0;
        glow.edgeColorAlpha = void 0;
        glow.edgeColorMaxAlpha = void 0;
        await this.plugin.saveSettings();
        if (txt)
          txt.setValue("");
        edgeAlpha.value = String(DEFAULT_SETTINGS.glow.edgeColorAlpha);
        edgeMaxAlpha.value = String(DEFAULT_SETTINGS.glow.edgeColorMaxAlpha);
      });
      s.controlEl.appendChild(rb);
      const hint = document.createElement("span");
      hint.textContent = "(alpha: min|max)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(edgeAlpha);
      s.controlEl.appendChild(edgeMaxAlpha);
    }
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Tag color (override)").setDesc("Optional CSS color string to override tag node color. Leave empty to use a theme-appropriate color.");
      let txt = null;
      s.addText((t) => {
        txt = t;
        return t.setValue(String(glow.tagColor ?? "")).onChange(async (value) => {
          const v = value.trim();
          glow.tagColor = v === "" ? void 0 : v;
          await this.plugin.saveSettings();
        });
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
      tagAlpha.min = "0";
      tagAlpha.max = "1";
      tagAlpha.step = "0.01";
      tagAlpha.value = String(glow.tagColorAlpha ?? DEFAULT_SETTINGS.glow.tagColorAlpha);
      tagAlpha.style.width = "68px";
      tagAlpha.style.marginLeft = "8px";
      tagAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.tagColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.tagColorAlpha;
        await this.plugin.saveSettings();
      });
      const tagMaxAlpha = document.createElement("input");
      tagMaxAlpha.type = "number";
      tagMaxAlpha.min = "0";
      tagMaxAlpha.max = "1";
      tagMaxAlpha.step = "0.01";
      tagMaxAlpha.value = String(glow.tagColorMaxAlpha ?? DEFAULT_SETTINGS.glow.tagColorMaxAlpha);
      tagMaxAlpha.style.width = "68px";
      tagMaxAlpha.style.marginLeft = "6px";
      tagMaxAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.tagColorMaxAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.tagColorMaxAlpha;
        await this.plugin.saveSettings();
      });
      rb.addEventListener("click", async () => {
        glow.tagColor = void 0;
        glow.tagColorAlpha = void 0;
        glow.tagColorMaxAlpha = void 0;
        await this.plugin.saveSettings();
        if (txt)
          txt.setValue("");
        tagAlpha.value = String(DEFAULT_SETTINGS.glow.tagColorAlpha);
        tagMaxAlpha.value = String(DEFAULT_SETTINGS.glow.tagColorMaxAlpha);
      });
      s.controlEl.appendChild(rb);
      const hint = document.createElement("span");
      hint.textContent = "(alpha: min|max)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(tagAlpha);
      s.controlEl.appendChild(tagMaxAlpha);
    }
    {
      const s = new import_obsidian2.Setting(containerEl).setName("Label color (override)").setDesc("Optional CSS color string to override label text color. Leave empty to use the active theme text color.");
      let txt = null;
      s.addText((t) => {
        txt = t;
        return t.setValue(String(glow.labelColor ?? "")).onChange(async (value) => {
          const v = value.trim();
          glow.labelColor = v === "" ? void 0 : v;
          await this.plugin.saveSettings();
        });
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      rb.addEventListener("click", async () => {
        glow.labelColor = void 0;
        glow.labelColorAlpha = void 0;
        await this.plugin.saveSettings();
        if (txt)
          txt.setValue("");
        labelAlpha.value = String(DEFAULT_SETTINGS.glow.labelColorAlpha);
      });
      s.controlEl.appendChild(rb);
      const labelAlpha = document.createElement("input");
      labelAlpha.type = "number";
      labelAlpha.min = "0";
      labelAlpha.max = "1";
      labelAlpha.step = "0.01";
      labelAlpha.value = String(glow.labelColorAlpha ?? DEFAULT_SETTINGS.glow.labelColorAlpha);
      labelAlpha.style.width = "68px";
      labelAlpha.style.marginLeft = "8px";
      labelAlpha.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        glow.labelColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_SETTINGS.glow.labelColorAlpha;
        await this.plugin.saveSettings();
      });
      s.controlEl.appendChild(labelAlpha);
    }
    new import_obsidian2.Setting(containerEl).setName("Use interface font for labels").setDesc("When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.").addToggle((t) => t.setValue(Boolean(glow.useInterfaceFont)).onChange(async (v) => {
      glow.useInterfaceFont = Boolean(v);
      await this.plugin.saveSettings();
    }));
    const phys = this.plugin.settings.physics || {};
    containerEl.createEl("h2", { text: "Greater Graph \u2013 Physics" });
    const repulsionUi = (() => {
      const internal = phys.repulsionStrength ?? DEFAULT_SETTINGS.physics.repulsionStrength;
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
      resetValue: 0.2,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = v * v * 2e3;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.repulsionStrength = DEFAULT_SETTINGS.physics.repulsionStrength;
          await this.plugin.saveSettings();
        }
      }
    });
    const springUi = Math.min(1, Math.max(0, (phys.springStrength ?? DEFAULT_SETTINGS.physics.springStrength) / 0.5));
    addSliderSetting(containerEl, {
      name: "Spring strength",
      desc: "UI 0\u20131 mapped to internal spring constant (higher = stiffer).",
      value: springUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: 0.4,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springStrength = v * 0.5;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springStrength = DEFAULT_SETTINGS.physics.springStrength;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Spring length",
      desc: "Preferred length (px) for edge springs.",
      value: phys.springLength ?? DEFAULT_SETTINGS.physics.springLength,
      min: 20,
      max: 400,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics.springLength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.springLength = DEFAULT_SETTINGS.physics.springLength;
          await this.plugin.saveSettings();
        }
      }
    });
    const centerUi = Math.min(1, Math.max(0, (phys.centerPull ?? DEFAULT_SETTINGS.physics.centerPull) / 0.01));
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
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = v * 0.01;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.centerPull = DEFAULT_SETTINGS.physics.centerPull;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Damping",
      desc: "Velocity damping (0.7\u20131.0). Higher values reduce motion faster.",
      value: phys.damping ?? DEFAULT_SETTINGS.physics.damping,
      min: 0.7,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0.7 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.damping = DEFAULT_SETTINGS.physics.damping;
          await this.plugin.saveSettings();
        }
      }
    });
    new import_obsidian2.Setting(containerEl).setName("Count duplicate links").setDesc("If enabled, multiple links between the same two files will be counted when computing in/out degrees.").addToggle((t) => t.setValue(Boolean(this.plugin.settings.countDuplicateLinks)).onChange(async (v) => {
      this.plugin.settings.countDuplicateLinks = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Double-line mutual links").setDesc("When enabled, mutual links (A \u2194 B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.").addToggle((t) => t.setValue(Boolean(this.plugin.settings.mutualLinkDoubleLine)).onChange(async (v) => {
      this.plugin.settings.mutualLinkDoubleLine = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Show tag nodes").setDesc("Toggle visibility of tag nodes and their edges in the graph.").addToggle((t) => t.setValue(this.plugin.settings.showTags !== false).onChange(async (v) => {
      this.plugin.settings.showTags = Boolean(v);
      await this.plugin.saveSettings();
    }));
    addSliderSetting(containerEl, {
      name: "Mouse attraction radius (px)",
      desc: "Maximum distance (in pixels) from cursor where the attraction applies.",
      value: phys.mouseAttractionRadius ?? 80,
      min: 0,
      max: 400,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics.mouseAttractionRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = DEFAULT_SETTINGS.physics.mouseAttractionRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Mouse attraction strength",
      desc: "Base force scale applied toward the cursor when within radius (higher = stronger pull).",
      value: phys.mouseAttractionStrength ?? 0.15,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics.mouseAttractionStrength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = DEFAULT_SETTINGS.physics.mouseAttractionStrength;
          await this.plugin.saveSettings();
        }
      }
    });
    const notePlaneUi = Math.min(1, Math.max(0, (phys.notePlaneStiffness ?? DEFAULT_SETTINGS.physics.notePlaneStiffness) / 0.02));
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
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.notePlaneStiffness = v * 0.02;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.notePlaneStiffness = DEFAULT_SETTINGS.physics.notePlaneStiffness;
          await this.plugin.saveSettings();
        }
      }
    });
    const tagPlaneUi = Math.min(1, Math.max(0, (phys.tagPlaneStiffness ?? DEFAULT_SETTINGS.physics.tagPlaneStiffness) / 0.02));
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
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.tagPlaneStiffness = v * 0.02;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.tagPlaneStiffness = DEFAULT_SETTINGS.physics.tagPlaneStiffness;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Mouse attraction radius (px)",
      desc: "Maximum distance (in pixels) from cursor where the attraction applies.",
      value: phys.mouseAttractionRadius ?? DEFAULT_SETTINGS.physics.mouseAttractionRadius,
      min: 40,
      max: 400,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics.mouseAttractionRadius,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionRadius = DEFAULT_SETTINGS.physics.mouseAttractionRadius;
          await this.plugin.saveSettings();
        }
      }
    });
    const mouseStrengthUi = Math.min(1, Math.max(0, (phys.mouseAttractionStrength ?? DEFAULT_SETTINGS.physics.mouseAttractionStrength) / 0.1));
    addSliderSetting(containerEl, {
      name: "Mouse attraction strength",
      desc: "UI 0\u20131 mapped to internal small force scale (higher = stronger pull).",
      value: mouseStrengthUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: 0.2,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = v * 0.1;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionStrength = DEFAULT_SETTINGS.physics.mouseAttractionStrength;
          await this.plugin.saveSettings();
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Mouse attraction exponent",
      desc: "How sharply attraction ramps as the cursor approaches (1 = linear; higher = snappier near cursor).",
      value: phys.mouseAttractionExponent ?? DEFAULT_SETTINGS.physics.mouseAttractionExponent,
      min: 1,
      max: 6,
      step: 0.1,
      resetValue: DEFAULT_SETTINGS.physics.mouseAttractionExponent,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 1 && v <= 6) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionExponent = v;
          await this.plugin.saveSettings();
        } else if (Number.isNaN(v)) {
          this.plugin.settings.physics = this.plugin.settings.physics || {};
          this.plugin.settings.physics.mouseAttractionExponent = DEFAULT_SETTINGS.physics.mouseAttractionExponent;
          await this.plugin.saveSettings();
        }
      }
    });
    containerEl.createEl("h2", { text: "Center Node" });
    new import_obsidian2.Setting(containerEl).setName("Use pinned center note").setDesc("Prefer a specific note path as the graph center. Falls back to max in-links if not found.").addToggle((t) => t.setValue(Boolean(this.plugin.settings.usePinnedCenterNote)).onChange(async (v) => {
      this.plugin.settings.usePinnedCenterNote = Boolean(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Pinned center note path").setDesc('e.g., "Home.md" or "Notes/Home" (vault-relative).').addText((txt) => txt.setPlaceholder("path/to/note").setValue(this.plugin.settings.pinnedCenterNotePath || "").onChange(async (v) => {
      this.plugin.settings.pinnedCenterNotePath = (v || "").trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Fallback: prefer out-links").setDesc("When picking a center by link count, prefer out-links (out-degree) instead of in-links (in-degree)").addToggle((t) => t.setValue(Boolean(this.plugin.settings.useOutlinkFallback)).onChange(async (v) => {
      this.plugin.settings.useOutlinkFallback = Boolean(v);
      await this.plugin.saveSettings();
    }));
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SETTINGS
});
