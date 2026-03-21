import type { RenderSystem, GraphData, Node, Link, Tickable } from "../../grammar/interfaces.ts";
import { getSettings } from "../../../obsidian/settings/settingsStore.ts";
import type { Camera} from "./Camera.ts";

type ThemeFonts = {
  text: string;
  interface: string;
  mono: string;
};

type ThemeColors = {
  node: string;
  tag: string;
  link: string;
  label: string;
  background: string;
  linkAlpha: number;
};

type ThemeSnapshot = {
  fonts: ThemeFonts;
  colors: ThemeColors;
};

type ScreenProj = { x: number; y: number; depth: number; scale: number };

export class Renderer implements RenderSystem {
  private context: CanvasRenderingContext2D | null;

  private settings = getSettings();
  private graph: GraphData | null = null;

  private worldNodes = new Map<string, Node>();
  private nodeMap = new Map<string, ScreenProj>();

  private theme: ThemeSnapshot = this.buildThemeSnapshot();

  private followedNodeId: string | null = null;
  private mousePosition: { x: number; y: number } | null = null;

  private cssW = 1;
  private cssH = 1;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private camera: Camera) {
    this.context = canvas.getContext("2d");
  }

  // Tickable: called by SpaceTime
  public tick(_dt: number, _nowMs: number): void {
    this.render();
  }

  // --- Public API (Renderer) -------------------------------------------------

  public destroy(): void {
    this.graph = null;
    this.worldNodes.clear();
    this.nodeMap.clear();
    // keep context/canvas alive; orchestrator owns those
  }

  public setGraph(g: GraphData | null): void {
    this.graph = g;

    this.worldNodes.clear();
    this.nodeMap.clear();

    if (!g) return;
    for (const node of g.nodes) this.worldNodes.set(node.id, node);
  }

  public refreshTheme(): void {
    this.theme = this.buildThemeSnapshot();
  }

  public resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;

    this.cssW = Math.max(1, width);
    this.cssH = Math.max(1, height);

    this.canvas.width = Math.floor(this.cssW * this.dpr);
    this.canvas.height = Math.floor(this.cssH * this.dpr);

    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;

    const ctx = this.canvas.getContext("2d");
    if (ctx) ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.camera.setViewport(this.cssW, this.cssH);

    this.render();
  }

  public setMouseScreenPosition(pos: { x: number; y: number } | null): void {
    this.mousePosition = pos;
  }

  public setFollowedNode(id: string | null): void {
    this.followedNodeId = id;
  }

  public render(): void {
    const ctx = this.context;
    if (!ctx) return;

    this.settings = getSettings();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.theme.colors.background;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const graph = this.graph;
    if (!graph) return;

    this.nodeMap.clear();
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, this.camera.worldToScreen(node));
    }

    this.drawLinks(this.nodeMap);
    this.drawNodes(this.nodeMap);
    this.drawLabels(this.nodeMap);
  }

  // --- Drawing ---------------------------------------------------------------

  private drawLinks(nodeMap: Map<string, ScreenProj>) {
    const ctx = this.context;
    const graph = this.graph;
    if (!ctx || !graph || !graph.links) return;

    ctx.save();
    ctx.strokeStyle = this.theme.colors.link;
    ctx.globalAlpha = this.theme.colors.linkAlpha;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    for (const link of graph.links as Link[]) {
      const src = this.worldNodes.get(link.sourceId);
      const tgt = this.worldNodes.get(link.targetId);
      if (!src || !tgt) continue;

      const p1 = nodeMap.get(link.sourceId);
      const p2 = nodeMap.get(link.targetId);
      if (!p1 || !p2) continue;

      if (p1.depth < 0 || p2.depth < 0) continue;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawNodes(nodeMap: Map<string, ScreenProj>) {
    const ctx = this.context;
    const graph = this.graph;
    if (!ctx || !graph || !graph.nodes) return;

    ctx.save();

    const nodeColor = this.theme.colors.node;
    const tagColor = this.theme.colors.tag;

    const sortable: { node: Node; depth: number }[] = [];
    for (const node of graph.nodes as Node[]) {
      const p = nodeMap.get(node.id);
      if (!p) continue;
      sortable.push({ node, depth: p.depth });
    }

    sortable.sort((a, b) => b.depth - a.depth);

    for (const { node } of sortable) {
      const p = nodeMap.get(node.id);
      if (!p || p.depth < 0) continue;

      const radiusPx = node.radius * p.scale;
      const isTag = node.type === "tag";
      const fillColor = isTag ? tagColor : nodeColor;

      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 1;
      ctx.fill();
    }

    ctx.restore();
  }

  private drawLabels(nodeMap: Map<string, { x: number; y: number; depth: number }>) {
    const ctx = this.context;
    const graph = this.graph;
    if (!ctx || !graph || !graph.nodes) return;
    if (!this.settings.graph.showLabels) return;

    const offsetY = 10;
    const fontSize = this.settings.graph.labelFontSize;

    ctx.save();
    ctx.font = `${fontSize}px ${this.theme.fonts.interface}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.theme.colors.label;

    for (const node of graph.nodes as Node[]) {
      const p = nodeMap.get(node.id);
      if (!p || p.depth < 0) continue;

      ctx.globalAlpha = node.anima.level / node.anima.capacity;
      ctx.fillText(node.label, p.x, p.y + node.radius + offsetY);
    }

    ctx.restore();
  }

  // --- Theme -----------------------------------------------------------------

  private buildThemeSnapshot(): ThemeSnapshot {
    return {
      fonts: this.readFonts(),
      colors: this.readColors(),
    };
  }

  private cssVar(name: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  private readFonts(): ThemeFonts {
    return {
      text: this.cssVar("--font-text") || "sans-serif",
      interface: this.cssVar("--font-interface") || "sans-serif",
      mono: this.cssVar("--font-monospace") || "monospace",
    };
  }

  private readColors(): ThemeColors {
    const s = getSettings();
    return {
      background: s.graph.backgroundColor ?? this.cssVar("--background-primary"),
      link: s.graph.edgeColor ?? this.cssVar("--text-normal"),
      node: s.graph.nodeColor ?? this.cssVar("--interactive-accent"),
      tag: s.graph.tagColor ?? this.cssVar("--interactive-accent-hover"),
      label: s.graph.labelColor ?? this.cssVar("--text-muted"),
      linkAlpha: 0.03,
    };
  }
}
