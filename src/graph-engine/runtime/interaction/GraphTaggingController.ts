export interface GraphTaggingResultV1 {
  readonly selectedNodeIds: readonly string[];
  readonly focusNodeId?: string;
}

/** Owns tag-set edits and held interaction state for transient presentation. */
export class GraphTaggingController {
  private shiftActive = false;
  private spaceActive = false;

  isShiftHeld(): boolean {
    return this.shiftActive;
  }

  isPresentationSuspended(): boolean {
    return this.shiftActive || this.spaceActive;
  }

  updateSpace(active: boolean): boolean {
    const changed = this.spaceActive !== active;
    this.spaceActive = active;
    return changed;
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
    this.spaceActive = false;
  }
}

function unique(nodeIds: readonly string[]): readonly string[] {
  return [...new Set(nodeIds)];
}
