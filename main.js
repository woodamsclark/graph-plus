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
    z: 0
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
  const ctx = canvas.getContext("2d");
  let graph = null;
  let nodeById = /* @__PURE__ */ new Map();
  function setGraph(g) {
    graph = g;
    nodeById = /* @__PURE__ */ new Map();
    if (graph && graph.nodes) {
      for (const n of graph.nodes) {
        nodeById.set(n.id, n);
      }
    }
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
  function render() {
    if (!ctx)
      return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!graph)
      return;
    const radius = 5;
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
    ctx.save();
    ctx.fillStyle = "#66ccff";
    ctx.strokeStyle = "#0d3b4e";
    ctx.lineWidth = 1;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const node of graph.nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#222";
      ctx.fillText(node.label, node.x, node.y + radius + 4);
      ctx.fillStyle = "#66ccff";
    }
    ctx.restore();
  }
  function destroy() {
    graph = null;
  }
  return {
    setGraph,
    resize,
    render,
    destroy
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
    this.controller = new Graph2DController(this.app, container);
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
  constructor(app, containerEl) {
    this.app = app;
    this.containerEl = containerEl;
  }
  async init() {
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = createRenderer2D({ canvas });
    this.graph = await buildGraph(this.app);
    const rect = this.containerEl.getBoundingClientRect();
    this.renderer.setGraph(this.graph);
    this.renderer.resize(rect.width || 300, rect.height || 200);
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
};

// main.ts
var GreaterGraphPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    this.registerView(GREATER_GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id: "open-greater-graph",
      name: "Open Greater Graph",
      callback: () => this.activateView()
    });
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
};
