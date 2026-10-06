/** Shared leaf visibility and event-cleanup owner for graph+ views. */
export class GraphPlusViewLifecycleV1 {
  private visible = true;
  private readonly unregisters: Array<() => void> = [];

  constructor(
    private readonly content: HTMLElement,
    private readonly callbacks: {
      readonly setSuspended: (suspended: boolean) => void;
      readonly clearPreview: () => void;
      readonly onRevealed?: () => void;
    },
  ) {}

  get isVisible(): boolean { return this.visible; }
  get listenerCount(): number { return this.unregisters.length; }

  register(...unregisters: Array<() => void>): void {
    this.unregisters.push(...unregisters);
  }

  synchronizeVisibility(): boolean {
    const visible = this.content.isShown()
      && this.content.closest('.workspace-split.is-collapsed') === null;
    if (this.visible === visible) return visible;
    this.visible = visible;
    this.callbacks.setSuspended(!visible);
    if (!visible) {
      this.callbacks.clearPreview();
      return false;
    }
    this.callbacks.onRevealed?.();
    return true;
  }

  dispose(): void {
    for (const unregister of this.unregisters.splice(0)) unregister();
  }
}
