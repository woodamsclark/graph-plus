import { App, Plugin, TFile } from "obsidian";
import { createSimulation } from "./simulation.ts";
import type { Node, GraphData, Simulation, Tickable } from "../../shared/interfaces.ts";
import { InputManager } from "./input/InputManager.ts";
import { getSettings } from "../../settings/settingsStore.ts";
import { CameraController } from "./CameraController.ts";
import type GraphPlus from "../../plugin/main.ts";
import { GraphInteractor } from "./GraphInteractor.ts";
import { GraphStore } from "./GraphStore.ts";

export type GraphDependencies = {
  getGraph           : () => GraphData | null;
  getCamera          : () => CameraController | null;
  getApp             : () => App;
  getPlugin          : () => GraphPlus | null;
  setPinnedNodes     : (ids: Set<string>) => void;
  enableMouseGravity : (on: boolean) => void;
};

type DataStoragePlugin = {
  loadData: () => Promise<any>;
  saveData: (data: any) => Promise<void>;
};
type GraphStoreDeps = {
  getApp: () => App;
  getPlugin: () => DataStoragePlugin | null;
};

export class GraphDirector implements Tickable {
  private app: App;
  private plugin: GraphPlus;

  private simulation: Simulation | null = null;
  private inputManager: InputManager | null = null;
  private camera: CameraController | null = null;
  private interactor: GraphInteractor | null = null;
  private graphStore: GraphStore | null = null;
  private graph: GraphData | null = null;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin as GraphPlus;

    const settings = getSettings();
    this.camera = new CameraController(settings.camera.state);
    this.camera.setWorldTransform(null);
  }

  public getGraph(): GraphData | null { return this.graph; }
  public getCamera(): CameraController | null { return this.camera; }
  public getInteractor(): GraphInteractor | null { return this.interactor; }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const graphDeps: GraphDependencies = {
      getGraph: () => this.graph,
      getCamera: () => this.camera,
      getApp: () => this.app,
      getPlugin: () => this.plugin,
      setPinnedNodes: (ids) => { this.simulation?.setPinnedNodes?.(ids); },
      enableMouseGravity: (on) => { getSettings().physics.mouseGravityEnabled = on; },
    };

    const storeDeps: GraphStoreDeps = {
      getApp: () => this.app,
      getPlugin: () => this.plugin,
    };

    this.interactor = new GraphInteractor(graphDeps);
    this.graphStore = new GraphStore(storeDeps);

    // Build graph + sim
    await this.rebuildGraph();
    this.graph = this.graphStore.get();
    if (!this.graph || !this.interactor) return;

    this.interactor.setOnNodeClick((node) => this.openNodeFile(node));

    // Input wiring stays in Adam
    this.inputManager = new InputManager(canvas, {
      onRotateStart : (x, y) => this.interactor!.startRotate(x, y),
      onRotateMove  : (x, y) => this.interactor!.updateRotate(x, y),
      onRotateEnd   : ()     => this.interactor!.endRotate(),

      onPanStart    : (x, y) => this.interactor!.startPan(x, y),
      onPanMove     : (x, y) => this.interactor!.updatePan(x, y),
      onPanEnd      : ()     => this.interactor!.endPan(),

      onOpenNode    : (x, y) => this.interactor!.openNode(x, y),
      onMouseMove   : (x, y) => this.interactor!.updateGravityCenter(x, y),

      onDragStart   : (id, x, y) => this.interactor!.startDrag(id, x, y),
      onDragMove    : (x, y)     => this.interactor!.updateDrag(x, y),
      onDragEnd     : ()         => this.interactor!.endDrag(),

      onZoom        : (x, y, d) => this.interactor!.updateZoom(x, y, d),
      onFollowStart : (id)      => this.interactor!.startFollow(id),
      onFollowEnd   : ()        => this.interactor!.endFollow(),

      resetCamera   : ()        => this.camera!.resetCamera(),
      getClickedNode: (x, y)    => this.interactor!.getClickedNode(x, y),
    });

    this.resetCamera();
  }

  public async rebuildGraph(): Promise<void> {
    if (!this.graphStore || !this.interactor || !this.camera) return;

    this.stopSimulation();
    await this.graphStore.rebuild();
    this.refreshGraph(); // rebuild sim from latest graph
  }

  public refreshGraph(): void {
    this.stopSimulation();
    if (!this.graphStore || !this.interactor || !this.camera) return;

    this.graph = this.graphStore.get();
    if (!this.graph) return;

    this.simulation = createSimulation(this.graph, this.camera, () => this.interactor!.getGravityCenter());
    this.startSimulation();
  }

  public tick(dt: number, nowMs: number): void {
    // 1) interaction update
    this.interactor?.frame();

    // 2) physics
    this.simulation?.tick(dt);
  }

  private startSimulation(): void {
    this.simulation?.start();
  }

  private stopSimulation(): void {
    if (this.simulation) this.simulation.stop();
  }

  public focusNode(nodeId: string): void {
    const graph = this.graph;
    const cam = this.camera;
    if (!graph || !cam) return;

    const n = graph.nodes.find(x => x.id === nodeId);
    if (!n) return;

    cam.patchState({ targetX: n.location.x, targetY: n.location.y, targetZ: n.location.z });
  }

  public resetCamera(): void {
    this.camera?.resetCamera();
    this.camera?.patchState({ targetX: 0, targetY: 0, targetZ: 0 });
  }

  private async openNodeFile(node: Node): Promise<void> {
    if (!node) return;

    let file: TFile | null = null;
    if (node.file) file = node.file as TFile;
    else if (node.id) {
      const af = this.app.vault.getAbstractFileByPath(node.id);
      if (af instanceof TFile) file = af;
    }

    if (!file) {
      console.warn("Greater Graph: could not resolve file for node", node);
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      console.error("Greater Graph: failed to open file", e);
    }
  }

  destroy(): void {
    this.graphStore?.save();
    this.stopSimulation();
    this.simulation = null;

    this.inputManager?.destroy();
    this.inputManager = null;

    this.interactor = null;
    this.graphStore = null;
    this.graph = null;
  }
}
