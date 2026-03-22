import type { TranslationState } from "./grammar/interfaces.ts";

export type CursorCss = "default" | "pointer" | "grabbing";

export function getCursorTypeFromInteraction(state: TranslationState): CursorCss {
  if (state.draggedNodeId || state.isPanning || state.isRotating) return "grabbing";
  if (state.hoveredNodeId) return "pointer";
  return "default";
}

export function createCursorController(canvas: HTMLElement) {
  return {
    applyFromInteraction(state: TranslationState) {
      canvas.style.cursor = getCursorTypeFromInteraction(state);
    },
    apply(cursor: CursorCss) {
      canvas.style.cursor = cursor;
    },
  };
}