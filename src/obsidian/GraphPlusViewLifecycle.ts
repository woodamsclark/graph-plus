/** Shared leaf visibility, reconciliation, and event-cleanup owner for graph+ views. */
export class GraphPlusViewLifecycleV1 {
  private visible = true;
  private reconcilePending = false;
  private reconcileTimer: number | undefined;
  private readonly unregisters: Array<() => void> = [];

  constructor(
    private readonly content: HTMLElement,
    private readonly callbacks: {
      readonly setSuspended: (suspended: boolean) => void;
      readonly clearPreview: () => void;
      readonly reconcile: () => void | Promise<void>;
    },
  ) {}

  get isVisible(): boolean { return this.visible; }
  get listenerCount(): number { return this.unregisters.length; }
  get rebuildScheduled(): boolean { return this.reconcileTimer !== undefined; }
  get hasReconcilePending(): boolean { return this.reconcilePending; }

  register(...unregisters: Array<() => void>): void {
    this.unregisters.push(...unregisters);
  }

  scheduleReconcile(delayMs = 180): void {
    if (!this.visible) {
      this.reconcilePending = true;
      return;
    }
    const window = this.content.ownerDocument.defaultView;
    if (this.reconcileTimer !== undefined) window?.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window?.setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.callbacks.reconcile();
    }, delayMs);
  }

  synchronizeVisibility(): boolean {
    const visible = this.content.isShown();
    if (this.visible === visible && !this.reconcilePending) return visible;
    this.visible = visible;
    if (!visible && this.reconcileTimer !== undefined) {
      this.content.ownerDocument.defaultView?.clearTimeout(this.reconcileTimer);
      this.reconcileTimer = undefined;
      this.reconcilePending = true;
    }
    this.callbacks.setSuspended(!visible);
    if (!visible) {
      this.callbacks.clearPreview();
      return false;
    }
    if (this.reconcilePending) {
      this.reconcilePending = false;
      void this.callbacks.reconcile();
    }
    return true;
  }

  cancelReconcile(): void {
    if (this.reconcileTimer !== undefined) {
      this.content.ownerDocument.defaultView?.clearTimeout(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
    this.reconcilePending = false;
  }

  dispose(): void {
    this.cancelReconcile();
    for (const unregister of this.unregisters.splice(0)) unregister();
  }
}
