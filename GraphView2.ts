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
    // Debounced refresh to avoid thrashing on vault events
    if (!this.scheduleGraphRefresh) {
      this.scheduleGraphRefresh = debounce(() => {
        try {
          this.controller?.refreshGraph();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Greater Graph: refreshGraph error', e);
        }
      }, 200, true);
    }

    // Register only structural vault listeners so the view updates on file changes,
    // not on every keystroke/content metadata parse.
    // Use this.registerEvent so Obsidian will unregister them when the view closes
    this.registerEvent(this.app.vault.on('create', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    // Note: We intentionally do NOT rebuild on metadataCache 'changed' to avoid refreshes
    // while typing. Optional incremental updates can hook into metadata changes separately.
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
  private dragStartDepth: number = 0;
  private dragOffsetWorld: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
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
  // pending right-click focus state
  private pendingFocusNode: any | null = null;
  private pendingFocusDownX: number = 0;
  private pendingFocusDownY: number = 0;
  // camera follow / animation state
  private cameraAnimStart: number | null = null;
  private cameraAnimDuration: number = 300; // ms
  private cameraAnimFrom: any = null;
  private cameraAnimTo: any = null;
  private isCameraFollowing: boolean = false;
  private cameraFollowNode: any | null = null;
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
  private controlsVisible: boolean = false; // start minimized by default
  // Screen-space tracking for cursor attractor
  private lastMouseX: number | null = null;
  private lastMouseY: number | null = null;
  // When true, skip running the cursor attractor until the next mousemove event
  private suppressAttractorUntilMouseMove: boolean = false;
  // Simple camera follow flag
  private followLockedNodeId: string | null = null;
  // Center node and camera defaults
  private centerNode: any | null = null;
  private defaultCameraDistance: number = 1200;
  private lastUsePinnedCenterNote: boolean = false;
  private lastPinnedCenterNotePath: string = '';
  private viewCenterX: number = 0;
  private viewCenterY: number = 0;

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
    try {
      const cam0 = (this.renderer as any).getCamera?.();
      if (cam0 && typeof cam0.distance === 'number') this.defaultCameraDistance = cam0.distance;
    } catch (e) {}
    // Apply initial render options (whether to draw mutual links as double lines)
    try {
      const drawDouble = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
      const showTags = (this.plugin as any).settings?.showTags !== false;
      if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
    } catch (e) {}

    // track center selection settings for change detection
    this.lastUsePinnedCenterNote = Boolean((this.plugin as any).settings?.usePinnedCenterNote);
    this.lastPinnedCenterNotePath = String((this.plugin as any).settings?.pinnedCenterNotePath || '');

    this.graph = await buildGraph(this.app, {
      countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks),
      usePinnedCenterNote: Boolean((this.plugin as any).settings?.usePinnedCenterNote),
      pinnedCenterNotePath: String((this.plugin as any).settings?.pinnedCenterNotePath || ''),
      useOutlinkFallback: Boolean((this.plugin as any).settings?.useOutlinkFallback),
    } as any);

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
      // centerNode will be positioned after we compute the view center (below)
      this.centerNode = this.graph.nodes.find((n: any) => (n as any).isCenterNode) || null;
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
    // record view center for consistent camera resets and locking
    this.viewCenterX = centerX;
    this.viewCenterY = centerY;

    this.renderer.setGraph(this.graph);
    // Layout only nodes that don't have saved positions so user-placed nodes remain where they were.
    if (needsLayout.length > 0) {
      layoutGraph3D(this.graph, {
        width: rect.width || 300,
        height: rect.height || 200,
        margin: 32,
        centerX,
        centerY,
        centerOnLargestNode: Boolean((this.plugin as any).settings?.usePinnedCenterNote),
        onlyNodes: needsLayout,
      });
    } else {
      // nothing to layout; ensure renderer has size
    }
    // Ensure the center node (if any) is placed at the view center
    if (this.centerNode) { this.centerNode.x = centerX; this.centerNode.y = centerY; this.centerNode.z = 0; }
    this.renderer.resize(rect.width || 300, rect.height || 200);

    // Use the explicitly chosen center node (when pinned mode is enabled) as
    // the simulation's centerNodeId. If none was chosen, don't pin a center node.
    const centerNodeId = this.centerNode ? this.centerNode.id : undefined;

    // create physics simulation (respecting showTags setting)
    const showTagsInitial = (this.plugin as any).settings?.showTags !== false;
    this.recreateSimulation(showTagsInitial, { centerX, centerY, centerNodeId });

    // Center camera on initial load same as a right-click origin focus would do.
    try {
      if ((this.renderer as any).setCamera) (this.renderer as any).setCamera({ targetX: this.viewCenterX ?? 0, targetY: this.viewCenterY ?? 0, targetZ: 0, distance: this.defaultCameraDistance });
    } catch (e) {}
    try { if ((this.renderer as any).resetPanToCenter) (this.renderer as any).resetPanToCenter(); } catch (e) {}
    // Clear any follow/preview locks and reset hover state so initial view is clean
    this.followLockedNodeId = null; this.previewLockNodeId = null;
    try {
      if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
      if ((this.renderer as any).setHoveredNode) (this.renderer as any).setHoveredNode(null);
      (this.renderer as any).render?.();
    } catch (e) {}
    // Suppress the cursor attractor until the user moves the mouse (matches right-click behavior)
    this.suppressAttractorUntilMouseMove = true;

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
      // track last mouse position in screen space for attractor
      this.lastMouseX = screenX;
      this.lastMouseY = screenY;
      // Re-enable the cursor attractor after any programmatic camera move
      this.suppressAttractorUntilMouseMove = false;

      // If currently dragging a node, move it to the world coords under the cursor
      if (this.draggingNode) {
        const now = performance.now();
        // map screen -> world at the stored camera-space depth so dragging respects yaw/pitch
        let world: any = null;
        try {
          const cam = (this.renderer as any).getCamera();
          const width = this.canvas ? this.canvas.width : (this.containerEl.getBoundingClientRect().width || 300);
          const height = this.canvas ? this.canvas.height : (this.containerEl.getBoundingClientRect().height || 200);
          if ((this.renderer as any).screenToWorldAtDepth) {
            world = (this.renderer as any).screenToWorldAtDepth(screenX, screenY, this.dragStartDepth, width, height, cam);
          } else {
            world = (this.renderer as any).screenToWorld(screenX, screenY);
          }
        } catch (e) {
          world = (this.renderer as any).screenToWorld(screenX, screenY);
        }

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
        this.dragVx = ((world.x + this.dragOffsetWorld.x) - this.lastWorldX) / dt;
        this.dragVy = ((world.y + this.dragOffsetWorld.y) - this.lastWorldY) / dt;

        // override node position and zero velocities so physics doesn't move it
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
        // while dragging, disable the mouse attractor so physics doesn't fight the drag
        try { if (this.simulation && (this.simulation as any).setMouseAttractor) (this.simulation as any).setMouseAttractor(null, null, null); } catch (e) {}
        return;
      }

      // If right-button is held and we had a pending focus, treat sufficient movement as orbit start
      try {
        if ((ev.buttons & 2) === 2 && this.pendingFocusNode) {
          const dx = screenX - this.pendingFocusDownX;
          const dy = screenY - this.pendingFocusDownY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const dragThreshold = 8;
          if (dist > dragThreshold) {
            // begin orbiting and cancel the pending focus
            this.isOrbiting = true;
            // set lastOrbit to the original down position so motion is continuous
            this.lastOrbitX = this.pendingFocusDownX;
            this.lastOrbitY = this.pendingFocusDownY;
            // clear pending focus
            this.pendingFocusNode = null;
            // cancel following if active
            if (this.isCameraFollowing) { this.isCameraFollowing = false; this.cameraFollowNode = null; }
          }
        }
      } catch (e) {}

      // Orbit (right mouse button drag)
      if (this.isOrbiting) {
        // keep hover/follow lock while orbiting; only adjust yaw/pitch
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
        // user interaction cancels camera following
        if (this.isCameraFollowing) { this.isCameraFollowing = false; this.cameraFollowNode = null; }
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
        // user interaction cancels camera following
        this.followLockedNodeId = null; this.previewLockNodeId = null;
        const dx = screenX - this.lastPanX;
        const dy = screenY - this.lastPanY;
        (this.renderer as any).panBy(dx, dy);
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        return;
      }

      // Default: treat as hover; pass the original event for preview modifier detection
      this.updateHoverFromCoords(screenX, screenY, ev);
    };

    this.mouseLeaveHandler = () => { this.clearHover(); this.lastPreviewedNodeId = null; };
    // on leave, clear last mouse
    this.lastMouseX = null; this.lastMouseY = null;

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
      try {
        // any user wheel action cancels camera following but should NOT cancel
        // the preview hover lock so highlighting remains while zooming.
        this.followLockedNodeId = null;
        const cam = (this.renderer as any).getCamera();
        const zoomSpeed = 0.0015;
        const factor = Math.exp(ev.deltaY * zoomSpeed);
        let distance = (cam.distance || 1000) * factor;
        distance = Math.max(200, Math.min(8000, distance));
        (this.renderer as any).setCamera({ distance });
        (this.renderer as any).render();
      } catch (e) {}
    };

    this.mouseDownHandler = (ev: MouseEvent) => {
      if (!this.canvas || !this.renderer) return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      // Right button -> either mark pending focus on node or pending focus on empty (origin)
      // We don't start orbit immediately; if the user drags beyond a threshold we'll begin orbiting.
      if (ev.button === 2) {
        const hitNode = this.hitTestNodeScreen(screenX, screenY);
        if (hitNode) {
          // pending focus on this node
          this.pendingFocusNode = hitNode;
          this.pendingFocusDownX = screenX;
          this.pendingFocusDownY = screenY;
          ev.preventDefault();
          return;
        } else {
          // pending focus to reset to origin (0,0,0) if click (no drag)
          this.pendingFocusNode = '__origin__';
          this.pendingFocusDownX = screenX;
          this.pendingFocusDownY = screenY;
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
          // begin 3D-aware drag: compute camera-space depth and world offset at click
          this.draggingNode = hit;
          try {
            const cam = (this.renderer as any).getCamera();
            const proj = (this.renderer as any).getProjectedNode ? (this.renderer as any).getProjectedNode(hit) : null;
            const depth = proj ? proj.depth : 1000;
            this.dragStartDepth = depth;
            const width = this.canvas ? this.canvas.width : (this.containerEl.getBoundingClientRect().width || 300);
            const height = this.canvas ? this.canvas.height : (this.containerEl.getBoundingClientRect().height || 200);
            const screenXClient = proj ? proj.x : screenX;
            const screenYClient = proj ? proj.y : screenY;
            const worldAtCursor = (this.renderer as any).screenToWorldAtDepth ? (this.renderer as any).screenToWorldAtDepth(screenXClient, screenYClient, depth, width, height, cam) : (this.renderer as any).screenToWorld(screenXClient, screenYClient);
            this.dragOffsetWorld = {
              x: (hit.x || 0) - (worldAtCursor.x || 0),
              y: (hit.y || 0) - (worldAtCursor.y || 0),
              z: (hit.z || 0) - (worldAtCursor.z || 0),
            };
            // pin this node in the simulation so physics won't move it while dragging
            try { if (this.simulation && (this.simulation as any).setPinnedNodes) (this.simulation as any).setPinnedNodes(new Set([hit.id])); } catch (e) {}
          } catch (e) {
            this.dragOffsetWorld = { x: 0, y: 0, z: 0 };
          }
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
      if (ev.button === 2) {
        // consume pending focus click if present
        if (this.pendingFocusNode) {
          const dx = ev.clientX - (this.canvas.getBoundingClientRect().left + this.pendingFocusDownX);
          const dy = ev.clientY - (this.canvas.getBoundingClientRect().top + this.pendingFocusDownY);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clickThreshold = 8;
          if (dist <= clickThreshold) {
            try {
              if (this.pendingFocusNode === '__origin__') {
                // Animate focus to origin; clear follow/highlight; keep a sane default distance
                try {
                  if (this.renderer) {
                    const cam = (this.renderer as any).getCamera();
                    const from = {
                      targetX: cam.targetX ?? 0,
                      targetY: cam.targetY ?? 0,
                      targetZ: cam.targetZ ?? 0,
                      distance: cam.distance ?? 1000,
                      yaw: cam.yaw ?? 0,
                      pitch: cam.pitch ?? 0,
                    };
                    const to = {
                      targetX: this.viewCenterX ?? 0,
                      targetY: this.viewCenterY ?? 0,
                      targetZ: 0,
                      distance: this.defaultCameraDistance,
                      yaw: from.yaw,
                      pitch: from.pitch,
                    };
                    this.cameraAnimStart = performance.now();
                    this.cameraAnimDuration = 300;
                    this.cameraAnimFrom = from;
                    this.cameraAnimTo = to;
                    // clear any follow locks
                    this.isCameraFollowing = false;
                    this.cameraFollowNode = null;
                  }
                } catch (e) {}
                try { if ((this.renderer as any).resetPanToCenter) (this.renderer as any).resetPanToCenter(); } catch (e) {}
                this.followLockedNodeId = null; this.previewLockNodeId = null;
                try {
                  if ((this.renderer as any).setHoverState) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
                  if ((this.renderer as any).setHoveredNode) (this.renderer as any).setHoveredNode(null);
                  (this.renderer as any).render?.();
                } catch (e) {}
                // suppress the cursor attractor until user next moves the mouse
                this.suppressAttractorUntilMouseMove = true;
              } else {
                // Center camera onto node using animated focus helper; lock hover + follow until user drags/another right-click
                const n = this.pendingFocusNode;
                try {
                  this.focusCameraOnNode(n);
                } catch (e) {}
                try { if ((this.renderer as any).resetPanToCenter) (this.renderer as any).resetPanToCenter(); } catch (e) {}
                this.followLockedNodeId = n.id;
                this.previewLockNodeId = n.id;
                // suppress the cursor attractor until user next moves the mouse
                this.suppressAttractorUntilMouseMove = true;
              }
            } catch (e) {}
          }
          this.pendingFocusNode = null;
        }
        this.isOrbiting = false;
      }
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
    this.canvas.addEventListener('contextmenu', (e) => { if (this.isOrbiting || this.pendingFocusNode) e.preventDefault(); });

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

          // If center selection settings changed, rebuild graph
          try {
            const usePinned = Boolean((this.plugin as any).settings?.usePinnedCenterNote);
            const pinnedPath = String((this.plugin as any).settings?.pinnedCenterNotePath || '');
            if (usePinned !== this.lastUsePinnedCenterNote || pinnedPath !== this.lastPinnedCenterNotePath) {
              this.lastUsePinnedCenterNote = usePinned;
              this.lastPinnedCenterNotePath = pinnedPath;
              // schedule a graph refresh
              this.refreshGraph();
            }
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
      // Resolve theme-derived node color (prefer canvas vars if available)
      let themeNodeColor = '#66ccff';
      try {
        const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
        const nodeVar = cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
        if (nodeVar && nodeVar.trim()) themeNodeColor = nodeVar.trim();
      } catch (e) {}
      nodeColor.value = (this.plugin as any).settings?.glow?.nodeColor || themeNodeColor;
      const nodeColorWrap = document.createElement('div');
      nodeColorWrap.style.display = 'flex'; nodeColorWrap.style.alignItems = 'center'; nodeColorWrap.style.gap = '6px';
      const nodeAlpha = document.createElement('input');
      nodeAlpha.type = 'number'; nodeAlpha.min = '0'; nodeAlpha.max = '1'; nodeAlpha.step = '0.01';
      nodeAlpha.value = String((this.plugin as any).settings?.glow?.nodeColorAlpha ?? 0.1);
      nodeAlpha.style.width = '64px';
      nodeColor.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.nodeColor = (e.target as HTMLInputElement).value;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      nodeAlpha.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          const v = Number((e.target as HTMLInputElement).value);
          (this.plugin as any).settings.glow.nodeColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1.0;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      nodeColorWrap.appendChild(nodeColor); nodeColorWrap.appendChild(nodeAlpha);
      panel.appendChild(makeRow('Node color', nodeColorWrap, async () => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
            delete (this.plugin as any).settings.glow.nodeColor;
          delete (this.plugin as any).settings.glow.nodeColorAlpha;
          await (this.plugin as any).saveSettings();
          // reset input display to theme color
          try {
            const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
            const nodeVar = cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
            nodeColor.value = (nodeVar && nodeVar.trim()) ? nodeVar.trim() : '#66ccff';
            nodeAlpha.value = String(1.0);
          } catch (e) { nodeColor.value = '#66ccff'; }
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      }));

      // Edge color
      const edgeColor = document.createElement('input');
      edgeColor.type = 'color';
      // Resolve theme-derived edge color
      let themeEdgeColor = '#888888';
      try {
        const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
        const edgeVar = cs.getPropertyValue('--text-muted') || cs.getPropertyValue('--text-faint') || cs.getPropertyValue('--text-normal');
        if (edgeVar && edgeVar.trim()) themeEdgeColor = edgeVar.trim();
      } catch (e) {}
      edgeColor.value = (this.plugin as any).settings?.glow?.edgeColor || themeEdgeColor;
      const edgeColorWrap = document.createElement('div');
      edgeColorWrap.style.display = 'flex'; edgeColorWrap.style.alignItems = 'center'; edgeColorWrap.style.gap = '6px';
      const edgeAlpha = document.createElement('input'); edgeAlpha.type = 'number'; edgeAlpha.min = '0'; edgeAlpha.max = '1'; edgeAlpha.step = '0.01';
      edgeAlpha.value = String((this.plugin as any).settings?.glow?.edgeColorAlpha ?? 0.1); edgeAlpha.style.width = '64px';
      edgeColor.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          (this.plugin as any).settings.glow.edgeColor = (e.target as HTMLInputElement).value;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      edgeAlpha.addEventListener('input', async (e) => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          const v = Number((e.target as HTMLInputElement).value);
          (this.plugin as any).settings.glow.edgeColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1.0;
          await (this.plugin as any).saveSettings();
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      edgeColorWrap.appendChild(edgeColor); edgeColorWrap.appendChild(edgeAlpha);
      panel.appendChild(makeRow('Edge color', edgeColorWrap, async () => {
        try {
          (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
          delete (this.plugin as any).settings.glow.edgeColor;
          delete (this.plugin as any).settings.glow.edgeColorAlpha;
          await (this.plugin as any).saveSettings();
          // reset input display to theme color
          try {
            const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
            const edgeVar = cs.getPropertyValue('--text-muted') || cs.getPropertyValue('--text-faint') || cs.getPropertyValue('--text-normal');
            edgeColor.value = (edgeVar && edgeVar.trim()) ? edgeVar.trim() : '#888888';
            edgeAlpha.value = String(1.0);
          } catch (e) { edgeColor.value = '#888888'; }
          try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      }));

        // Tag color
        const tagColor = document.createElement('input');
        tagColor.type = 'color';
        // Resolve theme-derived tag color from secondary/accent vars (fallback to purple)
        let themeTagColor = '#8000ff';
        try {
          const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
          const nodeVar = cs.getPropertyValue('--accent-2') || cs.getPropertyValue('--accent-secondary') || cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
          if (nodeVar && nodeVar.trim()) themeTagColor = nodeVar.trim();
        } catch (e) {}
        tagColor.value = (this.plugin as any).settings?.glow?.tagColor || themeTagColor;
        const tagWrap = document.createElement('div'); tagWrap.style.display='flex'; tagWrap.style.alignItems='center'; tagWrap.style.gap='6px';
        const tagAlpha = document.createElement('input'); tagAlpha.type='number'; tagAlpha.min='0'; tagAlpha.max='1'; tagAlpha.step='0.01'; tagAlpha.value = String((this.plugin as any).settings?.glow?.tagColorAlpha ?? 0.1); tagAlpha.style.width='64px';
        tagColor.addEventListener('input', async (e) => {
          try {
            (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
            (this.plugin as any).settings.glow.tagColor = (e.target as HTMLInputElement).value;
            await (this.plugin as any).saveSettings();
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        });
        tagAlpha.addEventListener('input', async (e) => { try { (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {}; const v = Number((e.target as HTMLInputElement).value); (this.plugin as any).settings.glow.tagColorAlpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1.0; await (this.plugin as any).saveSettings(); try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {} try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {} } catch (e) {} });
        tagWrap.appendChild(tagColor); tagWrap.appendChild(tagAlpha);
        panel.appendChild(makeRow('Tag color', tagWrap, async () => {
          try {
            (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
            delete (this.plugin as any).settings.glow.tagColor;
            delete (this.plugin as any).settings.glow.tagColorAlpha;
            await (this.plugin as any).saveSettings();
            // reset input display to theme tag color
            try {
              const cs = this.canvas ? window.getComputedStyle(this.canvas) : window.getComputedStyle(this.containerEl);
              const nodeVar = cs.getPropertyValue('--accent-2') || cs.getPropertyValue('--accent-secondary') || cs.getPropertyValue('--interactive-accent') || cs.getPropertyValue('--accent-1') || cs.getPropertyValue('--accent');
              tagColor.value = (nodeVar && nodeVar.trim()) ? nodeVar.trim() : '#8000ff';
              tagAlpha.value = String(1.0);
            } catch (e) { tagColor.value = '#8000ff'; }
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        }));

          // Hover highlight depth control (expose in toolbox)
          const hoverDepthWrap = document.createElement('div');
          hoverDepthWrap.style.display = 'flex'; hoverDepthWrap.style.alignItems = 'center'; hoverDepthWrap.style.gap = '6px';
          const hoverDepthRange = document.createElement('input');
          hoverDepthRange.type = 'range'; hoverDepthRange.min = '0'; hoverDepthRange.max = '4'; hoverDepthRange.step = '1';
          const curHoverDepth = (this.plugin as any).settings?.glow?.hoverHighlightDepth ?? 1;
          hoverDepthRange.value = String(curHoverDepth);
          const hoverDepthInput = document.createElement('input');
          hoverDepthInput.type = 'number'; hoverDepthInput.min = hoverDepthRange.min; hoverDepthInput.max = hoverDepthRange.max; hoverDepthInput.step = hoverDepthRange.step;
          hoverDepthInput.value = String(hoverDepthRange.value);
          hoverDepthInput.style.width = '56px'; hoverDepthInput.style.textAlign = 'right';
          hoverDepthRange.addEventListener('input', (e) => { hoverDepthInput.value = (e.target as HTMLInputElement).value; });
          hoverDepthRange.addEventListener('change', async (e) => {
            try {
              (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
              const v = Number((e.target as HTMLInputElement).value);
              (this.plugin as any).settings.glow.hoverHighlightDepth = Number.isFinite(v) ? Math.max(0, Math.min(4, Math.floor(v))) : 1;
              await (this.plugin as any).saveSettings();
              try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
              try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
            } catch (e) {}
          });
          hoverDepthInput.addEventListener('input', (e) => { hoverDepthRange.value = (e.target as HTMLInputElement).value; });
          hoverDepthInput.addEventListener('change', (e) => { hoverDepthRange.dispatchEvent(new Event('change')); });
          hoverDepthWrap.appendChild(hoverDepthRange); hoverDepthWrap.appendChild(hoverDepthInput);
          panel.appendChild(makeRow('Hover highlight depth', hoverDepthWrap, async () => {
            try {
              (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
              delete (this.plugin as any).settings.glow.hoverHighlightDepth;
              await (this.plugin as any).saveSettings();
              hoverDepthRange.value = String(1);
              hoverDepthInput.value = String(1);
              try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
              try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
            } catch (e) {}
          }));

        // Label visibility controls (min radius + fade range)
        const labelVisWrap = document.createElement('div');
        labelVisWrap.style.display = 'flex'; labelVisWrap.style.alignItems = 'center'; labelVisWrap.style.gap = '6px';
        const labelMinRange = document.createElement('input');
        labelMinRange.type = 'range'; labelMinRange.min = '0'; labelMinRange.max = '20'; labelMinRange.step = '1';
        const curLabelMin = (this.plugin as any).settings?.glow?.labelMinVisibleRadiusPx ?? 6;
        labelMinRange.value = String(curLabelMin);
        const labelMinInput = document.createElement('input'); labelMinInput.type = 'number'; labelMinInput.min = labelMinRange.min; labelMinInput.max = labelMinRange.max; labelMinInput.step = labelMinRange.step; labelMinInput.value = String(labelMinRange.value); labelMinInput.style.width = '56px'; labelMinInput.style.textAlign = 'right';
        labelMinRange.addEventListener('input', (e) => { labelMinInput.value = (e.target as HTMLInputElement).value; });
        labelMinRange.addEventListener('change', async (e) => {
          try {
            (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
            const v = Number((e.target as HTMLInputElement).value);
            (this.plugin as any).settings.glow.labelMinVisibleRadiusPx = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 6;
            await (this.plugin as any).saveSettings();
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        });

        const labelFadeRange = document.createElement('input');
        labelFadeRange.type = 'range'; labelFadeRange.min = '0'; labelFadeRange.max = '40'; labelFadeRange.step = '1';
        const curFade = (this.plugin as any).settings?.glow?.labelFadeRangePx ?? 8;
        labelFadeRange.value = String(curFade);
        const labelFadeInput = document.createElement('input'); labelFadeInput.type = 'number'; labelFadeInput.min = labelFadeRange.min; labelFadeInput.max = labelFadeRange.max; labelFadeInput.step = labelFadeRange.step; labelFadeInput.value = String(labelFadeRange.value); labelFadeInput.style.width = '56px'; labelFadeInput.style.textAlign = 'right';
        labelFadeRange.addEventListener('input', (e) => { labelFadeInput.value = (e.target as HTMLInputElement).value; });
        labelFadeRange.addEventListener('change', async (e) => {
          try {
            (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
            const v = Number((e.target as HTMLInputElement).value);
            (this.plugin as any).settings.glow.labelFadeRangePx = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 8;
            await (this.plugin as any).saveSettings();
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        });

        const leftWrap = document.createElement('div'); leftWrap.style.display = 'flex'; leftWrap.style.flexDirection = 'column'; leftWrap.style.gap = '6px';
        const minWrap = document.createElement('div'); minWrap.style.display = 'flex'; minWrap.style.alignItems = 'center'; minWrap.style.gap = '6px'; minWrap.appendChild(labelMinRange); minWrap.appendChild(labelMinInput);
        const fadeWrap = document.createElement('div'); fadeWrap.style.display = 'flex'; fadeWrap.style.alignItems = 'center'; fadeWrap.style.gap = '6px'; fadeWrap.appendChild(labelFadeRange); fadeWrap.appendChild(labelFadeInput);
        leftWrap.appendChild(minWrap); leftWrap.appendChild(fadeWrap);
        panel.appendChild(makeRow('Label visibility (min + fade)', leftWrap, async () => {
          try {
            (this.plugin as any).settings.glow = (this.plugin as any).settings.glow || {};
            delete (this.plugin as any).settings.glow.labelMinVisibleRadiusPx;
            delete (this.plugin as any).settings.glow.labelFadeRangePx;
            await (this.plugin as any).saveSettings();
            labelMinRange.value = String(6); labelMinInput.value = String(6);
            labelFadeRange.value = String(8); labelFadeInput.value = String(8);
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        }));

      // (Background color control removed)

      

      // Count duplicate links toggle
      const countDup = document.createElement('input');
      countDup.type = 'checkbox';
      countDup.checked = Boolean((this.plugin as any).settings?.countDuplicateLinks);
      countDup.addEventListener('change', async (e) => {
        try {
          (this.plugin as any).settings.countDuplicateLinks = (e.target as HTMLInputElement).checked;
          await (this.plugin as any).saveSettings();
          // rebuild graph and renderer sizing if necessary
          try { this.graph = await buildGraph(this.app, { countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks), usePinnedCenterNote: Boolean((this.plugin as any).settings?.usePinnedCenterNote), pinnedCenterNotePath: String((this.plugin as any).settings?.pinnedCenterNotePath || ''), useOutlinkFallback: Boolean((this.plugin as any).settings?.useOutlinkFallback) } as any); if (this.renderer) (this.renderer as any).setGraph(this.graph); } catch (e) {}
          try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
        } catch (e) {}
      });
      panel.appendChild(makeRow('Count duplicate links', countDup, async () => {
        try {
          (this.plugin as any).settings.countDuplicateLinks = undefined as any;
          await (this.plugin as any).saveSettings();
          try { this.graph = await buildGraph(this.app, { countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks), usePinnedCenterNote: Boolean((this.plugin as any).settings?.usePinnedCenterNote), pinnedCenterNotePath: String((this.plugin as any).settings?.pinnedCenterNotePath || ''), useOutlinkFallback: Boolean((this.plugin as any).settings?.useOutlinkFallback) } as any); if (this.renderer) (this.renderer as any).setGraph(this.graph); } catch (e) {}
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
        // mouseAttractionRadius and mouseAttractionStrength are managed
        // in the global Settings panel (main.ts) to avoid duplicate controls.
        { key: 'mouseAttractionExponent', label: 'Mouse attraction exponent', step: '0.1' },
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
          case 'springStrength': range.min = '0'; range.max = '1.0'; range.step = '0.001'; break;
          case 'springLength': range.min = '10'; range.max = '500'; range.step = '1'; break;
          case 'centerPull': range.min = '0'; range.max = '0.01'; range.step = '0.0001'; break;
          case 'damping': range.min = '0'; range.max = '1'; range.step = '0.01'; break;
          case 'mouseAttractionRadius': range.min = '0'; range.max = '400'; range.step = '1'; break;
          case 'mouseAttractionStrength': range.min = '0'; range.max = '1'; range.step = '0.01'; break;
          case 'mouseAttractionExponent': range.min = '0.1'; range.max = '10'; range.step = '0.1'; break;
          default: range.min = '0'; range.max = '100'; range.step = '1';
        }
        const current = (phys as any)[f.key];
        // For springStrength, settings store the internal value; convert to UI 0..1
        if (f.key === 'springStrength') {
          const ui = Number.isFinite(current) ? Math.min(1, Math.max(0, Number(current) / 0.5)) : Number(range.min);
          range.value = String(ui);
        } else {
          range.value = String(Number.isFinite(current) ? current : Number(range.min));
        }
        range.style.width = '120px';

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.min = range.min; valueInput.max = range.max; valueInput.step = range.step;
        valueInput.value = String(range.value);
        valueInput.style.width = '64px';
        valueInput.style.textAlign = 'right';

        range.addEventListener('input', (e) => {
          valueInput.value = (e.target as HTMLInputElement).value;
        });

        range.addEventListener('change', async (e) => {
          try {
            (this.plugin as any).settings.physics = (this.plugin as any).settings.physics || {};
            const val = Number((e.target as HTMLInputElement).value);
            // map UI -> internal for specific keys
            if (f.key === 'springStrength') {
              // UI 0..1 -> internal = ui * 0.5
              (this.plugin as any).settings.physics[f.key] = Number.isFinite(val) ? (val * 0.5) : (this.plugin as any).settings.physics[f.key];
            } else {
              (this.plugin as any).settings.physics[f.key] = Number.isFinite(val) ? val : (this.plugin as any).settings.physics[f.key];
            }
            await (this.plugin as any).saveSettings();
            try { if (this.simulation && (this.simulation as any).setOptions) (this.simulation as any).setOptions((this.plugin as any).settings.physics); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).setGlowSettings) (this.renderer as any).setGlowSettings((this.plugin as any).settings.glow); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        });
        valueInput.addEventListener('input', (e) => { range.value = (e.target as HTMLInputElement).value; });
        valueInput.addEventListener('change', (e) => { range.dispatchEvent(new Event('change')); });
        wrap.appendChild(range);
        wrap.appendChild(valueInput);
        panel.appendChild(makeRow(f.label, wrap, async () => {
          try {
            (this.plugin as any).settings.physics = (this.plugin as any).settings.physics || {};
            delete (this.plugin as any).settings.physics[f.key];
            await (this.plugin as any).saveSettings();
            // restore UI to default from settings object if available
            const def = (this.plugin as any).settings.physics[f.key];
            if (f.key === 'springStrength') {
              const ui = def !== undefined ? String(Math.min(1, Math.max(0, Number(def) / 0.5))) : String(range.min);
              range.value = ui;
            } else {
              range.value = def !== undefined ? String(def) : String(range.min);
            }
            valueInput.value = range.value;
            try { if (this.simulation && (this.simulation as any).setOptions) (this.simulation as any).setOptions((this.plugin as any).settings.physics); } catch (e) {}
            try { if (this.renderer && (this.renderer as any).render) (this.renderer as any).render(); } catch (e) {}
          } catch (e) {}
        }));
      }

      // append to container
      this.containerEl.style.position = 'relative';
      this.containerEl.appendChild(panel);
      this.controlsEl = panel;
      // start minimized: collapse content without toggling state
      if (!this.controlsVisible) {
        for (let i = 1; i < panel.children.length; i++) {
          const ch = panel.children[i] as HTMLElement;
          ch.dataset['__savedDisplay'] = ch.style.display || '';
          ch.style.display = 'none';
        }
        panel.style.overflow = 'hidden';
        panel.style.maxHeight = '36px';
      }

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
    // Apply camera-plane cursor attractor before physics tick
    try { this.applyCursorAttractor(); } catch (e) {}
    // camera follow to locked node id (no zoom change)
    try {
      if (this.followLockedNodeId && this.graph && this.renderer) {
        const n = this.graph.nodes.find((x: any) => x.id === this.followLockedNodeId);
        if (n) {
          const cam = (this.renderer as any).getCamera();
          const alpha = 0.12;
          const tx = cam.targetX + ((n.x ?? 0) - (cam.targetX ?? 0)) * alpha;
          const ty = cam.targetY + ((n.y ?? 0) - (cam.targetY ?? 0)) * alpha;
          const tz = cam.targetZ + ((n.z ?? 0) - (cam.targetZ ?? 0)) * alpha;
          (this.renderer as any).setCamera({ targetX: tx, targetY: ty, targetZ: tz });
        }
      }
    } catch (e) {}
    if (this.simulation) this.simulation.tick(dt);
    // Recompute hover even when the cursor is stationary so nodes moving
    // under the pointer (due to physics or attractor) receive hover visuals.
    // Respect preview locks and active interactions.
    try {
      if (this.lastMouseX != null && this.lastMouseY != null) {
        this.updateHoverFromCoords(this.lastMouseX, this.lastMouseY);
      }
    } catch (e) {}
    // update camera animation/following
    try { this.updateCameraAnimation(timestamp); } catch (e) {}
    if (this.renderer) this.renderer.render();
    // periodically persist node positions (debounced)
    try { if (this.saveNodePositionsDebounced) this.saveNodePositionsDebounced(); } catch (e) {}
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  // Camera-plane cursor attractor: screen-aligned, O(N) per-frame
  private applyCursorAttractor() {
    const physics = (this.plugin as any).settings?.physics || {};
    // default to enabled when unset
    if (physics.mouseAttractionEnabled === false) return;
    if (this.suppressAttractorUntilMouseMove) return;
    if (this.lastMouseX == null || this.lastMouseY == null) return;
    if (!this.renderer || !this.graph) return;

    const radius = physics.mouseAttractionRadius; // use existing setting
    const baseStrength = physics.mouseAttractionStrength;
    const exponent = physics.mouseAttractionExponent ?? 3;
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(baseStrength) || baseStrength === 0) return;

    const cam = (this.renderer as any).getCamera();
    const basis = (this.renderer as any).getCameraBasis ? (this.renderer as any).getCameraBasis(cam) : null;
    if (!basis) return;
    const { right, up } = basis;

    const width = (this.canvas ? this.canvas.width : this.containerEl.getBoundingClientRect().width) || 1;
    const height = (this.canvas ? this.canvas.height : this.containerEl.getBoundingClientRect().height) || 1;

    for (const node of this.graph.nodes) {
      const proj = (this.renderer as any).getProjectedNode ? (this.renderer as any).getProjectedNode(node) : null;
      if (!proj) continue;

      const dxScreen = (this.lastMouseX as number) - proj.x;
      const dyScreen = (this.lastMouseY as number) - proj.y;

      const distScreen = Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen);
      if (distScreen > radius || distScreen === 0) continue;

      // Jitter suppression: deadzone near cursor
      const deadzone = Math.max(1, radius * 0.06);
      if (distScreen < deadzone) {
        // strong local damping to settle when centered
        node.vx = (node.vx || 0) * 0.6;
        node.vy = (node.vy || 0) * 0.6;
        node.vz = (node.vz || 0) * 0.6;
        continue;
      }

      const nx = dxScreen / distScreen;
      const ny = dyScreen / distScreen;

      // Map screen direction to world using camera basis; use + for up to align attraction
      let wx = right.x * nx + up.x * ny;
      let wy = right.y * nx + up.y * ny;
      let wz = right.z * nx + up.z * ny;

      const len = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
      wx /= len; wy /= len; wz /= len;

      const t = 1 - distScreen / radius;
      const strength = baseStrength * Math.pow(t, exponent);

      node.vx = (node.vx || 0) + wx * strength;
      node.vy = (node.vy || 0) + wy * strength;
      node.vz = (node.vz || 0) + wz * strength;
    }
  }

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    if (this.simulation && (this.simulation as any).setOptions) {
      (this.simulation as any).setOptions({ centerX, centerY });
    }
  }

  private focusCameraOnNode(node: any) {
    // Start an animated camera focus and enable following of the node.
    if (!this.renderer || !node) return;
    try {
      const cam = (this.renderer as any).getCamera();
      const from = {
        targetX: cam.targetX ?? 0,
        targetY: cam.targetY ?? 0,
        targetZ: cam.targetZ ?? 0,
        distance: cam.distance ?? 1000,
        yaw: cam.yaw ?? 0,
        pitch: cam.pitch ?? 0,
      };
      const toDistance = Math.max(200, Math.min(3000, (from.distance || 1000) * 0.6));
      const to = {
        targetX: node.x ?? 0,
        targetY: node.y ?? 0,
        targetZ: node.z ?? 0,
        distance: toDistance,
        yaw: from.yaw,
        pitch: from.pitch,
      };
      this.cameraAnimStart = performance.now();
      this.cameraAnimDuration = 300;
      this.cameraAnimFrom = from;
      this.cameraAnimTo = to;
      this.isCameraFollowing = true;
      this.cameraFollowNode = node;
    } catch (e) {}
  }

  private updateCameraAnimation(now: number) {
    if (!this.renderer) return;
    if (this.cameraAnimStart == null) {
      // If following without an active animation, smoothly interpolate camera target to node each frame
      if (this.isCameraFollowing && this.cameraFollowNode) {
        const n = this.cameraFollowNode;
        try {
          const cam = (this.renderer as any).getCamera();
          const followAlpha = 0.12; // smoothing factor per frame (0-1)
          const curX = cam.targetX ?? 0;
          const curY = cam.targetY ?? 0;
          const curZ = cam.targetZ ?? 0;
          const newX = curX + ((n.x ?? 0) - curX) * followAlpha;
          const newY = curY + ((n.y ?? 0) - curY) * followAlpha;
          const newZ = curZ + ((n.z ?? 0) - curZ) * followAlpha;
          (this.renderer as any).setCamera({ targetX: newX, targetY: newY, targetZ: newZ });
        } catch (e) {}
      }
      return;
    }
    const t = Math.min(1, (now - this.cameraAnimStart) / this.cameraAnimDuration);
    // easeOutQuad
    const ease = 1 - (1 - t) * (1 - t);
    const from = this.cameraAnimFrom || {};
    const to = this.cameraAnimTo || {};
    const lerp = (a: number, b: number) => a + (b - a) * ease;
    const cameraState: any = {};
    if (typeof from.targetX === 'number' && typeof to.targetX === 'number') cameraState.targetX = lerp(from.targetX, to.targetX);
    if (typeof from.targetY === 'number' && typeof to.targetY === 'number') cameraState.targetY = lerp(from.targetY, to.targetY);
    if (typeof from.targetZ === 'number' && typeof to.targetZ === 'number') cameraState.targetZ = lerp(from.targetZ, to.targetZ);
    if (typeof from.distance === 'number' && typeof to.distance === 'number') cameraState.distance = lerp(from.distance, to.distance);
    if (typeof from.yaw === 'number' && typeof to.yaw === 'number') cameraState.yaw = lerp(from.yaw, to.yaw);
    if (typeof from.pitch === 'number' && typeof to.pitch === 'number') cameraState.pitch = lerp(from.pitch, to.pitch);
    try { (this.renderer as any).setCamera(cameraState); } catch (e) {}
    // At end of animation, clear anim state but keep follow active so camera follows node
    if (t >= 1) {
      this.cameraAnimStart = null;
      this.cameraAnimFrom = null;
      this.cameraAnimTo = null;
      // keep isCameraFollowing = true and cameraFollowNode set
    }
  }

  // Rebuilds the graph and restarts the simulation. Safe to call repeatedly.
  async refreshGraph(): Promise<void> {
    // If the controller has been destroyed or no canvas, abort
    if (!this.canvas) return;
    try {
      const newGraph = await buildGraph(this.app, {
        countDuplicates: Boolean((this.plugin as any).settings?.countDuplicateLinks),
        usePinnedCenterNote: Boolean((this.plugin as any).settings?.usePinnedCenterNote),
        pinnedCenterNotePath: String((this.plugin as any).settings?.pinnedCenterNotePath || ''),
        useOutlinkFallback: Boolean((this.plugin as any).settings?.useOutlinkFallback),
      } as any);
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
        this.centerNode = this.graph.nodes.find((n: any) => (n as any).isCenterNode) || null;
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
            onlyNodes: needsLayout,
          });
        }
        this.renderer.resize(width, height);
        // ensure center node aligned with view center
        if (this.centerNode) { this.centerNode.x = centerX; this.centerNode.y = centerY; this.centerNode.z = 0; }
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

  // Reusable hover updater: computes hover from screen coords and respects
  // existing preview/drag/pan locks. Accepts an optional MouseEvent so the
  // preview modifier detection can still run when available.
  private updateHoverFromCoords(screenX: number, screenY: number, ev?: MouseEvent): void {
    if (!this.graph || !this.renderer) return;
    // Respect preview lock and active interactions; handleHover already
    // contains the logic we want, so delegate to it. Passing through the
    // optional MouseEvent allows preview-modifier behavior when called from
    // mousemove. When called from the RAF loop, ev will be undefined.
    // Avoid updating hover while dragging or panning.
    if (this.draggingNode || this.isPanning) return;
    // If preview popover is currently locked, do not override it from RAF.
    if (this.previewLockNodeId) return;
    try { this.handleHover(screenX, screenY, ev); } catch (e) {}
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
