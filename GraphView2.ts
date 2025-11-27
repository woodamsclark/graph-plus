import { App, ItemView, WorkspaceLeaf, Plugin, TFile, MarkdownRenderer } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D } from './graph/layout2d';
import { createRenderer2D, Renderer2D } from './graph/renderer2d';
import { createSimulation, Simulation } from './graph/simulation';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

// Small debounce helper used for coalescing vault/metadata events
function debounce<T extends (...args: any[]) => void>(fn: T, wait = 300, immediate = false): T {
  let timeout: number | null = null;
  // eslint-disable-next-line @typescript-eslint/ban-types
  return ((...args: any[]) => {
    const later = () => {
      timeout = null;
      if (!immediate) fn(...args);
    };
    const callNow = immediate && timeout === null;
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(later, wait) as unknown as number;
    if (callNow) fn(...args);
  }) as unknown as T;
}

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;
  private scheduleGraphRefresh: (() => void) | null = null;

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
    // Debounced refresh to avoid thrashing on many vault events
    if (!this.scheduleGraphRefresh) {
      this.scheduleGraphRefresh = debounce(() => {
        try {
          this.controller?.refreshGraph();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Greater Graph: refreshGraph error', e);
        }
      }, 500, true);
    }

    // Register vault + metadata listeners so the view updates live
    // Use this.registerEvent so Obsidian will unregister them when the view closes
    this.registerEvent(this.app.vault.on('create', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    // metadataCache 'changed' fires on link/content changes
    // @ts-ignore - metadataCache typing can differ across Obsidian versions
    this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
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
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private mouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private lastDragX: number = 0;
  private lastDragY: number = 0;
  private draggingNode: any | null = null;
  private isPanning: boolean = false;
  private lastPanX: number = 0;
  private lastPanY: number = 0;
  // drag tracking for momentum and click suppression
  private hasDragged: boolean = false;
  private preventClick: boolean = false;
  private downScreenX: number = 0;
  private downScreenY: number = 0;
  private lastWorldX: number = 0;
  private lastWorldY: number = 0;
  private lastDragTime: number = 0;
  private dragVx: number = 0;
  private dragVy: number = 0;
  private momentumScale: number = 0.12;
  private dragThreshold: number = 4;
  // modifier preview state: show note preview when meta (cmd) or ctrl is held while hovering
  private modifierActive: boolean = false;
  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  private previewEl: HTMLElement | null = null;
  // persistence
  private saveNodePositionsDebounced: (() => void) | null = null;

  private saveNodePositions(): void {
    if (!this.graph) return;
    try {
      // top-level map keyed by vault name
      const allSaved: Record<string, Record<string, { x: number; y: number }>> = (this.plugin as any).settings.nodePositions || {};
      const vaultId = this.app.vault.getName();
      if (!allSaved[vaultId]) allSaved[vaultId] = {};
      const map = allSaved[vaultId];
      for (const node of this.graph.nodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        if (node.filePath) map[node.filePath] = { x: node.x, y: node.y };
      }
      (this.plugin as any).settings.nodePositions = allSaved;
      // fire-and-forget save
      try { (this.plugin as any).saveSettings && (this.plugin as any).saveSettings(); } catch (e) { console.error('Failed to save node positions', e); }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: saveNodePositions error', e);
    }
  }

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

    // When creating renderer, pass glow settings and prefer explicit glowRadiusPx derived
    // from physics.mouseAttractionRadius so glow matches mouse attraction radius.
    const initialGlow = Object.assign({}, (this.plugin as any).settings?.glow || {});
    const initialPhys = (this.plugin as any).settings?.physics || {};
    if (typeof initialPhys.mouseAttractionRadius === 'number') initialGlow.glowRadiusPx = initialPhys.mouseAttractionRadius;
    this.renderer = createRenderer2D({ canvas, glow: initialGlow });
    // Apply initial render options (whether to draw mutual links as double lines)
    try {
      const drawDouble = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
      if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble });
    } catch (e) {}

    this.graph = await buildGraph(this.app, { countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks) });

    // Restore saved positions from plugin settings (do not override saved positions)
    const vaultId = this.app.vault.getName();
    const allSaved: Record<string, Record<string, { x: number; y: number }>> = (this.plugin as any).settings?.nodePositions || {};
    const savedPositions: Record<string, { x: number; y: number }> = allSaved[vaultId] || {};
    const needsLayout: any[] = [];
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
    // Layout only nodes that don't have saved positions so user-placed nodes remain where they were.
    if (needsLayout.length > 0) {
      layoutGraph2D(this.graph, {
        width: rect.width || 300,
        height: rect.height || 200,
        margin: 32,
        centerX,
        centerY,
        centerOnLargestNode: true,
        onlyNodes: needsLayout,
      });
    } else {
      // nothing to layout; ensure renderer has size
    }
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

    // read interaction settings (drag momentum / threshold)
    try {
      const interaction = (this.plugin as any).settings?.interaction || {};
      this.momentumScale = interaction.momentumScale ?? this.momentumScale;
      this.dragThreshold = interaction.dragThreshold ?? this.dragThreshold;
    } catch (e) {}

    this.simulation.start();
    this.running = true;
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);

    // setup debounced saver for node positions
    if (!this.saveNodePositionsDebounced) {
      this.saveNodePositionsDebounced = debounce(() => this.saveNodePositions(), 2000, true);
    }

    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas || !this.renderer) return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;

      // If currently dragging a node, move it to the world coords under the cursor
      if (this.draggingNode) {
        const now = performance.now();
        const world = (this.renderer as any).screenToWorld(screenX, screenY);

        // Movement threshold for considering this a drag (in screen pixels)
        if (!this.hasDragged) {
          const dxs = screenX - this.downScreenX;
          const dys = screenY - this.downScreenY;
          if (Math.sqrt(dxs * dxs + dys * dys) > this.dragThreshold) {
            this.hasDragged = true;
            this.preventClick = true;
          }
        }

        // compute instantaneous velocity in world-space
        const dt = Math.max((now - this.lastDragTime) / 1000, 1e-6);
        this.dragVx = (world.x - this.lastWorldX) / dt;
        this.dragVy = (world.y - this.lastWorldY) / dt;

        // override node position and zero velocities so physics doesn't move it
        this.draggingNode.x = world.x;
        this.draggingNode.y = world.y;
        this.draggingNode.vx = 0;
        this.draggingNode.vy = 0;

        this.lastWorldX = world.x;
        this.lastWorldY = world.y;
        this.lastDragTime = now;

        this.renderer.render();
        // while dragging, disable the mouse attractor so physics doesn't fight the drag
        try { if (this.simulation && (this.simulation as any).setMouseAttractor) (this.simulation as any).setMouseAttractor(null, null, null); } catch (e) {}
        return;
      }

      // If panning, translate the camera
      if (this.isPanning) {
        const dx = screenX - this.lastPanX;
        const dy = screenY - this.lastPanY;
        (this.renderer as any).panBy(dx, dy);
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        return;
      }

      // Default: treat as hover
      this.handleHover(screenX, screenY);
    };

    // Key handlers for modifier (Cmd / Ctrl) to trigger previews
    this.keyDownHandler = (ev: KeyboardEvent) => {
      const was = this.modifierActive;
      this.modifierActive = Boolean(ev.metaKey || ev.ctrlKey);
      if (!was && this.modifierActive) {
        // modifier became active — if we're currently hovering a node, show preview
        try { if (this.canvas) { const r = this.canvas.getBoundingClientRect(); const mx = (this.lastPanX || 0); } } catch (e) {}
        // call handleHover to possibly show preview for the currently hovered node
        if (this.canvas) {
          const ev2 = (window as any).lastMouseEvent as MouseEvent | undefined;
          if (ev2) {
            const r = this.canvas.getBoundingClientRect();
            const screenX = ev2.clientX - r.left;
            const screenY = ev2.clientY - r.top;
            this.handleHover(screenX, screenY);
          }
        }
      }
    };

    this.keyUpHandler = (ev: KeyboardEvent) => {
      const was = this.modifierActive;
      this.modifierActive = Boolean(ev.metaKey || ev.ctrlKey);
      // If modifier released, hide preview
      if (was && !this.modifierActive) this.hideNotePreview();
    };
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);

    this.mouseLeaveHandler = () => this.clearHover();

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;
      // If a recent drag occurred, suppress this click
      if (this.preventClick) {
        this.preventClick = false;
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };

    this.wheelHandler = (ev: WheelEvent) => {
      if (!this.canvas || !this.renderer) return;
      ev.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const factor = ev.deltaY < 0 ? 1.1 : 0.9;
      (this.renderer as any).zoomAt(x, y, factor);
      (this.renderer as any).render();
    };

    this.mouseDownHandler = (ev: MouseEvent) => {
      if (!this.canvas || ev.button !== 0 || !this.renderer) return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      const world = (this.renderer as any).screenToWorld(screenX, screenY);

      // initialize drag tracking
      this.hasDragged = false;
      this.preventClick = false;
      this.downScreenX = screenX;
      this.downScreenY = screenY;
      this.lastWorldX = world.x;
      this.lastWorldY = world.y;
      this.lastDragTime = performance.now();

      // Hit-test in world coords to see if a node was clicked
      const hit = this.hitTestNode(world.x, world.y);
      if (hit) {
        this.draggingNode = hit;
        // pin this node in the simulation so physics won't move it while dragging
        try { if (this.simulation && (this.simulation as any).setPinnedNodes) (this.simulation as any).setPinnedNodes(new Set([hit.id])); } catch (e) {}
        this.canvas.style.cursor = 'grabbing';
      } else {
        // start panning
        this.isPanning = true;
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        this.canvas.style.cursor = 'grab';
      }
    };

    this.mouseUpHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;

      // If we were dragging a node, apply momentum if it was dragged
      if (this.draggingNode) {
        if (this.hasDragged) {
          try {
            this.draggingNode.vx = this.dragVx * this.momentumScale;
            this.draggingNode.vy = this.dragVy * this.momentumScale;
          } catch (e) {}
        }
        // unpin node so physics resumes
        try { if (this.simulation && (this.simulation as any).setPinnedNodes) (this.simulation as any).setPinnedNodes(new Set()); } catch (e) {}
      }

      // reset dragging / panning state
      this.isPanning = false;
      this.draggingNode = null;
      // preventClick remains true if a drag occurred; click handler will clear it
      this.canvas.style.cursor = 'default';
      // save positions after a drag ends (debounced)
      try { if (this.saveNodePositionsDebounced) this.saveNodePositionsDebounced(); } catch (e) {}
    };

    // track last mouse event globally for keyboard-triggered previews
    window.addEventListener('mousemove', (e: MouseEvent) => { (window as any).lastMouseEvent = e; });

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.canvas.addEventListener('mousedown', this.mouseDownHandler);
    window.addEventListener('mouseup', this.mouseUpHandler);

    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if ((this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            // ensure glow radius matches physics mouse attraction radius
            const phys = (this.plugin as any).settings?.physics || {};
            const glowWithRadius = Object.assign({}, glow || {});
            if (typeof phys.mouseAttractionRadius === 'number') glowWithRadius.glowRadiusPx = phys.mouseAttractionRadius;
            (this.renderer as any).setGlowSettings(glowWithRadius);
            // update mutual-line rendering option too
            try {
              const drawDouble = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
              if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble });
            } catch (e) {}
            this.renderer.render();
          }
          const phys = (this.plugin as any).settings.physics;
          if (this.simulation && phys && (this.simulation as any).setOptions) {
            (this.simulation as any).setOptions(phys);
          }
          // update interaction settings live
          try {
            const interaction = (this.plugin as any).settings?.interaction || {};
            this.momentumScale = interaction.momentumScale ?? this.momentumScale;
            this.dragThreshold = interaction.dragThreshold ?? this.dragThreshold;
          } catch (e) {}
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
    // periodically persist node positions (debounced)
    try { if (this.saveNodePositionsDebounced) this.saveNodePositionsDebounced(); } catch (e) {}
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

  // Rebuilds the graph and restarts the simulation. Safe to call repeatedly.
  async refreshGraph(): Promise<void> {
    // If the controller has been destroyed or no canvas, abort
    if (!this.canvas) return;
    try {
      const newGraph = await buildGraph(this.app, { countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks) });
      this.graph = newGraph;

      // Restore saved positions for the new graph as with init
      const vaultId = this.app.vault.getName();
      const allSaved: Record<string, Record<string, { x: number; y: number }>> = (this.plugin as any).settings?.nodePositions || {};
      const savedPositions: Record<string, { x: number; y: number }> = allSaved[vaultId] || {};
      const needsLayout: any[] = [];
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

      // rebuild adjacency
      this.adjacency = new Map<string, string[]>();
      if (this.graph && this.graph.edges) {
        for (const e of this.graph.edges) {
          if (!this.adjacency.has(e.sourceId)) this.adjacency.set(e.sourceId, []);
          if (!this.adjacency.has(e.targetId)) this.adjacency.set(e.targetId, []);
          this.adjacency.get(e.sourceId)!.push(e.targetId);
          this.adjacency.get(e.targetId)!.push(e.sourceId);
        }
      }

      // layout using current size and center
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
            onlyNodes: needsLayout,
          });
        }
        this.renderer.resize(width, height);
      }

      // recreate simulation using new nodes/edges
      if (this.simulation) {
        try { this.simulation.stop(); } catch (e) {}
        this.simulation = null;
      }

      this.simulation = createSimulation(
        (this.graph && this.graph.nodes) || [],
        (this.graph && this.graph.edges) || [],
        Object.assign({}, (this.plugin as any).settings?.physics || {}, { centerX, centerY })
      );

      this.simulation.start();

      // force a render
      if (this.renderer) this.renderer.render();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Greater Graph: failed to refresh graph', e);
    }
  }

  destroy(): void {
    // persist positions immediately when view is closed
    try { this.saveNodePositions(); } catch (e) {}
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

  private async showNotePreviewForNode(node: any) {
    if (!node || !node.file) return;
    if (!this.canvas || !this.renderer) return;
    // create preview element if needed
    if (!this.previewEl) {
      this.previewEl = document.createElement('div');
      this.previewEl.className = 'greater-graph-note-preview';
      // basic styling; themes can override in CSS
      Object.assign(this.previewEl.style, {
        position: 'absolute',
        zIndex: '9999',
        background: 'var(--background-primary, #fff)',
        color: 'var(--text-normal, #000)',
        border: '1px solid var(--interactive-border, rgba(0,0,0,0.08))',
        boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
        padding: '8px',
        borderRadius: '6px',
        maxWidth: '420px',
        maxHeight: '360px',
        overflow: 'auto',
      });
      this.containerEl.appendChild(this.previewEl);
    }

    try {
      const file: TFile = node.file as TFile;
      const md = await this.app.vault.read(file);
      // clear previous
      this.previewEl.innerHTML = '';
      // render markdown into preview element using plugin as component
      await MarkdownRenderer.render(md, this.previewEl, file.path, this.plugin as any);
    } catch (e) {
      // fallback: show filename
      this.previewEl!.innerText = node.label || (node.filePath || 'Preview');
    }

    // position preview near node screen coords
    try {
      const ws = (this.renderer as any).worldToScreen ? (this.renderer as any).worldToScreen(node.x, node.y) : { x: node.x, y: node.y };
      // offset slightly to the right and above
      const left = Math.round(ws.x + 12);
      const top = Math.round(ws.y - 12);
      // ensure within container bounds
      const rect = this.containerEl.getBoundingClientRect();
      const maxLeft = rect.width - 24;
      const maxTop = rect.height - 24;
      this.previewEl.style.left = Math.min(left, maxLeft) + 'px';
      this.previewEl.style.top = Math.max(4, Math.min(top, maxTop)) + 'px';
    } catch (e) {}
  }

  private hideNotePreview() {
    if (this.previewEl && this.previewEl.parentElement) {
      try { this.previewEl.parentElement.removeChild(this.previewEl); } catch (e) {}
    }
    this.previewEl = null;
  }

  handleClick(screenX: number, screenY: number): void {
    if (!this.graph || !this.onNodeClick || !this.renderer) return;
    const world = (this.renderer as any).screenToWorld(screenX, screenY);
    const node = this.hitTestNode(world.x, world.y);
    if (!node) return;
    try { this.onNodeClick(node); } catch (e) { console.error('Graph2DController.onNodeClick handler error', e); }
  }

  handleHover(screenX: number, screenY: number): void {
    if (!this.graph || !this.renderer) return;
    const world = (this.renderer as any).screenToWorld(screenX, screenY);
    let closest: any = null; let closestDist = Infinity; const hitPadding = 6;
    for (const node of this.graph.nodes) {
      const dx = world.x - node.x; const dy = world.y - node.y; const distSq = dx*dx + dy*dy;
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
    if (this.canvas) this.canvas.style.cursor = newId ? 'pointer' : 'default';
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(newId, highlightSet, world.x, world.y);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(newId);
    this.renderer.render();
    // inform simulation of mouse world coords and hovered node so it can apply local attraction
    try { if (this.simulation && (this.simulation as any).setMouseAttractor) (this.simulation as any).setMouseAttractor(world.x, world.y, newId); } catch (e) {}

    // If modifier key is active and there's a hovered node, show preview; otherwise hide
    try {
      if (this.modifierActive && newId) {
        const node = this.graph!.nodes.find((n) => n.id === newId);
        if (node) this.showNotePreviewForNode(node);
      } else {
        this.hideNotePreview();
      }
    } catch (e) {}
  }

  clearHover(): void {
    if (!this.renderer) return;
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(null);
    this.renderer.render();
    try { if (this.simulation && (this.simulation as any).setMouseAttractor) (this.simulation as any).setMouseAttractor(null, null, null); } catch (e) {}
  }
}
