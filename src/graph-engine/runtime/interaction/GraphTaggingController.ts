/** Owns held interaction state for transient selection presentation. */
export class GraphTaggingController {
  private optionRevealActive = false;
  private spaceActive = false;

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

  updateOptionReveal(active: boolean): boolean {
    const changed = this.optionRevealActive !== active;
    this.optionRevealActive = active;
    return changed;
  }

  reset(): void {
    this.optionRevealActive = false;
    this.spaceActive = false;
  }
}
