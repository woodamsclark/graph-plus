import { GraphAccessor }                        from "../types/domain/graph.ts";
import type { UIState }                         from "../types/domain/ui.ts";
import type {
  RenderFrame,
  RenderLinkState,
  RenderNodeState,
  RenderSettings,
}                                               from "../types/domain/render.ts";
import type { ModuleWithSettings, SettingsFor } from "../types/index.ts";
import type { RenderFrameStore }                from "../systems/5. Render/RenderFrameStore.ts";
import type { AnimaStateStore }                 from "../systems/4. Modules/AnimaStateStore.ts";

export type RenderStateComposerDeps = {
  graph:         GraphAccessor | null;
  uiState:    UIState;
  animaStore: AnimaStateStore;
  frameStore: RenderFrameStore;
};