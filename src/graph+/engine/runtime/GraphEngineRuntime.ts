import { App, Plugin }                                          from "obsidian";
import { SpaceTime }                                            from "../../systems/SpaceTime.ts";
import { onSettingsChange, getSettings }                        from "../../../obsidian/settings/settingsStore.ts";
import { GraphControlsPanel }                                   from "../../ui/GraphControlsPanel.ts";
import { ObsidianNavigator }                                    from "../../../obsidian/ObsidianNavigator.ts";
import { Input }                                                from "../../systems/1. User Input/Input.ts";
import { InputBuffer }                                          from "../../systems/1. User Input/InputBuffer.ts";
import { UIInterpreter }                                        from "../../systems/2. UI Interpretation + State/UIInterpreter.ts";
import { UIStateStore }                                         from "../../systems/2. UI Interpretation + State/UIStateStore.ts";
import { HitTester }                                            from "../../systems/2. UI Interpretation + State/HitTester.ts";
import { Command  }                                             from "../../types/domain/commands.ts";
import {  Commander, CommandRegistry }                          from "../../systems/3. Module Commander/Commander.ts";
import { CommandBuffer }                                        from "../../systems/3. Module Commander/CommandBuffer.ts";
import { Anima }                                                from "../../systems/4. Modules/Anima.ts";
import { AnimaStateStore }                                      from "../../systems/4. Modules/AnimaStateStore.ts";
import { Physics }                                              from "../../systems/4. Modules/Physics.ts";
import { CameraController }                                     from "../../systems/5. Render/CameraController.ts";
import { Renderer }                                             from "../../systems/5. Render/Renderer.ts";
import { FrameStore }                                     from "../../systems/5. Render/FrameStore.ts";
import { FrameComposer }                                  from "../../systems/5. Render/FrameComposer.ts";
import { createCursorController, getCursorTypeFromInteraction } from "../../CursorController.ts";
import { Graph }                                                from "../../systems/4. Modules/Graph.ts";
import { NavigationController }                                 from "../controllers/NavigationController.ts";
import { InteractionController }                                from "../controllers/InteractionController.ts";
import { GraphCommandBindings }                                 from "./GraphCommandBindings.ts";
import { GraphSystemRegistry }                                  from "./GraphSystemRegistry.ts";
import {
  selectGraphSettings,
  selectPhysicsSettings,
  selectUIInterpreterSettings,
  selectRenderComposerSettings,
  selectInputSettings,
  selectCameraSettings,
  selectAnimaSettings,
} from '../../types/index.ts';
import type { UserInputEvent, DrainableBuffer } from '../../types/domain/ui.ts';
import { ThemeStyleResolver } from "../../../obsidian/themeStyleResolver.ts";
import { FocusFollowSystem } from "../../systems/2. UI Interpretation + State/FocusFollowSystem.ts";
import type { GraphLensState } from "../../types/domain/lens.ts";
import { createDefaultGraphLens } from "../../types/domain/lens.ts";



export class GraphEngineRuntime {
  private canvas:                 HTMLCanvasElement       | null = null;
  private graph:                  Graph                   | null = null;
  private commandSystem:          Commander               | null = null;
  private anima:                  Anima                   | null = null;
  private renderer:               Renderer                | null = null;
  private physics:                Physics                 | null = null;
  private uiInterpreter:          UIInterpreter           | null = null;
  private focusFollow:            FocusFollowSystem       | null = null;
  private camera:                 CameraController        | null = null;
  private frameComposer:          FrameComposer           | null = null;
  private navigationController:   NavigationController    | null = null;
  private interactionController:  InteractionController   | null = null;
  private commandBindings:        GraphCommandBindings    | null = null;
  private controlsPanel:          GraphControlsPanel      | null = null;
  private unsubscribeSettings: (() => void)               | null = null;  
  private navigator:              ObsidianNavigator;
  private spaceTime:              SpaceTime;
  private input!:                 Input;
  private inputBuffer:            DrainableBuffer<UserInputEvent> = new InputBuffer();
  private commandBuffer:          DrainableBuffer<Command>        = new CommandBuffer();
  private commandRegistry                                         = new CommandRegistry();
  private uiStateStore                                            = new UIStateStore();
  private animaStateStore                                         = new AnimaStateStore();
  private renderFrameStore                                        = new FrameStore();
  private hitTester                                               = new HitTester();
  private systemRegistry                                          = new GraphSystemRegistry();
  private themeStyleResolver = new ThemeStyleResolver(() => document.body);
  

  constructor(private deps: {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    initialLensState?: GraphLensState;
    onLensStateChange?: (state: GraphLensState) => void;
  }) {
    this.spaceTime            = new SpaceTime({ maxDtSeconds: 0.05 });
    this.navigator            = new ObsidianNavigator(deps.app);
  }

  private async applySettings(mode: 'live' | 'rebuild' = 'live'): Promise<void> {
    const settings = getSettings();

    this.graph?.updateSettings(               selectGraphSettings(settings)         );
    this.physics?.updateSettings(             selectPhysicsSettings(settings)       );
    this.uiInterpreter?.updateSettings(       selectUIInterpreterSettings(settings) );
    this.frameComposer?.updateSettings( selectRenderComposerSettings(settings));
    this.input?.updateSettings(               selectInputSettings(settings)         );
    this.camera?.updateSettings(              selectCameraSettings(settings)        );
    this.anima?.updateSettings(               selectAnimaSettings(settings)         );

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

    const cursor      = createCursorController(this.canvas);

    const settings = getSettings();

    this.camera = new CameraController(selectCameraSettings(settings));

    this.graph = new Graph(selectGraphSettings(settings), {
      app:    this.deps.app,
      plugin: this.deps.plugin as any,
    }, this.deps.initialLensState);
    

    this.input = new Input(selectInputSettings(settings), {
      getCanvas: () => this.canvas!,
      getBuffer: () => this.inputBuffer,
    });

    this.uiInterpreter = new UIInterpreter(selectUIInterpreterSettings(settings), {
      graph:             this.graph,
      camera:            this.camera,
      canvas:            this.canvas!,
      inputBuffer:       this.inputBuffer,
      commandBuffer:     this.commandBuffer,
      interactionState:  this.uiStateStore,
      hitTester:         this.hitTester,
    });

    this.focusFollow = new FocusFollowSystem({
      graph: this.graph,
      camera: this.camera,
      uiStateStore: this.uiStateStore,
    });

    this.physics = new Physics(selectPhysicsSettings(settings), {
      graph:             this.graph,
      camera:            this.camera,
      interactionState:  this.uiStateStore.get(),
      animaStore:        this.animaStateStore,
    });

    this.anima = new Anima(selectAnimaSettings(settings), {
      graph:             this.graph,
      animaStore:        this.animaStateStore,
    });

    this.frameComposer = new FrameComposer(selectRenderComposerSettings(settings), {
      graph:             this.graph,
      camera:            this.camera,
      uiState:           this.uiStateStore.get(),
      animaStore:        this.animaStateStore,
      frameStore:        this.renderFrameStore,
      getThemePalette: () => this.themeStyleResolver.getPalette(),
    });

    this.renderer = new Renderer(this.canvas, this.camera, this.renderFrameStore);

    this.navigationController = new NavigationController({
      navigator: this.navigator,
      graph: this.graph,
    });

    this.interactionController = new InteractionController({
      physics: this.physics,
      camera: this.camera,
      uiStateStore: this.uiStateStore,
    });

    this.commandSystem = new Commander({
      queue: this.commandBuffer,
      registry: this.commandRegistry,
      observers: [this.anima],
    });

    this.commandBindings = new GraphCommandBindings({
      registry: this.commandRegistry,
      navigation: this.navigationController,
      interaction: this.interactionController,
    });

    this.commandBindings.register();
    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    // IMPORTANT: initialize graph once before starting the loop
    await this.graph.initialize();
    this.physics?.rebuild?.();

    this.systemRegistry.register({
      spaceTime:      this.spaceTime,
      uiInterpreter:  this.uiInterpreter,
      commandSystem:  this.commandSystem,
      focusFollow:    this.focusFollow,
      anima:          this.anima,
      physics:        this.physics,
      frameComposer:  this.frameComposer,
      renderer:       this.renderer,
      cursorTick: () => {
        const css = getCursorTypeFromInteraction(this.uiStateStore.get());
        cursor.apply(css);
      },
    });

    this.deps.containerEl.style.position = "relative";
    this.controlsPanel = new GraphControlsPanel({
      getContainer: () => this.deps.containerEl,
      getLens: () => this.getLensState(),
      getGraph: () => this.graph?.get() ?? null,
      getSourceNodes: () => this.graph?.getSource()?.nodes ?? [],
      getRelations: () => [...new Set(
        (this.graph?.getSource()?.links ?? []).flatMap((link) => link.relations),
      )].sort(),
      getFocusedNodeId: () => this.uiStateStore.get().followedNodeId,
      getCurrentFileId: () => this.deps.app.workspace.getActiveFile()?.path ?? null,
      onLensChange: (next) => this.setLensState(next),
      onResetView: () => this.resetView(),
      onSettingsApplied: async (mode) => {
        await this.applySettings(mode);
        await (this.deps.plugin as any).saveSettings();
      }
    });

    this.controlsPanel.mount();
    this.unsubscribeSettings = onSettingsChange(() => {
      void this.applySettings('live');
    });

    await this.applySettings("live");

    this.spaceTime.start();
  }

  resize(w: number, h: number): void {
    this.renderer?.resize(w, h);
  }

  public async rebuildGraph(): Promise<void> {
    await this.graph?.rebuild();
    this.releaseMissingFocus();
    this.physics?.rebuild?.();
    this.controlsPanel?.refresh();
  }

  public getLensState(): GraphLensState {
    return this.graph?.getLensState()
      ?? this.deps.initialLensState
      ?? createDefaultGraphLens(getSettings().base.showTags);
  }

  public setLensState(next: GraphLensState): void {
    const previousMode = this.graph?.getLensState().form.mode ?? 'free';
    const effective = {
      filter: { ...next.filter },
      groups: next.groups.map((group) => ({ ...group })),
      form: { ...next.form },
    };

    if (previousMode !== 'mind-map' && effective.form.mode === 'mind-map' && !effective.form.rootId) {
      effective.form.rootId = this.uiStateStore.get().followedNodeId
        ?? this.deps.app.workspace.getActiveFile()?.path
        ?? null;
    }

    this.graph?.setLensState(effective);
    this.releaseMissingFocus();
    this.physics?.rebuild();
    if (previousMode !== effective.form.mode) this.resetView();
    this.controlsPanel?.refresh();
    this.deps.onLensStateChange?.(effective);
  }

  public resetView(): void {
    // Keep reset inside the command pipeline so UI state, camera state, and
    // command observers such as Anima all release focus together.
    this.commandBuffer.push({ type: 'ResetCamera' });
  }

  private releaseMissingFocus(): void {
    const followed = this.uiStateStore.get().followedNodeId;
    if (!followed) return;
    if (!this.graph?.get()?.nodes.some((node) => node.id === followed)) {
      this.uiStateStore.setFocusedNode(null);
    }
  }

  async close(): Promise<void> {
  this.spaceTime.stop();

  this.unsubscribeSettings?.();
  this.unsubscribeSettings = null;

  this.controlsPanel?.unmount();
  this.controlsPanel = null;

  this.physics?.destroy?.();
  this.physics = null;

  this.renderer?.destroy?.();
  this.renderer = null;

  this.uiInterpreter?.destroy?.();
  this.uiInterpreter = null;
  this.focusFollow = null;

  this.anima?.destroy?.();
  this.anima = null;

  this.frameComposer?.destroy?.();
  this.frameComposer = null;

  this.commandSystem = null;
  this.commandBindings = null;
  this.interactionController = null;
  this.navigationController = null;

  await this.graph?.save?.();
  this.graph?.destroy?.();
  this.graph = null;

  this.camera = null;

  this.canvas?.remove();
  this.canvas = null;
}

  
}
