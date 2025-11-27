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

// GraphView2.ts
var GraphView2_exports = {};
__export(GraphView2_exports, {
  GREATER_GRAPH_VIEW_TYPE: () => GREATER_GRAPH_VIEW_TYPE,
  GraphView: () => GraphView
});
module.exports = __toCommonJS(GraphView2_exports);
var import_obsidian = require("obsidian");

// graph/buildGraph.ts
async function buildGraph(app) {
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
  const edges = [];
  const edgeSet = /* @__PURE__ */ new Set();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache || !cache.links)
      continue;
    for (const linkEntry of cache.links) {
      const linkPath = linkEntry.link;
      if (!linkPath)
        continue;
      const destFile = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
      if (!destFile)
        continue;
      if (!nodeByPath.has(destFile.path))
        continue;
      const sourceId = file.path;
      const targetId = destFile.path;
      const key = `${sourceId}->${targetId}`;
      if (!edgeSet.has(key)) {
        edges.push({ sourceId, targetId });
        edgeSet.add(key);
      }
    }
  }
  const nodeByIdForMetrics = /* @__PURE__ */ new Map();
  for (const n of nodes)
    nodeByIdForMetrics.set(n.id, n);
  for (const e of edges) {
    const src = nodeByIdForMetrics.get(e.sourceId);
    const tgt = nodeByIdForMetrics.get(e.targetId);
    if (!src || !tgt)
      continue;
    src.outDegree += 1;
    tgt.inDegree += 1;
  }
  for (const n of nodes) {
    n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0);
  }
  return { nodes, edges };
}

// graph/layout2d.ts
function layoutGraph2D(graph, options) {
  const { width, height, margin = 32 } = options;
  const nodes = graph.nodes;
  if (!nodes || nodes.length === 0)
    return;
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const innerWidth = Math.max(1, width - 2 * margin);
  const innerHeight = Math.max(1, height - 2 * margin);
  const cellWidth = innerWidth / cols;
  const cellHeight = innerHeight / rows;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const row = Math.floor(i / cols);
    const col = i % cols;
    node.x = margin + col * cellWidth + cellWidth / 2;
    node.y = margin + row * cellHeight + cellHeight / 2;
    node.z = 0;
  }
  if (options.centerOnLargestNode) {
    const centerX = options.centerX ?? width / 2;
    const centerY = options.centerY ?? height / 2;
    let centerNode = null;
    let maxDeg = -Infinity;
    for (const n of nodes) {
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
  let minRadius = glowOptions?.minNodeRadius ?? 4;
  let maxRadius = glowOptions?.maxNodeRadius ?? 14;
  let glowMultiplier = glowOptions?.glowRadiusMultiplier ?? 2;
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
      }
    }
    minDegree = Infinity;
    maxDegree = -Infinity;
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        const d = n.totalDegree || 0;
        if (d < minDegree)
          minDegree = d;
        if (d > maxDegree)
          maxDegree = d;
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
    const d = node.totalDegree || 0;
    if (maxDegree <= minDegree)
      return 0.5;
    return (d - minDegree) / (maxDegree - minDegree);
  }
  function getNodeRadius(node) {
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!graph)
      return;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const node of graph.nodes) {
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      const glowRadius = radius * glowMultiplier;
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
      gradient.addColorStop(0, `rgba(102,204,255,${centerAlpha})`);
      gradient.addColorStop(0.4, `rgba(102,204,255,${centerAlpha * 0.5})`);
      gradient.addColorStop(0.8, `rgba(102,204,255,${centerAlpha * 0.15})`);
      gradient.addColorStop(1, `rgba(102,204,255,0)`);
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#66ccff";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#222";
      ctx.fillText(node.label, node.x, node.y + radius + 4);
      ctx.restore();
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
  let linkForceMultiplier = options?.linkForceMultiplier ?? 1;
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
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
        } else {
          const fx = (Math.random() - 0.5) * 0.1;
          const fy = (Math.random() - 0.5) * 0.1;
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
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
      const weight = e.linkStrength ?? 1;
      const springK = springStrength * weight * (linkForceMultiplier ?? 1);
      const f = springK * Math.tanh(diff / 50);
      const fx = dx / dist * f;
      const fy = dy / dist * f;
      a.vx = (a.vx || 0) + fx;
      a.vy = (a.vy || 0) + fy;
      b.vx = (b.vx || 0) - fx;
      b.vy = (b.vy || 0) - fy;
    }
  }
  function applyCentering() {
    if (centerPull <= 0)
      return;
    const cx = centerX ?? 0;
    const cy = centerY ?? 0;
    for (const n of nodes) {
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
      n.vx = (n.vx || 0) * damping;
      n.vy = (n.vy || 0) * damping;
      if (Math.abs(n.vx) < 1e-3)
        n.vx = 0;
      if (Math.abs(n.vy) < 1e-3)
        n.vy = 0;
    }
  }
  function integrate(dt) {
    const scale = dt * 60;
    for (const n of nodes) {
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
    if (typeof opts.linkForceMultiplier === "number")
      linkForceMultiplier = opts.linkForceMultiplier;
    if (typeof opts.centerX === "number")
      centerX = opts.centerX;
    if (typeof opts.centerY === "number")
      centerY = opts.centerY;
    if (typeof opts.centerNodeId === "string") {
      centerNodeId = opts.centerNodeId;
      centerNode = nodes.find((n) => n.id === centerNodeId) || null;
    }
  }
  return { start, stop, tick, reset, setOptions };
}

// GraphView2.ts
var GREATER_GRAPH_VIEW_TYPE = "greater-graph-view";
var GraphView = class extends import_obsidian.ItemView {
  controller = null;
  plugin;
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
  isDragging = false;
  lastDragX = 0;
  lastDragY = 0;
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
    this.renderer = createRenderer2D({ canvas, glow: this.plugin.settings?.glow });
    this.graph = await buildGraph(this.app);
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
    layoutGraph2D(this.graph, {
      width: rect.width || 300,
      height: rect.height || 200,
      margin: 32,
      centerX,
      centerY,
      centerOnLargestNode: true
    });
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
    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);
    this.mouseMoveHandler = (ev) => {
      if (!this.canvas)
        return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleHover(x, y);
    };
    this.mouseLeaveHandler = () => this.clearHover();
    this.mouseClickHandler = (ev) => {
      if (!this.canvas)
        return;
      if (ev.button !== 0)
        return;
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
      if (!this.canvas || ev.button !== 0)
        return;
      this.isDragging = true;
      const r = this.canvas.getBoundingClientRect();
      this.lastDragX = ev.clientX - r.left;
      this.lastDragY = ev.clientY - r.top;
      this.canvas.style.cursor = "grabbing";
    };
    this.mouseUpHandler = (ev) => {
      if (!this.canvas)
        return;
      if (ev.button !== 0)
        return;
      this.isDragging = false;
      this.canvas.style.cursor = "default";
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
            this.renderer.setGlowSettings(glow);
            this.renderer.render();
          }
          const phys = this.plugin.settings.physics;
          if (this.simulation && phys && this.simulation.setOptions) {
            this.simulation.setOptions(phys);
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
  destroy() {
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
    if (this.isDragging) {
      const worldPrev = this.renderer.screenToWorld(this.lastDragX, this.lastDragY);
      const r = this.canvas.getBoundingClientRect();
      const curX = screenX;
      const curY = screenY;
      const dx = curX - this.lastDragX;
      const dy = curY - this.lastDragY;
      this.renderer.panBy(dx, dy);
      this.lastDragX = curX;
      this.lastDragY = curY;
      return;
    }
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
  }
  clearHover() {
    if (!this.renderer)
      return;
    if (this.renderer.setHoverState)
      this.renderer.setHoverState(null, /* @__PURE__ */ new Set(), 0, 0);
    if (this.renderer.setHoveredNode)
      this.renderer.setHoveredNode(null);
    this.renderer.render();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GREATER_GRAPH_VIEW_TYPE,
  GraphView
});
