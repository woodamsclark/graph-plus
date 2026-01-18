import { App, Plugin } from "obsidian";
import { AnimaDirector } from "../systems/AnimaDirector.ts";
import { Renderer } from "./render/Renderer.ts";
import { cursor_selector } from "../systems/interaction/input/cursor_selector.ts";
import { SpaceTime } from "./physics/SpaceTime.ts";
import { Physics } from "./physics/Physics.ts";
import { Interaction } from "../systems/interaction/InteractionSystem.ts";
import { getSettings } from "../../obsidian/settings/settingsStore.ts";
import { ObsidianNavigator } from "../../obsidian/ObsidianNavigator.ts";
import { GraphState } from "../grammar/interfaces.ts";
import { ObsidianGraphSource } from "../../obsidian/ObsidianGraphSource.ts";
import { CameraController } from "../systems/CameraController.ts";


export class Orchestrator {
  private spaceTime: SpaceTime;

  private canvas: HTMLCanvasElement | null = null;
  private cursor: ReturnType<typeof cursor_selector> | null = null;

  private navigator: ObsidianNavigator;
  private graphSource: ObsidianGraphSource;

  private graphState: GraphState = new GraphState();

  private anima: AnimaDirector | null = null;
  private renderer: Renderer | null = null;

  private physics: Physics | null = null;
  private interactor: Interaction | null = null;
  private camera: CameraController | null = null;

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {
    this.spaceTime = new SpaceTime({ maxDtSeconds: 0.05 });
    this.navigator = new ObsidianNavigator(deps.app);

    // NOTE: this casts plugin to the data storage interface expected by GraphStore/GraphSource
    this.graphSource = new ObsidianGraphSource({
      getApp: () => this.deps.app,
      getPlugin: () => this.deps.plugin as any,
    });
  }

  async open(): Promise<void> {
    // Stage
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.tabIndex = 0;
    this.deps.containerEl.appendChild(this.canvas);

    // Domain-ish system
    this.anima = new AnimaDirector();

    // Camera (world-owned)
    this.camera = new CameraController(getSettings().camera.state);
    this.camera.setWorldTransform(null);

    // Renderer (world-owned)
    this.renderer = new Renderer(this.canvas, this.camera);
    this.cursor = cursor_selector(this.canvas);
    if (!this.renderer) return;

    // Interactor (world-owned)
    this.interactor = new Interaction({
      getGraph: () => this.graphState.get(),
      getCamera: () => this.camera,
      getCanvas: () => this.canvas!
    });

    // Physics (world-owned)
    this.physics = new Physics({
      getGraph:       () => this.graphState.get(),
      getCamera:      () => this.camera,
      getInteraction: () => this.interactor!.getState(),
    });

    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    // IMPORTANT: build graph once before starting the loop
    await this.rebuildGraph();

    // register systems
    this.spaceTime.register("interaction", this.interactor, 10);
    this.spaceTime.register("events", {tick: () => this.drainInteractionEvents()}, 20);
    this.spaceTime.register("physics", this.physics, 30);
    this.spaceTime.register("anima", this.anima, 40);
    this.spaceTime.register("render", this.renderer, 100);

    this.spaceTime.start();
  }

  private drainInteractionEvents(): void {
    const interactor = this.interactor;
    if (!interactor) return;

    for (const e of interactor.drainEvents()) {
      if (e.type === "PINNED_SET") this.physics?.setPinnedNodes(e.ids);

      if (e.type === "MOUSE_GRAVITY_SET") {
        getSettings().physics.mouseGravityEnabled = e.on;
      }

      if (e.type === "OPEN_NODE_REQUESTED") {
        const node = e.node;
        if (node.type.toLowerCase() === "tag") void this.navigator.openTagSearch(node.id);
        else void this.navigator.openNodeById(node.id);
      }
    }
  }

  private renderFrame(): void {
    const renderer    = this.renderer;
    const cursor      = this.cursor;
    const interactor  = this.interactor;
    if (!renderer || !cursor || !interactor) return;

    const s = interactor.getState();

    renderer.setFollowedNode(s.followedNodeId);
    cursor.apply(interactor.getCursorType());
    renderer.setMouseScreenPosition(s.gravityCenter);
    renderer.render();
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  public async rebuildGraph(): Promise<void> {
    const graph = await this.graphSource.rebuild();
    this.graphState.set(graph);

    this.renderer?.setGraph(graph);
    this.physics?.rebuild();
  }

  refreshTheme(): void {
    this.renderer?.refreshTheme();
  }

  async close(): Promise<void> {
    this.spaceTime.stop();

    this.physics?.destroy?.();
    this.physics = null;

    this.renderer?.destroy();
    this.renderer = null;

    this.cursor = null;
    this.interactor?.destroy();
    this.interactor = null;
    this.anima = null;

    this.canvas?.remove();
    this.canvas = null;
  }
}
