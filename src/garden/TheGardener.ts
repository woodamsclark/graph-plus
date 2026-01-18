import { App, Plugin } from "obsidian";
import { GraphDirector } from "./graph/GraphDirector.ts";
import { AnimaDirector } from "./anima/AnimaDirector.ts";
import { createRenderer } from "./render.ts";
import { createCursorController } from "./graph/input/CursorController.ts";
import { Time } from "./Time.ts";
import { Space } from "./Space.ts";
import type { Renderer } from "../shared/interfaces.ts";
import { Physics } from "../space/physics/Physics.ts";

export class TheGardener {
  private time = new Time({ maxDtSeconds: 0.05 });
  private unregs: Array<() => void> = [];

  private canvas: HTMLCanvasElement | null = null;
  private cursor: ReturnType<typeof createCursorController> | null = null;

  private graph: GraphDirector | null = null;
  private anima: AnimaDirector | null = null;
  private renderer: Renderer | null = null;
  private space: Space;
  private physics: Physics | null = null;

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {
    this.space = new Space({ maxDtSeconds: 0.05 });
  }

  async open(): Promise<void> {
    // Stage
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.tabIndex = 0;
    this.deps.containerEl.appendChild(this.canvas);

    // Adam
    this.graph = new GraphDirector(this.deps.app, this.deps.plugin);
    await this.graph.init(this.canvas);

    // Eve
    this.anima = new AnimaDirector();

    const camera = this.graph.getCamera();
    if (!camera) return;

    this.renderer = createRenderer(this.canvas, camera);
    this.cursor   = createCursorController(this.canvas);

    const interactor = this.graph.getInteractor();
    if (!interactor) return;

    this.physics = new Physics({
      getGraph: () => this.graph?.getGraph() ?? null,
      getCamera: () => this.graph?.getCamera() ?? null,
      getInteraction: () => interactor.getState(),
    });

    this.physics.rebuild();

    this.graph.setOnPinnedNodesChanged((ids) => {
      this.physics?.setPinnedNodes(ids); // you'd add this method
    });

    // Initial sizing + bind graph
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
    this.syncRendererGraph();

    // Order is important
    this.space.register("graph", this.graph); // graph.tick -> interactor.frame only
    this.space.register("physics", { tick: (dt:number) => this.physics?.tick(dt) } as any);
    this.space.register("anima", this.anima);
    this.space.register("render", { tick: () => this.renderFrame() } as any);

    this.space.start() // space owns time
  }

  private syncRendererGraph(): void {
    if (!this.renderer || !this.graph) return;
    this.renderer.setGraph(this.graph.getGraph());
  }

  private renderFrame(): void {
    const graph = this.graph;
    const renderer = this.renderer;
    const cursor = this.cursor;
    if (!graph || !renderer || !cursor) return;

    const interactor = graph.getInteractor();
    if (!interactor) return;

    const s = interactor.getState();

    renderer.setFollowedNode(s.followedNodeId);
    cursor.apply(interactor.cursorType);
    renderer.setMouseScreenPosition(s.gravityCenter);
    renderer.render();
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  public async rebuildGraph(): Promise<void> {
    await this.graph?.rebuildGraph();

    this.renderer?.setGraph(this.graph?.getGraph() ?? null);
    this.physics?.rebuild();
  }


  refreshTheme(): void {
    this.renderer?.refreshTheme();
  }

  async close(): Promise<void> {
    this.space.stop();
    for (const u of this.unregs) u();
    this.unregs = [];

    this.graph?.destroy();
    this.graph = null;
    this.anima = null;

    this.renderer?.destroy();
    this.renderer = null;
    this.cursor = null;

    this.canvas?.remove();
    this.canvas = null;
  }
}
