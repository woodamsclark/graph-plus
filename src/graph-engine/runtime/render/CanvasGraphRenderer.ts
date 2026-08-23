import type { GraphCameraController, ProjectedGraphPointV1 } from '../camera/index.ts';
import type { GraphFrameStore } from './GraphFrameStore.ts';
import type { GraphRenderFrameV1, GraphRenderNodeV1 } from './GraphRenderTypes.ts';

interface ProjectedNode {
  readonly node: GraphRenderNodeV1;
  readonly point: ProjectedGraphPointV1;
  readonly radius: number;
}

export interface GraphRenderTimingV1 {
  readonly projectionMs: number;
  readonly edgeRenderMs: number;
  readonly nodeRenderMs: number;
  readonly labelLayoutMs: number;
  readonly labelDrawMs: number;
}

export class CanvasGraphRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly textWidthCache = new Map<string, number>();
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: GraphCameraController,
    private readonly frames: GraphFrameStore,
    private readonly now: () => number,
  ) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire the graph Canvas2D rendering context.');
    this.context = context;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  render(): GraphRenderTimingV1 {
    const frame = this.frames.get();
    if (!frame) return emptyRenderTiming();
    this.clear(frame);
    const projectionStart = this.now();
    const projected = frame.nodes
      .map((node) => {
        const point = this.camera.worldToScreen(node.position);
        return { node, point, radius: node.radius * point.scale };
      })
      .filter(({ point }) => point.depth > 0)
      .sort((a, b) => b.point.depth - a.point.depth);
    const byId = new Map(projected.map((value) => [value.node.id, value]));
    const visible = projected.filter(({ point, radius }) => circleIntersectsViewport(point.x, point.y, radius + 4, this.width, this.height));
    const projectionMs = elapsed(projectionStart, this.now());
    const edgeStart = this.now();
    this.drawEdges(frame, byId);
    const edgeRenderMs = elapsed(edgeStart, this.now());
    const nodeStart = this.now();
    this.drawNodes(frame, visible);
    const nodeRenderMs = elapsed(nodeStart, this.now());
    const labels = this.drawLabels(frame, visible);
    return { projectionMs, edgeRenderMs, nodeRenderMs, ...labels };
  }

  private clear(frame: GraphRenderFrameV1): void {
    this.context.clearRect(0, 0, this.width, this.height);
    if (frame.theme.backgroundColor !== 'transparent') {
      this.context.fillStyle = frame.theme.backgroundColor;
      this.context.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawEdges(frame: GraphRenderFrameV1, nodes: ReadonlyMap<string, ProjectedNode>): void {
    this.context.save();
    for (const edge of frame.edges) {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target) continue;
      if (!segmentBoundsIntersectViewport(source.point, target.point, this.width, this.height)) continue;
      const dx = target.point.x - source.point.x;
      const dy = target.point.y - source.point.y;
      const length = Math.hypot(dx, dy);
      if (length <= 0.0001) continue;
      const unitX = dx / length;
      const unitY = dy / length;
      const startX = source.point.x + unitX * source.radius;
      const startY = source.point.y + unitY * source.radius;
      const endX = target.point.x - unitX * target.radius;
      const endY = target.point.y - unitY * target.radius;
      this.context.strokeStyle = edge.color ?? frame.theme.edgeColor;
      this.context.fillStyle = edge.color ?? frame.theme.edgeColor;
      this.context.lineWidth = edge.thickness;
      this.context.setLineDash(edge.dashed ? [4, 5] : []);
      this.context.beginPath();
      this.context.moveTo(startX, startY);
      this.context.lineTo(endX, endY);
      this.context.stroke();
      if (edge.directed) drawArrow(this.context, endX, endY, unitX, unitY, Math.max(5, edge.thickness * 3));
    }
    this.context.restore();
  }

  private drawNodes(frame: GraphRenderFrameV1, nodes: readonly ProjectedNode[]): void {
    this.context.save();
    for (const { node, point, radius } of nodes) {
      this.context.fillStyle = node.focused
        ? frame.theme.focusedNodeColor
        : node.selected
          ? frame.theme.selectedNodeColor
          : node.color ?? frame.theme.nodeColor;
      this.context.beginPath();
      this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.context.fill();
      if (node.focused || node.selected) {
        this.context.strokeStyle = frame.theme.labelColor;
        this.context.lineWidth = node.focused ? 2 : 1;
        this.context.stroke();
      }
    }
    this.context.restore();
  }

  private drawLabels(frame: GraphRenderFrameV1, nodes: readonly ProjectedNode[]): Pick<GraphRenderTimingV1, 'labelLayoutMs' | 'labelDrawMs'> {
    const mode = frame.theme.labelMode ?? 'adaptive';
    if (mode === 'off') return { labelLayoutMs: 0, labelDrawMs: 0 };
    this.context.save();
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';
    this.context.font = frame.theme.labelFont;
    this.context.fillStyle = frame.theme.labelColor;
    const candidates = nodes
      .filter(({ node }) => node.showLabel !== false)
      .map((value) => ({ ...value, score: labelScore(value) }))
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    const layoutStart = this.now();
    let acceptedCandidates: readonly ProjectedNode[];
    if (mode === 'all') {
      acceptedCandidates = candidates;
    } else {
      const zoom = Math.max(0.1, this.camera.getState().zoom);
      const budget = clampInteger(Math.round(this.width * this.height / 12000 * Math.sqrt(zoom)), 12, 120);
      const occupied: LabelBounds[] = [];
      const accepted: ProjectedNode[] = [];
      for (const candidate of candidates) {
        const forced = candidate.node.focused
          || candidate.node.selected
          || candidate.node.hovered
          || candidate.node.labelAlwaysVisible === true;
        if (!forced && accepted.length >= budget) continue;
        const bounds = this.labelBounds(candidate);
        if (!forced && occupied.some((other) => overlaps(bounds, other))) continue;
        occupied.push(bounds);
        accepted.push(candidate);
      }
      acceptedCandidates = accepted;
    }
    const labelLayoutMs = elapsed(layoutStart, this.now());
    const drawStart = this.now();
    for (const { node, point, radius } of acceptedCandidates) this.context.fillText(node.label, point.x, point.y + radius + 4);
    const labelDrawMs = elapsed(drawStart, this.now());
    this.context.restore();
    return { labelLayoutMs, labelDrawMs };
  }

  private labelBounds(value: ProjectedNode): LabelBounds {
    const cacheKey = `${this.context.font}\u0000${value.node.label}`;
    let width = this.textWidthCache.get(cacheKey);
    if (width === undefined) {
      const measured = this.context.measureText?.(value.node.label)?.width;
      width = Number.isFinite(measured) ? measured! : value.node.label.length * 7;
      if (this.textWidthCache.size >= 20_000) this.textWidthCache.clear();
      this.textWidthCache.set(cacheKey, width);
    }
    const height = fontPixelHeight(this.context.font);
    const centerX = value.point.x;
    const top = value.point.y + value.radius + 4;
    return { left: centerX - width / 2 - 2, right: centerX + width / 2 + 2, top, bottom: top + height + 2 };
  }
}

function emptyRenderTiming(): GraphRenderTimingV1 {
  return { projectionMs: 0, edgeRenderMs: 0, nodeRenderMs: 0, labelLayoutMs: 0, labelDrawMs: 0 };
}

function elapsed(start: number, end: number): number {
  return Math.max(0, end - start);
}

interface LabelBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function labelScore(value: ProjectedNode): number {
  if (value.node.focused) return 1_000_000_000;
  if (value.node.selected) return 900_000_000;
  if (value.node.hovered) return 800_000_000;
  if (value.node.labelAlwaysVisible) return 700_000_000;
  return (value.node.labelPriority ?? 0) * 10_000 + value.point.scale * 100 + value.radius;
}

function overlaps(a: LabelBounds, b: LabelBounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function circleIntersectsViewport(x: number, y: number, radius: number, width: number, height: number): boolean {
  return x + radius >= 0 && x - radius <= width && y + radius >= 0 && y - radius <= height;
}

function segmentBoundsIntersectViewport(
  a: ProjectedGraphPointV1,
  b: ProjectedGraphPointV1,
  width: number,
  height: number,
): boolean {
  return Math.max(a.x, b.x) >= 0 && Math.min(a.x, b.x) <= width
    && Math.max(a.y, b.y) >= 0 && Math.min(a.y, b.y) <= height;
}

function fontPixelHeight(font: string): number {
  const match = /([0-9]+(?:\.[0-9]+)?)px/.exec(font);
  return match ? Number(match[1]) : 12;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function drawArrow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  unitX: number,
  unitY: number,
  size: number,
): void {
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - unitX * size + perpendicularX * size * 0.55, y - unitY * size + perpendicularY * size * 0.55);
  context.lineTo(x - unitX * size - perpendicularX * size * 0.55, y - unitY * size - perpendicularY * size * 0.55);
  context.closePath();
  context.fill();
}
