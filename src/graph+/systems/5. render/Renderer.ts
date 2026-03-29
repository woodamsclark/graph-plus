import type { RenderFrame, RenderLinkState, RenderNodeState } from "../../types/domain/render.ts";
import type { CameraAccessor }                                  from "../../types/domain/camera.ts";
import { RenderFrameStore }                                   from "./RenderFrameStore.ts";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(
    private canvas    : HTMLCanvasElement,
    private camera    : CameraAccessor,
    private frameStore: RenderFrameStore,
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
    this.drawLinks(frame.links, frame);
    this.drawNodes(frame.nodes, frame);
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
    const nodeMap = new Map(frame.nodes.map((n) => [n.id, n]));

    this.ctx.save();

    this.ctx.strokeStyle = frame.settings.edgeColor ?? "#888";

    for (const link of links) {
      if (!link.visible) continue;

      const src = nodeMap.get(link.sourceId);
      const tgt = nodeMap.get(link.targetId);
      if (!src || !tgt) continue;

      if (!src.world || !tgt.world) continue;

      const a = this.camera.worldToScreen(src.world);
      const b = this.camera.worldToScreen(tgt.world);
      if (a.depth < 0 || b.depth < 0) continue;

      this.ctx.lineWidth = link.thickness;
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
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
          ? (frame.settings.tagColor ?? "#888")
          : (frame.settings.nodeColor ?? "#888");

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
    this.ctx.fillStyle = frame.settings.labelColor ?? "#ccc";

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
}
