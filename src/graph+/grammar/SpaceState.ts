import type { GraphData } from "./interfaces.ts";
import type { InteractionState } from "./InteractionState.ts";
import type { CameraController } from "../eve/CameraController.ts";

export type WorldState = {
  graph: GraphData | null;
  camera: CameraController;
  interaction: InteractionState;
};
