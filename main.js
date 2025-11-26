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
  const MIN_RADIUS = glowOptions?.minNodeRadius ?? 4;
  const MAX_RADIUS = glowOptions?.maxNodeRadius ?? 14;
  const GLOW_MULTIPLIER = glowOptions?.glowRadiusMultiplier ?? 2;
  const MIN_CENTER_ALPHA = glowOptions?.minCenterAlpha ?? 0.05;
  const MAX_CENTER_ALPHA = glowOptions?.maxCenterAlpha ?? 0.35;
  const HOVER_BOOST = glowOptions?.hoverBoostFactor ?? 1.5;
  let hoveredNodeId = null;
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
    return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
  }
  function getBaseCenterAlpha(node) {
    const t = getDegreeNormalized(node);
    return MIN_CENTER_ALPHA + t * (MAX_CENTER_ALPHA - MIN_CENTER_ALPHA);
  }
  function getCenterAlpha(node) {
    let alpha = getBaseCenterAlpha(node);
    if (hoveredNodeId === node.id) {
      alpha = Math.min(1, alpha * HOVER_BOOST);
    }
    return alpha;
  }
  function render() {
    if (!ctx)
      return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!graph)
      return;
    if (graph.edges && graph.edges.length > 0) {
      ctx.save();
      ctx.beginPath();
      for (const edge of graph.edges) {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (!src || !tgt)
          continue;
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
      }
      ctx.strokeStyle = "#888888";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const node of graph.nodes) {
      const radius = getNodeRadius(node);
      const centerAlpha = getCenterAlpha(node);
      const glowRadius = radius * GLOW_MULTIPLIER;
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
      ctx.strokeStyle = "#0d3b4e";
      ctx.lineWidth = 1;
      ctx.stroke();
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
  return {
    setGraph,
    resize,
    render,
    destroy,
    setHoveredNode,
    getNodeRadiusForHit
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
};
var Graph2DController = class {
  app;
  containerEl;
  canvas = null;
  renderer = null;
  graph = null;
  plugin;
  mouseMoveHandler = null;
  mouseLeaveHandler = null;
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
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.canvas.addEventListener("mouseleave", this.mouseLeaveHandler);
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
    this.renderer.setHoveredNode(newId);
    this.renderer.render();
  }
  clearHover() {
    if (!this.renderer)
      return;
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
    hoverBoostFactor: 1.5
  }
};
var GreaterGraphPlugin = class extends import_obsidian2.Plugin {
  settings = DEFAULT_SETTINGS;
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
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SETTINGS
});
