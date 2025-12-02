import { App, Plugin, Platform } from 'obsidian'; 
import { buildGraph } from './buildGraph.ts';
import { layoutGraph2D, layoutGraph3D } from './layout2d.ts';
import { createRenderer2D } from './renderer2d.ts';
import { createSimulation } from './simulation.ts';
import { debounce } from '../utils/debounce.ts';
import { Settings, Renderer2D, GraphData, GraphNode, Simulation} from '../types/interfaces.ts';
import { DEFAULT_SETTINGS } from '../main';

export class GraphController {
  private app                     : App;
  private containerEl             : HTMLElement;
  private canvas                  : HTMLCanvasElement     | null = null;
  private renderer                : Renderer2D            | null = null;
  private graph                   : GraphData             | null = null;
  private adjacency               : Map<string, string[]> | null = null;
  private onNodeClick             : ((node: any) => void) | null = null;
  private plugin?                 : Plugin;
  private mouseMoveHandler?       : ((e: MouseEvent) => void);
  private mouseClickHandler?      : ((e: MouseEvent) => void);
  private mouseLeaveHandler?      : (() => void);
  private simulation?             : Simulation            | null = null;
  private animationFrame          : number                | null = null;
  private lastTime                : number                | null = null;
  private running?                : boolean;
  private settingsUnregister      : (() => void)          | null = null;
  private wheelHandler?           : ((e: WheelEvent) => void);
  private mouseDownHandler?       : ((e: MouseEvent) => void);
  private mouseUpHandler?         : ((e: MouseEvent) => void);
  private draggingNode?           : any                   | null;
  private dragStartDepth          : number        = 0;
  private dragOffsetWorld         : { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private isPanning               : boolean       = false;
  private lastPanX                : number        = 0;
  private lastPanY                : number        = 0;
  private isOrbiting              : boolean       = false;
  private lastOrbitX              : number        = 0;
  private lastOrbitY              : number        = 0;
  private isMiddlePanning         : boolean       = false;
  private panStartX               : number        = 0;
  private panStartY               : number        = 0;
  private panStartTargetX         : number        = 0;
  private panStartTargetY         : number        = 0;
  private pendingFocusNode        : any | null = null;
  private pendingFocusDownX       : number        = 0;
  private pendingFocusDownY       : number        = 0;
  private cameraAnimStart         : number | null = null;
  private cameraAnimDuration      : number        = 300; // ms
  private cameraAnimFrom          : any           = null;
  private cameraAnimTo            : any           = null;
  private isCameraFollowing       : boolean       = false;
  private cameraFollowNode        : any | null    = null;
  private hasDragged              : boolean       = false;
  private preventClick            : boolean       = false;
  private downScreenX             : number        = 0;
  private downScreenY             : number        = 0;
  private lastWorldX              : number        = 0;
  private lastWorldY              : number        = 0;
  private lastDragTime            : number        = 0;
  private dragVx                  : number        = 0;
  private dragVy                  : number        = 0;
  private momentumScale           : number        = 0.12;
  private dragThreshold           : number        = 4;
  private lastPreviewedNodeId     : string        | null = null;
  private previewLockNodeId       : string        | null = null;
  private previewPollTimer        : number        | null = null;
  private controlsEl              : HTMLElement   | null = null;
  private lastMouseX              : number        | null = null;
  private lastMouseY              : number        | null = null;
  private followLockedNodeId      : string        | null = null;
  private centerNode              : any           | null = null;
  private defaultCameraDistance   : number        = 1200;
  private lastUsePinnedCenterNote : boolean       = false;
  private lastPinnedCenterNotePath: string        = '';
  private viewCenterX             : number        = 0;
  private viewCenterY             : number        = 0;
  private suppressAttractorUntilMouseMove : boolean = false;
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

// INIT

  async init(): Promise<void> {
    const canvas        = document.createElement('canvas');
    canvas.style.width  = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex     = 0;
    this.containerEl.appendChild(canvas);
    this.canvas         = canvas;

    // create in-view controls panel
    //this.createControlsPanel();

    const userSettings = await (this.plugin as any).loadData();
    const settings: Settings = Object.assign({}, DEFAULT_SETTINGS, userSettings);
    //const settings = Object.assign({}, (this.plugin as any).settings || {});
    this.renderer = createRenderer2D({ canvas, settings });
   
    try {
      const cam0 = (this.renderer as any).getCamera?.();
      if (cam0 && typeof cam0.distance === 'number') this.defaultCameraDistance = cam0.distance;
    } catch (e) {}
    // Apply initial render options (whether to draw mutual links as double lines)
    try {
      const drawDouble  = Boolean((this.plugin as any).settings?.mutualLinkDoubleLine);
      const showTags    = (this.plugin as any).settings?.showTags !== false;
      if (this.renderer && (this.renderer as any).setRenderOptions) (this.renderer as any).setRenderOptions({ mutualDoubleLines: drawDouble, showTags });
    } catch (e) {}

    // track center selection settings for change detection
    this.lastUsePinnedCenterNote  = Boolean((this.plugin as any).settings?.usePinnedCenterNote);
    this.lastPinnedCenterNotePath = String ((this.plugin as any).settings?.pinnedCenterNotePath || '');

    this.graph = await buildGraph(this.app, {
      countDuplicates     : Boolean((this.plugin as any).settings?.countDuplicateLinks),
      usePinnedCenterNote : Boolean((this.plugin as any).settings?.usePinnedCenterNote),
      pinnedCenterNotePath: String ((this.plugin as any).settings?.pinnedCenterNotePath || ''),
      useOutlinkFallback  : Boolean((this.plugin as any).settings?.useOutlinkFallback),
    } as any);

    // Restore saved positions from plugin settings (do not override saved positions)
    // NOTE: We intentionally differentiate between nodes that have persisted
    // positions and nodes that don't. Nodes with a saved position are placed
    // exactly at their saved world coordinates and are NOT included in the
    // subsequent layout pass. Nodes without saved positions are collected
    // into `needsLayout` and will be laid out around the current view center
    // (centerX/centerY) so newly-created notes/tags appear around the visible
    // center node rather than at the absolute origin (0,0,0).
    const vaultId = this.app.vault.getName();
    // `nodePositions` historically was stored as a flat map of path->pos.
    // Newer versions store a per-vault map: { [vaultId]: { path: pos } }.
    // Support both formats: prefer per-vault, fall back to flat, and migrate
    // legacy flat maps into the per-vault shape for future saves.
    const rawSaved: any = (this.plugin as any).settings?.nodePositions || {};
    let allSaved: Record<string, Record<string, { x: number; y: number }>> = {};
    let savedPositions: Record<string, { x: number; y: number }> = {};
    if (rawSaved && typeof rawSaved === 'object') {
      if (rawSaved[vaultId] && typeof rawSaved[vaultId] === 'object') {
        // already per-vault
        allSaved = rawSaved as any;
        savedPositions = allSaved[vaultId] || {};
      } else {
        // legacy flat map: treat rawSaved as the vault map and migrate
        const hasPathLikeKeys = Object.keys(rawSaved).some((k) => typeof k === 'string' && (k.includes('/') || k.startsWith('tag:') || k.endsWith('.md')));
        if (hasPathLikeKeys) {
          // use flat map as savedPositions for this session
          savedPositions = rawSaved as Record<string, { x: number; y: number }>;
          // also migrate into per-vault shape so future saves are consistent
          allSaved = {} as any;
          allSaved[vaultId] = Object.assign({}, rawSaved);
          try {
            (this.plugin as any).settings.nodePositions = allSaved;
            // persist migrated shape (best-effort)
            try { (this.plugin as any).saveSettings && (this.plugin as any).saveSettings(); } catch (e) {}
          } catch (e) {}
        } else {
          // empty or unexpected shape: treat as empty
          allSaved = {} as any;
          savedPositions = {};
        }
      }
    }
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
      const interaction   = (this.plugin as any).settings?.interaction || {};
      this.momentumScale  = interaction.momentumScale ?? this.momentumScale;
      this.dragThreshold  = interaction.dragThreshold ?? this.dragThreshold;
    } catch (e) {}

    this.running        = true;
    this.lastTime       = null;
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
          const cam     = (this.renderer as any).getCamera();
          const width   = this.canvas ? this.canvas.width   : (this.containerEl.getBoundingClientRect().width || 300);
          const height  = this.canvas ? this.canvas.height  : (this.containerEl.getBoundingClientRect().height || 200);
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
            this.hasDragged   = true;
            this.preventClick = true;
          }
        }

        // compute instantaneous velocity in world-space
        const dt = Math.max((now - this.lastDragTime) / 1000, 1e-6);
        this.dragVx = ((world.x + this.dragOffsetWorld.x) - this.lastWorldX) / dt;
        this.dragVy = ((world.y + this.dragOffsetWorld.y) - this.lastWorldY) / dt;

        // override node position and zero velocities so physics doesn't move it
        this.draggingNode.x   = world.x         + this.dragOffsetWorld.x;
        this.draggingNode.y   = world.y         + this.dragOffsetWorld.y;
        this.draggingNode.z   = (world.z || 0)  + this.dragOffsetWorld.z;
        this.draggingNode.vx  = 0;
        this.draggingNode.vy  = 0;
        this.draggingNode.vz  = 0;
        this.lastWorldX       = this.draggingNode.x;
        this.lastWorldY       = this.draggingNode.y;
        this.lastDragTime     = now;

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
          const panSpeed    = cam.distance * 0.001 / Math.max(0.0001, cam.zoom);
          const newTargetX  = this.panStartTargetX - dx * panSpeed;
          const newTargetY  = this.panStartTargetY + dy * panSpeed;
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
        const cam       = (this.renderer as any).getCamera();
        const zoomSpeed = 0.0015;
        const factor    = Math.exp(ev.deltaY * zoomSpeed);
        let distance    = (cam.distance || 1000) * factor;
        distance        = Math.max(200, Math.min(8000, distance));
        (this.renderer as any).setCamera({ distance });
        (this.renderer as any).render();
      } catch (e) {}
    };

    this.mouseDownHandler = (ev: MouseEvent) => {
      if (!this.canvas || !this.renderer) return;
      const r       = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      // Right button -> either mark pending focus on node or pending focus on empty (origin)
      // We don't start orbit immediately; if the user drags beyond a threshold we'll begin orbiting.
      if (ev.button === 2) {
        const hitNode = this.hitTestNodeScreen(screenX, screenY);
        if (hitNode) {
          // pending focus on this node
          this.pendingFocusNode   = hitNode;
          this.pendingFocusDownX  = screenX;
          this.pendingFocusDownY  = screenY;
          ev.preventDefault();
          return;
        } else {
          // pending focus to reset to origin (0,0,0) if click (no drag)
          this.pendingFocusNode   = '__origin__';
          this.pendingFocusDownX  = screenX;
          this.pendingFocusDownY  = screenY;
          ev.preventDefault();
          return;
        }
      }
      // Middle button -> start camera target pan
      if (ev.button === 1) {
        try {
          const cam             = (this.renderer as any).getCamera();
          this.isMiddlePanning  = true;
          this.panStartX        = screenX;
          this.panStartY        = screenY;
          this.panStartTargetX  = cam.targetX;
          this.panStartTargetY  = cam.targetY;
          ev.preventDefault();
          return;
        } catch (e) {}
      }
      if (ev.button !== 0) return;
      const world = (this.renderer as any).screenToWorld(screenX, screenY);

      // initialize drag tracking
      this.hasDragged   = false;
      this.preventClick = false;
      this.downScreenX  = screenX;
      this.downScreenY  = screenY;
      this.lastWorldX   = world.x;
      this.lastWorldY   = world.y;
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
            const cam             = (this.renderer as any).getCamera();
            const proj            = (this.renderer as any).getProjectedNode ? (this.renderer as any).getProjectedNode(hit) : null;
            const depth           = proj ? proj.depth : 1000;
            this.dragStartDepth   = depth;
            const width           = this.canvas ? this.canvas.width  : (this.containerEl.getBoundingClientRect().width || 300);
            const height          = this.canvas ? this.canvas.height : (this.containerEl.getBoundingClientRect().height || 200);
            const screenXClient   = proj ? proj.x : screenX;
            const screenYClient   = proj ? proj.y : screenY;
            const worldAtCursor   = (this.renderer as any).screenToWorldAtDepth ? (this.renderer as any).screenToWorldAtDepth(screenXClient, screenYClient, depth, width, height, cam) : (this.renderer as any).screenToWorld(screenXClient, screenYClient);
            this.dragOffsetWorld  = {
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
                  if ((this.renderer as any).setHoverState ) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
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
          const visuals = (this.plugin as any).settings.visuals;
          const physics = (this.plugin as any).settings.physics;
          if (this.renderer && (this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(visuals);
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
            const interaction   = (this.plugin as any).settings?.interaction || {};
            this.momentumScale  = interaction.momentumScale ?? this.momentumScale;
            this.dragThreshold  = interaction.dragThreshold ?? this.dragThreshold;
          } catch (e) {}

          // If center selection settings changed, rebuild graph
          try {
            const usePinned   = Boolean((this.plugin as any).settings?.usePinnedCenterNote);
            const pinnedPath  = String((this.plugin as any).settings?.pinnedCenterNotePath || '');
            if (usePinned   !== this.lastUsePinnedCenterNote || pinnedPath !== this.lastPinnedCenterNotePath) {
              this.lastUsePinnedCenterNote  = usePinned;
              this.lastPinnedCenterNotePath = pinnedPath;
              this.refreshGraph();
            }
          } catch (e) {}
          // Refresh toolbox UI to match latest settings
//          try { this.refreshControlsFromSettings(); } catch (e) {}
        }
      });
    }
  }

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;
    if (!this.lastTime) {
      this.lastTime       = timestamp;
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
          const cam   = (this.renderer as any).getCamera();
          const alpha = 0.12;
          const tx    = cam.targetX + ((n.x ?? 0) - (cam.targetX ?? 0)) * alpha;
          const ty    = cam.targetY + ((n.y ?? 0) - (cam.targetY ?? 0)) * alpha;
          const tz    = cam.targetZ + ((n.z ?? 0) - (cam.targetZ ?? 0)) * alpha;
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
    const glow = (this.plugin as any).settings?.glow || {};
    // default to enabled when unset
    const gravityEnabled = (physics.mouseGravityEnabled !== false) && (physics.mouseAttractionEnabled !== false);
    if (!gravityEnabled) return;
    if (this.suppressAttractorUntilMouseMove) return;
    if (this.lastMouseX == null || this.lastMouseY == null) return;
    if (!this.renderer || !this.graph) return;

    // Use unified glow/gravity model: interpret the `gravityRadiusMultiplier`
    // setting as an absolute pixel gravity/glow radius (capped at 50). If
    // unset, fall back to multiplier-based behavior (6× node screen radius).
    const rawGravitySetting = Number.isFinite(glow.gravityRadius) ? Number(glow.gravityRadius) : NaN;
    const gravityRadiusPx   = (Number.isFinite(rawGravitySetting) && rawGravitySetting > 0) ? Math.min(50, rawGravitySetting) : NaN;
    const defaultMultiplier = 6;
    const steepness         = Number.isFinite(glow.gravityCurveSteepness) ? Number(glow.gravityCurveSteepness) : (physics.mouseAttractionExponent ?? 3);
    const baseStrength      = Number.isFinite(physics.mouseAttractionStrength) ? Number(physics.mouseAttractionStrength) : 0.6;
    if (baseStrength === 0) return;

    const cam   = (this.renderer as any).getCamera();
    const basis = (this.renderer as any).getCameraBasis ? (this.renderer as any).getCameraBasis(cam) : null;
    if (!basis) return;
    const { right, up } = basis;

    for (const node of this.graph.nodes) {
      const proj = (this.renderer as any).getProjectedNode ? (this.renderer as any).getProjectedNode(node) : null;
      if (!proj) continue;

      const dxScreen    = (this.lastMouseX as number) - proj.x;
      const dyScreen    = (this.lastMouseY as number) - proj.y;
      const distScreen  = Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen);

      // Determine per-node attraction radius in screen space
      const nodeScreenR = Number.isFinite(proj.r) ? Math.max(4, Number(proj.r)) : 8;
      const radius      = Number.isFinite(gravityRadiusPx) ? Math.max(8, gravityRadiusPx) : Math.max(8, nodeScreenR * defaultMultiplier);
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
      const strength = baseStrength * Math.pow(t, steepness);

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
      const cam   = (this.renderer as any).getCamera();
      const from  = {
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
          const cam         = (this.renderer as any).getCamera();
          const followAlpha = 0.12; // smoothing factor per frame (0-1)
          const curX        = cam.targetX ?? 0;
          const curY        = cam.targetY ?? 0;
          const curZ        = cam.targetZ ?? 0;
          const newX        = curX + ((n.x ?? 0) - curX) * followAlpha;
          const newY        = curY + ((n.y ?? 0) - curY) * followAlpha;
          const newZ        = curZ + ((n.z ?? 0) - curZ) * followAlpha;
          (this.renderer as any).setCamera({ targetX: newX, targetY: newY, targetZ: newZ });
        } catch (e) {}
      }
      return;
    }
    const t = Math.min(1, (now - this.cameraAnimStart) / this.cameraAnimDuration);
    // easeOutQuad
    const ease  = 1 - (1 - t) * (1 - t);
    const from  = this.cameraAnimFrom || {};
    const to    = this.cameraAnimTo || {};
    const lerp  = (a: number, b: number) => a + (b - a) * ease;
    const cameraState: any = {};
    if (typeof from.targetX   === 'number' && typeof to.targetX   === 'number')   cameraState.targetX   = lerp(from.targetX, to.targetX);
    if (typeof from.targetY   === 'number' && typeof to.targetY   === 'number')   cameraState.targetY   = lerp(from.targetY, to.targetY);
    if (typeof from.targetZ   === 'number' && typeof to.targetZ   === 'number')   cameraState.targetZ   = lerp(from.targetZ, to.targetZ);
    if (typeof from.distance  === 'number' && typeof to.distance  === 'number')   cameraState.distance  = lerp(from.distance, to.distance);
    if (typeof from.yaw   === 'number' && typeof to.yaw   === 'number') cameraState.yaw   = lerp(from.yaw, to.yaw);
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
        countDuplicates       : Boolean((this.plugin as any).settings?.countDuplicateLinks),
        usePinnedCenterNote   : Boolean((this.plugin as any).settings?.usePinnedCenterNote),
        pinnedCenterNotePath  : String ((this.plugin as any).settings?.pinnedCenterNotePath || ''),
        useOutlinkFallback    : Boolean((this.plugin as any).settings?.useOutlinkFallback),
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
      const rect        = this.containerEl.getBoundingClientRect();
      const width       = rect.width || 300;
      const height      = rect.height || 200;
      const centerX     = width / 2;
      const centerY     = height / 2;
      this.viewCenterX  = centerX;
      this.viewCenterY  = centerY;

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
    this.previewPollTimer     = null;
    this.previewLockNodeId    = null;
    this.lastPreviewedNodeId  = null;
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas                   = null;
    this.renderer                 = null;
    this.graph                    = null;
    if (this.simulation)          { try { this.simulation.stop(); } catch (e) {} this.simulation = null; }
    if (this.animationFrame)      { try { cancelAnimationFrame(this.animationFrame); } catch (e) {} this.animationFrame = null; this.lastTime = null; this.running = false; }
    this.onNodeClick              = null;
    if (this.settingsUnregister)  { try { this.settingsUnregister(); } catch (e) {} this.settingsUnregister = null; }
  }

  setNodeClickHandler(handler: ((node: any) => void) | null) { this.onNodeClick = handler; }

  private hitTestNodeScreen(screenX: number, screenY: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any  = null;
    let closestDist   = Infinity;
    const hitPadding  = 6;
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
        if (this.renderer && (this.renderer as any).setHoverState ) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
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
    const depth = (this.plugin as any).settings?.glow?.highlightDepth ?? 1;
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
              event       : ev,
              source      : 'greater-graph',
              hoverParent : this.containerEl,
              targetEl    : this.canvas,
              linktext    : closest.filePath || closest.label,
              sourcePath  : closest.filePath,
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
