export interface GraphTaggingResultV1 {
  readonly selectedNodeIds: readonly string[];
  readonly focusNodeId: string;
  readonly complete: boolean;
}

/**
 * Owns the transient interaction around assembling a selection. The durable
 * selection remains in GraphViewState; this controller only decides when a
 * series of tags is ready to become the focused Explore structure.
 */
export class GraphTaggingController {
  private shiftActive = false;
  private pendingFocusNodeId: string | undefined;

  isActive(): boolean {
    return this.shiftActive;
  }

  updateShift(
    active: boolean,
    selectedNodeIds: readonly string[],
  ): GraphTaggingResultV1 | undefined {
    const wasActive = this.shiftActive;
    this.shiftActive = active;
    if (!wasActive || active || this.pendingFocusNodeId === undefined) return undefined;
    const result = {
      selectedNodeIds: unique(selectedNodeIds),
      focusNodeId: this.pendingFocusNodeId,
      complete: true,
    } as const;
    this.pendingFocusNodeId = undefined;
    return result;
  }

  tag(
    nodeIds: readonly string[],
    focusNodeId: string,
    selectedNodeIds: readonly string[],
    additive: boolean,
  ): GraphTaggingResultV1 {
    const batching = additive;
    if (batching) {
      this.shiftActive = true;
      this.pendingFocusNodeId = focusNodeId;
    } else {
      this.shiftActive = false;
      this.pendingFocusNodeId = undefined;
    }
    return {
      selectedNodeIds: unique(batching ? [...selectedNodeIds, ...nodeIds] : nodeIds),
      focusNodeId,
      complete: !batching,
    };
  }

  reset(): void {
    this.shiftActive = false;
    this.pendingFocusNodeId = undefined;
  }
}

function unique(nodeIds: readonly string[]): readonly string[] {
  return [...new Set(nodeIds)];
}
