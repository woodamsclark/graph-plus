import type { DrainableBuffer as DrainableBuffer, UserInputEvent, GraphModule } from "../grammar/interfaces.ts";

import { App, Plugin }                                          from "obsidian";
import { SpaceTime }                                            from "../systems/SpaceTime.ts";
import { getSettings }                                          from "../../obsidian/settings/settingsStore.ts";
import { ObsidianNavigator }                                    from "../../obsidian/ObsidianNavigator.ts";
import { Input }                                                from "../systems/1. User Input/Input.ts";
import { InputBuffer }                                          from "../systems/1. User Input/InputBuffer.ts";
import { UIInterpreter }                                        from "../systems/2. UI Interpretation + State/UIInterpreter.ts";
import { UIStateStore }                                         from "../systems/2. UI Interpretation + State/UIStateStore.ts";
import { HitTester }                                            from "../systems/2. UI Interpretation + State/HitTester.ts";
import { Command, Commander, CommandRegistry }                  from "../systems/3. Module Commander/Commander.ts";
import { CommandBuffer }                                        from "../systems/3. Module Commander/CommandBuffer.ts";
import { Anima }                                                from "../systems/4. Modules/Anima.ts";
import { AnimaStateStore }                                      from "../systems/4. Modules/AnimaStateStore.ts";
import { Physics }                                              from "../systems/4. Modules/Physics.ts";
import { CameraController }                                     from "../systems/5. Render/CameraController.ts";
import { Renderer }                                             from "../systems/5. Render/Renderer.ts";
import { RenderFrameStore }                                     from "../systems/5. Render/RenderFrameStore.ts";
import { RenderStateComposer }                                  from "../systems/5. Render/RenderStateComposer.ts";
import { createCursorController, getCursorTypeFromInteraction } from "../CursorController.ts";
import { Graph }                                                from "../systems/4. Modules/Graph.ts";
import { NavigationController }                                 from "./controllers/NavigationController.ts";
import { InteractionController }                                from "./controllers/InteractionController.ts";
import { GraphCommandBindings }                                 from "./runtime/GraphCommandBindings.ts";
import { GraphSystemRegistry }                                  from "./runtime/GraphSystemRegistry.ts";


export class GraphEngineRuntime {
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
  private navigationController: NavigationController | null = null;
  private interactionController: InteractionController | null = null;
  private commandBindings: GraphCommandBindings | null = null;
  private systemRegistry = new GraphSystemRegistry();
  

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

    // 4. Physics (world-owned)
    this.physics = new Physics({
      getGraph: ()            => this.graph,
      getCamera: ()           => this.camera,
      getInteractionState: () => this.uiStateStore.get(),
      getPhysicsSettings: ()    => getSettings().physics,
    });

    this.navigationController = new NavigationController({
      navigator: this.navigator,
      getGraph: () => this.graph,
    });

    this.interactionController = new InteractionController({
      getPhysics: () => this.physics,
      getCamera: () => this.camera,
      getUIStateStore: () => this.uiStateStore,
    });

    this.commandBindings = new GraphCommandBindings({
      registry: this.commandRegistry,
      navigation: this.navigationController,
      interaction: this.interactionController,
    });

    this.commandBindings.register();

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

    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    // IMPORTANT: initialize graph once before starting the loop
    await this.graph.initialize();
    this.physics?.rebuild?.();

    this.systemRegistry.register({
      spaceTime: this.spaceTime,
      uiInterpreter: this.uiInterpreter,
      commandSystem: this.commandSystem,
      anima: this.anima,
      physics: this.physics,
      renderStateComposer: this.renderStateComposer,
      renderer: this.renderer,
      cursorTick: () => {
        const css = getCursorTypeFromInteraction(this.uiStateStore.get());
        cursor.apply(css);
      },
    });


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
    this.commandBindings = null;
    this.interactionController = null;
    this.navigationController = null;
    this.graph.dispose?.();

    this.canvas?.remove();
    this.canvas = null;
  }
}
