import { App, ItemView, WorkspaceLeaf, Plugin, TFile } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D } from './graph/layout2d';
import { createRenderer2D, Renderer2D } from './graph/renderer2d';
import { createSimulation, Simulation } from './graph/simulation';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GREATER_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Greater Graph';
  }

  getIcon(): string {
    return 'dot-network';
  }

  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: 'greater-graph-view' });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
    if (this.controller) {
      this.controller.setNodeClickHandler((node: any) => void this.openNodeFile(node));
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

  private async openNodeFile(node: any): Promise<void> {
    if (!node) return;
    const app = this.app;
    let file: TFile | null = null;
    if ((node as any).file) file = (node as any).file as TFile;
    else if ((node as any).filePath) {
      const af = app.vault.getAbstractFileByPath((node as any).filePath);
      if (af instanceof TFile) file = af;
    }
    if (!file) {
      // eslint-disable-next-line no-console
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: failed to open file', e);
    }
  }
}

class Graph2DController {
  private app: App;
  private containerEl: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer2D | null = null;
  private graph: GraphData | null = null;
  private adjacency: Map<string, string[]> | null = null;
  private onNodeClick: ((node: any) => void) | null = null;
  private plugin: Plugin;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private mouseClickHandler: ((e: MouseEvent) => void) | null = null;
  private simulation: Simulation | null = null;
  private animationFrame: number | null = null;
  private lastTime: number | null = null;
  private running: boolean = false;
  private settingsUnregister: (() => void) | null = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = createRenderer2D({ canvas, glow: (this.plugin as any).settings?.glow });

    this.graph = await buildGraph(this.app);

    this.adjacency = new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!this.adjacency.has(e.sourceId)) this.adjacency.set(e.sourceId, []);
        if (!this.adjacency.has(e.targetId)) this.adjacency.set(e.targetId, []);
        this.adjacency.get(e.sourceId)!.push(e.targetId);
        this.adjacency.get(e.targetId)!.push(e.sourceId);
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
      centerOnLargestNode: true,
    });
    this.renderer.resize(rect.width || 300, rect.height || 200);

    let centerNodeId: string | undefined = undefined;
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
      Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY, centerNodeId })
    );

    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);

    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleHover(x, y);
    };

    this.mouseLeaveHandler = () => this.clearHover();

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);

    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if ((this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(glow);
            this.renderer.render();
          }
          const phys = (this.plugin as any).settings.physics;
          if (this.simulation && phys && (this.simulation as any).setOptions) {
            (this.simulation as any).setOptions(phys);
          }
        }
      });
    }
  }

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    this.lastTime = timestamp;
    if (this.simulation) this.simulation.tick(dt);
    if (this.renderer) this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && (this.simulation as any).setOptions) {
      (this.simulation as any).setOptions({ centerX, centerY });
    }
  }

  destroy(): void {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.simulation) { try { this.simulation.stop(); } catch (e) {} this.simulation = null; }
    if (this.animationFrame) { try { cancelAnimationFrame(this.animationFrame); } catch (e) {} this.animationFrame = null; this.lastTime = null; this.running = false; }
    this.onNodeClick = null;
    if (this.settingsUnregister) { try { this.settingsUnregister(); } catch (e) {} this.settingsUnregister = null; }
  }

  setNodeClickHandler(handler: ((node: any) => void) | null) { this.onNodeClick = handler; }

  private hitTestNode(x: number, y: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  handleClick(x: number, y: number): void { if (!this.graph || !this.onNodeClick) return; const node = this.hitTestNode(x, y); if (!node) return; try { this.onNodeClick(node); } catch (e) { console.error('Graph2DController.onNodeClick handler error', e); } }

  handleHover(x: number, y: number): void {
    if (!this.graph || !this.renderer) return;
    let closest: any = null; let closestDist = Infinity; const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    const newId = closest ? closest.id : null;
    const depth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = new Set<string>(); if (newId) highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q: Array<{ id: string; d: number }> = [{ id: newId, d: 0 }];
      const seen = new Set<string>([newId]);
      while (q.length > 0) {
        const cur = q.shift()!; if (cur.d > 0) highlightSet.add(cur.id);
        if (cur.d >= depth) continue; const neighbors = this.adjacency.get(cur.id) || [];
        for (const nb of neighbors) { if (!seen.has(nb)) { seen.add(nb); q.push({ id: nb, d: cur.d + 1 }); } }
      }
    }
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(newId, highlightSet, x, y);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(newId);
    this.renderer.render();
  }

  clearHover(): void { if (!this.renderer) return; if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0); if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(null); this.renderer.render(); }
}
import { App, ItemView, WorkspaceLeaf, Plugin, TFile } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D } from './graph/layout2d';
import { createRenderer2D, Renderer2D } from './graph/renderer2d';
import { createSimulation, Simulation } from './graph/simulation';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GREATER_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Greater Graph';
  }

  getIcon(): string {
    return 'dot-network';
  }

  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: 'greater-graph-view' });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
    if (this.controller) {
      this.controller.setNodeClickHandler((node: any) => void this.openNodeFile(node));
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

  private async openNodeFile(node: any): Promise<void> {
    if (!node) return;
    const app = this.app;
    let file: TFile | null = null;
    if ((node as any).file) file = (node as any).file as TFile;
    else if ((node as any).filePath) {
      const af = app.vault.getAbstractFileByPath((node as any).filePath);
      if (af instanceof TFile) file = af;
    }
    if (!file) {
      // eslint-disable-next-line no-console
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: failed to open file', e);
    }
  }
}

class Graph2DController {
  private app: App;
  private containerEl: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer2D | null = null;
  private graph: GraphData | null = null;
  private adjacency: Map<string, string[]> | null = null;
  private onNodeClick: ((node: any) => void) | null = null;
  private plugin: Plugin;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private mouseClickHandler: ((e: MouseEvent) => void) | null = null;
  private simulation: Simulation | null = null;
  private animationFrame: number | null = null;
  private lastTime: number | null = null;
  private running: boolean = false;
  private settingsUnregister: (() => void) | null = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = createRenderer2D({ canvas, glow: (this.plugin as any).settings?.glow });

    this.graph = await buildGraph(this.app);

    this.adjacency = new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!this.adjacency.has(e.sourceId)) this.adjacency.set(e.sourceId, []);
        if (!this.adjacency.has(e.targetId)) this.adjacency.set(e.targetId, []);
        this.adjacency.get(e.sourceId)!.push(e.targetId);
        this.adjacency.get(e.targetId)!.push(e.sourceId);
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
      centerOnLargestNode: true,
    });
    this.renderer.resize(rect.width || 300, rect.height || 200);

    let centerNodeId: string | undefined = undefined;
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
      Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY, centerNodeId })
    );

    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);

    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleHover(x, y);
    };

    this.mouseLeaveHandler = () => this.clearHover();

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);

    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if ((this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(glow);
            this.renderer.render();
          }
          const phys = (this.plugin as any).settings.physics;
          if (this.simulation && phys && (this.simulation as any).setOptions) {
            (this.simulation as any).setOptions(phys);
          }
        }
      });
    }
  }

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    this.lastTime = timestamp;
    if (this.simulation) this.simulation.tick(dt);
    if (this.renderer) this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && (this.simulation as any).setOptions) {
      (this.simulation as any).setOptions({ centerX, centerY });
    }
  }

  destroy(): void {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.simulation) { try { this.simulation.stop(); } catch (e) {} this.simulation = null; }
    if (this.animationFrame) { try { cancelAnimationFrame(this.animationFrame); } catch (e) {} this.animationFrame = null; this.lastTime = null; this.running = false; }
    this.onNodeClick = null;
    if (this.settingsUnregister) { try { this.settingsUnregister(); } catch (e) {} this.settingsUnregister = null; }
  }

  setNodeClickHandler(handler: ((node: any) => void) | null) { this.onNodeClick = handler; }

  private hitTestNode(x: number, y: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  handleClick(x: number, y: number): void { if (!this.graph || !this.onNodeClick) return; const node = this.hitTestNode(x, y); if (!node) return; try { this.onNodeClick(node); } catch (e) { console.error('Graph2DController.onNodeClick handler error', e); } }

  handleHover(x: number, y: number): void {
    if (!this.graph || !this.renderer) return;
    let closest: any = null; let closestDist = Infinity; const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    const newId = closest ? closest.id : null;
    const depth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = new Set<string>(); if (newId) highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q: Array<{ id: string; d: number }> = [{ id: newId, d: 0 }];
      const seen = new Set<string>([newId]);
      while (q.length > 0) {
        const cur = q.shift()!; if (cur.d > 0) highlightSet.add(cur.id);
        if (cur.d >= depth) continue; const neighbors = this.adjacency.get(cur.id) || [];
        for (const nb of neighbors) { if (!seen.has(nb)) { seen.add(nb); q.push({ id: nb, d: cur.d + 1 }); } }
      }
    }
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(newId, highlightSet, x, y);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(newId);
    this.renderer.render();
  }

  clearHover(): void { if (!this.renderer) return; if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0); if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(null); this.renderer.render(); }
}
import { App, ItemView, WorkspaceLeaf, Plugin, TFile } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D } from './graph/layout2d';
import { createRenderer2D, Renderer2D } from './graph/renderer2d';
import { createSimulation, Simulation } from './graph/simulation';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GREATER_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Greater Graph';
  }

  getIcon(): string {
    return 'dot-network';
  }

  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: 'greater-graph-view' });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
      // wire node click -> open note
      if (this.controller) {
        this.controller.setNodeClickHandler((node: any) => {
          // open file for node
          // fire-and-forget
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

  private async openNodeFile(node: any): Promise<void> {
    if (!node) return;
    const app = this.app;
    let file: TFile | null = null;
    if ((node as any).file) file = (node as any).file as TFile;
    else if ((node as any).filePath) {
      const af = app.vault.getAbstractFileByPath((node as any).filePath);
      if (af instanceof TFile) file = af;
    }
    if (!file) {
      // eslint-disable-next-line no-console
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: failed to open file', e);
    }
  }
}

class Graph2DController {
  private app: App;
  private containerEl: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer2D | null = null;
  private graph: GraphData | null = null;
  private adjacency: Map<string, string[]> | null = null;
  private onNodeClick: ((node: any) => void) | null = null;
  private plugin: Plugin;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private mouseClickHandler: ((e: MouseEvent) => void) | null = null;
  private simulation: Simulation | null = null;
  private animationFrame: number | null = null;
  private lastTime: number | null = null;
  private running: boolean = false;
  private settingsUnregister: (() => void) | null = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = createRenderer2D({ canvas, glow: (this.plugin as any).settings?.glow });

    this.graph = await buildGraph(this.app);

    this.adjacency = new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!this.adjacency.has(e.sourceId)) this.adjacency.set(e.sourceId, []);
        if (!this.adjacency.has(e.targetId)) this.adjacency.set(e.targetId, []);
        this.adjacency.get(e.sourceId)!.push(e.targetId);
        this.adjacency.get(e.targetId)!.push(e.sourceId);
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
      centerOnLargestNode: true,
    });
    this.renderer.resize(rect.width || 300, rect.height || 200);

    let centerNodeId: string | undefined = undefined;
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
      Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY, centerNodeId })
    );

    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);

    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleHover(x, y);
    };

    this.mouseLeaveHandler = () => this.clearHover();

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);

    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if ((this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(glow);
            this.renderer.render();
          }
          const phys = (this.plugin as any).settings.physics;
          if (this.simulation && phys && (this.simulation as any).setOptions) {
            (this.simulation as any).setOptions(phys);
          }
        }
      });
    }
  }

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    this.lastTime = timestamp;
    if (this.simulation) this.simulation.tick(dt);
    if (this.renderer) this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && (this.simulation as any).setOptions) {
      (this.simulation as any).setOptions({ centerX, centerY });
    }
  }

  destroy(): void {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.simulation) { try { this.simulation.stop(); } catch (e) {} this.simulation = null; }
    if (this.animationFrame) { try { cancelAnimationFrame(this.animationFrame); } catch (e) {} this.animationFrame = null; this.lastTime = null; this.running = false; }
    this.onNodeClick = null;
    if (this.settingsUnregister) { try { this.settingsUnregister(); } catch (e) {} this.settingsUnregister = null; }
  }

  setNodeClickHandler(handler: ((node: any) => void) | null) { this.onNodeClick = handler; }

  private hitTestNode(x: number, y: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  handleClick(x: number, y: number): void { if (!this.graph || !this.onNodeClick) return; const node = this.hitTestNode(x, y); if (!node) return; try { this.onNodeClick(node); } catch (e) { console.error('Graph2DController.onNodeClick handler error', e); } }

  handleHover(x: number, y: number): void {
    if (!this.graph || !this.renderer) return;
    let closest: any = null; let closestDist = Infinity; const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    const newId = closest ? closest.id : null;
    const depth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = new Set<string>(); if (newId) highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q: Array<{ id: string; d: number }> = [{ id: newId, d: 0 }];
      const seen = new Set<string>([newId]);
      while (q.length > 0) {
        const cur = q.shift()!; if (cur.d > 0) highlightSet.add(cur.id);
        if (cur.d >= depth) continue; const neighbors = this.adjacency.get(cur.id) || [];
        for (const nb of neighbors) { if (!seen.has(nb)) { seen.add(nb); q.push({ id: nb, d: cur.d + 1 }); } }
      }
    }
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(newId, highlightSet, x, y);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(newId);
    this.renderer.render();
  }

  clearHover(): void { if (!this.renderer) return; if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0); if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(null); this.renderer.render(); }
}
import { App, ItemView, WorkspaceLeaf, Plugin, TFile } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D, Layout2DOptions } from './graph/layout2d';
import { createRenderer2D, Renderer2D } from './graph/renderer2d';
import { createSimulation, Simulation, SimulationOptions } from './graph/simulation';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GREATER_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Greater Graph';
  }

  getIcon(): string {
    return 'dot-network';
  }

  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: 'greater-graph-view' });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
    if (this.controller) {
      this.controller.setNodeClickHandler((node: any) => void this.openNodeFile(node));
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

  private async openNodeFile(node: any): Promise<void> {
    if (!node) return;
    const app = this.app;
    let file: TFile | null = null;
    if ((node as any).file) file = (node as any).file as TFile;
    else if ((node as any).filePath) {
      const af = app.vault.getAbstractFileByPath((node as any).filePath);
      if (af instanceof TFile) file = af;
    }
    if (!file) {
      // eslint-disable-next-line no-console
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: failed to open file', e);
    }
  }
}

class Graph2DController {
  private app: App;
  private containerEl: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer2D | null = null;
  private graph: GraphData | null = null;
  private adjacency: Map<string, string[]> | null = null;
  private onNodeClick: ((node: any) => void) | null = null;
  private plugin: Plugin;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private mouseClickHandler: ((e: MouseEvent) => void) | null = null;
  private simulation: Simulation | null = null;
  private animationFrame: number | null = null;
  private lastTime: number | null = null;
  private running: boolean = false;
  private settingsUnregister: (() => void) | null = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = createRenderer2D({ canvas, glow: (this.plugin as any).settings?.glow });

    this.graph = await buildGraph(this.app);

    this.adjacency = new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!this.adjacency.has(e.sourceId)) this.adjacency.set(e.sourceId, []);
        if (!this.adjacency.has(e.targetId)) this.adjacency.set(e.targetId, []);
        this.adjacency.get(e.sourceId)!.push(e.targetId);
        this.adjacency.get(e.targetId)!.push(e.sourceId);
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
      centerOnLargestNode: true,
    });
    this.renderer.resize(rect.width || 300, rect.height || 200);

    let centerNodeId: string | undefined = undefined;
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
      Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY, centerNodeId })
    );

    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);

    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleHover(x, y);
    };

    this.mouseLeaveHandler = () => this.clearHover();

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);

    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if ((this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(glow);
            this.renderer.render();
          }
          const phys = (this.plugin as any).settings.physics;
          if (this.simulation && phys && (this.simulation as any).setOptions) {
            (this.simulation as any).setOptions(phys);
          }
        }
      });
    }
  }

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    this.lastTime = timestamp;
    if (this.simulation) this.simulation.tick(dt);
    if (this.renderer) this.renderer.render();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && (this.simulation as any).setOptions) {
      (this.simulation as any).setOptions({ centerX, centerY });
    }
  }

  destroy(): void {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.simulation) { try { this.simulation.stop(); } catch (e) {} this.simulation = null; }
    if (this.animationFrame) { try { cancelAnimationFrame(this.animationFrame); } catch (e) {} this.animationFrame = null; this.lastTime = null; this.running = false; }
    this.onNodeClick = null;
    if (this.settingsUnregister) { try { this.settingsUnregister(); } catch (e) {} this.settingsUnregister = null; }
  }

  setNodeClickHandler(handler: ((node: any) => void) | null) { this.onNodeClick = handler; }

  private hitTestNode(x: number, y: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  handleClick(x: number, y: number): void { if (!this.graph || !this.onNodeClick) return; const node = this.hitTestNode(x, y); if (!node) return; try { this.onNodeClick(node); } catch (e) { console.error('Graph2DController.onNodeClick handler error', e); } }

  handleHover(x: number, y: number): void {
    if (!this.graph || !this.renderer) return;
    let closest: any = null; let closestDist = Infinity; const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x; const dy = y - node.y; const distSq = dx*dx + dy*dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    const newId = closest ? closest.id : null;
    const depth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = new Set<string>(); if (newId) highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q: Array<{ id: string; d: number }> = [{ id: newId, d: 0 }];
      const seen = new Set<string>([newId]);
      while (q.length > 0) {
        const cur = q.shift()!; if (cur.d > 0) highlightSet.add(cur.id);
        if (cur.d >= depth) continue; const neighbors = this.adjacency.get(cur.id) || [];
        for (const nb of neighbors) { if (!seen.has(nb)) { seen.add(nb); q.push({ id: nb, d: cur.d + 1 }); } }
      }
    }
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(newId, highlightSet, x, y);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(newId);
    this.renderer.render();
  }

  clearHover(): void { if (!this.renderer) return; if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0); if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(null); this.renderer.render(); }
}

import { App, ItemView, WorkspaceLeaf, Plugin, TFile } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D } from './graph/layout2d.ts';
import { createRenderer2D, Renderer2D } from './graph/renderer2d.ts';
import { createSimulation, Simulation } from './graph/simulation.ts';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GREATER_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Greater Graph';
  }

  getIcon(): string {
    return 'dot-network';
  }

  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: 'greater-graph-view' });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
    // wire node click -> open note
    if (this.controller) {
      this.controller.setNodeClickHandler((node: any) => {
        // open file for node
        // fire-and-forget
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

  private async openNodeFile(node: any): Promise<void> {
    if (!node) return;
    const app = this.app;

    let file: TFile | null = null;
    if ((node as any).file) {
      file = (node as any).file as TFile;
    } else if ((node as any).filePath) {
      const af = app.vault.getAbstractFileByPath((node as any).filePath);
      if (af instanceof TFile) file = af;
    }

    if (!file) {
      // couldn't resolve file
      // eslint-disable-next-line no-console
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }

    // open in active leaf
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: failed to open file', e);
    }
  }
}

class Graph2DController {
  private app: App;
  private containerEl: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer2D | null = null;
  private graph: GraphData | null = null;
  private adjacency: Map<string, string[]> | null = null;
  private onNodeClick: ((node: any) => void) | null = null;
  private plugin: Plugin;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private mouseClickHandler: ((e: MouseEvent) => void) | null = null;
  private simulation: Simulation | null = null;
  private animationFrame: number | null = null;
  private lastTime: number | null = null;
  private running: boolean = false;
  private settingsUnregister: (() => void) | null = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    // create canvas
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = createRenderer2D({ canvas, glow: (this.plugin as any).settings?.glow });

    // build graph
    this.graph = await buildGraph(this.app);

    // build adjacency map (undirected) for hover BFS
    this.adjacency = new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!this.adjacency.has(e.sourceId)) this.adjacency.set(e.sourceId, []);
        if (!this.adjacency.has(e.targetId)) this.adjacency.set(e.targetId, []);
        this.adjacency.get(e.sourceId)!.push(e.targetId);
        this.adjacency.get(e.targetId)!.push(e.sourceId);
      }
    }

    // initial layout + render
    const rect = this.containerEl.getBoundingClientRect();
    const centerX = (rect.width || 300) / 2;
    const centerY = (rect.height || 200) / 2;

    this.renderer.setGraph(this.graph);

    // apply layout ONCE here (center the largest node)
    layoutGraph2D(this.graph, {
      width: rect.width || 300,
      height: rect.height || 200,
      margin: 32,
      centerX,
      centerY,
      centerOnLargestNode: true,
    });

    this.renderer.resize(rect.width || 300, rect.height || 200);

    // determine center node id (largest by totalDegree)
    let centerNodeId: string | undefined = undefined;
    if (this.graph && this.graph.nodes && this.graph.nodes.length > 0) {
      let maxDeg = -Infinity;
      for (const n of this.graph.nodes) {
        if ((n.totalDegree || 0) > maxDeg) {
          maxDeg = n.totalDegree || 0;
          centerNodeId = n.id;
        }
      }
    }

    // create simulation operating on the same node objects
    this.simulation = createSimulation(
      this.graph.nodes,
      this.graph.edges,
      Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY, centerNodeId })
    );
    // start simulation and animation loop
    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);

    // mouse events for hover
    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      this.handleHover(x, y);
    };

    this.mouseLeaveHandler = () => {
      this.clearHover();
    };

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      // only handle primary (left) button
      if (ev.button !== 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      this.handleClick(x, y);
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);

    // register settings listener to apply settings live
    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if ((this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(glow);
            this.renderer.render();
          }

          const phys = (this.plugin as any).settings.physics;
          if (this.simulation && phys && (this.simulation as any).setOptions) {
            (this.simulation as any).setOptions(phys);
          }
        }
      });

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;

    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }

    let dt = (timestamp - this.lastTime) / 1000; // seconds
    // clamp dt for stability
    if (dt > 0.05) dt = 0.05; // max 50ms
    this.lastTime = timestamp;

    if (this.simulation) this.simulation.tick(dt);
    if (this.renderer) this.renderer.render();

    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
    // update simulation screen center so centering forces track the view
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && (this.simulation as any).setOptions) {
      (this.simulation as any).setOptions({ centerX, centerY });
    }
  }

  destroy(): void {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.simulation) {
      try {
        this.simulation.stop();
      } catch (e) {}
      this.simulation = null;
    }
    if (this.animationFrame) {
      try {
        cancelAnimationFrame(this.animationFrame);
      } catch (e) {}
      this.animationFrame = null;
      this.lastTime = null;
      this.running = false;
    }
    this.onNodeClick = null;
    if (this.settingsUnregister) {
      try {
        this.settingsUnregister();
      } catch (e) {
        // ignore
      }
      this.settingsUnregister = null;
    }
  }

  setNodeClickHandler(handler: ((node: any) => void) | null) {
    this.onNodeClick = handler;
  }

  private hitTestNode(x: number, y: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      const distSq = dx * dx + dy * dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit
        ? this.renderer.getNodeRadiusForHit(node)
        : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR * hitR && distSq < closestDist) {
        closestDist = distSq;
        closest = node;
      }
    }
    return closest;
  }

  handleClick(x: number, y: number): void {
    if (!this.graph || !this.onNodeClick) return;
    const node = this.hitTestNode(x, y);
    if (!node) return;
    try {
      this.onNodeClick(node);
    } catch (e) {
      // ignore handler errors
      // eslint-disable-next-line no-console
      console.error('Graph2DController.onNodeClick handler error', e);
    }
  }

  handleHover(x: number, y: number): void {
    if (!this.graph || !this.renderer) return;

    // simple hit test: find closest node within hit radius
    let closest: any = null;
    let closestDist = Infinity;
    // use a hit radius based on max node radius
    const hitPadding = 6;

    for (const node of this.graph.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      const distSq = dx * dx + dy * dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit
        ? this.renderer.getNodeRadiusForHit(node)
          // determine center node id (largest by totalDegree)
          let centerNodeId: string | undefined = undefined;
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
            Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY, centerNodeId })
          );
      }
    }

    const newId = closest ? closest.id : null;
    // compute highlight set up to configured depth
    const depth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = new Set<string>();
    if (newId) {
      highlightSet.add(newId); // ✅ include hovered node at depth 0
    }

    if (newId && this.adjacency && depth > 0) {
      const q: Array<{ id: string; d: number }> = [{ id: newId, d: 0 }];
      const seen = new Set<string>([newId]);
      while (q.length > 0) {
        const cur = q.shift()!;
        if (cur.d > 0) highlightSet.add(cur.id);
        if (cur.d >= depth) continue;
        const neighbors = this.adjacency.get(cur.id) || [];
        for (const nb of neighbors) {
          if (!seen.has(nb)) {
            seen.add(nb);
            q.push({ id: nb, d: cur.d + 1 });
          }
        }
      }
    }

    if ((this.renderer as any).setHoverState) {
      (this.renderer as any).setHoverState(newId, highlightSet, x, y);
    }
    if (this.renderer.setHoveredNode) {
      this.renderer.setHoveredNode(newId);
    }
    this.renderer.render();
  }

  clearHover(): void {
    if (!this.renderer) return;
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(null);
    this.renderer.render();
  }
}
