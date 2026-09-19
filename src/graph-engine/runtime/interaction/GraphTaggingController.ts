export interface GraphTaggingResultV1 {
  readonly selectedNodeIds: readonly string[];
  readonly focusNodeId?: string;
}

/**
 * Owns tag-set edits and the temporary Shift-held Overview presentation. The
 * durable selection remains in GraphViewState; Shift never delays or commits it.
 */
export class GraphTaggingController {
  private shiftActive = false;

  isOverviewHeld(): boolean {
    return this.shiftActive;
  }

  updateShift(active: boolean): boolean {
    const changed = this.shiftActive !== active;
    this.shiftActive = active;
    return changed;
  }

  tag(
    nodeIds: readonly string[],
    focusNodeId: string,
    selectedNodeIds: readonly string[],
    focusedNodeId: string | undefined,
    shift: boolean,
  ): GraphTaggingResultV1 {
    this.shiftActive = shift;
    const current = unique(selectedNodeIds);
    if (shift && current.includes(focusNodeId)) {
      const removed = new Set(nodeIds);
      removed.add(focusNodeId);
      const remaining = current.filter((id) => !removed.has(id));
      const nextFocus = focusedNodeId !== focusNodeId && focusedNodeId !== undefined
        ? focusedNodeId
        : remaining[remaining.length - 1];
      return { selectedNodeIds: remaining, focusNodeId: nextFocus };
    }
    return {
      selectedNodeIds: unique([...current, ...nodeIds]),
      focusNodeId,
    };
  }

  reset(): void {
    this.shiftActive = false;
  }
}

function unique(nodeIds: readonly string[]): readonly string[] {
  return [...new Set(nodeIds)];
}
