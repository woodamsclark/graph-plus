import { App, ItemView, WorkspaceLeaf, Plugin, TFile, Platform } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D, layoutGraph3D } from './graph/layout2d';
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
  // Camera interaction (Phase 4)
  private isOrbiting: boolean = false;
  private lastOrbitX: number = 0;
  private lastOrbitY: number = 0;
  private isMiddlePanning: boolean = false;
  private panStartX: number = 0;
  private panStartY: number = 0;
  private panStartTargetX: number = 0;
  private panStartTargetY: number = 0;
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
  // persistence
  private saveNodePositionsDebounced: (() => void) | null = null;
  // last node id that we triggered a hover preview for (to avoid retriggering)
  private lastPreviewedNodeId: string | null = null;
  // When a hover preview has been triggered and is visible, lock highlighting
  // to that node (and neighbors) until the popover disappears.
  private previewLockNodeId: string | null = null;
  private previewPollTimer: number | null = null;
  private controlsEl: HTMLElement | null = null;
  private controlsVisible: boolean = true;

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

  // Recreate the physics simulation, optionally excluding tag nodes.
  private recreateSimulation(showTags: boolean, extraOpts?: { centerX?: number; centerY?: number; centerNodeId?: string }) {
    try {
      if (this.simulation) {
        try { this.simulation.stop(); } catch (e) {}
      }
      if (!this.graph) return;
      const physOpts = Object.assign({}, (this.plugin as any).settings?.physics || {});
      const rect = this.containerEl.getBoundingClientRect();
      const centerX = (extraOpts && typeof extraOpts.centerX === 'number') ? extraOpts.centerX : rect.width / 2;
      const centerY = (extraOpts && typeof extraOpts.centerY === 'number') ? extraOpts.centerY : rect.height / 2;
      const centerNodeId = extraOpts?.centerNodeId;

      // Filter nodes/edges when tags are hidden
      let simNodes = this.graph.nodes;
      let simEdges = this.graph.edges || [];
      if (!showTags) {
        const tagSet = new Set<string>();
        simNodes = this.graph.nodes.filter((n: any) => {
          if ((n as any).type === 'tag') { tagSet.add(n.id); return false; }
          return true;
        });
        simEdges = (this.graph.edges || []).filter((e: any) => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
      }

      this.simulation = createSimulation(simNodes, simEdges, Object.assign({}, physOpts, { centerX, centerY, centerNodeId }));
      // start simulation
      try { this.simulation.start(); } catch (e) {}
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to recreate simulation', e);
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

    // create in-view controls panel
    this.createControlsPanel();

    // When creating renderer, pass glow settings and prefer explicit glowRadiusPx derived
    // from physics.mouseAttractionRadius so glow matches mouse attraction radius.
    const initialGlow = Object.assign({}, (this.plugin as any).settings?.glow || {});
    const initialPhys = (this.plugin as any).settings?.physics || {};
    if (typeof initialPhys.mouseAttractionRadius === 'number') initialGlow.glowRadiusPx = initialPhys.mouseAttractionRadius;
    this.renderer = createRenderer2D({ canvas, glow: initialGlow });
    // Apply initial render options (whether to draw mutual links as double lines)
    try {
      const drawDouble = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
      const showTags = (this.plugin as any).settings?.showTags !== false;
      if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
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
      layoutGraph3D(this.graph, {
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

    // create physics simulation (respecting showTags setting)
    const showTagsInitial = (this.plugin as any).settings?.showTags !== false;
    this.recreateSimulation(showTagsInitial, { centerX, centerY, centerNodeId });

    // read interaction settings (drag momentum / threshold)
    try {
      const interaction = (this.plugin as any).settings?.interaction || {};
      this.momentumScale = interaction.momentumScale ?? this.momentumScale;
      this.dragThreshold = interaction.dragThreshold ?? this.dragThreshold;
    } catch (e) {}

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

      // Orbit (right mouse button drag)
      if (this.isOrbiting) {
        const dx = screenX - this.lastOrbitX;
        const dy = screenY - this.lastOrbitY;
        this.lastOrbitX = screenX;
        this.lastOrbitY = screenY;
        try {
          const cam = (this.renderer as any).getCamera();
          const yawSpeed = 0.005;
          const pitchSpeed = 0.005;
          let newYaw = cam.yaw - dx * yawSpeed;
          let newPitch = cam.pitch - dy * pitchSpeed;
          const maxPitch = Math.PI / 2 - 0.1;
          const minPitch = -maxPitch;
          newPitch = Math.max(minPitch, Math.min(maxPitch, newPitch));
          (this.renderer as any).setCamera({ yaw: newYaw, pitch: newPitch });
          (this.renderer as any).render();
        } catch (e) {}
        return;
      }

      // Middle-button pan: move camera target
      if (this.isMiddlePanning) {
        const dx = screenX - this.panStartX;
        const dy = screenY - this.panStartY;
        try {
          const cam = (this.renderer as any).getCamera();
          const panSpeed = cam.distance * 0.001 / Math.max(0.0001, cam.zoom);
          const newTargetX = this.panStartTargetX - dx * panSpeed;
          const newTargetY = this.panStartTargetY + dy * panSpeed;
          (this.renderer as any).setCamera({ targetX: newTargetX, targetY: newTargetY });
          (this.renderer as any).render();
        } catch (e) {}
        return;
      }

      // Legacy 2D panning (left drag on empty) remains
      if (this.isPanning) {
        const dx = screenX - this.lastPanX;
        const dy = screenY - this.lastPanY;
        (this.renderer as any).panBy(dx, dy);
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        return;
      }

      // Default: treat as hover; pass the original event for preview modifier detection
      this.handleHover(screenX, screenY, ev);
    };

    this.mouseLeaveHandler = () => { this.clearHover(); this.lastPreviewedNodeId = null; };

    // ensure any preview poll timer is cleared when leaving the view area
    // (we intentionally don't release previewLockNodeId here; poll determines actual popover state)

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
      const factor = ev.deltaY < 0 ? 1.1 : 0.9;
      (this.renderer as any).zoomAt(ev.clientX, ev.clientY, factor);
      (this.renderer as any).render();
    };

    this.mouseDownHandler = (ev: MouseEvent) => {
      if (!this.canvas || !this.renderer) return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      // Right button -> start orbit if on empty space
      if (ev.button === 2) {
        const hitNode = this.hitTestNodeScreen(screenX, screenY);
        if (!hitNode) {
          this.isOrbiting = true;
          this.lastOrbitX = screenX;
          this.lastOrbitY = screenY;
          ev.preventDefault();
          return;
        }
      }
      // Middle button -> start camera target pan
      if (ev.button === 1) {
        try {
          const cam = (this.renderer as any).getCamera();
          this.isMiddlePanning = true;
          this.panStartX = screenX;
          this.panStartY = screenY;
          this.panStartTargetX = cam.targetX;
          this.panStartTargetY = cam.targetY;
          ev.preventDefault();
          return;
        } catch (e) {}
      }
      if (ev.button !== 0) return;
      const world = (this.renderer as any).screenToWorld(screenX, screenY);

      // initialize drag tracking
      this.hasDragged = false;
      this.preventClick = false;
      this.downScreenX = screenX;
      this.downScreenY = screenY;
      this.lastWorldX = world.x;
      this.lastWorldY = world.y;
      this.lastDragTime = performance.now();

      // Hit-test in screen coords to see if a node was clicked
      const hit = this.hitTestNodeScreen(screenX, screenY);
      if (hit) {
        // prevent dragging tag nodes for now (projected plane)
        if ((hit as any).type === 'tag') {
          this.isPanning = true;
          this.lastPanX = screenX;
          this.lastPanY = screenY;
          this.canvas.style.cursor = 'grab';
        } else {
          this.draggingNode = hit;
          // pin this node in the simulation so physics won't move it while dragging
          try { if (this.simulation && (this.simulation as any).setPinnedNodes) (this.simulation as any).setPinnedNodes(new Set([hit.id])); } catch (e) {}
          this.canvas.style.cursor = 'grabbing';
        }
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
      if (ev.button === 2) this.isOrbiting = false;
      if (ev.button === 1) this.isMiddlePanning = false;
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

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.canvas.addEventListener('mousedown', this.mouseDownHandler);
    window.addEventListener('mouseup', this.mouseUpHandler);
    this.canvas.addEventListener('contextmenu', (e) => { if (this.isOrbiting) e.preventDefault(); });

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
              const showTags = (this.plugin as any).settings?.showTags !== false;
              if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
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

  // Create floating controls panel in top-right and a gear toggle in the view
  private createControlsPanel(): void {
    try {
      // Panel container
      const panel = document.createElement('div');
      panel.style.position = 'absolute';
      panel.style.top = '8px';
      panel.style.right = '8px';
      panel.style.zIndex = '10';
      panel.style.background = 'var(--background-secondary)';
      panel.style.color = 'var(--text-normal)';
      panel.style.border = '1px solid var(--interactive-border)';
      panel.style.padding = '8px';
      panel.style.borderRadius = '6px';
      panel.style.minWidth = '220px';
      panel.style.fontSize = '12px';
      panel.style.boxShadow = 'var(--translucent-shadow)';

      // Title row with close/gear
      const title = document.createElement('div');
      title.style.display = 'flex';
      title.style.justifyContent = 'space-between';
      title.style.alignItems = 'center';
      title.style.marginBottom = '6px';
      const titleText = document.createElement('div');
      titleText.textContent = 'Graph Controls';
      titleText.style.fontWeight = '600';
      titleText.style.fontSize = '12px';
      title.appendChild(titleText);

      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Toggle graph controls');
      closeBtn.style.background = 'transparent';
      closeBtn.style.border = 'none';
      closeBtn.style.color = 'var(--text-normal)';
      closeBtn.style.cursor = 'pointer';
      closeBtn.textContent = '⚙';
      closeBtn.addEventListener('click', () => this.toggleControlsVisibility());
      title.appendChild(closeBtn);
      panel.appendChild(title);

      const makeRow = (labelText: string, inputEl: HTMLElement, resetCb?: () => void) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.marginBottom = '6px';
        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.marginRight = '8px';
        label.style.flex = '1';
        const rightWrap = document.createElement('div');
        rightWrap.style.display = 'flex';
        rightWrap.style.alignItems = 'center';
        rightWrap.style.gap = '6px';
        inputEl.style.flex = '0 0 auto';
        rightWrap.appendChild(inputEl);
        if (resetCb) {
          const rbtn = document.createElement('button');
          rbtn.type = 'button';
          rbtn.title = 'Reset to default';
          rbtn.textContent = '↺';
          rbtn.style.border = 'none';
          rbtn.style.background = 'transparent';
          rbtn.style.cursor = 'pointer';
          rbtn.addEventListener('click', (e) => {
            e.preventDefault();
            try { resetCb(); } catch (err) {}
          });
          rightWrap.appendChild(rbtn);
        }
        row.appendChild(label);
        row.appendChild(rightWrap);
        return row;
      };

      // Node color
      const nodeColor = document.createElement('input');
      nodeColor.type = 'color';
      nodeColor.value = (this.plugin as any).settings?.glow?.nodeColor || '#66ccff';
      nodeColor.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.nodeColor = (e.target as HTMLInputElement).value;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      panel.appendChild(makeRow('Node color', nodeColor, async () => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.nodeColor = undefined;
          await (this.plugin as any).saveSettings();
          // update UI: if possible clear color input to theme-derived value
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      }));

      // Edge color
      const edgeColor = document.createElement('input');
      edgeColor.type = 'color';
      edgeColor.value = (this.plugin as any).settings?.glow?.edgeColor || '#888888';
      edgeColor.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.edgeColor = (e.target as HTMLInputElement).value;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      panel.appendChild(makeRow('Edge color', edgeColor, async () => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.edgeColor = undefined;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      }));

      // Background color (in-view)
      const bgColor = document.createElement('input');
      bgColor.type = 'color';
      // allow background color to be stored at plugin.settings.glow.backgroundColor
      bgColor.value = (this.plugin as any).settings?.glow?.backgroundColor || (getComputedStyle(this.containerEl).getPropertyValue('--background-primary') || '#ffffff').trim();
      bgColor.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.backgroundColor = (e.target as HTMLInputElement).value;
          await (this.plugin as any).saveSettings();
          try { this.containerEl.style.background = (this.plugin as any).settings.glow.backgroundColor || ''; } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      panel.appendChild(makeRow('Background color', bgColor, async () => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          delete (this.plugin as any).settings.glow.backgroundColor;
          await (this.plugin as any).saveSettings();
          try { this.containerEl.style.background = ''; } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      }));

      // Node size range controls (min/max radius)
      const minSizeWrap = document.createElement('div');
      minSizeWrap.style.display = 'flex'; minSizeWrap.style.alignItems = 'center'; minSizeWrap.style.gap = '6px';
      const minRange = document.createElement('input');
      minRange.type = 'range'; minRange.min = '1'; minRange.max = '60'; minRange.step = '1';
      const curMin = (this.plugin as any).settings?.glow?.minNodeRadius ?? 4;
      minRange.value = String(curMin);
      const minLabel = document.createElement('div'); minLabel.textContent = String(minRange.value); minLabel.style.minWidth = '36px'; minLabel.style.textAlign='right';
      minRange.addEventListener('input', (e) => { minLabel.textContent = (e.target as HTMLInputElement).value; });
      minRange.addEventListener('change', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          const v = Number((e.target as HTMLInputElement).value);
          (this.plugin as any).settings.glow.minNodeRadius = v;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      minSizeWrap.appendChild(minRange); minSizeWrap.appendChild(minLabel);

      const maxSizeWrap = document.createElement('div');
      maxSizeWrap.style.display = 'flex'; maxSizeWrap.style.alignItems = 'center'; maxSizeWrap.style.gap = '6px';
      const maxRange = document.createElement('input');
      maxRange.type = 'range'; maxRange.min = '4'; maxRange.max = '120'; maxRange.step = '1';
      const curMax = (this.plugin as any).settings?.glow?.maxNodeRadius ?? 14;
      maxRange.value = String(curMax);
      const maxLabel = document.createElement('div'); maxLabel.textContent = String(maxRange.value); maxLabel.style.minWidth = '36px'; maxLabel.style.textAlign='right';
      maxRange.addEventListener('input', (e) => { maxLabel.textContent = (e.target as HTMLInputElement).value; });
      maxRange.addEventListener('change', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          const v = Number((e.target as HTMLInputElement).value);
          (this.plugin as any).settings.glow.maxNodeRadius = v;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      maxSizeWrap.appendChild(maxRange); maxSizeWrap.appendChild(maxLabel);

      // row for node size min
      panel.appendChild(makeRow('Node min radius', minSizeWrap, async () => {
        try { delete (this.plugin as any).settings.glow.minNodeRadius; await (this.plugin as any).saveSettings(); minRange.value = String(4); minLabel.textContent = minRange.value; if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
      }));
      // row for node size max
      panel.appendChild(makeRow('Node max radius', maxSizeWrap, async () => {
        try { delete (this.plugin as any).settings.glow.maxNodeRadius; await (this.plugin as any).saveSettings(); maxRange.value = String(14); maxLabel.textContent = maxRange.value; if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
      }));

      // Count duplicate links toggle
      const countDup = document.createElement('input');
      countDup.type = 'checkbox';
      countDup.checked = Boolean((this.plugin as any).settings?.countDuplicateLinks);
      countDup.addEventListener('change', async (e) => {
        try {
          (this.plugin as any).settings.countDuplicateLinks = (e.target as HTMLInputElement).checked;
          await (this.plugin as any).saveSettings();
          // rebuild graph and renderer sizing if necessary
          try { this.graph = await buildGraph(this.app, { countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks) }); if (this.renderer) (this.renderer as any).setGraph(this.graph); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      panel.appendChild(makeRow('Count duplicate links', countDup, async () => {
        try {
          (this.plugin as any).settings.countDuplicateLinks = undefined as any;
          await (this.plugin as any).saveSettings();
          try { this.graph = await buildGraph(this.app, { countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks) }); if (this.renderer) (this.renderer as any).setGraph(this.graph); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      }));

      // Show tag nodes toggle
      const showTagsChk = document.createElement('input');
      showTagsChk.type = 'checkbox';
      showTagsChk.checked = (this.plugin as any).settings?.showTags !== false;
      showTagsChk.addEventListener('change', async (e) => {
        try {
          (this.plugin as any).settings.showTags = (e.target as HTMLInputElement).checked;
          await (this.plugin as any).saveSettings();
          // update renderer visibility
          const drawDouble = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
          const showTags = (this.plugin as any).settings?.showTags !== false;
          if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
          if (this.renderer && (this.renderer as any).render) (this.renderer as any).render();
          // recreate physics to remove/add tag nodes
          try { this.recreateSimulation(showTags); } catch (e) {}
        } catch (e) {}
      });
      panel.appendChild(makeRow('Show tag nodes', showTagsChk, async () => {
        try {
          (this.plugin as any).settings.showTags = true;
          await (this.plugin as any).saveSettings();
          const drawDouble = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
          const showTags = (this.plugin as any).settings?.showTags !== false;
          if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
          if (this.renderer && (this.renderer as any).render) (this.renderer as any).render();
          try { this.recreateSimulation(showTags); } catch (e) {}
        } catch (e) {}
      }));

      // Physics settings group
      const phys = (this.plugin as any).settings?.physics || {};
      const physFields: { key: string; label: string; step?: string }[] = [
        { key: 'repulsionStrength', label: 'Repulsion', step: '1' },
        { key: 'springStrength', label: 'Spring', step: '0.01' },
        { key: 'springLength', label: 'Spring len', step: '1' },
        { key: 'centerPull', label: 'Center pull', step: '0.0001' },
        { key: 'damping', label: 'Damping', step: '0.01' },
        { key: 'mouseAttractionRadius', label: 'Attract radius', step: '1' },
        { key: 'mouseAttractionStrength', label: 'Attract strength', step: '0.01' },
        { key: 'mouseAttractionExponent', label: 'Attract exponent', step: '0.1' },
      ];
      for (const f of physFields) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';

        const range = document.createElement('input');
        range.type = 'range';
        // sensible defaults per-key
        switch (f.key) {
          case 'repulsionStrength': range.min = '0'; range.max = '10000'; range.step = '1'; break;
          case 'springStrength': range.min = '0'; range.max = '0.2'; range.step = '0.001'; break;
          case 'springLength': range.min = '10'; range.max = '500'; range.step = '1'; break;
          case 'centerPull': range.min = '0'; range.max = '0.01'; range.step = '0.0001'; break;
          case 'damping': range.min = '0'; range.max = '1'; range.step = '0.01'; break;
          case 'mouseAttractionRadius': range.min = '0'; range.max = '400'; range.step = '1'; break;
          case 'mouseAttractionStrength': range.min = '0'; range.max = '1'; range.step = '0.01'; break;
          case 'mouseAttractionExponent': range.min = '0.1'; range.max = '10'; range.step = '0.1'; break;
          default: range.min = '0'; range.max = '100'; range.step = '1';
        }
        const current = (phys as any)[f.key];
        range.value = String(Number.isFinite(current) ? current : Number(range.min));
        range.style.width = '120px';

        const valueLabel = document.createElement('div');
        valueLabel.textContent = String(range.value);
        valueLabel.style.minWidth = '48px';
        valueLabel.style.textAlign = 'right';

        range.addEventListener('input', (e) => {
          valueLabel.textContent = (e.target as HTMLInputElement).value;
        });

        range.addEventListener('change', async (e) => {
          try {
            (this.plugin as any).settings.physics = (this.plugin as any).settings.physics || {};
            const val = Number((e.target as HTMLInputElement).value);
            (this.plugin as any).settings.physics[f.key] = Number.isFinite(val) ? val : (this.plugin as any).settings.physics[f.key];
            await (this.plugin as any).saveSettings();
            try { if (this.simulation && (this.simulation as any).setOptions) (this.simulation as any).setOptions((this.plugin as any).settings.physics); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        });

        wrap.appendChild(range);
        wrap.appendChild(valueLabel);
        panel.appendChild(makeRow(f.label, wrap, async () => {
          try {
            (this.plugin as any).settings.physics = (this.plugin as any).settings.physics || {};
            delete (this.plugin as any).settings.physics[f.key];
            await (this.plugin as any).saveSettings();
            // restore UI to default from settings object if available
            const def = (this.plugin as any).settings.physics[f.key];
            range.value = def !== undefined ? String(def) : String(range.min);
            valueLabel.textContent = range.value;
            try { if (this.simulation && (this.simulation as any).setOptions) (this.simulation as any).setOptions((this.plugin as any).settings.physics); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        }));
      }

      // append to container
      this.containerEl.style.position = 'relative';
      this.containerEl.appendChild(panel);
      this.controlsEl = panel;

      // also try to add a gear to the view header area if available
      try {
        const headerActions = this.containerEl.closest('.workspace-leaf')?.querySelector('.view-header .view-actions');
        if (headerActions) {
          const hbtn = document.createElement('button');
          hbtn.className = 'mod-quiet';
          hbtn.style.marginLeft = '6px';
          hbtn.textContent = '⚙';
          hbtn.setAttribute('aria-label', 'Toggle graph controls');
          hbtn.addEventListener('click', () => this.toggleControlsVisibility());
          headerActions.appendChild(hbtn);
        }
      } catch (e) {}
    } catch (e) {
      // ignore
    }
  }

  private toggleControlsVisibility(): void {
    try {
      this.controlsVisible = !this.controlsVisible;
      if (!this.controlsEl) return;
      const panel = this.controlsEl;
      // When collapsed, keep the title row visible and hide the rest (collapse upward).
      if (!this.controlsVisible) {
        for (let i = 1; i < panel.children.length; i++) {
          const ch = panel.children[i] as HTMLElement;
          ch.dataset['__savedDisplay'] = ch.style.display || '';
          ch.style.display = 'none';
        }
        panel.style.overflow = 'hidden';
        // keep a small header height so it looks collapsed
        panel.style.maxHeight = '36px';
      } else {
        for (let i = 1; i < panel.children.length; i++) {
          const ch = panel.children[i] as HTMLElement;
          const prev = ch.dataset['__savedDisplay'] || '';
          ch.style.display = prev || '';
          delete ch.dataset['__savedDisplay'];
        }
        panel.style.overflow = '';
        panel.style.maxHeight = '';
      }
    } catch (e) {}
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
          layoutGraph3D(this.graph, {
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
    // clear any preview poll timer and lock
    try { if (this.previewPollTimer) window.clearInterval(this.previewPollTimer as number); } catch (e) {}
    this.previewPollTimer = null;
    this.previewLockNodeId = null;
    this.lastPreviewedNodeId = null;
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

  private hitTestNodeScreen(screenX: number, screenY: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any = null;
    let closestDist = Infinity;
    const hitPadding = 6;
    const scale = (this.renderer as any).getScale ? (this.renderer as any).getScale() : 1;
    for (const node of this.graph.nodes) {
      const sp = (this.renderer as any).getNodeScreenPosition ? (this.renderer as any).getNodeScreenPosition(node) : null;
      if (!sp) continue;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR = nodeRadius * Math.max(0.0001, scale) + hitPadding;
      const dx = screenX - sp.x; const dy = screenY - sp.y; const distSq = dx*dx + dy*dy;
      if (distSq <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  private isPreviewModifier(event: MouseEvent): boolean {
    try {
      if (Platform && (Platform as any).isMacOS) return Boolean(event.metaKey);
    } catch (e) {}
    return Boolean(event.ctrlKey);
  }

    // Start a small poll to detect when Obsidian's hover popover is removed from DOM.
    // While the popover exists we keep the preview lock active; when it's gone we clear it.
    private startPreviewLockMonitor(): void {
      try {
        if (this.previewPollTimer) window.clearInterval(this.previewPollTimer as number);
      } catch (e) {}
      this.previewPollTimer = window.setInterval(() => {
        try {
          const sel = '.popover.hover-popover, .hover-popover, .internal-link-popover, .internal-link-hover';
          const found = document.querySelector(sel);
          if (!found) {
            this.clearPreviewLock();
          }
        } catch (e) {
          // ignore
        }
      }, 250) as unknown as number;
    }

    private clearPreviewLock(): void {
      try {
        if (this.previewPollTimer) window.clearInterval(this.previewPollTimer as number);
      } catch (e) {}
      this.previewPollTimer = null;
      this.previewLockNodeId = null;
      this.lastPreviewedNodeId = null;
      try {
        if (this.renderer && (this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
        if (this.renderer && (this.renderer as any).setHoveredNode) (this.renderer as any).setHoveredNode(null);
        if (this.renderer && (this.renderer as any).render) (this.renderer as any).render();
      } catch (e) {}
    }

  handleClick(screenX: number, screenY: number): void {
    if (!this.graph || !this.onNodeClick || !this.renderer) return;
    const node = this.hitTestNodeScreen(screenX, screenY);
    if (!node) return;
    try { this.onNodeClick(node); } catch (e) { console.error('Graph2DController.onNodeClick handler error', e); }
  }

  handleHover(screenX: number, screenY: number, ev?: MouseEvent): void {
    if (!this.graph || !this.renderer) return;
    // don't show previews while dragging or panning
    if (this.draggingNode || this.isPanning) {
      // if user is panning/dragging, we don't want preview lock to change here
      return;
    }

    const world = (this.renderer as any).screenToWorld(screenX, screenY);

    // If a preview is locked, keep that node (and its neighbors) highlighted
    // and ignore other nodes until the preview is gone.
    let closest: any = null;
    if (this.previewLockNodeId && this.graph && this.graph.nodes) {
      closest = this.graph.nodes.find((n: any) => n.id === this.previewLockNodeId) || null;
    } else {
      let closestDist = Infinity; const hitPadding = 6;
      for (const node of this.graph.nodes) {
        const screenPos = (this.renderer as any).getNodeScreenPosition ? (this.renderer as any).getNodeScreenPosition(node) : null;
        if (!screenPos) continue;
        const radiusWorld = (this.renderer as any).getNodeRadiusForHit ? (this.renderer as any).getNodeRadiusForHit(node) : 8;
        const scale = (this.renderer as any).getScale ? (this.renderer as any).getScale() : 1;
        const r = radiusWorld * Math.max(0.0001, scale) + hitPadding;
        const dxs = (screenPos.x) - screenX;
        const dys = (screenPos.y) - screenY;
        const d = Math.sqrt(dxs * dxs + dys * dys);
        if (d < r && d < closestDist) {
          closest = node;
          closestDist = d;
        }
      }
    }

    const newId = closest ? closest.id : null;
    const depth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
    const highlightSet = new Set<string>(); if (newId) highlightSet.add(newId);
    if (newId && this.adjacency && depth > 0) {
      const q: string[] = [newId];
      const seen = new Set<string>([newId]);
      let curDepth = 0;
      while (q.length > 0 && curDepth < depth) {
        const levelSize = q.length;
        for (let i = 0; i < levelSize; i++) {
          const nid = q.shift() as string;
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

    // If preview is locked, use the locked node's actual world coords for attraction/hover center
    let hoverWorldX = world.x;
    let hoverWorldY = world.y;
    if (this.previewLockNodeId) {
      const lockedNode = this.graph.nodes.find((n: any) => n.id === this.previewLockNodeId);
      if (lockedNode) {
        hoverWorldX = lockedNode.x;
        hoverWorldY = lockedNode.y;
      }
    }

    if (this.canvas) this.canvas.style.cursor = newId ? 'pointer' : 'default';
    if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(newId, highlightSet, hoverWorldX, hoverWorldY);
    if (this.renderer.setHoveredNode) this.renderer.setHoveredNode(newId);
    this.renderer.render();

    // inform simulation of mouse world coords and hovered node so it can apply local attraction
    try { if (this.simulation && (this.simulation as any).setMouseAttractor) (this.simulation as any).setMouseAttractor(hoverWorldX, hoverWorldY, newId); } catch (e) {}

    // Handle preview modifier: trigger Obsidian's hover-link once per node when modifier held
    try {
      if (ev) {
        const previewModifier = this.isPreviewModifier(ev);
        const currentId = closest ? closest.id : null;
        if (previewModifier && closest && currentId !== this.lastPreviewedNodeId && !this.previewLockNodeId) {
          this.lastPreviewedNodeId = currentId;
          // trigger native hover preview
          try {
            this.app.workspace.trigger('hover-link', {
              event: ev,
              source: 'greater-graph',
              hoverParent: this.containerEl,
              targetEl: this.canvas,
              linktext: closest.filePath || closest.label,
              sourcePath: closest.filePath,
            } as any);
          } catch (e) {}
          // lock highlighting to this node until popover disappears
          this.previewLockNodeId = currentId;
          this.startPreviewLockMonitor();
        }
        if (!previewModifier || !closest) {
          // only clear lastPreviewedNodeId when there's no active preview lock
          if (!this.previewLockNodeId) this.lastPreviewedNodeId = null;
        }
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
