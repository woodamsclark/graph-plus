import type {
  RenderFrame,
  RenderLinkState,
  RenderNodeState,
  RenderSystem,
} from "../../grammar/interfaces.ts";

import type { Camera } from "./Camera.ts";
import { RenderFrameStore } from "./RenderFrameStore.ts";

export class Renderer implements RenderSystem {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(
    private canvas:     HTMLCanvasElement,
    private camera:     Camera,
    private frameStore: RenderFrameStore
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

  public tick(_dt: number, _nowMs: number): void {
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

  public destroy(): void {
    // no-op
  }

  private clear(frame: RenderFrame): void {
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (frame.config.backgroundColor) {
      this.ctx.fillStyle = frame.config.backgroundColor;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawLinks(links: RenderLinkState[], frame: RenderFrame): void {
    const nodeMap = new Map(frame.nodes.map((n) => [n.id, n]));

    this.ctx.save();

    this.ctx.strokeStyle = frame.config.edgeColor ?? "#888";

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

    for (const node of nodes) {
      if (!node.visible) continue;
      if (!node.world) continue;

      const p = this.camera.worldToScreen(node.world);
      const r = node.radius * node.scale * p.scale;

      this.ctx.fillStyle =
        node.type === "tag"
          ? (frame.config.tagColor ?? "#888")
          : (frame.config.nodeColor ?? "#888");

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private drawLabels(nodes: RenderNodeState[], frame: RenderFrame): void {
    if (!frame.config.showLabels) return;

    this.ctx.save();
    this.ctx.font = `${frame.config.labelFontSize}px sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillStyle = frame.config.labelColor ?? "#ccc";

    for (const node of nodes) {
      if (!node.visible) continue;
      if (node.type === "tag" && !frame.config.showTags) continue;
      if (node.labelOpacity <= 0) continue;
      if (!node.world) continue;

      const p = this.camera.worldToScreen(node.world);
      const offsetY = node.radius * node.scale * p.scale + 12;

      this.ctx.globalAlpha = node.labelOpacity;
      this.ctx.fillText(node.label, p.x, p.y + offsetY);
    }

    this.ctx.restore();
    this.ctx.globalAlpha = 1;
  }
}
