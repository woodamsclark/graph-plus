import type { GraphData }       from '../types/domain/graph.ts';
import type { UIState }         from '../types/domain/ui.ts';
import type { CameraLike }      from '../types/domain/camera.ts';

export type PhysicsDeps = {
  getGraph:             () => GraphData | null;
  getCamera:            () => CameraLike | null;
  getInteractionState:  () => Readonly<UIState>;
};