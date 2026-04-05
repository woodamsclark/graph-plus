import      { GraphAccessor }                   from "../types/domain/graph.ts";
import      { ThemePalette }                    from "../../obsidian/themeStyleResolver.ts";
import type { UIState }                         from "../types/domain/ui.ts";
import type { FrameStore }                      from "../systems/5. Render/FrameStore.ts";
import type { AnimaStateStore }                 from "../systems/4. Modules/AnimaStateStore.ts";

export type FrameComposerDeps = {
  graph:      GraphAccessor | null;
  uiState:    UIState;
  animaStore: AnimaStateStore;
  frameStore: FrameStore;
  getThemePalette: () => ThemePalette;
};