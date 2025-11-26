import { App, ItemView, WorkspaceLeaf, Plugin } from 'obsidian';
import { buildGraph, GraphData } from './graph/buildGraph';
import { layoutGraph2D } from './graph/layout2d';
import { createRenderer2D, Renderer2D } from './graph/renderer2d';

export const GREATER_GRAPH_VIEW_TYPE = 'greater-graph-view';

export class GraphView extends ItemView {
  private controller: Graph2DController | null = null;
  private plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GREATER_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Greater Graph';
  }

  getIcon(): string {
    return 'dot-network';
  }

  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: 'greater-graph-view' });
    this.controller = new Graph2DController(this.app, container, this.plugin);
    await this.controller.init();
  }

  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.controller?.resize(rect.width, rect.height);
  }

  async onClose() {
    this.controller?.destroy();
    this.controller = null;
    this.containerEl.empty();
  }
}

class Graph2DController {
  private app: App;
  private containerEl: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer2D | null = null;
  private graph: GraphData | null = null;
  private plugin: Plugin;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private settingsUnregister: (() => void) | null = null;

  constructor(app: App, containerEl: HTMLElement, plugin: Plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    // create canvas
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 0;
    this.containerEl.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = createRenderer2D({ canvas, glow: (this.plugin as any).settings?.glow });

    // build graph
    this.graph = await buildGraph(this.app);

    // initial layout + render
    const rect = this.containerEl.getBoundingClientRect();
    this.renderer.setGraph(this.graph);
    this.renderer.resize(rect.width || 300, rect.height || 200);

    // mouse events for hover
    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      this.handleHover(x, y);
    };

    this.mouseLeaveHandler = () => {
      this.clearHover();
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);

    // register settings listener to apply settings live
    if ((this.plugin as any).registerSettingsListener) {
      this.settingsUnregister = (this.plugin as any).registerSettingsListener(() => {
        if (this.renderer && (this.plugin as any).settings) {
          const glow = (this.plugin as any).settings.glow;
          if ((this.renderer as any).setGlowSettings) {
            (this.renderer as any).setGlowSettings(glow);
            this.renderer.render();
          }
        }
      });
    }
  }

  resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.renderer.resize(width, height);
  }

  destroy(): void {
    this.renderer?.destroy();
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.renderer = null;
    this.graph = null;
    if (this.settingsUnregister) {
      try {
        this.settingsUnregister();
      } catch (e) {
        // ignore
      }
      this.settingsUnregister = null;
    }
  }

  handleHover(x: number, y: number): void {
    if (!this.graph || !this.renderer) return;

    // simple hit test: find closest node within hit radius
    let closest: any = null;
    let closestDist = Infinity;
    // use a hit radius based on max node radius
    const hitPadding = 6;

    for (const node of this.graph.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      const distSq = dx * dx + dy * dy;
      const nodeRadius = this.renderer.getNodeRadiusForHit
        ? this.renderer.getNodeRadiusForHit(node)
        : 8;
      const hitR = nodeRadius + hitPadding;
      if (distSq <= hitR * hitR && distSq < closestDist) {
        closestDist = distSq;
        closest = node;
      }
    }

    const newId = closest ? closest.id : null;
    this.renderer.setHoveredNode(newId);
    this.renderer.render();
  }

  clearHover(): void {
    if (!this.renderer) return;
    this.renderer.setHoveredNode(null);
    this.renderer.render();
  }
}
