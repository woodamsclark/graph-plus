import type { GraphData }                       from "../types/domain/graph.ts";
import type { UserInputEvent, DrainableBuffer } from "../types/domain/ui.ts";
import type { UIStateStore }                    from "../systems/2. UI Interpretation + State/UIStateStore.ts";
import type { Command }                         from "../types/domain/commands.ts";
import type { HitTester }                       from "../systems/2. UI Interpretation + State/HitTester.ts";
import      { CameraController }                from "../systems/5. Render/CameraController.ts";

export type UIInterpreterDeps = {
  getGraph:             () => GraphData | null;
  getCamera:            () => CameraController | null;
  getCanvas:            () => HTMLCanvasElement;
  getInputBuffer:       () => DrainableBuffer<UserInputEvent>;
  getCommands:          () => DrainableBuffer<Command>;
  getInteractionState:  () => UIStateStore;
  getHitTester:         () => HitTester;
};