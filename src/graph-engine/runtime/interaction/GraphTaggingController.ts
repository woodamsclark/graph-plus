export interface GraphTaggingResultV1 {
  readonly selectedNodeIds: readonly string[];
}

/** Owns tag-set edits and held interaction state for transient presentation. */
export class GraphTaggingController {
  private ctrlActive = false;
  private optionRevealActive = false;
  private spaceActive = false;

  isCtrlHeld(): boolean {
    return this.ctrlActive;
  }

  isPresentationSuspended(): boolean {
    return this.spaceActive;
  }

  isSelectionNeighborRevealActive(): boolean {
    return this.optionRevealActive;
  }

  updateSpace(active: boolean): boolean {
    const changed = this.spaceActive !== active;
    this.spaceActive = active;
    return changed;
  }

  updateCtrl(active: boolean): boolean {
    const changed = this.ctrlActive !== active;
    this.ctrlActive = active;
    return changed;
  }

  updateOptionReveal(active: boolean): boolean {
    const changed = this.optionRevealActive !== active;
    this.optionRevealActive = active;
    return changed;
  }

  tag(
    nodeIds: readonly string[],
    clickedNodeId: string,
    selectedNodeIds: readonly string[],
    ctrl: boolean,
  ): GraphTaggingResultV1 {
    this.ctrlActive = ctrl;
    const current = unique(selectedNodeIds);
    if (ctrl && current.includes(clickedNodeId)) {
      const removed = new Set(nodeIds);
      removed.add(clickedNodeId);
      const remaining = current.filter((id) => !removed.has(id));
      return { selectedNodeIds: remaining };
    }
    return {
      selectedNodeIds: unique([...current, ...nodeIds]),
    };
  }

  reset(): void {
    this.ctrlActive = false;
    this.optionRevealActive = false;
    this.spaceActive = false;
  }
}

function unique(nodeIds: readonly string[]): readonly string[] {
  return [...new Set(nodeIds)];
}
