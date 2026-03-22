import { App, Plugin }                from "obsidian";
import { GraphState, InputSettings }  from "./grammar/interfaces.ts";
import { SpaceTime }                  from "./systems/SpaceTime.ts";
import { getSettings }                from "../obsidian/settings/settingsStore.ts";
import { ObsidianNavigator }          from "../obsidian/ObsidianNavigator.ts";
import { ObsidianGraphSource }        from "../obsidian/ObsidianGraphSource.ts";
import { Input }                      from "./systems/1. User Input/Input.ts";
import { InputBuffer }                from "./systems/1. User Input/InputBuffer.ts";
import { InteractionInterpreter }     from "./systems/2. UI Interpretation + State/UIInterpreter.ts";
import { Commander }                  from "./systems/3. Module Commander/Commander.ts";
import { CommandBuffer }              from "./systems/3. Module Commander/CommandBuffer.ts";
import { Anima }                      from "./systems/4. Modules/Anima.ts";
import { Physics }                    from "./systems/4. Modules/Physics.ts";
import { Renderer }                   from "./systems/5. Render/Renderer.ts";
import { Camera }                     from "./systems/5. Render/Camera.ts";
import { createCursorController }            from "./CursorController.ts";
import { InteractionStateStore }      from "./systems/2. UI Interpretation + State/UIStateStore.ts";
import { getCursorTypeFromInteraction } from "./CursorController.ts";


export class Orchestrator {
  private commandBuffer = new CommandBuffer();
  private commandSystem: Commander | null = null;

  private spaceTime: SpaceTime;

  private canvas: HTMLCanvasElement | null = null;

  private navigator: ObsidianNavigator;
  private graphSource: ObsidianGraphSource;

  private graphState: GraphState = new GraphState();
  private input!: Input;
  private inputBuffer: InputBuffer = new InputBuffer();

  private anima: Anima | null = null;
  private renderer: Renderer | null = null;

  private physics: Physics | null = null;
  private translator: InteractionInterpreter | null = null;
  private camera: Camera | null = null;
  private interactionStateStore = new InteractionStateStore();
  

  constructor(private deps: { app: App; plugin: Plugin; containerEl: HTMLElement }) {
    this.spaceTime  = new SpaceTime({ maxDtSeconds: 0.05 });
    this.navigator  = new ObsidianNavigator(deps.app);

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
    const cursor = createCursorController(this.canvas);

   // 5. Render
    this.camera = new Camera(getSettings().camera.state);
    this.camera.setWorldTransform(null);

    this.renderer = new Renderer(this.canvas, this.camera);
    if (!this.renderer) return;


    // 1. Input (world-owned)
    this.input = new Input({
      getCanvas: () => this.canvas!,
      getBuffer: () => this.inputBuffer,
      inputSettings: getSettings().input,
    });

    // 2. Translator (world-owned)
    this.translator = new InteractionInterpreter({
      getGraph: () => this.graphState.get(),
      getCamera: () => this.camera,
      getCanvas: () => this.canvas!,
      getBuffer: () => this.inputBuffer,
      getCommands: () => this.commandBuffer,
      getCameraSettings: () => ({}), // future use send Camera only the settings it needs
      getInteractionState: () => this.interactionStateStore,
    });

    // 3. Command
    this.commandSystem = new Commander({
      getQueue: () => this.commandBuffer,
      handlers: {
        pinNode:                (nodeId)              => { this.physics?.pinNode(nodeId); },
        unpinNode:              (nodeId)              => { this.physics?.unpinNode(nodeId); },
        setMouseGravity:        (on)                  => { getSettings().physics.mouseGravityEnabled = on; },
        openNode:               (nodeId)              => { const graph = this.graphState.get(); const node = graph?.nodes.find(n => n.id === nodeId); if (!node) return; if (node.type.toLowerCase() === "tag") void this.navigator.openTagSearch(node.id); else void this.navigator.openNodeById(node.id);},
        dragTarget:             (nodeId, targetWorld) => { this.physics?.setDragTarget(nodeId, targetWorld); },
        beginDrag:              (nodeId)              => { this.physics?.beginDrag(nodeId); },
        endDrag:                (nodeId)              => { this.physics?.endDrag(nodeId); },
        onNodeCommandExecuted:  (nodeId, commandType) => { this.anima?.add(nodeId, 20); },
        resetCamera:            ()                    => { this.camera?.resetCamera(); },
        startPanCamera:         (screen)              => { this.camera?.startPan(screen.x, screen.y); },
        updatePanCamera:        (screen)              => { this.camera?.updatePan(screen.x, screen.y); },
        endPanCamera:           ()                    => { this.camera?.endPan(); },
        startRotateCamera:      (screen)              => { this.camera?.startRotate(screen.x, screen.y); },
        updateRotateCamera:     (screen)              => { this.camera?.updateRotate(screen.x, screen.y); },
        endRotateCamera:        ()                    => { this.camera?.endRotate(); },
        zoomCamera:             (screen, delta)       => { this.camera?.updateZoom(screen.x, screen.y, delta); },
        setGravityCenter:       (point)               => { this.interactionStateStore.setGravityCenter(point); },
        setHoveredNode:         (nodeId)              => { this.interactionStateStore.setHoveredNode(nodeId); },
        setFollowedNode:        (nodeId)              => { this.interactionStateStore.setFollowedNode(nodeId); },
        setDraggedNode:         (nodeId)              => { this.interactionStateStore.setDraggedNode(nodeId); },
        setPanning:             (on)                  => { this.interactionStateStore.setPanning(on); },
        setRotating:            (on)                  => { this.interactionStateStore.setRotating(on); },
        setCameraTarget:        (target)              => { this.camera?.patchState({targetX: target.x,targetY: target.y,targetZ: target.z, });
        },
      }
  });
    this.anima = new Anima({
      getGraph: () => this.graphState.get(),
    });


    // 4. Physics (world-owned)
    this.physics = new Physics({
      getGraph:       () => this.graphState.get(),
      getCamera:      () => this.camera,
      getInteractionState: () => this.interactionStateStore.get(),
    });

 

    // Initial sizing
    const rect = this.deps.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);

    // IMPORTANT: build graph once before starting the loop
    await this.rebuildGraph();

    // register systems
    this.spaceTime.register("translate", this.translator, 10);
    this.spaceTime.register("commands", { tick: () => this.commandSystem?.tick() }, 20);
    this.spaceTime.register("anima", this.anima, 25);
    this.spaceTime.register("physics", this.physics, 30);
    this.spaceTime.register("cursor", { tick: () => { const css = getCursorTypeFromInteraction(this.interactionStateStore.get()); cursor.apply(css); } }, 95);
    this.spaceTime.register("render", this.renderer, 100);


    this.spaceTime.start();
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
    this.graphSource.save();
    this.spaceTime.stop();

    this.physics?.destroy?.();
    this.physics = null;

    this.renderer?.destroy();
    this.renderer = null;

    this.translator?.destroy();
    this.translator = null;
    this.anima = null;

    this.canvas?.remove();
    this.canvas = null;
  }
}
