import type { DrainableBuffer as DrainableBuffer, UserInputEvent, GraphModule } from "./grammar/interfaces.ts";

import { App, Plugin }                                          from "obsidian";
import { SpaceTime }                                            from "./systems/SpaceTime.ts";
import { getSettings }                                          from "../obsidian/settings/settingsStore.ts";
import { ObsidianNavigator }                                    from "../obsidian/ObsidianNavigator.ts";
import { Input }                                                from "./systems/1. User Input/Input.ts";
import { InputBuffer }                                          from "./systems/1. User Input/InputBuffer.ts";
import { UIInterpreter }                                        from "./systems/2. UI Interpretation + State/UIInterpreter.ts";
import { UIStateStore }                                         from "./systems/2. UI Interpretation + State/UIStateStore.ts";
import { HitTester }                                            from "./systems/2. UI Interpretation + State/HitTester.ts";
import { Command, Commander, CommandRegistry }                  from "./systems/3. Module Commander/Commander.ts";
import { CommandBuffer }                                        from "./systems/3. Module Commander/CommandBuffer.ts";
import { Anima }                                                from "./systems/4. Modules/Anima.ts";
import { AnimaStateStore }                                      from "./systems/4. Modules/AnimaStateStore.ts";
import { Physics }                                              from "./systems/4. Modules/Physics.ts";
import { CameraController }                                     from "./systems/5. Render/CameraController.ts";
import { Renderer }                                             from "./systems/5. Render/Renderer.ts";
import { RenderFrameStore }                                     from "./systems/5. Render/RenderFrameStore.ts";
import { RenderStateComposer }                                  from "./systems/5. Render/RenderStateComposer.ts";
import { createCursorController, getCursorTypeFromInteraction } from "./CursorController.ts";
import { Graph }                                                from "./systems/4. Modules/Graph.ts";


export class Orchestrator {
  private navigator:      ObsidianNavigator;
  private spaceTime:      SpaceTime;
  private input!:         Input;
  private canvas:         HTMLCanvasElement | null        = null;
  private inputBuffer:    DrainableBuffer<UserInputEvent> = new InputBuffer();
  private graph:          GraphModule;
  private commandBuffer:  DrainableBuffer<Command>        = new CommandBuffer();
  private commandRegistry                                 = new CommandRegistry();
  private commandSystem:  Commander | null                = null;
  private anima:          Anima | null                    = null;
  private renderer:       Renderer | null                 = null;
  private physics:        Physics | null                  = null;
  private uiInterpreter:  UIInterpreter | null            = null;
  private camera:         CameraController | null         = null;
  private uiStateStore                                    = new UIStateStore();
  private animaStateStore                                 = new AnimaStateStore();
  private renderFrameStore                                = new RenderFrameStore();
  private hitTester                                       = new HitTester();
  private renderStateComposer: RenderStateComposer | null = null;
  

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {
    this.spaceTime  = new SpaceTime({ maxDtSeconds: 0.05 });
    this.navigator  = new ObsidianNavigator(deps.app);

    this.graph = new Graph({
      getApp: ()              => this.deps.app,
      getPlugin: ()           => this.deps.plugin as any,
      getGraphSettings: ()    => getSettings().graph,
      getPhysicsSettings: ()  => getSettings().physics,
    });
  }

  async open(): Promise<void> {
    // Stage
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.tabIndex = 0;
    this.deps.containerEl.appendChild(this.canvas);
    const cursor = createCursorController(this.canvas);

   // 5. Render
    this.camera = new CameraController(getSettings().camera.state);
    this.camera.setWorldTransform(null);

    this.renderer = new Renderer(this.canvas, this.camera, this.renderFrameStore);

    // 1. Input
    this.input = new Input({
      getCanvas: () => this.canvas!,
      getBuffer: () => this.inputBuffer,
      uiSettings: getSettings().ui,
    });

    // 2. UI State Interpreter
    this.uiInterpreter = new UIInterpreter({
      getGraph: ()            => this.graph,
      getCamera: ()           => this.camera,
      getCanvas: ()           => this.canvas!,
      getInputBuffer: ()      => this.inputBuffer,
      getCommands: ()         => this.commandBuffer,
      getUISettings: ()       => getSettings().ui,
      getInteractionState: () => this.uiStateStore,
      getHitTester: ()        => this.hitTester,
    });

    // 3. Command
   

    this.commandRegistry.register("OpenNode", (command) => {
    const graph = this.graph.get();
    const node = graph?.nodes.find(n => n.id === command.nodeId);
    if (!node) return;

    if (node.type.toLowerCase() === "tag") void this.navigator.openTagSearch(node.id);
      else void this.navigator.openNodeById(node.id);
    });

    this.commandRegistry.register("SetMouseGravity", (command) => {
      getSettings().physics.mouseGravityEnabled = command.on;
    });

    this.commandRegistry.register("PinNode", (command) => {
      this.physics?.pinNode(command.nodeId);
    });

    this.commandRegistry.register("UnpinNode", (command) => {
      this.physics?.unpinNode(command.nodeId);
    });

    this.commandRegistry.register("BeginDrag", (command) => {
      this.physics?.beginDrag?.(command.nodeId, command.targetWorld);
    });

    this.commandRegistry.register("UpdateDragTarget", (command) => {
      this.physics?.updateDragTarget?.(command.targetWorld);
    });

    this.commandRegistry.register("EndDrag", (command) => {
      this.physics?.endDrag?.();
    });

    this.commandRegistry.register("ResetCamera", () => {
      this.camera?.resetCamera();
    });

    this.commandRegistry.register("StartPanCamera", (command) => {
      this.camera?.startPan(command.screen.x, command.screen.y);
    });

    this.commandRegistry.register("UpdatePanCamera", (command) => {
      this.camera?.updatePan(command.screen.x, command.screen.y);
    });

    this.commandRegistry.register("EndPanCamera", () => {
      this.camera?.endPan();
    });

    this.commandRegistry.register("StartRotateCamera", (command) => {
      this.camera?.startRotate(command.screen.x, command.screen.y);
    });

    this.commandRegistry.register("UpdateRotateCamera", (command) => {
      this.camera?.updateRotate(command.screen.x, command.screen.y);
    });

    this.commandRegistry.register("EndRotateCamera", () => {
      this.camera?.endRotate();
    });

    this.commandRegistry.register("ZoomCamera", (command) => {
      this.camera?.updateZoom(command.screen.x, command.screen.y, command.delta);
    });

    this.commandRegistry.register("SetGravityCenter", (command) => {
      this.uiStateStore.setGravityCenter(command.point);
    });

    this.commandRegistry.register("SetHoveredNode", (command) => {
      this.uiStateStore.setHoveredNode(command.nodeId);
    });

    this.commandRegistry.register("SetFollowedNode", (command) => {
      this.uiStateStore.setFollowedNode(command.nodeId);
    });

    this.commandRegistry.register("SetDraggedNode", (command) => {
      this.uiStateStore.setDraggedNode(command.nodeId);
    });

    this.commandRegistry.register("SetPanning", (command) => {
      this.uiStateStore.setPanning(command.on);
    });

    this.commandRegistry.register("SetRotating", (command) => {
      this.uiStateStore.setRotating(command.on);
    });

    this.commandRegistry.register("SetCameraTarget", (command) => {
      this.camera?.patchState({
        targetX: command.target.x,
        targetY: command.target.y,
        targetZ: command.target.z,
      });
    });

    this.anima = new Anima({
      getGraph: () => this.graph,
      getStore: () => this.animaStateStore,
    });

    this.renderStateComposer = new RenderStateComposer({
      getGraph: () => this.graph,
      getUIState: () => this.uiStateStore.get(),
      getGraphSettings: () => getSettings().graph,
      getAnimaStore: () => this.animaStateStore,
      getFrameStore: () => this.renderFrameStore,
    });

    this.commandSystem = new Commander({
      getQueue: () => this.commandBuffer,
      registry: this.commandRegistry,
      observers: this.anima ? [this.anima] : [],
    });

    // 4. Physics (world-owned)
    this.physics = new Physics({
      getGraph: ()            => this.graph,
      getCamera: ()           => this.camera,
      getInteractionState: () => this.uiStateStore.get(),
      getPhysicsSettings: ()    => getSettings().physics,
    });

 

    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    // IMPORTANT: initialize graph once before starting the loop
    await this.graph.initialize();
    this.physics?.rebuild?.();

    // register systems
    this.spaceTime.register("translate", this.uiInterpreter, 10);
    this.spaceTime.register("commands", { tick: () => this.commandSystem?.tick() }, 20);
    this.spaceTime.register("anima", this.anima, 25);
    this.spaceTime.register("physics", this.physics, 30);
    this.spaceTime.register("render-state-composer", this.renderStateComposer, 90);
    this.spaceTime.register("cursor", {
      tick: () => {
        const css = getCursorTypeFromInteraction(this.uiStateStore.get());
        cursor.apply(css);
      }
    }, 95);
    this.spaceTime.register("render", this.renderer, 100);


    this.spaceTime.start();
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  public async rebuildGraph(): Promise<void> {
    await this.graph.rebuild();
    this.physics?.rebuild?.();
  }

  refreshTheme(): void {
    // no-op: renderer now consumes config from RenderStateComposer
  }


  async close(): Promise<void> {
    await this.graph.save?.();
    this.spaceTime.stop();

    this.physics?.dispose?.();
    this.physics = null;

    this.renderer?.dispose?.();
    this.renderer = null;

    this.uiInterpreter?.destroy();
    this.uiInterpreter = null;
    this.anima?.dispose?.();
    this.anima = null;
    this.renderStateComposer?.dispose?.();
    this.renderStateComposer = null;
    this.graph.dispose?.();

    this.canvas?.remove();
    this.canvas = null;
  }
}
