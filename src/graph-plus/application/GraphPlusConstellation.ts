/** Application-owned working membership, independent of rendering sessions and Memory. */
export class GraphPlusConstellationV1 {
  private readonly members = new Set<string>();
  private knownNodeIds = new Set<string>();
  private readonly removedBeforeRestore = new Set<string>();
  private restored = false;

  constructor(initialNodeIds?: readonly string[]) {
    if (initialNodeIds !== undefined) this.restore(initialNodeIds);
  }

  get isRestored(): boolean { return this.restored; }
  snapshot(): readonly string[] { return [...this.members]; }

  restore(nodeIds: readonly string[], knownNodeIds: readonly string[] = nodeIds): void {
    if (this.restored) return;
    // Arrivals during an asynchronous restore must survive the saved snapshot.
    const arrivals = this.snapshot();
    this.members.clear();
    this.add([...nodeIds.filter(id => !this.removedBeforeRestore.has(id)), ...arrivals]);
    this.knownNodeIds = new Set(knownNodeIds);
    this.restored = true;
    this.removedBeforeRestore.clear();
  }

  add(nodeIds: readonly string[]): void {
    for (const id of nodeIds) {
      this.members.add(id);
      this.removedBeforeRestore.delete(id);
    }
  }

  edit(added: readonly string[], removed: readonly string[]): void {
    for (const id of removed) {
      this.members.delete(id);
      if (!this.restored) this.removedBeforeRestore.add(id);
    }
    this.add(added);
  }

  clear(requiredNodeIds: readonly string[]): void {
    this.restored = true;
    this.members.clear();
    this.add(requiredNodeIds);
  }

  reconcile(nodeIds: readonly string[]): void {
    const available = new Set(nodeIds);
    for (const id of this.members) {
      // Unknown arrivals wait for metadata reconciliation; deleted known nodes leave.
      if (this.knownNodeIds.has(id) && !available.has(id)) this.members.delete(id);
    }
    this.knownNodeIds = available;
  }
}
