import { App, Plugin, Platform } from 'obsidian'; 
import { buildGraph } from './buildGraph.ts';
import { createRenderer } from './renderer.ts';
import { createSimulation } from './simulation.ts';
import { debounce } from '../utilities/debounce.ts';
import { Settings, Renderer, GraphData, GraphNode, GraphEdge, Simulation, CameraState} from '../utilities/interfaces.ts';
import { InputManager } from './InputManager.ts';
import { getSettings, updateSettings } from '../utilities/settingsStore.ts';
import { CameraManager } from '../CameraManager.ts';

// This class manages interactions between the graph data, simulation, and renderer.
export class GraphManager {
  private app                         : App;
  private containerEl                 : HTMLElement;
  private plugin?                     : Plugin;
  private running                     : boolean                                     = false;
  private canvas                      : HTMLCanvasElement                   | null  = null;
  private renderer                    : Renderer                            | null  = null;
  private graph                       : GraphData                           | null  = null;
  private adjacency                   : Map<string, string[]>               | null  = null;
  private simulation?                 : Simulation                          | null  = null;
  private animationFrame              : number                              | null  = null;
  private lastTime                    : number                              | null  = null;
  private previewPollTimer            : number                              | null  = null;
  private followedNode                : string                              | null  = null;
  private inputManager                : InputManager                        | null  = null;
  private cameraManager               : CameraManager                       | null  = null;
  private openNodeFile                : ((node: any) => void)               | null  = null;
  private settingsUnregister          : (() => void)                        | null  = null;
  private saveNodePositionsDebounced  : (() => void)                        | null  = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app          = app;
    this.containerEl  = containerEl;
    this.plugin       = plugin;
  }

  async init(): Promise<void> {
    const settings            = getSettings();
    const vaultId             = this.app.vault.getName();
    const canvas              = document.createElement('canvas');
    canvas.style.width        = '100%';
    canvas.style.height       = '100%';
    canvas.tabIndex           = 0;

    this.cameraManager        = new CameraManager(settings.camera.state);
    this.renderer             = createRenderer(canvas, this.cameraManager);
    // (This is critical because CameraManager needs the viewport center to project correctly)
    const rect                = this.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    this.containerEl.appendChild(canvas);
    this.graph                = await buildGraph(this.app);

    this.inputManager         = new InputManager(canvas, {
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


    const rawSaved    : any = settings.nodePositions || {};
    let allSaved      : Record<string, Record<string, { x: number; y: number }>> = {};
    let savedPositions: Record<string,                { x: number; y: number }> = {};
    
    if (rawSaved && typeof rawSaved === 'object') {
      if (rawSaved[vaultId] && typeof rawSaved[vaultId] === 'object') {
        // already per-vault
        allSaved       = rawSaved as any;
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

    this.buildAdjacencyMap();
    this.refreshGraph();
    this.resetCamera();

    this.lastTime         = null;
    this.animationFrame   = requestAnimationFrame(this.animationLoop);

    // setup debounced saver for node positions
    if (!this.saveNodePositionsDebounced) {
      this.saveNodePositionsDebounced = debounce(() => this.saveNodePositions(), 2000, true);
    }
  }

  private buildAdjacencyMap(){
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

  public updateHover (screenX: number, screenY: number) {
      this.cameraManager?.updateHover(screenX, screenY);
  }

  public startDrag (nodeId: string, screenX: number, screenY: number) {
    this.cameraManager?.startDrag(nodeId, screenX, screenY);
    return;
  }
 
  public updateDrag (screenX: number, screenY: number) {
      this.cameraManager?.updateDrag(screenX, screenY);
      return;
  }

  public endDrag () {
      this.cameraManager?.endDrag();
      return;
  }

  public updateZoom (screenX: number, screenY: number, delta: number) {
    this.cameraManager?.updateZoom(screenX, screenY, delta);
  }

  public startPan (screenX: number, screenY: number) {
    this.cameraManager?.startPan(screenX, screenY);
  }

  public updatePan (screenX: number, screenY: number) {
    this.cameraManager?.updatePan(screenX, screenY);
  }

  public endPan(){
    this.cameraManager?.endPan();
  }

  public startOrbit (screenX: number, screenY: number) {
    this.cameraManager?.startOrbit(screenX, screenY);
  }

  public updateOrbit (screenX: number, screenY: number) {
    this.cameraManager?.updateOrbit(screenX, screenY);
  }

  public endOrbit () {
    this.cameraManager?.endOrbit();
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
    if (this.renderer) this.renderer.render(this.cameraManager!.getState());

    // periodically persist node positions (debounced)
    //try { if (this.saveNodePositionsDebounced) this.saveNodePositionsDebounced(); } catch (e) {}
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  resize(width: number, height: number): void {
    if (!this.renderer || !this.cameraManager) return;
    this.renderer.resize(width, height);
  }

  public resetCamera() {
    if (!this.renderer) return;
    try {
      const renderer = (this.renderer as any);
      if (renderer.resetCamera) {
        renderer.resetCamera();
      }
    } catch (e) {}  
  }

  private updateCameraAnimation(now: number) { return; // smooths camera animations. Revist later
  /*  if (!this.renderer) return;
    if (this.cameraAnimStart == null) {
      // If following without an active animation, smoothly interpolate camera target to node each frame
      if (this.isCameraFollowing && this.cameraFollowNode) {
        const n = this.cameraFollowNode;
        try {
          const cam         = (this.renderer as any).getCameraState();
          const followAlpha = 0.12; // smoothing factor per frame (0-1)
          const curX        = cam.targetX ?? 0;
          const curY        = cam.targetY ?? 0;
          const curZ        = cam.targetZ ?? 0;
          const newX        = curX + ((n.x ?? 0) - curX) * followAlpha;
          const newY        = curY + ((n.y ?? 0) - curY) * followAlpha;
          const newZ        = curZ + ((n.z ?? 0) - curZ) * followAlpha;
          (this.renderer as any).setCameraState({ targetX: newX, targetY: newY, targetZ: newZ });
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
    try { (this.renderer as any).setCameraState(cameraState); } catch (e) {}
    // At end of animation, clear anim state but keep follow active so camera follows node
    if (t >= 1) {
      this.cameraAnimStart  = null;
      this.cameraAnimFrom   = null;
      this.cameraAnimTo     = null;
      // keep isCameraFollowing = true and cameraFollowNode set
    }*/
  }

  public async refreshGraph() {
    this.stopSimulation();

    // try to load graph from file first
    this.graph = await buildGraph (this.app);

    const { nodes, edges }  = this.filterGraph    (this.graph);
    this.simulation         = this.buildSimulation(nodes, edges);

    this.buildAdjacencyMap(); // rebuild adjacency map after graph refresh or showTags changes
    this.startSimulation();
    this.renderer!.setGraph(this.graph!);
    this.renderer?.render(this.cameraManager!.getState());
  }

  private stopSimulation() {
    if (this.simulation) {
        try { this.simulation.stop(); } catch {}
        this.simulation = null;
    }
  }

  private buildSimulation(nodes: GraphNode[], edges: GraphEdge[]) {
    // maybe I want to add more to this, idk
    return createSimulation(nodes, edges);
  }

  private startSimulation() {
    if (!this.simulation) return;
    try { this.simulation.start(); this.running = true; } catch {}
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

    //if (this.renderer.canvas && this.renderer.canvas.parentElement) this.renderer.canvas.parentElement.removeChild(this.renderer.canvas);
    //this.renderer.canvas                   = null;
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
      const sp         = (this.renderer as any).getNodeScreenPosition(node, this.cameraManager!.getState());
      if (!sp) continue;
      const nodeRadius = this.renderer.getNodeRadiusForHit ? this.renderer.getNodeRadiusForHit(node) : 8;
      const hitR       = nodeRadius * Math.max(0.0001, scale) + hitPadding;
      const dx         = screenX - sp.x; const dy = screenY - sp.y; const distSq = dx*dx + dy*dy;
      if (distSq      <= hitR*hitR && distSq < closestDist) { closestDist = distSq; closest = node; }
    }
    return closest;
  }

  private saveNodePositions(): void {
    // undefined error within here after destroy() called
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