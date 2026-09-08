import { animaPreviewTiming, resolveAnimaPreviewCard, type AnimaPreviewPhase } from '../graph-engine/runtime/modules/shipped/AnimaPreviewPresentation.ts';

export interface GraphPlusNotePreviewRequestV1<FileValue extends { readonly path: string }> {
  readonly nodeId?: string;
  readonly file?: FileValue;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly active: boolean;
  readonly immediate?: boolean;
}

export interface GraphPlusPreviewRenderHandleV1 {
  dispose(): void;
}

interface PreviewClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export type GraphPlusPreviewPhaseV1 = AnimaPreviewPhase;

/** Graph hover truth stays in Graph Engine; this class owns Markdown and card interaction. */
export class GraphPlusNotePreviewControllerV1<FileValue extends { readonly path: string }> {
  private phase: GraphPlusPreviewPhaseV1 = 'inactive';
  private target?: GraphPlusNotePreviewRequestV1<FileValue>;
  private card?: HTMLElement;
  private openTimer?: number;
  private closeTimer?: number;
  private renderHandle?: GraphPlusPreviewRenderHandleV1;
  private pointerInsideCard = false;
  private generation = 0;

  constructor(private readonly options: {
    readonly container: HTMLElement;
    readonly isVisible: () => boolean;
    readonly readFile: (file: FileValue) => Promise<string>;
    readonly renderMarkdown: (
      markdown: string,
      element: HTMLElement,
      sourcePath: string,
    ) => Promise<GraphPlusPreviewRenderHandleV1>;
    readonly openFile: (file: FileValue) => void | Promise<void>;
    readonly openLink?: (link: string, sourcePath: string, newLeaf: boolean) => void | Promise<void>;
    readonly onPreviewSurfaceActive: (active: boolean) => void | Promise<void>;
    readonly onDismissRequested: () => void | Promise<void>;
    readonly clock?: PreviewClock;
  }) {
    this.options.container.ownerDocument.defaultView?.addEventListener('keydown', this.onKeyDown);
  }

  update(request: GraphPlusNotePreviewRequestV1<FileValue>): void {
    if (!this.options.isVisible()) {
      this.dismiss(false);
      return;
    }
    if (!request.active || !request.nodeId || !request.file || !request.anchor) {
      if (request.immediate) {
        this.dismiss(false);
        return;
      }
      if (this.pointerInsideCard) return;
      this.scheduleDismiss(this.card ? animaPreviewTiming.handoff : 0);
      return;
    }
    const sameTarget = this.target?.nodeId === request.nodeId && this.target.file?.path === request.file.path;
    this.target = request;
    if (sameTarget) {
      this.cancelClose();
      if (this.card) this.phase = this.pointerInsideCard ? 'card-active' : 'node-active';
      this.positionCard();
      return;
    }
    this.beginTarget();
  }

  clear(): void {
    this.dismiss(true);
  }

  dispose(): void {
    this.options.container.ownerDocument.defaultView?.removeEventListener('keydown', this.onKeyDown);
    this.dismiss(true);
  }

  getPhase(): GraphPlusPreviewPhaseV1 {
    return this.phase;
  }

  private beginTarget(): void {
    this.pointerInsideCard = false;
    void this.options.onPreviewSurfaceActive(false);
    this.generation += 1;
    const generation = this.generation;
    this.cancelTimers();
    this.releaseCard();
    this.phase = 'waiting';
    this.openTimer = this.clock().setTimeout(() => {
      this.openTimer = undefined;
      void this.openCard(generation);
    }, animaPreviewTiming.open);
  }

  private async openCard(generation: number): Promise<void> {
    const target = this.target;
    if (!target?.file || generation !== this.generation || !this.options.isVisible()) return;
    const document = this.options.container.ownerDocument;
    const card = document.createElement('section');
    card.className = 'graphplus-note-preview';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', `Preview of ${displayName(target.file.path)}`);
    const header = document.createElement('header');
    header.className = 'graphplus-note-preview-header';
    const title = document.createElement('button');
    title.className = 'graphplus-note-preview-title';
    title.type = 'button';
    title.textContent = displayName(target.file.path);
    title.addEventListener('click', this.onTitleClick);
    header.append(title);
    const body = document.createElement('div');
    body.className = 'graphplus-note-preview-body markdown-preview-view markdown-rendered';
    body.textContent = 'Loading…';
    card.append(header, body);
    card.addEventListener('pointerenter', this.onCardEnter);
    card.addEventListener('pointerleave', this.onCardLeave);
    card.addEventListener('wheel', this.onCardWheel, { passive: false });
    card.addEventListener('click', this.onCardClick);
    this.options.container.append(card);
    this.card = card;
    this.phase = 'node-active';
    this.positionCard();

    try {
      const markdown = await this.options.readFile(target.file);
      if (!this.isCurrent(generation, target.file.path)) return;
      body.textContent = '';
      const handle = await this.options.renderMarkdown(markdown, body, target.file.path);
      if (!this.isCurrent(generation, target.file.path)) {
        handle.dispose();
        return;
      }
      this.renderHandle = handle;
      this.positionCard();
    } catch (error) {
      if (!this.isCurrent(generation, target.file.path)) return;
      body.textContent = error instanceof Error ? error.message : 'Unable to render note preview.';
      body.classList.add('graphplus-note-preview-error');
    }
  }

  private positionCard(): void {
    const card = this.card;
    const point = this.target?.anchor;
    if (!card || !point) return;
    const canvas = this.options.container.querySelector('canvas');
    const window = this.options.container.ownerDocument.defaultView;
    if (!window || !(canvas instanceof window.HTMLCanvasElement)) return;
    const containerBounds = this.options.container.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const logicalWidth = Math.max(1, canvas.clientWidth || canvasBounds.width);
    const logicalHeight = Math.max(1, canvas.clientHeight || canvasBounds.height);
    const anchorX = canvasBounds.left - containerBounds.left + point.x * canvasBounds.width / logicalWidth;
    const anchorY = canvasBounds.top - containerBounds.top + point.y * canvasBounds.height / logicalHeight;
    const availableWidth = Math.max(0, containerBounds.width);
    const availableHeight = Math.max(0, containerBounds.height);
    const target = resolveAnimaPreviewCard({
      anchor: { x: anchorX, y: anchorY },
      viewport: { width: availableWidth, height: availableHeight },
      measuredHeight: card.getBoundingClientRect().height,
    });
    card.style.width = `${target.width}px`;
    card.style.maxHeight = `${target.maxHeight}px`;
    card.style.left = `${target.left}px`;
    card.style.top = `${target.top}px`;
    card.style.opacity = String(target.opacity);
    card.style.transform = `scale(${target.scale})`;
  }

  private readonly onCardEnter = (): void => {
    this.pointerInsideCard = true;
    this.cancelClose();
    this.phase = 'card-active';
    void this.options.onPreviewSurfaceActive(true);
  };

  private readonly onCardLeave = (): void => {
    this.pointerInsideCard = false;
    void this.options.onPreviewSurfaceActive(false);
    this.scheduleDismiss(animaPreviewTiming.leave);
  };

  private readonly onCardWheel = (event: WheelEvent): void => {
    event.stopPropagation();
  };

  private readonly onTitleClick = (): void => {
    const file = this.target?.file;
    if (file) {
      this.dismiss(true);
      void this.options.openFile(file);
    }
  };

  private readonly onCardClick = (event: MouseEvent): void => {
    const window = this.options.container.ownerDocument.defaultView;
    if (!window || !(event.target instanceof window.Element)) return;
    const link = event.target.closest('a.internal-link');
    const href = link?.getAttribute('data-href') ?? link?.getAttribute('href');
    const sourcePath = this.target?.file?.path;
    if (!href || !sourcePath || !this.options.openLink) return;
    event.preventDefault();
    event.stopPropagation();
    this.dismiss(true);
    void this.options.openLink(href, sourcePath, event.metaKey || event.ctrlKey);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.phase === 'inactive') return;
    event.preventDefault();
    event.stopPropagation();
    this.dismiss(true);
  };

  private scheduleDismiss(delayMs: number): void {
    if (this.phase === 'inactive') return;
    this.cancelClose();
    this.phase = 'closing';
    this.closeTimer = this.clock().setTimeout(() => {
      this.closeTimer = undefined;
      if (!this.pointerInsideCard) this.dismiss(true);
    }, delayMs);
  }

  private dismiss(notifyEngine: boolean): void {
    if (this.phase === 'inactive' && !this.target && !this.card) return;
    this.generation += 1;
    this.cancelTimers();
    this.pointerInsideCard = false;
    void this.options.onPreviewSurfaceActive(false);
    this.releaseCard();
    this.target = undefined;
    this.phase = 'inactive';
    if (notifyEngine) void this.options.onDismissRequested();
  }

  private releaseCard(): void {
    this.renderHandle?.dispose();
    this.renderHandle = undefined;
    if (this.card) {
      this.card.removeEventListener('pointerenter', this.onCardEnter);
      this.card.removeEventListener('pointerleave', this.onCardLeave);
      this.card.removeEventListener('wheel', this.onCardWheel);
      this.card.removeEventListener('click', this.onCardClick);
      this.card.querySelector('.graphplus-note-preview-title')?.removeEventListener('click', this.onTitleClick);
      this.card.remove();
    }
    this.card = undefined;
  }

  private isCurrent(generation: number, path: string): boolean {
    return generation === this.generation && this.target?.file?.path === path && this.card?.isConnected === true;
  }

  private cancelTimers(): void {
    if (this.openTimer !== undefined) this.clock().clearTimeout(this.openTimer);
    this.openTimer = undefined;
    this.cancelClose();
  }

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

function displayName(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/i, '') || path;
}
