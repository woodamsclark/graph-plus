export interface GraphPlusNotePreviewRequestV1<FileValue extends { readonly path: string }> {
  readonly file?: FileValue;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly mod: boolean;
}

interface HoverPopoverLike {
  readonly hoverEl: HTMLElement;
  readonly hide?: () => void;
}

interface PreviewClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

interface HoverLinkRequest {
  readonly event: MouseEvent;
  readonly source: string;
  readonly hoverParent: unknown;
  readonly targetEl: HTMLElement;
  readonly linktext: string;
  readonly sourcePath: string;
}

const PREVIEW_HANDOFF_MS = 400;
const PREVIEW_LEAVE_MS = 80;

export class GraphPlusNotePreviewControllerV1<FileValue extends { readonly path: string }> {
  private anchor?: HTMLElement;
  private filePath?: string;
  private closeTimer?: number;
  private popoverEl?: HTMLElement;
  private pointerInsideAnchor = false;
  private pointerInsidePopover = false;

  constructor(private readonly options: {
    readonly container: HTMLElement;
    readonly source: string;
    readonly hoverParent: unknown;
    readonly getHoverPopover: () => HoverPopoverLike | null;
    readonly triggerHoverLink: (request: HoverLinkRequest) => void;
    readonly isVisible: () => boolean;
    readonly clock?: PreviewClock;
  }) {}

  update(request: GraphPlusNotePreviewRequestV1<FileValue>): void {
    if (!this.options.isVisible()) {
      this.clear();
      return;
    }
    if (request.mod && request.file && request.anchor) {
      this.show(request.file, request.anchor);
      return;
    }
    if (request.file && !request.mod) {
      this.clear();
      return;
    }
    this.scheduleClear(PREVIEW_HANDOFF_MS);
  }

  clear(): void {
    this.clearPreview(true);
  }

  private clearPreview(releaseGraphHover: boolean): void {
    this.cancelClose();
    this.unbindPopover();
    const canvas = this.options.container.querySelector('canvas');
    if (this.anchor) {
      const window = this.options.container.ownerDocument.defaultView;
      this.anchor.removeEventListener('pointerenter', this.onAnchorEnter);
      this.anchor.removeEventListener('pointerleave', this.onAnchorLeave);
      if (window) this.anchor.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
      this.anchor.remove();
      this.anchor = undefined;
    }
    this.pointerInsideAnchor = false;
    this.filePath = undefined;
    this.options.getHoverPopover()?.hide?.();
    if (releaseGraphHover && canvas instanceof this.options.container.ownerDocument.defaultView!.HTMLCanvasElement) {
      const window = this.options.container.ownerDocument.defaultView;
      if (window) canvas.dispatchEvent(new window.PointerEvent('pointerleave', {
        bubbles: false,
        pointerId: -1,
        pointerType: 'mouse',
      }));
    }
  }

  private show(file: FileValue, point: { readonly x: number; readonly y: number }): void {
    this.cancelClose();
    if (this.anchor?.isConnected && this.filePath === file.path) return;
    this.clearPreview(false);
    const window = this.options.container.ownerDocument.defaultView;
    if (!window) return;
    const canvas = this.options.container.querySelector('canvas');
    if (!(canvas instanceof window.HTMLCanvasElement)) return;
    const bounds = canvas.getBoundingClientRect();
    const deviceRatio = Math.max(1, window.devicePixelRatio ?? 1);
    const logicalWidth = canvas.width / deviceRatio;
    const ratio = logicalWidth > 0 ? bounds.width / logicalWidth : 1;
    const anchor = this.options.container.ownerDocument.createElement('div');
    anchor.className = 'graphplus-native-preview-anchor';
    anchor.style.position = 'absolute';
    anchor.style.pointerEvents = 'auto';
    anchor.style.width = '18px';
    anchor.style.height = '18px';
    anchor.style.transform = 'translate(-50%, -50%)';
    anchor.style.zIndex = '1';
    anchor.style.left = `${bounds.left - this.options.container.getBoundingClientRect().left + point.x * ratio}px`;
    anchor.style.top = `${bounds.top - this.options.container.getBoundingClientRect().top + point.y * ratio}px`;
    anchor.addEventListener('pointerenter', this.onAnchorEnter);
    anchor.addEventListener('pointerleave', this.onAnchorLeave);
    this.options.container.append(anchor);
    this.anchor = anchor;
    this.filePath = file.path;
    const mac = /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform ?? '');
    const event = new window.MouseEvent('mouseover', {
      bubbles: true,
      clientX: bounds.left + point.x * ratio,
      clientY: bounds.top + point.y * ratio,
      metaKey: mac,
      ctrlKey: !mac,
    });
    this.options.triggerHoverLink({
      event,
      source: this.options.source,
      hoverParent: this.options.hoverParent,
      targetEl: anchor,
      linktext: file.path,
      sourcePath: file.path,
    });
    this.bindPopover();
  }

  private scheduleClear(delayMs: number): void {
    if (!this.anchor) return;
    this.cancelClose();
    this.bindPopover();
    this.closeTimer = this.clock().setTimeout(() => {
      this.closeTimer = undefined;
      this.bindPopover();
      if (this.pointerInsideAnchor || elementIsHovered(this.anchor)
        || this.pointerInsidePopover || elementIsHovered(this.popoverEl)) return;
      this.clear();
    }, delayMs);
  }

  private bindPopover(): void {
    const next = this.options.getHoverPopover()?.hoverEl;
    if (!next || next === this.popoverEl) return;
    this.unbindPopover();
    this.popoverEl = next;
    next.addEventListener('pointerenter', this.onPopoverEnter);
    next.addEventListener('pointerleave', this.onPopoverLeave);
  }

  private unbindPopover(): void {
    this.popoverEl?.removeEventListener('pointerenter', this.onPopoverEnter);
    this.popoverEl?.removeEventListener('pointerleave', this.onPopoverLeave);
    this.popoverEl = undefined;
    this.pointerInsidePopover = false;
  }

  private readonly onPopoverEnter = (): void => {
    this.pointerInsidePopover = true;
    this.cancelClose();
  };

  private readonly onPopoverLeave = (): void => {
    this.pointerInsidePopover = false;
    this.scheduleClear(PREVIEW_LEAVE_MS);
  };

  private readonly onAnchorEnter = (): void => {
    this.pointerInsideAnchor = true;
    this.cancelClose();
  };

  private readonly onAnchorLeave = (): void => {
    this.pointerInsideAnchor = false;
    this.scheduleClear(PREVIEW_HANDOFF_MS);
  };

  private cancelClose(): void {
    if (this.closeTimer !== undefined) this.clock().clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  }

  private clock(): PreviewClock {
    const window = this.options.container.ownerDocument.defaultView;
    return this.options.clock ?? {
      setTimeout: (callback, delayMs) => window?.setTimeout(callback, delayMs) ?? -1,
      clearTimeout: (handle) => window?.clearTimeout(handle),
    };
  }
}

function elementIsHovered(element: HTMLElement | undefined): boolean {
  if (!element) return false;
  try {
    return element.matches(':hover');
  } catch {
    return false;
  }
}
