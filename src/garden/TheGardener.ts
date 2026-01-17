import { App, Plugin } from "obsidian";
import { GraphDirector } from "./graph/GraphDirector.ts";
import { AnimaDirector } from "./anima/AnimaDirector.ts";
import { createRenderer } from "./render.ts";
import { createCursorController } from "./graph/input/CursorController.ts";
import { time } from "./time.ts";
import type { Renderer } from "../shared/interfaces.ts";

export class TheGardener {
  private time = new time({ maxDtSeconds: 0.05 });
  private unregs: Array<() => void> = [];

  private canvas: HTMLCanvasElement | null = null;
  private cursor: ReturnType<typeof createCursorController> | null = null;

  private graph: GraphDirector | null = null;
  private anima: AnimaDirector | null = null;
  private renderer: Renderer | null = null;

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {}

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

    // Initial sizing + bind graph
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
    this.syncRendererGraph();

    // Order is important
    this.unregs.push(this.time.register("graph",  (dt, now) => this.graph?.tick(dt, now)));
    this.unregs.push(this.time.register("anima",  (dt, now) => this.anima?.tick(dt, now)));
    this.unregs.push(this.time.register("render", ()        => this.renderFrame()));

    this.time.start();
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

    renderer.setFollowedNode(interactor.followedNodeId);
    cursor.apply(interactor.cursorType);
    renderer.setMouseScreenPosition(interactor.getGravityCenter());
    renderer.render();
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  async rebuildGraph(): Promise<void> {
    await this.graph?.rebuildGraph();
    this.syncRendererGraph();
  }

  refreshTheme(): void {
    this.renderer?.refreshTheme();
  }

  async close(): Promise<void> {
    this.time.stop();
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
