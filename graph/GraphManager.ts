import { App, Plugin, Platform } from 'obsidian'; 
import { buildGraph } from './buildGraph.ts';
import { layoutGraph2D, layoutGraph3D } from './layout.ts';
import { createRenderer } from './renderer.ts';
import { createSimulation } from './simulation.ts';
import { debounce } from '../utils/debounce.ts';
import { Settings, Renderer, GraphData, GraphNode, GraphEdge, Simulation, SimulationSettings} from '../types/interfaces.ts';
import { DEFAULT_SETTINGS } from '../main.ts';
import { InputManager } from './InputManager.ts';

// This class manages interactions between the graph data, simulation, and renderer.
export class GraphManager {
  private app                         : App;
  private containerEl                 : HTMLElement;
  private plugin?                     : Plugin;
  private running?                    : boolean;
  private cameraAnimDuration          : number                                      = 300; // ms
  private momentumScale               : number                                      = 0.12;
  private dragThreshold               : number                                      = 4;
  private defaultCameraDistance       : number                                      = 1200;
  private lastUsePinnedCenterNote     : boolean                                     = false;
  private lastPinnedCenterNotePath    : string                                      = '';
  private viewCenterX                 : number                                      = 0;
  private viewCenterY                 : number                                      = 0;
  private canvas                      : HTMLCanvasElement                   | null  = null;
  private renderer                    : Renderer                            | null  = null;
  private graph                       : GraphData                           | null  = null;
  private adjacency                   : Map<string, string[]>               | null  = null;
  private simulation?                 : Simulation                          | null  = null;
  private animationFrame              : number                              | null  = null;
  private lastTime                    : number                              | null  = null;
  private cameraAnimStart             : number                              | null  = null;
  private previewPollTimer            : number                              | null  = null;
  private lastMouseX                  : number                              | null  = null;
  private lastMouseY                  : number                              | null  = null;
  private followedNode                : string                              | null  = null;
  private centerNode                  : any                                 | null  = null;
  private inputManager                : InputManager                        | null  = null;
  private cameraSnapShot              : any                                 | null  = null;
  private worldAnchorPoint            : { x: number; y: number; z: number } | null  = null;
  private screenAnchorPoint           : { x: number; y: number }            | null  = null;
  private openNodeFile                : ((node: any) => void)               | null  = null;
  private settingsUnregister          : (() => void)                        | null  = null;
  private saveNodePositionsDebounced  : (() => void)                        | null  = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app          = app;
    this.containerEl  = containerEl;
    this.plugin       = plugin;
  }

  async init(): Promise<void> {
    const vaultId             = this.app.vault.getName();
    this.canvas               = document.createElement('canvas');
    this.canvas.style.width   = '100%';
    this.canvas.style.height  = '100%';
    this.canvas.tabIndex      = 0;
    const userSettings        = await (this.plugin as any).loadData();
    const settings: Settings  = Object.assign({}, DEFAULT_SETTINGS, userSettings);
    const rect                = this.containerEl.getBoundingClientRect();
    const centerX             = (rect.width  || 300) / 2;
    const centerY             = (rect.height || 200) / 2;
    this.viewCenterX          = centerX;
    this.viewCenterY          = centerY;
    this.renderer             = createRenderer({ canvas: this.canvas, settings });
    this.containerEl.appendChild(this.canvas);

    // track center selection settings for change detection
    this.lastUsePinnedCenterNote  = Boolean((this.plugin as any).settings?.usePinnedCenterNote);
    this.lastPinnedCenterNotePath = String ((this.plugin as any).settings?.pinnedCenterNotePath || '');

    this.graph = await buildGraph(this.app, {
      countDuplicates     : Boolean((this.plugin as any).settings?.countDuplicateLinks),
      usePinnedCenterNote : Boolean((this.plugin as any).settings?.usePinnedCenterNote),
      pinnedCenterNotePath: String ((this.plugin as any).settings?.pinnedCenterNotePath || ''),
      useOutlinkFallback  : Boolean((this.plugin as any).settings?.useOutlinkFallback),
    } as any);

    this.inputManager = new InputManager(this.canvas, {
      onOrbitStart      : (dx, dy)                    => this.startOrbit(dx, dy),
      onOrbitMove       : (dx, dy)                    => this.updateOrbit(dx, dy),
      onOrbitEnd        : ()                          => this.endOrbit(),
      onPanStart        : (screenX, screenY)          => this.startPan(screenX, screenY),
      onPanMove         : (screenX, screenY)          => this.updatePan(screenX, screenY),
      onPanEnd          : ()                          => this.endPan(),
      onOpenNode        : (screenX, screenY)          => this.openNode(screenX, screenY),
      onHover           : (screenX, screenY)          => this.updateHover(screenX, screenY),
      onDragStart       : (nodeId, screenX, screenY)  => this.startDrag(nodeId, screenX, screenY),
      onDragMove        : (screenX, screenY)          => this.updateDrag(screenX, screenY),
      onDragEnd         : ()                          => this.endDrag(),
      onZoom            : (x, y, delta)               => this.updateZoom(x, y, delta),
      onFollowStart     : (nodeId)                    => this.startFollow(nodeId),
      onFollowEnd       : ()                          => this.endFollow(),
      resetCamera       : ()                          => this.resetCamera(),
      detectClickedNode : (screenX, screenY)          => { return this.nodeClicked(screenX, screenY); },
    });

    const rawSaved    : any = (this.plugin as any).settings?.nodePositions || {};
    let allSaved      : Record<string, Record<string, { x: number; y: number }>> = {};
    let savedPositions: Record<string,                { x: number; y: number }> = {};
    
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

    this.buildAdjacencyMap();

    this.renderer.setGraph(this.graph);
    // Layout only nodes that don't have saved positions so user-placed nodes remain where they were.
    if (needsLayout.length > 0) {
      layoutGraph3D(this.graph, {
        width: rect.width   || 300,
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
    this.refreshGraph();
    this.initializeCamera();
    

    try { if ((this.renderer as any).resetPanToCenter) (this.renderer as any).resetPanToCenter(); } catch (e) {}
    // Clear any follow/preview locks and reset hover state so initial view is clean
    try {
      if ((this.renderer as any).setHoverState ) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
      if ((this.renderer as any).setHoveredNode) (this.renderer as any).setHoveredNode(null);
      (this.renderer as any).render?.();
    } catch (e) {}

    // read interaction settings (drag momentum / threshold)
    try {
      const interaction   = (this.plugin as any).settings?.interaction || {};
      this.momentumScale  = interaction.momentumScale ?? this.momentumScale;
      this.dragThreshold  = interaction.dragThreshold ?? this.dragThreshold;
    } catch (e) {}

    this.running          = true;
    this.lastTime         = null;
    this.animationFrame   = requestAnimationFrame(this.animationLoop);

    // setup debounced saver for node positions
    if (!this.saveNodePositionsDebounced) {
      this.saveNodePositionsDebounced = debounce(() => this.saveNodePositions(), 2000, true);
    }
  }

  private buildAdjacencyMap(): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!adjacency.has(e.sourceId)) adjacency.set(e.sourceId, []);
        if (!adjacency.has(e.targetId)) adjacency.set(e.targetId, []);
        adjacency.get(e.sourceId)!.push(e.targetId);
        adjacency.get(e.targetId)!.push(e.sourceId);
      }
    }
    this.adjacency = adjacency;
  }

  private initializeCamera() {
    try { // Center camera on initial load same as a right-click origin focus would do.
        if ((this.renderer as any).setCamera) (this.renderer as any).setCamera({  targetX: this.viewCenterX ?? 0, targetY: this.viewCenterY ?? 0, targetZ: 0, distance: this.defaultCameraDistance });
    } catch (e) {}
  }

  public updateHover (screenX: number, screenY: number) {
      return;
  }

  public startDrag (nodeId: string, screenX: number, screenY: number) {
    console.log("dragging", nodeId);
    return;
  }
 
  public updateDrag (screenX: number, screenY: number) {
      return;
  }

  public endDrag () {
      return;
  }

  public updateZoom (screenX: number, screenY: number, delta: number) {
    (this.renderer as any).zoomAt(screenX, screenY, 1 + delta * -0.1); this.renderer?.render();
  }

  public startPan (screenX: number, screenY: number) {
    if (!this.renderer || !(this.renderer as any).screenToWorld3D) { console.log("GM startPan: No renderer or screenToWorld3D method"); return; }
    
    const renderer        = (this.renderer as any);
    this.cameraSnapShot   = { ...renderer.getCamera() };
    const depth           = this.cameraSnapShot.distance;

    this.worldAnchorPoint = renderer.screenToWorld3D(screenX, screenY, depth, this.cameraSnapShot);
  }

  public updatePan (screenX: number, screenY: number) {
    if (!this.renderer || !(this.renderer as any).screenToWorld3D || this.worldAnchorPoint === null) 
      { return; }
    const renderer = (this.renderer as any);
    const camSnap  = this.cameraSnapShot;
    const depth    = camSnap.distance; 
    
    if (this.worldAnchorPoint === null) { return; }
    const currentWorld = renderer.screenToWorld3D(screenX, screenY, depth, camSnap);

    const dx = currentWorld.x - (this.worldAnchorPoint.x as any);
    const dy = currentWorld.y - (this.worldAnchorPoint.y as any);
    const dz = currentWorld.z - (this.worldAnchorPoint.z as any);

    const camera = renderer.getCamera();
    (this.renderer as any) .setCamera({
        targetX: camera.targetX - dx,
        targetY: camera.targetY - dy,
        targetZ: camera.targetZ - dz,
    });
    this.worldAnchorPoint = currentWorld;
  }

  public endPan(){
    this.worldAnchorPoint = null;
    this.cameraSnapShot   = null;
  }

  public startOrbit (screenX: number, screenY: number) {
    if (!this.renderer) { console.log("GM startOrbit: No renderer or screenToWorld3D method"); return; }
    // Similar to startPan but may differ later
    const renderer              = (this.renderer as any);
    this.cameraSnapShot         = { ...renderer.getCamera() };
    const depth                 = this.cameraSnapShot.distance;

    this.screenAnchorPoint = { x: screenX, y: screenY };
  }

  public updateOrbit (screenX: number, screenY: number) {
    if (!this.renderer || this.screenAnchorPoint === null) 
      { return; }
    const renderer              = (this.renderer as any);
    const camSnap               = this.cameraSnapShot;
    const depth                 = camSnap.distance;

    const ROTATE_SENSITIVITY_X  = DEFAULT_SETTINGS.interaction.rotateSensitivityX;
    const ROTATE_SENSITIVITY_Y  = DEFAULT_SETTINGS.interaction.rotateSensitivityY;
    const dx                    = screenX - this.screenAnchorPoint!.x;
    const dy                    = screenY - this.screenAnchorPoint!.y;

    let yaw                     = camSnap.yaw   - dx * ROTATE_SENSITIVITY_X;
    let pitch                   = camSnap.pitch - dy * ROTATE_SENSITIVITY_Y;

    const maxPitch              = Math.PI / 2;// - 0.05;
    const minPitch              = -maxPitch;
    if (pitch > maxPitch) pitch = maxPitch;
    if (pitch < minPitch) pitch = minPitch;

    renderer.setCamera({yaw,pitch,});
  }

  public endOrbit () {
    this.screenAnchorPoint = null;
    this.cameraSnapShot    = null;
  }

  public openNode (screenX: number, screenY: number) {
    const node = this.nodeClicked(screenX, screenY);
    if (node && this.openNodeFile) { 
      this.openNodeFile(node); 
    }
  }

  public setOnNodeClick(handler: (node: any) => void): void {
    this.openNodeFile = handler; 
  }

  public startFollow(nodeId: string) {
    this.followedNode = nodeId;
    console.log("start follow", nodeId);
  }

  public endFollow() {
    this.followedNode = null;
  }

  public resetCamera() {
    this.initializeCamera
  }

  private animationLoop = (timestamp: number) => {
    if (!this.running) return;
    if (!this.lastTime) {
      this.lastTime       = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt                = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt     = 0.05;
    this.lastTime         = timestamp;
    if (this.simulation) this.simulation.tick(dt);

    // update camera animation/following
    try { this.updateCameraAnimation(timestamp); } catch (e) {}
    if (this.renderer) this.renderer.render();

    // periodically persist node positions (debounced)
    //try { if (this.saveNodePositionsDebounced) this.saveNodePositionsDebounced(); } catch (e) {}
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

  private updateCameraAnimation(now: number) { return; // smooths camera animations. Revist later
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
    if (typeof from.yaw       === 'number' && typeof to.yaw       === 'number')   cameraState.yaw       = lerp(from.yaw, to.yaw);
    if (typeof from.pitch     === 'number' && typeof to.pitch === 'number') cameraState.pitch = lerp(from.pitch, to.pitch);
    try { (this.renderer as any).setCamera(cameraState); } catch (e) {}
    // At end of animation, clear anim state but keep follow active so camera follows node
    if (t >= 1) {
      this.cameraAnimStart  = null;
      this.cameraAnimFrom   = null;
      this.cameraAnimTo     = null;
      // keep isCameraFollowing = true and cameraFollowNode set
    }
  }

  public async refreshGraph() {
    this.stopSimulation();

    this.graph = await buildGraph (this.app, {
        countDuplicates       : Boolean((this.plugin as any).settings?.countDuplicateLinks),
        usePinnedCenterNote   : Boolean((this.plugin as any).settings?.usePinnedCenterNote),
        pinnedCenterNotePath  : String ((this.plugin as any).settings?.pinnedCenterNotePath || ''),
        useOutlinkFallback    : Boolean((this.plugin as any).settings?.useOutlinkFallback),
      } as any);

    const { nodes, edges }  = this.filterGraph    (this.graph);
    this.simulation         = this.buildSimulation(nodes, edges);

    this.buildAdjacencyMap(); // rebuild adjacency map after graph refresh or showTags changes
    this.startSimulation();
    this.renderer!.setGraph(this.graph!);
    this.renderer?.render();
  }

  private stopSimulation() {
    if (this.simulation) {
        try { this.simulation.stop(); } catch {}
        this.simulation = null;
    }
  }

  private buildSimulation(nodes: GraphNode[], edges: GraphEdge[], opts?: Partial<SimulationSettings>) {
    const physics = (this.plugin as any).settings.physics;
    return createSimulation(nodes, edges, { ...physics, ...opts });
  }

  private startSimulation() {
    if (!this.simulation) return;
    try { this.simulation.start(); } catch {}
  }

  private filterGraph(graph: GraphData, showTags = true) {
    if (showTags) return { nodes: graph.nodes, edges: graph.edges };

    const tagSet  = new Set(graph.nodes.filter(n => n.type === "tag").map(n => n.id));
    const nodes   = graph.nodes.filter(n => !tagSet.has(n.id));
    const edges   = graph.edges.filter(e => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
    return { nodes, edges };
}

  destroy(): void {
    // persist positions immediately when view is closed
    try { this.saveNodePositions(); } catch (e) {}
    // clear any preview poll timer and lock
    try { if (this.previewPollTimer) window.clearInterval(this.previewPollTimer as number); } catch (e) {}
    this.previewPollTimer         = null;
    this.renderer?.destroy();

    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas                   = null;
    this.renderer                 = null;
    this.graph                    = null;
    if (this.simulation)          { 
      try { this.simulation.stop(); } catch (e) {} 
      this.simulation             = null; 
    }
    if (this.animationFrame)      { 
      try { cancelAnimationFrame(this.animationFrame); } catch (e) {} 
      this.animationFrame         = null; 
      this.lastTime               = null; 
      this.running                = false; 
    }
    this.openNodeFile             = null;
    if (this.settingsUnregister)  { try { this.settingsUnregister(); } catch (e) {} this.settingsUnregister = null; }
  
    this.inputManager?.destroy();
    this.inputManager = null;
  }

  private nodeClicked(screenX: number, screenY: number) {
    if (!this.graph || !this.renderer) return null;
    let closest: any   = null;
    let closestDist    = Infinity;
    const hitPadding   = 6;
    const scale        = (this.renderer as any).getScale ? (this.renderer as any).getScale() : 1;

    for (const node of this.graph.nodes) {
      const sp         = (this.renderer as any).getNodeScreenPosition ? (this.renderer as any).getNodeScreenPosition(node) : null;
      if (!sp) continue;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR       = nodeRadius * Math.max(0.0001, scale) + hitPadding;
      const dx         = screenX - sp.x; const dy = screenY - sp.y; const distSq = dx*dx + dy*dy;
      if (distSq      <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  private saveNodePositions(): void {
    if (!this.graph) return;
    try {
      // top-level map keyed by vault name
      const allSaved: Record<string, Record<string, { x: number; y: number }>> = (this.plugin as any).settings.nodePositions || {};
      const vaultId                               = this.app.vault.getName();
      if (!allSaved[vaultId]) allSaved[vaultId]   = {};
      const map                                   = allSaved[vaultId];
      for (const node of this.graph.nodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        if (node.filePath) map[node.filePath]     = { x: node.x, y: node.y };
      }
      (this.plugin as any).settings.nodePositions = allSaved;
      // fire-and-forget save
      try { (this.plugin as any).saveSettings && (this.plugin as any).saveSettings(); 
          } catch (e) { console.error('Failed to save node positions', e); }
    } catch (e) {
      console.error('Greater Graph: saveNodePositions error', e);
    }
  }
}


  /*// Recreate the physics simulation, optionally excluding tag nodes.
  private recreateSimulation(showTags: boolean, extraOpts?: { centerX?: number; centerY?: number; centerNodeId?: string }) {
    try {
      if (this.simulation) {
        try { this.simulation.stop(); } catch (e) {}
      }
      if (!this.graph) return;
      const physOpts  = Object.assign({}, (this.plugin as any).settings?.physics || {});
      const rect      = this.containerEl.getBoundingClientRect();
      const centerX   = (extraOpts && typeof extraOpts.centerX === 'number') ? extraOpts.centerX : rect.width / 2;
      const centerY   = (extraOpts && typeof extraOpts.centerY === 'number') ? extraOpts.centerY : rect.height / 2;
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
        simEdges = (this.graph.edges  || []).filter((e: any) => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
      }

      this.simulation = createSimulation(simNodes, simEdges, Object.assign({}, physOpts, { centerX, centerY, centerNodeId }));
      try { this.simulation.start(); } catch (e) {}
    } catch (e) {
      console.error('Failed to recreate simulation', e);
    }
  }*/



/*  // Rebuilds the graph and restarts the simulation. Safe to call repeatedly.
  async refreshGraph(): Promise<void> {
    // If the manager has been destroyed or no canvas, abort
    if (!this.canvas) return;
    try {
      const newGraph = await buildGraph (this.app, {
        countDuplicates       : Boolean((this.plugin as any).settings?.countDuplicateLinks),
        usePinnedCenterNote   : Boolean((this.plugin as any).settings?.usePinnedCenterNote),
        pinnedCenterNotePath  : String ((this.plugin as any).settings?.pinnedCenterNotePath || ''),
        useOutlinkFallback    : Boolean((this.plugin as any).settings?.useOutlinkFallback),
      } as any);
      this.graph = newGraph;

      // Restore saved positions for the new graph as with init
      const vaultId = this.app.vault.getName();
      const allSaved        : Record<string, Record<string, { x: number; y: number }>> = (this.plugin as any).settings?.nodePositions || {};
      const savedPositions  : Record<string,                { x: number; y: number }>  = allSaved[vaultId] || {};
      const needsLayout     : any[]                                                    = [];
      
      if (this.graph &&    this.graph.nodes) {
        for (const node of this.graph.nodes) {
          const s  = savedPositions[node.filePath];
          const isFiniteX = Number.isFinite(s?.x);
          const isFiniteY = Number.isFinite(s?.y);
          if (s && isFiniteX && isFiniteY) {
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
            centerOnLargestNode : true,
            onlyNodes           : needsLayout,
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

      if (this.renderer) this.renderer.render();
    } catch (e) {
      console.error('Greater Graph: failed to refresh graph', e);
    }
  }
*/