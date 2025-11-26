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

// GraphView.ts
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
    if (graph) {
      layoutGraph2D(graph, { width: canvas.width, height: canvas.height, margin: 32 });
    }
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
    if (!hoveredNodeId)
      return clamp01(base);
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
  return {
    setGraph,
    resize,
    render,
    destroy,
    setHoveredNode,
    getNodeRadiusForHit,
    setGlowSettings,
    setHoverState
  };
}

// GraphView.ts
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
      this.controller.setNodeClickHandler((node) => {
        void this.openNodeFile(node);
      });
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
    if (node.file) {
      file = node.file;
    } else if (node.filePath) {
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
  settingsUnregister = null;
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
    this.renderer.setGraph(this.graph);
    this.renderer.resize(rect.width || 300, rect.height || 200);
    this.mouseMoveHandler = (ev) => {
      if (!this.canvas)
        return;
      const rect2 = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect2.left;
      const y = ev.clientY - rect2.top;
      this.handleHover(x, y);
    };
    this.mouseLeaveHandler = () => {
      this.clearHover();
    };
    this.mouseClickHandler = (ev) => {
      if (!this.canvas)
        return;
      if (ev.button !== 0)
        return;
      const rect2 = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect2.left;
      const y = ev.clientY - rect2.top;
      this.handleClick(x, y);
    };
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.addEventListener("mouseleave", this.mouseLeaveHandler);
    this.canvas.addEventListener("click", this.mouseClickHandler);
    if (this.plugin.registerSettingsListener) {
      this.settingsUnregister = this.plugin.registerSettingsListener(() => {
        if (this.renderer && this.plugin.settings) {
          const glow = this.plugin.settings.glow;
          if (this.renderer.setGlowSettings) {
            this.renderer.setGlowSettings(glow);
            this.renderer.render();
          }
        }
      });
    }
  }
  resize(width, height) {
    if (!this.renderer)
      return;
    this.renderer.resize(width, height);
  }
  destroy() {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
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
  handleClick(x, y) {
    if (!this.graph || !this.onNodeClick)
      return;
    const node = this.hitTestNode(x, y);
    if (!node)
      return;
    try {
      this.onNodeClick(node);
    } catch (e) {
      console.error("Graph2DController.onNodeClick handler error", e);
    }
  }
  handleHover(x, y) {
    if (!this.graph || !this.renderer)
      return;
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
    const newId = closest ? closest.id : null;
    const depth = this.plugin.settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = /* @__PURE__ */ new Set();
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
    if (this.renderer.setHoverState) {
      this.renderer.setHoverState(newId, highlightSet, x, y);
    }
    if (this.renderer.setHoveredNode) {
      this.renderer.setHoveredNode(newId);
    }
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

// main.ts
var DEFAULT_SETTINGS = {
  glow: {
    minNodeRadius: 4,
    maxNodeRadius: 14,
    glowRadiusMultiplier: 2,
    minCenterAlpha: 0.1,
    maxCenterAlpha: 0.4,
    hoverBoostFactor: 1.6,
    neighborBoostFactor: 1.2,
    dimFactor: 0.3,
    hoverHighlightDepth: 1,
    distanceInnerRadiusMultiplier: 1,
    distanceOuterRadiusMultiplier: 2.5,
    distanceCurveSteepness: 2
  }
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
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      await rightLeaf.setViewState({
        type: GREATER_GRAPH_VIEW_TYPE,
        active: true
      });
      this.app.workspace.revealLeaf(rightLeaf);
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
    new import_obsidian2.Setting(containerEl).setName("Glow radius multiplier").setDesc("Glow radius as a multiple of the node radius.").addText(
      (text) => text.setValue(String(glow.glowRadiusMultiplier)).onChange(async (value) => {
        const num = Number(value);
        if (!isNaN(num) && num > 0) {
          glow.glowRadiusMultiplier = num;
          await this.plugin.saveSettings();
        }
      })
    );
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
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SETTINGS
});
