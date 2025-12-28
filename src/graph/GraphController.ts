import { App, Plugin, TFile } from 'obsidian'; 
import { createRenderer } from './renderer.ts';
import { createSimulation } from './simulation.ts';
import { Renderer, GraphNode, GraphData, Simulation, WorldTransform } from '../shared/interfaces.ts';
import { InputManager } from './InputManager.ts';
import { getSettings } from '../settings/settingsStore.ts';
import { CameraController } from './CameraController.ts';
import type GraphPlus from '../plugin/main.ts';
import { GraphInteractor } from './GraphInteractor.ts';
import { createCursorController } from "./CursorController";
import { GraphStore } from "./GraphStore.ts";


export type GraphDependencies = {
  getGraph            : ()                    => GraphData        | null;
  getCamera           : ()                    => CameraController | null;
  getApp              : ()                    => App;
  getPlugin           : ()                    => GraphPlus        | null;
  setPinnedNodes      : (ids  : Set<string>)  => void;
  enableMouseGravity  : (on   : boolean)      => void;
};

type PluginLike = {
  loadData: () => Promise<any>;
  saveData: (data: any) => Promise<void>;
};
type GraphStoreDeps = {
  getApp: () => App;
  getPlugin: () => PluginLike | null;
};


// This class manages interactions between the graph data, simulation, and renderer.
export class GraphController {
  private app                 : App;
  private containerEl         : HTMLElement;
  private plugin              : GraphPlus;
  private running             : boolean                                           = false;
  private canvas              : HTMLCanvasElement                         | null  = null;
  private renderer            : Renderer                                  | null  = null;
  private adjacencyMap        : Map<string, string[]>                     | null  = null
  private simulation?         : Simulation                                | null  = null;
  private animationFrame      : number                                    | null  = null;
  private lastTime            : number                                    | null  = null;
  private previewPollTimer    : number                                    | null  = null;
  private inputManager        : InputManager                              | null  = null;
  private camera              : CameraController                          | null  = null;
  private settingsUnregister  : (() => void)                              | null  = null;
  private interactor          : GraphInteractor                           | null  = null;
  private graphStore          : GraphStore                                | null  = null;
  private graph               : GraphData                                 | null  = null;
  private cursor              : ReturnType<typeof createCursorController> | null  = null;
  private lastPreviewId       : string                                    | null  = null;
  private hoverAnchor         : HTMLAnchorElement                         | null  = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app                = app;
    this.containerEl        = containerEl;
    this.plugin             = plugin as GraphPlus;

    const settings          = getSettings();
    this.camera      = new CameraController(settings.camera.state);
    this.camera.setWorldTransform(null);

    
  }

  async init(): Promise<void> {
    this.canvas               = document.createElement('canvas');
    this.canvas.style.width   = '100%';
    this.canvas.style.height  = '100%';
    this.canvas.tabIndex      = 0;

    const graphDeps: GraphDependencies = {
      getGraph              : ()    => this.graph,
      getCamera             : ()    => this.camera,
      getApp                : ()    => this.app,
      getPlugin             : ()    => this.plugin,
      setPinnedNodes        : (ids) => { this.simulation?.setPinnedNodes?.(ids); },
      enableMouseGravity    : (on)  => { getSettings().physics.mouseGravityEnabled = on;} ,
    };

    const storeDeps: GraphStoreDeps = {
      getApp  : () => this.app,
      getPlugin: () => this.plugin,
    };

    this.interactor           = new GraphInteractor(graphDeps);
    this.graphStore           = new GraphStore(storeDeps);
    this.cursor               = createCursorController(this.canvas!);
    this.renderer             = createRenderer(this.canvas, this.camera!);    
    
    if (!this.canvas || !this.interactor || !this.renderer || !this.graphStore || !this.renderer) return;

    await this.graphStore.init();
    
    this.interactor.setOnNodeClick((node) => this.openNodeFile(node));

    const rect                = this.containerEl.getBoundingClientRect(); // (This is critical because CameraManager needs the viewport center to project correctly)
    this.renderer.resize(rect.width, rect.height);
    this.containerEl.appendChild(this.canvas);

    this.inputManager                                   = new InputManager(this.canvas, {
      onOrbitStart      : (dx, dy)                    => this.interactor!.startOrbit(dx, dy),
      onOrbitMove       : (dx, dy)                    => this.interactor!.updateOrbit(dx, dy),
      onOrbitEnd        : ()                          => this.interactor!.endOrbit(),
      onPanStart        : (screenX, screenY)          => this.interactor!.startPan(screenX, screenY),
      onPanMove         : (screenX, screenY)          => this.interactor!.updatePan(screenX, screenY),
      onPanEnd          : ()                          => this.interactor!.endPan(),
      onOpenNode        : (screenX, screenY)          => this.interactor!.openNode(screenX, screenY),
      onMouseMove       : (screenX, screenY)          => this.interactor!.updateMouse(screenX, screenY),
      onDragStart       : (nodeId, screenX, screenY)  => this.interactor!.startDrag(nodeId, screenX, screenY),
      onDragMove        : (screenX, screenY)          => this.interactor!.updateDrag(screenX, screenY),
      onDragEnd         : ()                          => this.interactor!.endDrag(),
      onZoom            : (x, y, delta)               => this.interactor!.updateZoom(x, y, delta),
      onFollowStart     : (nodeId)                    => this.interactor!.startFollow(nodeId),
      onFollowEnd       : ()                          => this.interactor!.endFollow(),
      resetCamera       : ()                          => this.camera!.resetCamera(),
      detectClickedNode : (screenX, screenY)          => { return this.interactor!.nodeClicked(screenX, screenY); },
    });

    this.buildAdjacencyMap();
    await this.refreshGraph(); if (!this.graph) return;
    this.resetCamera();

    this.lastTime         = null;
    this.animationFrame   = requestAnimationFrame(this.animationLoop);
  }

  public async refreshGraph() {
    this.stopSimulation();
    if (!this.graphStore) return;

    this.graph        = this.graphStore.get();
    const interactor  = this.interactor;
    const renderer    = this.renderer;
    const graph       = this.graph;
    const camera      = this.camera;
    if (!interactor || !renderer || !graph || !camera) return;

    renderer?.setGraph(graph);

    this.simulation   = createSimulation(graph, camera, () => interactor.getMouseScreenPosition());
    const simulation  = this.simulation;
    
    this.buildAdjacencyMap(); // rebuild adjacency map after graph refresh or showTags changes
    this.startSimulation();
    renderer?.render();
  }

  public async rebuildGraph(): Promise<void> {
    if (!this.graphStore || !this.renderer || !this.interactor || !this.camera) return;

    this.stopSimulation();
    this.simulation = null;

    await this.graphStore.rebuild();
    this.graph = this.graphStore.get();
    if (!this.graph) return;

    this.renderer.setGraph(this.graph);

    this.simulation = createSimulation(this.graph, this.camera, () => this.interactor!.getMouseScreenPosition());
    this.startSimulation();
}


  private animationLoop = (timestamp: number) => {
    // Always keep the RAF loop alive; just skip simulation stepping when not running.
    if (!this.lastTime) {
      this.lastTime       = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }

    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    this.lastTime = timestamp;

    if (this.running && this.simulation) this.simulation.tick(dt);
    const cursor      = this.cursor;
    const interactor  = this.interactor;
    const renderer    = this.renderer;
    const camera      = this.camera;
    if (!camera || !cursor || !interactor || !renderer) return;

    interactor.frame();
    const cursorType = interactor.cursorType;
    cursor.apply(cursorType);

    this.updateCameraAnimation(timestamp); // does nothing rn
    
    renderer.setMouseScreenPosition(interactor.getMouseScreenPosition());
    renderer.render();

    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  private updateCameraAnimation(now: number) { 
    return; // smooths camera animations. Revist later
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
    this.adjacencyMap = adjacency;
  }

  public resetCamera() {
    this.camera?.resetCamera();
  }

  private startSimulation() {
    if (!this.simulation) return;
    this.simulation.start(); this.running = true;
  }

  private stopSimulation() {
    if (this.simulation) {
        this.simulation.stop();
        this.simulation = null;
    }
  }

  private async openNodeFile(node: GraphNode): Promise<void> {
    if (!node) return;
    const app                     = this.app;
    let file: TFile | null        = null;
    if (node.file) file  = node.file as TFile;
    else if (node.filePath) {
      const af = app.vault.getAbstractFileByPath(node.filePath);
      if (af instanceof TFile) file = af;
    }
    if (!file) {
      console.warn('Greater Graph: could not resolve file for node', node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      console.error('Greater Graph: failed to open file', e);
    } 
  }

  private filterGraph(graph: GraphData, showTags = true) {
    if (showTags) return { nodes: graph.nodes, edges: graph.edges };

    const tagSet  = new Set(graph.nodes.filter(n => n.type === "tag").map(n => n.id));
    const nodes   = graph.nodes.filter(n => !tagSet.has(n.id));
    const edges   = graph.edges.filter(e => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
    return { nodes, edges };
  } 

  public refreshTheme(): void {
    this.renderer?.refreshTheme();
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    this.renderer.resize(width, height);
  }

  destroy(): void {
    // persist positions immediately when view is closed
    this.graphStore?.save(); 
    // clear any preview poll timer and lock
    if (this.previewPollTimer) window.clearInterval(this.previewPollTimer as number); 
    this.previewPollTimer         = null;

    this.renderer?.destroy();
    this.renderer                 = null;
    this.interactor               = null;
    
    if (this.simulation)          { 
      this.simulation.stop();  
      this.simulation             = null; 
    }

    if (this.animationFrame)      { 
      cancelAnimationFrame(this.animationFrame);  
      this.animationFrame         = null; 
      this.lastTime               = null; 
      this.running                = false; 
    }

    if (this.settingsUnregister)  { this.settingsUnregister();  this.settingsUnregister = null; }

    this.inputManager?.destroy();
    this.inputManager = null;
  }
}