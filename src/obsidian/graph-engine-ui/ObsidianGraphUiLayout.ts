import type { Disposable, GraphUiOcclusionV1 } from '../../graph-engine/contracts/v1/index.ts';

const HOST_OCCLUSION_SELECTORS = [
  '.view-actions',
  '.view-header-nav-buttons',
  '.mobile-navbar',
  '.workspace-leaf-content > .view-header .clickable-icon',
].join(',');

export class ObsidianGraphUiLayoutV1 implements Disposable {
  private readonly window: Window | null;
  private readonly resizeObserver?: ResizeObserver;
  private readonly mutationObserver?: MutationObserver;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly root: HTMLElement,
    private readonly occlusions: readonly GraphUiOcclusionV1[],
  ) {
    this.window = container.ownerDocument.defaultView;
    this.window?.addEventListener('resize', this.update);
    this.window?.addEventListener('orientationchange', this.update);
    this.window?.visualViewport?.addEventListener('resize', this.update);
    const ResizeObserverCtor = this.window
      ? (this.window as Window & typeof globalThis).ResizeObserver
      : undefined;
    if (ResizeObserverCtor) {
      const resizeObserver = new ResizeObserverCtor(this.update);
      resizeObserver.observe(container);
      this.resizeObserver = resizeObserver;
    }
    const MutationObserverCtor = this.window
      ? (this.window as Window & typeof globalThis).MutationObserver
      : undefined;
    if (MutationObserverCtor) {
      const mutationObserver = new MutationObserverCtor(this.update);
      mutationObserver.observe(container.parentElement ?? container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      this.mutationObserver = mutationObserver;
    }
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.window?.removeEventListener('resize', this.update);
    this.window?.removeEventListener('orientationchange', this.update);
    this.window?.visualViewport?.removeEventListener('resize', this.update);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
  }

  private readonly update = (): void => {
    if (this.disposed) return;
    const bounds = this.container.getBoundingClientRect();
    const gap = 12;
    const launcherWidth = this.root.classList.contains('is-collapsed') ? 32 : Math.min(240, Math.max(32, bounds.width - gap * 2));
    const candidate = {
      left: bounds.right - gap - launcherWidth,
      right: bounds.right - gap,
      top: bounds.top + gap,
      bottom: bounds.top + gap + 40,
    };
    const explicit = this.occlusions.map((value) => ({
      left: bounds.left + value.x,
      right: bounds.left + value.x + value.width,
      top: bounds.top + value.y,
      bottom: bounds.top + value.y + value.height,
    }));
    const host = Array.from(this.container.ownerDocument.querySelectorAll<HTMLElement>(HOST_OCCLUSION_SELECTORS))
      .filter((element) => !this.root.contains(element))
      .map((element) => element.getBoundingClientRect());
    let top = gap;
    for (const blocked of [...explicit, ...host]) {
      if (!intersects(candidate, blocked)) continue;
      top = Math.max(top, blocked.bottom - bounds.top + 8);
    }
    const maxTop = Math.max(gap, bounds.height - 40 - gap);
    this.root.style.setProperty('--graph-engine-controls-top', `${Math.min(top, maxTop)}px`);
  };
}

function intersects(
  left: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  right: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}
