import type { GraphData } from "../shared/interfaces.ts";
import type { InteractionState } from "./interaction/InteractionState.ts";
import type { CameraController } from "../garden/graph/CameraController.ts";

export type WorldState = {
  graph: GraphData | null;
  camera: CameraController;
  interaction: InteractionState;
};
