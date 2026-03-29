import type { GraphAccessor }                   from "../types/domain/graph.ts";
import type { UserInputEvent, DrainableBuffer } from "../types/domain/ui.ts";
import type { UIStateStore }                    from "../systems/2. UI Interpretation + State/UIStateStore.ts";
import type { Command }                         from "../types/domain/commands.ts";
import type { HitTester }                       from "../systems/2. UI Interpretation + State/HitTester.ts";
import      { CameraController }                from "../systems/5. Render/CameraController.ts";

export type UIInterpreterDeps = {
  graph:            GraphAccessor     | null;
  camera:           CameraController  | null;
  canvas:           HTMLCanvasElement;
  inputBuffer:      DrainableBuffer<UserInputEvent>;
  commandBuffer:    DrainableBuffer<Command>;
  interactionState: UIStateStore;
  hitTester:        HitTester;
};