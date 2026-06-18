import type { RenderFocusPlane, RenderFrame, RenderLinkState, RenderNodeState }   from "../../types/domain/render.ts";
import type { CameraAccessor }                                  from "../../types/domain/camera.ts";
import      { FrameStore }                                from "./FrameStore.ts";

type ProjectedPoint = {
  x: number;
  y: number;
  depth: number;
  scale: number;
  viewZ: number;
};

type ProjectedNode = {
  node: RenderNodeState;
  p: ProjectedPoint;
  focusAlpha: number;
};

type Drawable =
  | {
      kind: "link";
      depth: number;
      link: RenderLinkState;
      src: ProjectedNode;
      tgt: ProjectedNode;
    }
  | {
      kind: "node";
      depth: number;
      projected: ProjectedNode;
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

    const projectedNodes: ProjectedNode[] = [];
    const nodeMap = new Map<string, ProjectedNode>();
    const drawables: Drawable[] = [];

    for (const node of frame.nodes) {
      if (!node.visible || !node.world) continue;

      const p = this.camera.worldToScreen(node.world);
      if (p.depth < 0) continue;

      const projected: ProjectedNode = {
        node,
        p,
        focusAlpha: this.computeFocusAlpha(p.viewZ, frame.focusPlane),
      };
      projectedNodes.push(projected);
      nodeMap.set(node.id, projected);

      drawables.push({
        kind: "node",
        depth: p.depth,
        projected,
      });
    }

    for (const link of frame.links) {
      if (!link.visible) continue;

      const src = nodeMap.get(link.sourceId);
      const tgt = nodeMap.get(link.targetId);
      if (!src || !tgt) continue;

      drawables.push({
        kind: "link",
        depth: (src.p.depth + tgt.p.depth) / 2,
        link,
        src,
        tgt,
      });
    }

    drawables.sort((a, b) => b.depth - a.depth); // far -> near

    this.drawDrawables(drawables, frame);
    this.drawLabels(projectedNodes, frame);
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

  private drawLabels(nodes: ProjectedNode[], frame: RenderFrame): void {
    if (!frame.settings.showLabels) return;

    this.ctx.save();
    this.ctx.font = `${frame.settings.labelFontSize}px sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillStyle = frame.settings.labelColor;

    const projected = nodes
      .filter(({ node, focusAlpha }) => {
        if (!node.visible) return false;
        if (node.type === "tag" && !frame.settings.showTags) return false;
        if (node.labelOpacity <= 0) return false;
        if (focusAlpha <= 0) return false;
        return true;
      })
      .sort((a, b) => b.p.depth - a.p.depth);

    for (const { node, p, focusAlpha } of projected) {
      const offsetY = node.radius * p.scale + frame.settings.labelOffsetY;
      const lines = node.label.split("\n");
      const lineHeight = frame.settings.labelFontSize * 1.1;
      const firstLineY = p.y + offsetY - ((lines.length - 1) * lineHeight) / 2;

      this.ctx.globalAlpha = node.labelOpacity * focusAlpha;
      for (let i = 0; i < lines.length; i++) {
        this.ctx.fillText(lines[i], p.x, firstLineY + i * lineHeight);
      }
    }

    this.ctx.restore();
    this.ctx.globalAlpha = 1;
  }

  private drawDrawables(drawables: Drawable[], frame: RenderFrame): void {
    this.ctx.save();

    for (const item of drawables) {
      if (item.kind === "link") {
        const { link, src, tgt } = item;
        const a = src.p;
        const b = tgt.p;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        const startX = a.x + ux * (src.node.radius * a.scale);
        const startY = a.y + uy * (src.node.radius * a.scale);
        const endX   = b.x - ux * (tgt.node.radius * b.scale);
        const endY   = b.y - uy * (tgt.node.radius * b.scale);

        const pressureDelta = Math.abs(src.node.animaPressure - tgt.node.animaPressure);
        const pressureAlpha = Math.max(0.2, Math.min(1, 0.2 + pressureDelta * 0.8));
        const focusAlpha = (src.focusAlpha + tgt.focusAlpha) / 2;
        this.ctx.globalAlpha = pressureAlpha * focusAlpha;
        this.ctx.strokeStyle = frame.settings.linkColor;
        this.ctx.lineWidth = link.thickness;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
      } else {
        const { node, p, focusAlpha } = item.projected;
        const r = node.radius * p.scale;
        const fillColor =
          node.type === "tag"
            ? frame.settings.tagColor
            : frame.settings.nodeColor;
        const displayPressure = Math.max(0, Math.min(1.5, node.animaPressure));
        const darken = Math.max(0, 1 - Math.min(1, displayPressure));
        const brighten = Math.max(0, displayPressure - 1);

        this.ctx.globalAlpha = focusAlpha;
        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        this.ctx.fill();

        if (darken > 0) {
          this.ctx.globalAlpha = focusAlpha * Math.min(0.65, darken * 0.65);
          this.ctx.fillStyle = "#000000";
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          this.ctx.fill();
        } else if (brighten > 0) {
          this.ctx.globalAlpha = focusAlpha * Math.min(0.35, brighten * 0.7);
          this.ctx.fillStyle = "#ffffff";
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          this.ctx.fill();
        }

        this.ctx.globalAlpha = 1;
      }
    }

    this.ctx.restore();
  }

  private computeFocusAlpha(viewZ: number, focusPlane: RenderFocusPlane): number {
    if (!focusPlane.enabled) return 1;

    const distance = Math.abs(viewZ - focusPlane.centerViewZ);
    if (distance <= focusPlane.halfWidth) return 1;

    const fadeDistance = Math.max(0.0001, focusPlane.fadeDistance);
    const t = Math.min(1, (distance - focusPlane.halfWidth) / fadeDistance);
    return lerp(1, focusPlane.minAlpha, smoothstep(t));
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
