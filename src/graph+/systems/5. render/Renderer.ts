import type { RenderFrame, RenderLinkState, RenderNodeState }   from "../../types/domain/render.ts";
import type { CameraAccessor }                                  from "../../types/domain/camera.ts";
import      { FrameStore }                                from "./FrameStore.ts";

type Drawable =
  | {
      kind: "link";
      depth: number;
      link: RenderLinkState;
      src: RenderNodeState;
      tgt: RenderNodeState;
      a: { x: number; y: number; depth: number; scale: number };
      b: { x: number; y: number; depth: number; scale: number };
    }
  | {
      kind: "node";
      depth: number;
      node: RenderNodeState;
      p: { x: number; y: number; depth: number; scale: number };
    };

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(
    private canvas    : HTMLCanvasElement,
    private camera    : CameraAccessor,
    private frameStore: FrameStore,
  ) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D rendering context");
    this.ctx = ctx;
  }

  public resize(width: number, height: number): void {
    this.width  = width;
    this.height = height;

    const dpr                 = window.devicePixelRatio || 1;
    this.canvas.width         = Math.floor(width * dpr);
    this.canvas.height        = Math.floor(height * dpr);
    this.canvas.style.width   = `${width}px`;
    this.canvas.style.height  = `${height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setViewport(width, height);
  }

  public tick(_dt: number ): void {
    this.render();
  }

  public render(): void {
    const frame = this.frameStore.get();
    if (!frame) return;

    this.clear(frame);

    const nodeMap = new Map(frame.nodes.map((n) => [n.id, n]));
    const drawables: Drawable[] = [];

    for (const node of frame.nodes) {
      if (!node.visible || !node.world) continue;

      const p = this.camera.worldToScreen(node.world);
      if (p.depth < 0) continue;

      drawables.push({
        kind: "node",
        depth: p.depth,
        node,
        p,
      });
    }

    for (const link of frame.links) {
      if (!link.visible) continue;

      const src = nodeMap.get(link.sourceId);
      const tgt = nodeMap.get(link.targetId);
      if (!src || !tgt || !src.world || !tgt.world) continue;

      const a = this.camera.worldToScreen(src.world);
      const b = this.camera.worldToScreen(tgt.world);
      if (a.depth < 0 || b.depth < 0) continue;

      drawables.push({
        kind: "link",
        depth: (a.depth + b.depth) / 2,
        link,
        src,
        tgt,
        a,
        b,
      });
    }

    drawables.sort((a, b) => b.depth - a.depth); // far -> near

    this.drawDrawables(drawables, frame);
    this.drawLabels(frame.nodes, frame);
  }

  public initialize(): void {
    // no-op
  }

  public destroy(): void {
    // no-op
  }

  private clear(frame: RenderFrame): void {
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (frame.settings.backgroundColor) {
      this.ctx.fillStyle = frame.settings.backgroundColor;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawLinks(links: RenderLinkState[], frame: RenderFrame): void {
    const ctx = this.ctx;
    const nodeMap = new Map(frame.nodes.map((n) => [n.id, n]));

    ctx.save();
    ctx.strokeStyle = frame.settings.linkColor;

    for (const link of links) {
      if (!link.visible) continue;

      const src = nodeMap.get(link.sourceId);
      const tgt = nodeMap.get(link.targetId);
      if (!src?.world || !tgt?.world) continue;

      const a = this.camera.worldToScreen(src.world);
      const b = this.camera.worldToScreen(tgt.world);
      if (a.depth < 0 || b.depth < 0) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      const startX = a.x + ux * (src.radius * a.scale);
      const startY = a.y + uy * (src.radius * a.scale);
      const endX   = b.x - ux * (tgt.radius * b.scale);
      const endY   = b.y - uy * (tgt.radius * b.scale);

      ctx.lineWidth = link.thickness;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawNodes(nodes: RenderNodeState[], frame: RenderFrame): void {
    this.ctx.save();

    const projected = nodes
      .filter((node) => node.visible && node.world)
      .map((node) => {
        const p = this.camera.worldToScreen(node.world!);
        return { node, p };
      })
      .filter(({ p }) => p.depth >= 0)
      .sort((a, b) => b.p.depth - a.p.depth); // far -> near

    for (const { node, p } of projected) {
      const r = node.radius * p.scale;

      this.ctx.fillStyle =
        node.type === "tag"
          ? (frame.settings.tagColor)
          : (frame.settings.nodeColor);

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }
  
  private drawLabels(nodes: RenderNodeState[], frame: RenderFrame): void {
    if (!frame.settings.showLabels) return;

    this.ctx.save();
    this.ctx.font = `${frame.settings.labelFontSize}px sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillStyle = frame.settings.labelColor;

    const projected = nodes
      .filter((node) => {
        if (!node.visible) return false;
        if (node.type === "tag" && !frame.settings.showTags) return false;
        if (node.labelOpacity <= 0) return false;
        if (!node.world) return false;
        return true;
      })
      .map((node) => {
        const p = this.camera.worldToScreen(node.world!);
        return { node, p };
      })
      .filter(({ p }) => p.depth >= 0)
      .sort((a, b) => b.p.depth - a.p.depth); // far -> near

    for (const { node, p } of projected) {
      const offsetY = node.radius * p.scale + frame.settings.labelOffsetY;

      this.ctx.globalAlpha = node.labelOpacity;
      this.ctx.fillText(node.label, p.x, p.y + offsetY);
    }

    this.ctx.restore();
    this.ctx.globalAlpha = 1;
  }

  private drawDrawables(drawables: Drawable[], frame: RenderFrame): void {
    this.ctx.save();

    for (const item of drawables) {
      if (item.kind === "link") {
        const { link, src, tgt, a, b } = item;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        const startX = a.x + ux * (src.radius * a.scale);
        const startY = a.y + uy * (src.radius * a.scale);
        const endX   = b.x - ux * (tgt.radius * b.scale);
        const endY   = b.y - uy * (tgt.radius * b.scale);

        this.ctx.strokeStyle = frame.settings.linkColor;
        this.ctx.lineWidth = link.thickness;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
      } else {
        const { node, p } = item;
        const r = node.radius * p.scale;

        this.ctx.fillStyle =
          node.type === "tag"
            ? frame.settings.tagColor
            : frame.settings.nodeColor;

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this.ctx.restore();
  }
}
