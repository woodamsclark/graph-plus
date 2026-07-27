import type {
  RenderAnimaFlowState,
  RenderFocusPlane,
  RenderFrame,
  RenderLinkState,
  RenderNodeState,
} from "../../types/domain/render.ts";
import type { CameraAccessor }                                  from "../../types/domain/camera.ts";
import      { FrameStore }                                from "./FrameStore.ts";

const ANIMA_FIELD_RESOLUTION = 0.5;
const ANIMA_FIELD_BLUR_PX = 7;
const ANIMA_NODE_SWELL = 0.28;
const ANIMA_BLOB_SPEED = 0.38;
const ANIMA_EMPTY_PRESSURE = 0.75;
const ANIMA_MAX_DISPLAY_PRESSURE = 2;

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

type LinkDrawable = {
  depth: number;
  link: RenderLinkState;
  src: ProjectedNode;
  tgt: ProjectedNode;
};

type NodeDrawable = {
  depth: number;
  projected: ProjectedNode;
};

type FlowDrawable = {
  flow: RenderAnimaFlowState;
  src: ProjectedNode;
  tgt: ProjectedNode;
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private fluidCanvas: HTMLCanvasElement;
  private fluidCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private elapsedSeconds = 0;

  constructor(
    private canvas    : HTMLCanvasElement,
    private camera    : CameraAccessor,
    private frameStore: FrameStore,
  ) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D rendering context");
    this.ctx = ctx;

    this.fluidCanvas = document.createElement("canvas");
    const fluidCtx = this.fluidCanvas.getContext("2d");
    if (!fluidCtx) throw new Error("Could not acquire Anima field rendering context");
    this.fluidCtx = fluidCtx;
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

    this.fluidCanvas.width = Math.max(1, Math.floor(width * ANIMA_FIELD_RESOLUTION));
    this.fluidCanvas.height = Math.max(1, Math.floor(height * ANIMA_FIELD_RESOLUTION));
    this.fluidCtx.setTransform(
      ANIMA_FIELD_RESOLUTION,
      0,
      0,
      ANIMA_FIELD_RESOLUTION,
      0,
      0,
    );

    this.camera.setViewport(width, height);
  }

  public tick(dt: number ): void {
    this.elapsedSeconds += Math.max(0, dt);
    this.render();
  }

  public render(): void {
    const frame = this.frameStore.get();
    if (!frame) return;

    this.clear(frame);

    const projectedNodes: ProjectedNode[] = [];
    const nodeMap = new Map<string, ProjectedNode>();
    const nodeDrawables: NodeDrawable[] = [];
    const linkDrawables: LinkDrawable[] = [];
    const flowDrawables: FlowDrawable[] = [];

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

      nodeDrawables.push({
        depth: p.depth,
        projected,
      });
    }

    for (const link of frame.links) {
      if (!link.visible) continue;

      const src = nodeMap.get(link.sourceId);
      const tgt = nodeMap.get(link.targetId);
      if (!src || !tgt) continue;

      linkDrawables.push({
        depth: (src.p.depth + tgt.p.depth) / 2,
        link,
        src,
        tgt,
      });
    }

    for (const flow of frame.animaFlows) {
      const src = nodeMap.get(flow.fromNodeId);
      const tgt = nodeMap.get(flow.toNodeId);
      if (!src || !tgt) continue;

      flowDrawables.push({ flow, src, tgt });
    }

    linkDrawables.sort((a, b) => b.depth - a.depth); // far -> near
    nodeDrawables.sort((a, b) => b.depth - a.depth); // far -> near

    // Keep links depth-sorted, but always paint nodes on top so overlap reads consistently.
    this.drawLinks(linkDrawables, frame);
    this.drawAnimaField(projectedNodes, flowDrawables, frame);
    this.drawNodes(nodeDrawables, frame);
    this.drawFlowHighlights(flowDrawables, frame);
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
      const offsetY =
        node.radius * p.scale * this.getNodeSwell(node) +
        frame.settings.labelOffsetY;
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

  private drawLinks(drawables: LinkDrawable[], frame: RenderFrame): void {
    this.ctx.save();

    for (const { link, src, tgt } of drawables) {
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
    }

    this.ctx.restore();
  }

  private drawNodes(drawables: NodeDrawable[], frame: RenderFrame): void {
    this.ctx.save();

    for (const { projected } of drawables) {
      const { node, p, focusAlpha } = projected;
      const r = node.radius * p.scale * this.getNodeSwell(node);
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

    this.ctx.restore();
  }

  private drawAnimaField(
    nodes: ProjectedNode[],
    flows: FlowDrawable[],
    frame: RenderFrame,
  ): void {
    const field = this.fluidCtx;
    field.save();
    field.setTransform(1, 0, 0, 1, 0, 0);
    field.clearRect(0, 0, this.fluidCanvas.width, this.fluidCanvas.height);
    field.restore();

    field.save();
    field.setTransform(
      ANIMA_FIELD_RESOLUTION,
      0,
      0,
      ANIMA_FIELD_RESOLUTION,
      0,
      0,
    );
    field.globalCompositeOperation = "lighter";

    const supportsFilter = typeof field.filter === "string";
    if (supportsFilter) {
      field.filter = `blur(${ANIMA_FIELD_BLUR_PX * ANIMA_FIELD_RESOLUTION}px)`;
    }

    for (const projected of nodes) {
      const { node, p, focusAlpha } = projected;
      const fill = this.getAnimaFill(node);
      if (fill <= 0.01 || focusAlpha <= 0.01) continue;

      const radius = node.radius * p.scale * this.getNodeSwell(node);
      const color =
        node.type === "tag"
          ? frame.settings.tagColor
          : frame.settings.nodeColor;

      field.globalAlpha = focusAlpha * (0.22 + fill * 0.58);
      field.fillStyle = color;
      if (!supportsFilter) {
        field.shadowBlur = ANIMA_FIELD_BLUR_PX;
        field.shadowColor = color;
      }
      field.beginPath();
      field.arc(p.x, p.y, radius, 0, Math.PI * 2);
      field.fill();
    }

    for (const drawable of flows) {
      const blob = this.getFlowBlob(drawable);
      const focusAlpha = (drawable.src.focusAlpha + drawable.tgt.focusAlpha) / 2;
      if (focusAlpha <= 0.01) continue;

      const color =
        drawable.src.node.type === "tag"
          ? frame.settings.tagColor
          : frame.settings.nodeColor;

      field.globalAlpha = focusAlpha * (0.55 + drawable.flow.strength * 0.35);
      field.fillStyle = color;
      if (!supportsFilter) {
        field.shadowBlur = ANIMA_FIELD_BLUR_PX;
        field.shadowColor = color;
      }
      field.beginPath();
      field.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
      field.fill();
    }

    field.restore();

    this.ctx.save();
    this.ctx.globalAlpha = 0.88;
    this.ctx.drawImage(this.fluidCanvas, 0, 0, this.width, this.height);
    this.ctx.restore();
  }

  private drawFlowHighlights(flows: FlowDrawable[], frame: RenderFrame): void {
    this.ctx.save();

    for (const drawable of flows) {
      const focusAlpha = (drawable.src.focusAlpha + drawable.tgt.focusAlpha) / 2;
      if (focusAlpha <= 0.01) continue;

      const blob = this.getFlowBlob(drawable);
      const color =
        drawable.src.node.type === "tag"
          ? frame.settings.tagColor
          : frame.settings.nodeColor;

      this.ctx.globalCompositeOperation = "source-over";
      this.ctx.globalAlpha = focusAlpha * 0.86;
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
      this.ctx.fill();

      const highlightX = blob.x - blob.radius * 0.3;
      const highlightY = blob.y - blob.radius * 0.3;
      const gradient = this.ctx.createRadialGradient(
        highlightX,
        highlightY,
        Math.max(0.1, blob.radius * 0.05),
        blob.x,
        blob.y,
        blob.radius,
      );
      gradient.addColorStop(0, "rgba(255,255,255,0.8)");
      gradient.addColorStop(0.35, "rgba(255,255,255,0.24)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = focusAlpha;
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private getFlowBlob({ flow, src, tgt }: FlowDrawable): {
    x: number;
    y: number;
    radius: number;
  } {
    const phaseOffset = stableUnitHash(`${flow.fromNodeId}\u0000${flow.toNodeId}`);
    const t = (this.elapsedSeconds * ANIMA_BLOB_SPEED + phaseOffset) % 1;
    const easedT = smoothstep(t);
    const minNodeRadius = Math.min(
      src.node.radius * src.p.scale,
      tgt.node.radius * tgt.p.scale,
    );

    return {
      x: lerp(src.p.x, tgt.p.x, easedT),
      y: lerp(src.p.y, tgt.p.y, easedT),
      radius: Math.max(3, minNodeRadius * (0.34 + flow.strength * 0.3)),
    };
  }

  private getNodeSwell(node: RenderNodeState): number {
    return 1 + this.getAnimaFill(node) * ANIMA_NODE_SWELL;
  }

  private getAnimaFill(node: RenderNodeState): number {
    return clamp(
      (node.animaPressure - ANIMA_EMPTY_PRESSURE) /
        (ANIMA_MAX_DISPLAY_PRESSURE - ANIMA_EMPTY_PRESSURE),
      0,
      1,
    );
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stableUnitHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
