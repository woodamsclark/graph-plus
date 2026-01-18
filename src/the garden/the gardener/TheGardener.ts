import { App, Plugin } from "obsidian";
import { AnimaDirector } from "../eve/AnimaDirector.ts";
import { createRenderer } from "./render/render.ts";
import { cursor_selector } from "../eve/interacts/input/cursor_selector.ts";
import { Space } from "./physics/Space.ts";
import type { Renderer } from "../adam/interfaces.ts";
import { Physics } from "./physics/Physics.ts";
import { InteractionSystem } from "../eve/interacts/InteractionSystem.ts";
import { getSettings } from "../../obsidian/settings/settingsStore.ts";
import { ObsidianNavigator } from "../../obsidian/ObsidianNavigator.ts";
import { InputManager } from "../eve/interacts/input/InputManager.ts";
import { GraphState } from "../adam/GraphState.ts";
import { ObsidianGraphSource } from "../../obsidian/ObsidianGraphSource.ts";
import { CameraController } from "../eve/CameraController.ts";

export class TheGardener {
  private space: Space;

  private canvas: HTMLCanvasElement | null = null;
  private cursor: ReturnType<typeof cursor_selector> | null = null;
  private input: InputManager | null = null;

  private navigator: ObsidianNavigator;
  private source: ObsidianGraphSource;

  private graphState: GraphState = new GraphState();

  private anima: AnimaDirector | null = null;
  private renderer: Renderer | null = null;

  private physics: Physics | null = null;
  private interactor: InteractionSystem | null = null;
  private camera: CameraController | null = null;

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {
    this.space = new Space({ maxDtSeconds: 0.05 });
    this.navigator = new ObsidianNavigator(deps.app);

    // NOTE: this casts plugin to the data storage interface expected by GraphStore/GraphSource
    this.source = new ObsidianGraphSource({
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
    this.renderer = createRenderer(this.canvas, this.camera);
    this.cursor = cursor_selector(this.canvas);

    // Interactor (world-owned)
    this.interactor = new InteractionSystem({
      getGraph: () => this.graphState.get(),
      getCamera: () => this.camera,
    });

    // Input adapter (world edge)
    this.input = new InputManager(this.canvas, {
      onRotateStart: (x, y) => this.interactor!.startRotate(x, y),
      onRotateMove:  (x, y) => this.interactor!.updateRotate(x, y),
      onRotateEnd:   ()     => this.interactor!.endRotate(),

      onPanStart:    (x, y) => this.interactor!.startPan(x, y),
      onPanMove:     (x, y) => this.interactor!.updatePan(x, y),
      onPanEnd:      ()     => this.interactor!.endPan(),

      onOpenNode:    (x, y) => this.interactor!.openNode(x, y),
      onMouseMove:   (x, y) => this.interactor!.updateGravityCenter(x, y),

      onDragStart:   (id, x, y) => this.interactor!.startDrag(id, x, y),
      onDragMove:    (x, y)     => this.interactor!.updateDrag(x, y),
      onDragEnd:     ()         => this.interactor!.endDrag(),

      onZoom:        (x, y, d)  => this.interactor!.updateZoom(x, y, d),
      onFollowStart: (id)       => this.interactor!.startFollow(id),
      onFollowEnd:   ()         => this.interactor!.endFollow(),

      resetCamera:   ()         => this.camera!.resetCamera(),

      getClickedNode:(x, y)     => this.interactor!.getClickedNodeIdLabel(x, y),
    });

    // Physics (world-owned)
    this.physics = new Physics({
      getGraph:       () => this.graphState.get(),
      getCamera:      () => this.camera,
      getInteraction: () => this.interactor!.getState(),
    });

    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer?.resize(rect.width, rect.height);

    // ✅ IMPORTANT: build graph once before starting the loop
    await this.rebuildGraph();

    // Tick order
    this.space.register("interaction", this.interactor);
    this.space.register("events", { tick: () => this.drainInteractionEvents() } as any);
    this.space.register("physics", { tick: (dt: number) => this.physics?.tick(dt) } as any);
    this.space.register("anima", this.anima);
    this.space.register("render", { tick: () => this.renderFrame() } as any);

    this.space.start();
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
    const renderer = this.renderer;
    const cursor = this.cursor;
    const interactor = this.interactor;
    if (!renderer || !cursor || !interactor) return;

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
    const graph = await this.source.rebuild();
    this.graphState.set(graph);

    this.renderer?.setGraph(graph);
    this.physics?.rebuild();
  }

  refreshTheme(): void {
    this.renderer?.refreshTheme();
  }

  async close(): Promise<void> {
    this.space.stop();

    this.input?.destroy();
    this.input = null;

    this.physics?.destroy?.();
    this.physics = null;

    this.renderer?.destroy();
    this.renderer = null;

    this.cursor = null;
    this.interactor = null;
    this.anima = null;

    this.canvas?.remove();
    this.canvas = null;
  }
}
