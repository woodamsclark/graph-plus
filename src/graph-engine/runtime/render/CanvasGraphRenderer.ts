import type { GraphCameraController, ProjectedGraphPointV1 } from '../camera/index.ts';
import type { GraphFrameStore } from './GraphFrameStore.ts';
import type {
  GraphRenderFrameV1,
  GraphRenderNodeV1,
  GraphRenderRegionV1,
} from './GraphRenderTypes.ts';

interface ProjectedNode {
  readonly node: GraphRenderNodeV1;
  readonly point: ProjectedGraphPointV1;
  readonly radius: number;
}

export interface GraphRenderTimingV1 {
  readonly projectionMs: number;
  readonly regionRenderMs: number;
  readonly edgeRenderMs: number;
  readonly nodeRenderMs: number;
  readonly labelLayoutMs: number;
  readonly labelDrawMs: number;
}

export class CanvasGraphRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly textWidthCache = new Map<string, number>();
  private readonly hitGrid = new Map<string, ProjectedNode[]>();
  private readonly hitCellSize = 32;
  private indexedFrame: GraphRenderFrameV1 | null = null;
  private indexedCameraKey = '';
  private readonly regionContourCache = new Map<string, {
    readonly signature: string;
    readonly points: readonly import('../../contracts/v1/index.ts').Vec3[];
  }>();
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
    if (!frame) {
      this.hitGrid.clear();
      this.indexedFrame = null;
      this.indexedCameraKey = '';
      return emptyRenderTiming();
    }
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
    const renderNodeById = new Map(frame.nodes.map((node) => [node.id, node] as const));
    const visible = projected.filter(({ point, radius }) => circleIntersectsViewport(point.x, point.y, radius + 4, this.width, this.height));
    this.rebuildHitGrid(visible);
    this.indexedFrame = frame;
    this.indexedCameraKey = this.cameraKey();
    const projectionMs = elapsed(projectionStart, this.now());
    const regionStart = this.now();
    this.drawRegions(frame, renderNodeById);
    const regionRenderMs = elapsed(regionStart, this.now());
    const edgeStart = this.now();
    this.drawEdges(frame, byId);
    const edgeRenderMs = elapsed(edgeStart, this.now());
    const nodeStart = this.now();
    this.drawNodes(frame, visible);
    const nodeRenderMs = elapsed(nodeStart, this.now());
    const labels = this.drawLabels(frame, visible);
    return { projectionMs, regionRenderMs, edgeRenderMs, nodeRenderMs, ...labels };
  }

  hitTest(point: { readonly x: number; readonly y: number }): {
    readonly nodeId: string;
    readonly position: import('../../contracts/v1/index.ts').Vec3;
    readonly depth: number;
  } | null {
    const frame = this.frames.get();
    const cameraKey = this.cameraKey();
    if (frame && (frame !== this.indexedFrame || cameraKey !== this.indexedCameraKey)) {
      const visible = frame.nodes
        .map((node) => {
          const projected = this.camera.worldToScreen(node.position);
          return { node, point: projected, radius: node.radius * projected.scale };
        })
        .filter(({ point: projected, radius }) => projected.depth > 0
          && circleIntersectsViewport(projected.x, projected.y, radius + 4, this.width, this.height));
      this.rebuildHitGrid(visible);
      this.indexedFrame = frame;
      this.indexedCameraKey = cameraKey;
    }
    const candidates = this.hitGrid.get(this.hitGridKey(point.x, point.y)) ?? [];
    let best: ProjectedNode | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = (point.x - candidate.point.x) ** 2 + (point.y - candidate.point.y) ** 2;
      if (distance > candidate.radius ** 2) continue;
      if (!best || candidate.point.depth < best.point.depth
        || (candidate.point.depth === best.point.depth && distance < bestDistance)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best ? {
      nodeId: best.node.id,
      position: { ...best.node.position },
      depth: best.point.depth,
    } : null;
  }

  private rebuildHitGrid(nodes: readonly ProjectedNode[]): void {
    this.hitGrid.clear();
    for (const node of nodes) {
      const minX = Math.floor((node.point.x - node.radius) / this.hitCellSize);
      const maxX = Math.floor((node.point.x + node.radius) / this.hitCellSize);
      const minY = Math.floor((node.point.y - node.radius) / this.hitCellSize);
      const maxY = Math.floor((node.point.y + node.radius) / this.hitCellSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = this.hitGrid.get(key);
          if (bucket) bucket.push(node);
          else this.hitGrid.set(key, [node]);
        }
      }
    }
  }

  private hitGridKey(x: number, y: number): string {
    return `${Math.floor(x / this.hitCellSize)}:${Math.floor(y / this.hitCellSize)}`;
  }

  private cameraKey(): string {
    const state = this.camera.getState();
    const viewport = this.camera.getViewport();
    return [
      state.position.x, state.position.y, state.position.z,
      state.target.x, state.target.y, state.target.z,
      state.up.x, state.up.y, state.up.z,
      state.zoom, state.projection, viewport.width, viewport.height,
    ].join(':');
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

  private drawRegions(
    frame: GraphRenderFrameV1,
    nodes: ReadonlyMap<string, GraphRenderNodeV1>,
  ): void {
    const active = new Set(frame.regions.map((region) => region.id));
    for (const id of [...this.regionContourCache.keys()]) {
      if (!active.has(id)) this.regionContourCache.delete(id);
    }
    this.context.save();
    for (const region of [...frame.regions].sort((left, right) =>
      right.memberNodeIds.length - left.memberNodeIds.length || left.id.localeCompare(right.id))) {
      const contour = this.regionContour(region, nodes);
      const projected = contour
        .map((position) => this.camera.worldToScreen(position))
        .filter((point) => point.depth > 0);
      if (projected.length < 3) continue;
      this.traceSmoothClosedPath(projected);
      this.context.globalAlpha = 0.12;
      this.context.fillStyle = region.color;
      this.context.fill();
      this.traceSmoothClosedPath(projected);
      this.context.globalAlpha = 0.52;
      this.context.strokeStyle = region.color;
      this.context.lineWidth = 1.5;
      this.context.setLineDash([]);
      this.context.stroke();
    }
    this.context.restore();
  }

  private regionContour(
    region: GraphRenderRegionV1,
    nodes: ReadonlyMap<string, GraphRenderNodeV1>,
  ) {
    const owner = nodes.get(region.regionNodeId);
    if (!owner) return [];
    const members = [owner, ...region.memberNodeIds.map((id) => nodes.get(id)).filter(isRenderNode)];
    const signature = members.map((node) =>
      `${node.id}:${node.position.x.toFixed(3)}:${node.position.y.toFixed(3)}`).join('|') + `:${region.padding}`;
    const cached = this.regionContourCache.get(region.id);
    if (cached?.signature === signature) return cached.points;
    const center = owner.position;
    const sampleCount = 48;
    const points = Array.from({ length: sampleCount }, (_, index) => {
      const angle = index / sampleCount * Math.PI * 2;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      let radius = region.padding;
      for (const member of members) {
        const dx = member.position.x - center.x;
        const dy = member.position.y - center.y;
        const along = dx * direction.x + dy * direction.y;
        const perpendicular = Math.abs(dx * -direction.y + dy * direction.x);
        if (perpendicular > region.padding) continue;
        const cap = Math.sqrt(Math.max(0, region.padding ** 2 - perpendicular ** 2));
        radius = Math.max(radius, along + cap);
      }
      return {
        x: center.x + direction.x * radius,
        y: center.y + direction.y * radius,
        z: 0,
      };
    });
    this.regionContourCache.set(region.id, { signature, points });
    return points;
  }

  private traceSmoothClosedPath(points: readonly ProjectedGraphPointV1[]): void {
    const midpoint = (a: ProjectedGraphPointV1, b: ProjectedGraphPointV1) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    const start = midpoint(points[points.length - 1], points[0]);
    this.context.beginPath();
    this.context.moveTo(start.x, start.y);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      const end = midpoint(point, next);
      this.context.quadraticCurveTo(point.x, point.y, end.x, end.y);
    }
    this.context.closePath();
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
  return {
    projectionMs: 0,
    regionRenderMs: 0,
    edgeRenderMs: 0,
    nodeRenderMs: 0,
    labelLayoutMs: 0,
    labelDrawMs: 0,
  };
}

function isRenderNode(value: GraphRenderNodeV1 | undefined): value is GraphRenderNodeV1 {
  return value !== undefined;
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
