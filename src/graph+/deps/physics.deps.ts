import type { GraphAccessor }       from '../types/domain/graph.ts';
import type { UIState }         from '../types/domain/ui.ts';
import type { CameraAccessor }      from '../types/domain/camera.ts';

export type PhysicsDeps = {
  graph:            GraphAccessor | null;
  camera:           CameraAccessor | null;
  interactionState: Readonly<UIState>;
};