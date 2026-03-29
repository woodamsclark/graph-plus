import type { DrainableBuffer as DrainableBuffer, UserInputEvent, GraphModule } from "../../grammar/interfaces.ts";

import { App, Plugin }                                          from "obsidian";
import { SpaceTime }                                            from "../../systems/SpaceTime.ts";
import { onSettingsChange, getSettings } from "../../../obsidian/settings/settingsStore.ts";
import { LiveSettingsOverlay } from "../../ui/LiveSettingsOverlay.ts";
import { ObsidianNavigator }                                    from "../../../obsidian/ObsidianNavigator.ts";
import { Input }                                                from "../../systems/1. User Input/Input.ts";
import { InputBuffer }                                          from "../../systems/1. User Input/InputBuffer.ts";
import { UIInterpreter }                                        from "../../systems/2. UI Interpretation + State/UIInterpreter.ts";
import { UIStateStore }                                         from "../../systems/2. UI Interpretation + State/UIStateStore.ts";
import { HitTester }                                            from "../../systems/2. UI Interpretation + State/HitTester.ts";
import { Command, Commander, CommandRegistry }                  from "../../systems/3. Module Commander/Commander.ts";
import { CommandBuffer }                                        from "../../systems/3. Module Commander/CommandBuffer.ts";
import { Anima }                                                from "../../systems/4. Modules/Anima.ts";
import { AnimaStateStore }                                      from "../../systems/4. Modules/AnimaStateStore.ts";
import { Physics }                                              from "../../systems/4. Modules/Physics.ts";
import { CameraController }                                     from "../../systems/5. Render/CameraController.ts";
import { Renderer }                                             from "../../systems/5. Render/Renderer.ts";
import { RenderFrameStore }                                     from "../../systems/5. Render/RenderFrameStore.ts";
import { RenderStateComposer }                                  from "../../systems/5. Render/RenderStateComposer.ts";
import { createCursorController, getCursorTypeFromInteraction } from "../../CursorController.ts";
import { Graph }                                                from "../../systems/4. Modules/Graph.ts";
import { NavigationController }                                 from "../controllers/NavigationController.ts";
import { InteractionController }                                from "../controllers/InteractionController.ts";
import { GraphCommandBindings }                                 from "./GraphCommandBindings.ts";
import { GraphSystemRegistry }                                  from "./GraphSystemRegistry.ts";
import { selectCameraSettings, selectGraphSettings, selectInputSettings, selectPhysicsSettings, selectUIInterpreterSettings } from "../../../obsidian/settings/settingsSelectors.ts";
import { selectRendererStateComposerSettings } from "../../../obsidian/settings/settingsSelectors.ts";



export class GraphEngineRuntime {
  private canvas:                 HTMLCanvasElement       | null = null;
  private graph:                  GraphModule             | null = null;
  private commandSystem:          Commander               | null = null;
  private anima:                  Anima                   | null = null;
  private renderer:               Renderer                | null = null;
  private physics:                Physics                 | null = null;
  private uiInterpreter:          UIInterpreter           | null = null;
  private camera:                 CameraController        | null = null;
  private renderStateComposer:    RenderStateComposer     | null = null;
  private navigationController:   NavigationController    | null = null;
  private interactionController:  InteractionController   | null = null;
  private commandBindings:        GraphCommandBindings    | null = null;
  private liveSettingsOverlay:    LiveSettingsOverlay     | null = null;
  private unsubscribeSettings: (() => void)               | null = null;  
  private navigator:              ObsidianNavigator;
  private spaceTime:              SpaceTime;
  private input!:                 Input;
  private inputBuffer:            DrainableBuffer<UserInputEvent> = new InputBuffer();
  private commandBuffer:          DrainableBuffer<Command>        = new CommandBuffer();
  private commandRegistry                                         = new CommandRegistry();
  private uiStateStore                                            = new UIStateStore();
  private animaStateStore                                         = new AnimaStateStore();
  private renderFrameStore                                        = new RenderFrameStore();
  private hitTester                                               = new HitTester();
  private systemRegistry                                          = new GraphSystemRegistry();
  

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {
    this.spaceTime            = new SpaceTime({ maxDtSeconds: 0.05 });
    this.navigator            = new ObsidianNavigator(deps.app);
  }

  private async applySettings(mode: 'live' | 'rebuild'): Promise<void> {
    const settings = getSettings();

    this.input?.updateSettings(settings);
    this.camera?.updateSettings(settings);
    //this.renderer?.updateSettings(settings);
    this.uiInterpreter?.updateSettings(settings);
    this.physics?.updateSettings(settings);

    if (mode === 'rebuild') {
      await this.rebuildGraph();
    }
  }

  async open(): Promise<void> {
    // Stage
    this.canvas               = document.createElement("canvas");
    this.canvas.style.width   = "100%";
    this.canvas.style.height  = "100%";
    this.canvas.tabIndex      = 0;
    this.deps.containerEl.appendChild(this.canvas);

    const overlay = document.createElement("div");
    overlay.className = "graphplus-live-settings";
    this.deps.containerEl.appendChild(overlay);

    const cursor = createCursorController(this.canvas);



    const settings = getSettings();
    
   // 5. Camera
    this.camera = new CameraController(selectCameraSettings(settings));
    this.camera.setWorldTransform(null);




    // 1. Input
    this.input = new Input(
      selectInputSettings(settings),
      {
        getCanvas: ()           => this.canvas!,
        getBuffer: ()           => this.inputBuffer,
      }
    );


    this.graph = new Graph(
      selectGraphSettings(settings),
      { getApp: () => this.deps.app, getPlugin: () => this.deps.plugin as any }
    );


    // 2. UI State Interpreter
    this.uiInterpreter = new UIInterpreter(
      selectUIInterpreterSettings(settings),
      {
        getGraph: ()            => this.graph!,
        getCamera: ()           => this.camera!,
        getCanvas: ()           => this.canvas!,
        getInputBuffer: ()      => this.inputBuffer,
        getCommands: ()         => this.commandBuffer,
        getInteractionState: () => this.uiStateStore,
        getHitTester: ()        => this.hitTester,
      }
    );

    /// 3. Commander
    this.commandSystem = new Commander({
      getQueue: () => this.commandBuffer,
      registry: this.commandRegistry,
      observers: this.anima ? [this.anima] : [],
    });

    // 4. Physics (world-owned)


    this.physics = new Physics( 
      selectPhysicsSettings(settings),
      {
        getGraph:             ()  => this.graph!,
        getCamera:            ()  => this.camera,
        getInteractionState:  ()  => this.uiStateStore.get()
      }
    );

    this.navigationController = new NavigationController({
      navigator: this.navigator,
      getGraph: ()            => this.graph!,
    });

    this.interactionController = new InteractionController({
      getPhysics: ()          => this.physics,
      getCamera: ()           => this.camera,
      getUIStateStore: ()     => this.uiStateStore,
    });

    this.commandBindings = new GraphCommandBindings({
      registry:     this.commandRegistry,
      navigation:   this.navigationController,
      interaction:  this.interactionController,
    });

    this.commandBindings.register();


    this.anima = new Anima(
      //selectGraphSettings(settings),
      {
        getGraph: ()      => this.graph!,
        getAnimaStore: () => this.animaStateStore,
      }
    );


    // 5. Render
        this.renderer = new Renderer(
      this.canvas, 
      this.camera,
      this.renderFrameStore
    );

    this.renderStateComposer = new RenderStateComposer(
      selectRendererStateComposerSettings(settings),
      {
        getGraph:       () => this.graph!,
        getUIState:     () => this.uiStateStore.get(),
        getAnimaStore:  () => this.animaStateStore,
        getFrameStore:  () => this.renderFrameStore,
      }
    );

    

    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    // IMPORTANT: initialize graph once before starting the loop
    await this.graph.initialize();
    this.physics?.rebuild?.();

    this.systemRegistry.register({
      spaceTime:            this.spaceTime,
      uiInterpreter:        this.uiInterpreter,
      commandSystem:        this.commandSystem,
      anima:                this.anima,
      physics:              this.physics,
      renderStateComposer:  this.renderStateComposer,
      renderer:             this.renderer,
      cursorTick: () => {
        const css = getCursorTypeFromInteraction(this.uiStateStore.get());
        cursor.apply(css);
      },
    });

    this.deps.containerEl.style.position = "relative";
    this.liveSettingsOverlay = new LiveSettingsOverlay(
       {
        getContainer: () => this.deps.containerEl,
        onSettingsApplied: async (mode) => {
          this.input?.updateSettings(settings);
          this.camera?.updateSettings(settings);

          if (mode === 'rebuild') {
            await this.rebuildGraph();
          }
        } } );

    this.liveSettingsOverlay.mount();
      this.unsubscribeSettings = onSettingsChange(() => {
      this.input?.updateSettings(settings);
      this.camera?.updateSettings(settings);
    });

    this.applySettings("rebuild");

    this.spaceTime.start();
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  public async rebuildGraph(): Promise<void> {
    await this.graph?.rebuild();
    this.physics?.rebuild?.();
  }

  async close(): Promise<void> {
    await this.graph?.save?.();
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
    this.graph?.dispose?.();

    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;

    this.liveSettingsOverlay?.unmount();
    this.liveSettingsOverlay = null;

    this.input?.destroy?.();

    this.canvas?.remove();
    this.canvas = null;
  }

  
}
