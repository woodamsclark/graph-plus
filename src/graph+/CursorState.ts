import type { TranslationState } from "./grammar/interfaces.ts";
import type { CursorCss } from "./cursor_selector.ts";

export function getCursorTypeFromInteraction(state: TranslationState): CursorCss {
  if (state.draggedNodeId || state.isPanning || state.isRotating) return "grabbing";
  if (state.hoveredNodeId) return "pointer";
  return "default";
}