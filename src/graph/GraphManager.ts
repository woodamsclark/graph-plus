import { App, Plugin, Platform } from 'obsidian'; 
import { buildGraph } from './buildGraph.ts';
import { createRenderer } from './renderer.ts';
import { createSimulation } from './simulation.ts';
import { debounce } from '../utilities/debounce.ts';
import { Renderer, GraphNode, GraphData, Simulation, WorldTransform } from '../utilities/interfaces.ts';
import { InputManager } from './InputManager.ts';
import { getSettings } from '../utilities/settingsStore.ts';
import { CameraManager } from '../CameraManager.ts';
import type GraphPlus from '../main.ts';

enum CursorState {
  Idle = "Idle",
  Clickable = "Clickable",
  Dragging = "Dragging",
}

// This class manages interactions between the graph data, simulation, and renderer.
export class GraphManager {
  private app                         : App;
  private containerEl                 : HTMLElement;
  private plugin                      : GraphPlus;
  private canvas                      : HTMLCanvasElement                   | null  = null;
  private appliedCursorCss            : string                                      = "default";
  private running                     : boolean                                     = false;
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
  private mouseScreenPosition         : { mouseX: number, mouseY: number }  | null  = null;
  private hoveredNodeId               : string                              | null  = null;
  private draggedNodeId               : string                              | null  = null;
  private isPanning                   : boolean                                     = false;
  private isRotating                  : boolean                                     = false;
  private dragWorldOffset             : { x: number; y: number; z: number } | null  = null;
  private dragDepthFromCamera         : number                                      = 0;
  private pinnedNodes                 : Set<string>                                 = new Set();
  private cursorState                 : CursorState                                 = CursorState.Idle;

  

  private worldTransform: WorldTransform = {
  rotationX: 0,
  rotationY: 0,
  scale: 1,
  };

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app          = app;
    this.containerEl  = containerEl;
    this.plugin       = plugin as GraphPlus;
  }

  async init(): Promise<void> {
    const settings                  = getSettings();
    const vaultId                   = this.app.vault.getName();
    this.canvas                     = document.createElement('canvas');
    this.canvas.style.width         = '100%';
    this.canvas.style.height        = '100%';
    this.canvas.tabIndex            = 0;

    this.cameraManager        = new CameraManager(settings.camera.state);
    this.cameraManager.setWorldTransform(null);

    this.renderer             = createRenderer(this.canvas, this.cameraManager);
    // (This is critical because CameraManager needs the viewport center to project correctly)
    const rect                = this.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    this.containerEl.appendChild(this.canvas);

    this.inputManager         = new InputManager(this.canvas, {
      onOrbitStart      : (dx, dy)                    => this.startOrbit(dx, dy),
      onOrbitMove       : (dx, dy)                    => this.updateOrbit(dx, dy),
      onOrbitEnd        : ()                          => this.endOrbit(),
      onPanStart        : (screenX, screenY)          => this.startPan(screenX, screenY),
      onPanMove         : (screenX, screenY)          => this.updatePan(screenX, screenY),
      onPanEnd          : ()                          => this.endPan(),
      onOpenNode        : (screenX, screenY)          => this.openNode(screenX, screenY),
      onHover           : (screenX, screenY)          => this.onHover(screenX, screenY),
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
            this.plugin.settings.nodePositions = allSaved;
            // persist migrated shape (best-effort)
            try { this.plugin.saveSettings && this.plugin.saveSettings(); } catch (e) {}
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

  // this needs changing
  public onHover (screenX: number, screenY: number) {
    if (screenX === -Infinity || screenY === -Infinity) {
        this.mouseScreenPosition = null; // off screen
    } else {
        this.mouseScreenPosition = { mouseX: screenX, mouseY: screenY };
    }
    
    // Also tell the camera manager for any hover effects (highlighting)
    this.cameraManager?.updateHover(screenX, screenY);
  }

  public startDrag (nodeId: string, screenX: number, screenY: number) {
    if (!this.graph || !this.cameraManager) return;

    const node = this.graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Depth from camera so we can unproject mouse onto the same plane in view-space
    const projected           = this.cameraManager.worldToScreen(node);
    this.dragDepthFromCamera  = Math.max(0.0001, projected.depth);

    // Pin while dragging
    this.draggedNodeId = nodeId;
    this.pinnedNodes.add(nodeId);
    try { this.simulation?.setPinnedNodes?.(this.pinnedNodes); } catch {}

    // World-space offset so we don’t snap the node center to the cursor
    const underMouse = this.cameraManager.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    this.dragWorldOffset = {
      x: node.x - underMouse.x,
      y: node.y - underMouse.y,
      z: (node.z || 0) - underMouse.z,
    };
    return;
  }
 
  public updateDrag (screenX: number, screenY: number) {
    if (!this.graph || !this.cameraManager) return;
    if (!this.draggedNodeId) return;

    const node = this.graph.nodes.find(n => n.id === this.draggedNodeId);
    if (!node) return;

    const underMouse = this.cameraManager.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    const o = this.dragWorldOffset || { x: 0, y: 0, z: 0 };

    node.x = underMouse.x + o.x;
    node.y = underMouse.y + o.y;
    node.z = underMouse.z + o.z;

    // Prevent slingshot on release
    node.vx = 0; node.vy = 0; node.vz = 0;

    // Immediate feedback
    try { this.renderer?.render(this.cameraManager.getState()); } catch {}
      return;
  }

  public endDrag () {
    if (!this.draggedNodeId) return;

    this.pinnedNodes.delete(this.draggedNodeId);
    try { this.simulation?.setPinnedNodes?.(this.pinnedNodes); } catch {}

    this.draggedNodeId = null;
    this.dragWorldOffset = null;

    // Save soon after drag ends
    try { this.saveNodePositionsDebounced && this.saveNodePositionsDebounced(); } catch {}
      return;
  }

  public updateZoom (screenX: number, screenY: number, delta: number) {
    this.cameraManager?.updateZoom(screenX, screenY, delta);
  }

  public startPan (screenX: number, screenY: number) {
    this.isPanning = true;
    this.cameraManager?.startPan(screenX, screenY);
  }

  public updatePan (screenX: number, screenY: number) {
    this.cameraManager?.updatePan(screenX, screenY);
  }

  public endPan(){
    this.isPanning = false;
    this.cameraManager?.endPan();
  }

  public startOrbit (screenX: number, screenY: number) {
    this.isRotating = true;
    this.cameraManager?.startOrbit(screenX, screenY);
  }

  public updateOrbit (screenX: number, screenY: number) {
    this.cameraManager?.updateOrbit(screenX, screenY);
  }

  public endOrbit () {
    this.isRotating = false;
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
  }

  public endFollow() {
    this.followedNode = null;
  }

  private animationLoop = (timestamp: number) => {
    // Always keep the RAF loop alive; just skip simulation stepping when not running.
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }

    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    this.lastTime = timestamp;

    if (this.running && this.simulation) this.simulation.tick(dt);

    this.checkForHoveredNode();
    this.updateCursor();

    try { this.updateCameraAnimation(timestamp); } catch (e) {}
    if (this.renderer) this.renderer.render(this.cameraManager!.getState());

    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  private checkForHoveredNode() {
    if (!this.mouseScreenPosition) {
      this.hoveredNodeId = null; 
      return;
    }
    const hit = this.nodeClicked(this.mouseScreenPosition.mouseX, this.mouseScreenPosition.mouseY);
    this.hoveredNodeId = hit?.id ?? null;
  }

  private updateCursor() {
    this.updateCursorState();
    this.applyCursorStyle();
  }

  private updateCursorState() {
    if (this.draggedNodeId || this.isPanning || this.isRotating) {
      this.cursorState = CursorState.Dragging;
    } else if (this.hoveredNodeId) {
      this.cursorState = CursorState.Clickable;
    } else {
      this.cursorState = CursorState.Idle;
    }
  }

  private applyCursorStyle() {
    if (!this.canvas) return;

    let css = "default";
    if (this.cursorState === CursorState.Clickable) css = "pointer";
    if (this.cursorState === CursorState.Dragging)  css = "grabbing";

    if (this.appliedCursorCss === css) return;
    this.appliedCursorCss = css;
    this.canvas.style.cursor = css;
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.cameraManager) return;
    this.renderer.resize(width, height);
  }

  public resetCamera() {
    this.cameraManager?.resetCamera();
  }

  private updateCameraAnimation(now: number) { 
    return; // smooths camera animations. Revist later
  }

  public async refreshGraph() {
    this.stopSimulation();

    // try to load graph from file first
    this.graph = await buildGraph (this.app);
    if (!this.graph) return;

     this.renderer?.setGraph(this.graph);

    this.simulation         = createSimulation(this.graph, this.cameraManager!, () => this.mouseScreenPosition);

    this.buildAdjacencyMap(); // rebuild adjacency map after graph refresh or showTags changes
    this.startSimulation();
    this.renderer?.render(this.cameraManager!.getState());
  }

  private stopSimulation() {
    if (this.simulation) {
        try { this.simulation.stop(); } catch {}
        this.simulation = null;
    }
  }

  private buildSimulation() {
    //return createSimulation(this.graph);
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
    let closest: GraphNode | null    = null;
    let closestDist     = Infinity;
    const hitPadding    = 0; // extra padding for easier clicking
    //const scale         = this.cameraManager ? this.cameraManager.getState().distance : 1;

    for (const node of this.graph.nodes) {
      const projected  = this.cameraManager?.worldToScreen(node);
      if (!projected) continue;
      const nodeRadius = node.radius;
      const hitR       = nodeRadius /** Math.max(0.0001, scale)*/ + hitPadding;
      const dx         = screenX - projected.x; 
      const dy         = screenY - projected.y; 
      const distSq     = dx*dx + dy*dy;
      if (distSq      <= hitR*hitR && distSq < closestDist) { 
        closestDist    = distSq;
        closest        = node;
      }
    }
    return closest;
  }

  private saveNodePositions(): void {
    // undefined error within here after destroy() called
    if (!this.graph) return;
    try {
      const allSaved        = getSettings().nodePositions;
      const vaultId         = this.app.vault.getName();
      if (!allSaved[vaultId]) {
        allSaved[vaultId]   = {};
      }
      const map             = allSaved[vaultId];
      for (const node of this.graph.nodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        if (node.filePath) {
          map[node.filePath] = { x: node.x, y: node.y };
        }
      }
      this.plugin.settings.nodePositions = allSaved;
      try {
        this.plugin.saveSettings && this.plugin.saveSettings();
      } catch (e) {
        console.error('Failed to save node positions', e);
      }
    } catch (e) {
      console.error('Greater Graph: saveNodePositions error', e);
    }
  }
}