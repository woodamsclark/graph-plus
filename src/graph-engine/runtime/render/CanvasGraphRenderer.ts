import { GraphCameraController, type ProjectedGraphPointV1 } from '../camera/index.ts';
import type { GraphFrameStore } from './GraphFrameStore.ts';
import type {
  GraphPickRequestV2,
  GraphRendererDiagnosticsV2,
  GraphRendererV2,
  GraphRenderSceneV2,
  GraphRenderViewportV2,
} from './GraphRenderer.ts';
import type {
  GraphRenderFrameV1,
  GraphRenderNodeV1,
  GraphRenderRegionV1,
} from './GraphRenderTypes.ts';
import { graphColorToCssV2, type GraphFontV2 } from '../theme/index.ts';
import type { GraphColorV2 } from '../theme/index.ts';

interface ProjectedNode {
  readonly node: GraphRenderNodeV1;
  readonly point: ProjectedGraphPointV1;
  readonly radius: number;
}

interface ProjectedGeometry {
  readonly id: string;
  readonly point: ProjectedGraphPointV1;
}

export interface GraphRenderTimingV1 {
  readonly projectionMs: number;
  readonly regionRenderMs: number;
  readonly edgeRenderMs: number;
  readonly nodeRenderMs: number;
  readonly labelLayoutMs: number;
  readonly labelDrawMs: number;
}

export class CanvasGraphRenderer implements GraphRendererV2 {
  readonly backendId = 'canvas2d' as const;
  readonly interactionElement: HTMLElement;
  private context!: CanvasRenderingContext2D;
  private camera!: GraphCameraController;
  private frames?: GraphFrameStore;
  private scene: GraphRenderSceneV2 | null = null;
  private readonly now: () => number;
  private lifecycle: 'created' | 'initialized' | 'disposed' = 'created';
  private readonly textWidthCache = new Map<string, number>();
  private colorCssCache = new WeakMap<GraphColorV2, string>();
  private readonly hitGrid = new Map<string, ProjectedNode[]>();
  private readonly hitCellSize = 32;
  private indexedFrame: GraphRenderFrameV1 | null = null;
  private indexedCameraKey = '';
  private projectedGeometryRevision = -1;
  private projectedGeometryCameraKey = '';
  private projectedGeometry: readonly ProjectedGeometry[] = [];
  private projectionCacheHits = 0;
  private readonly regionContourCache = new Map<string, {
    readonly signature: string;
    readonly points: readonly import('../../contracts/v1/index.ts').Vec3[];
  }>();
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement, now: () => number);
  constructor(canvas: HTMLCanvasElement, camera: GraphCameraController, frames: GraphFrameStore, now: () => number);
  constructor(
    private readonly canvas: HTMLCanvasElement,
    cameraOrNow: GraphCameraController | (() => number),
    frames?: GraphFrameStore,
    now?: () => number,
  ) {
    this.interactionElement = canvas;
    this.now = typeof cameraOrNow === 'function' ? cameraOrNow : (now ?? (() => performance.now()));
    if (typeof cameraOrNow !== 'function') {
      this.camera = cameraOrNow;
      this.frames = frames;
      this.initialize();
    }
  }

  initialize(): void {
    if (this.lifecycle === 'initialized') return;
    if (this.lifecycle === 'disposed') throw new Error('The Canvas2D renderer has been disposed.');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire the graph Canvas2D rendering context.');
    this.context = context;
    this.lifecycle = 'initialized';
  }

  resize(viewport: GraphRenderViewportV2): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  resize(viewportOrWidth: GraphRenderViewportV2 | number, heightValue?: number, pixelRatioValue?: number): void {
    const viewport = typeof viewportOrWidth === 'number'
      ? { width: viewportOrWidth, height: heightValue ?? 0, devicePixelRatio: pixelRatioValue ?? 1 }
      : viewportOrWidth;
    const { width, height, devicePixelRatio } = viewport;
    this.width = width;
    this.height = height;
    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  render(): GraphRenderTimingV1 {
    const frame = this.currentFrame();
    if (!frame) {
      this.hitGrid.clear();
      this.indexedFrame = null;
      this.indexedCameraKey = '';
      return emptyRenderTiming();
    }
    this.clear(frame);
    const projectionStart = this.now();
    const projected = this.projectFrame(frame);
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

  hitTest(point: { readonly x: number; readonly y: number }, pointerKind: 'mouse' | 'touch' | 'pen' = 'mouse'): {
    readonly nodeId: string;
    readonly position: import('../../contracts/v1/index.ts').Vec3;
    readonly depth: number;
  } | null {
    const frame = this.currentFrame();
    const cameraKey = this.cameraKey();
    if (frame && (frame !== this.indexedFrame || cameraKey !== this.indexedCameraKey)) {
      const visible = this.projectFrame(frame)
        .filter(({ point: projected, radius }) =>
          circleIntersectsViewport(projected.x, projected.y, radius + 4, this.width, this.height));
      this.rebuildHitGrid(visible);
      this.indexedFrame = frame;
      this.indexedCameraKey = cameraKey;
    }
    const minimumTouchRadius = pointerKind === 'touch' && frame !== null
      && renderPolicy(frame).minimumPerspectiveTouchHitRadius !== undefined
      && this.camera.getState().projection === 'perspective'
      ? renderPolicy(frame).minimumPerspectiveTouchHitRadius!
      : 0;
    const candidates = this.hitCandidates(point.x, point.y, minimumTouchRadius);
    let bestVisible: ProjectedNode | undefined;
    let bestVisibleDistance = Number.POSITIVE_INFINITY;
    let bestTouch: ProjectedNode | undefined;
    let bestTouchDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = (point.x - candidate.point.x) ** 2 + (point.y - candidate.point.y) ** 2;
      if (distance <= candidate.radius ** 2) {
        if (!bestVisible || candidate.point.depth < bestVisible.point.depth
          || (candidate.point.depth === bestVisible.point.depth && distance < bestVisibleDistance)) {
          bestVisible = candidate;
          bestVisibleDistance = distance;
        }
        continue;
      }
      if (minimumTouchRadius > 0 && distance <= minimumTouchRadius ** 2
        && (distance < bestTouchDistance
          || (distance === bestTouchDistance && candidate.point.depth < (bestTouch?.point.depth ?? Number.POSITIVE_INFINITY)))) {
        bestTouch = candidate;
        bestTouchDistance = distance;
      }
    }
    const best = bestVisible ?? bestTouch;
    return best ? {
      nodeId: best.node.id,
      position: { ...best.node.position },
      depth: best.point.depth,
    } : null;
  }

  getDiagnostics(): Readonly<Record<string, number>> {
    return {
      projectedGeometryEntries: this.projectedGeometry.length,
      projectionCacheHits: this.projectionCacheHits,
      hitGridCells: this.hitGrid.size,
      textWidthCacheEntries: this.textWidthCache.size,
      regionContourCacheEntries: this.regionContourCache.size,
    };
  }

  updateTheme(_theme: import('../theme/index.ts').GraphVisualThemeV2): void {}

  updateScene(scene: GraphRenderSceneV2): void {
    this.scene = scene;
    if (!this.camera) this.camera = new GraphCameraController(scene.view.camera, scene.view.dimensions);
    else this.camera.setState(scene.view.camera);
    this.camera.setViewport(scene.view.viewport.width, scene.view.viewport.height);
  }

  pick(request: GraphPickRequestV2) {
    return this.hitTest(request.point, request.pointerKind);
  }

  getRendererDiagnostics(): GraphRendererDiagnosticsV2 {
    return { backendId: this.backendId, lifecycle: this.lifecycle, resources: this.getDiagnostics() };
  }

  dispose(): void {
    if (this.lifecycle === 'disposed') return;
    this.lifecycle = 'disposed';
    this.scene = null;
    this.hitGrid.clear();
    this.textWidthCache.clear();
    this.regionContourCache.clear();
    this.projectedGeometry = [];
    this.colorCssCache = new WeakMap();
    this.canvas.remove();
  }

  private currentFrame(): GraphRenderFrameV1 | null {
    return this.scene ?? this.frames?.get() ?? null;
  }

  private colorCss(color: GraphColorV2): string {
    const cached = this.colorCssCache.get(color);
    if (cached) return cached;
    const value = graphColorToCssV2(color);
    this.colorCssCache.set(color, value);
    return value;
  }

  private projectFrame(frame: GraphRenderFrameV1): readonly ProjectedNode[] {
    const cameraKey = this.cameraKey();
    if (
      frame.geometryRevision !== undefined
      && frame.geometryRevision === this.projectedGeometryRevision
      && cameraKey === this.projectedGeometryCameraKey
    ) {
      this.projectionCacheHits += 1;
      const nodes = new Map(frame.nodes.map((node) => [node.id, node] as const));
      const projection = this.camera.getState().projection;
      return this.projectedGeometry.flatMap(({ id, point }) => {
        const node = nodes.get(id);
        return node ? [{ node, point, radius: projectedRadius(
          frame, node.radius, point.scale, projection, node.nodeScaleExponent,
        ) }] : [];
      });
    }
    const projection = this.camera.getState().projection;
    const projected = frame.nodes
      .map((node) => {
        const point = this.camera.worldToScreen(node.position);
        return { node, point, radius: projectedRadius(
          frame, node.radius, point.scale, projection, node.nodeScaleExponent,
        ) };
      })
      .filter(({ point }) => point.depth > 0)
      .sort((a, b) => b.point.depth - a.point.depth);
    this.projectedGeometryRevision = frame.geometryRevision ?? -1;
    this.projectedGeometryCameraKey = cameraKey;
    this.projectedGeometry = projected.map(({ node, point }) => ({ id: node.id, point }));
    return projected;
  }

  private hitCandidates(x: number, y: number, searchRadius: number): readonly ProjectedNode[] {
    if (searchRadius <= 0) return this.hitGrid.get(this.hitGridKey(x, y)) ?? [];
    const centerX = Math.floor(x / this.hitCellSize);
    const centerY = Math.floor(y / this.hitCellSize);
    const cellRadius = Math.ceil(searchRadius / this.hitCellSize) + 1;
    const candidates = new Set<ProjectedNode>();
    for (let offsetX = -cellRadius; offsetX <= cellRadius; offsetX += 1) {
      for (let offsetY = -cellRadius; offsetY <= cellRadius; offsetY += 1) {
        for (const candidate of this.hitGrid.get(`${centerX + offsetX}:${centerY + offsetY}`) ?? []) {
          candidates.add(candidate);
        }
      }
    }
    return [...candidates];
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
    if (frame.backgroundColor.a > 0) {
      this.context.fillStyle = this.colorCss(frame.backgroundColor);
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
      this.context.strokeStyle = this.colorCss(edge.color);
      this.context.globalAlpha = clampOpacity(edge.opacity);
      this.context.lineWidth = edge.thickness;
      this.context.setLineDash(edge.dashed ? [4, 5] : []);
      this.context.beginPath();
      this.context.moveTo(startX, startY);
      this.context.lineTo(endX, endY);
      this.context.stroke();
      this.context.fillStyle = this.colorCss(edge.arrowColor);
      this.context.globalAlpha = clampOpacity(edge.arrowOpacity);
      if (edge.arrowAtTarget ?? edge.directed) drawArrow(this.context, endX, endY, unitX, unitY, Math.max(5, edge.thickness * 3));
      if (edge.arrowAtSource === true) drawArrow(this.context, startX, startY, -unitX, -unitY, Math.max(5, edge.thickness * 3));
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
      this.context.globalAlpha = clampOpacity(region.fillOpacity);
      this.context.fillStyle = this.colorCss(region.fillColor);
      this.context.fill();
      this.traceSmoothClosedPath(projected);
      this.context.globalAlpha = clampOpacity(region.strokeOpacity);
      this.context.strokeStyle = this.colorCss(region.strokeColor);
      this.context.lineWidth = region.strokeWidth;
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
      this.context.globalAlpha = clampOpacity(node.opacity);
      this.context.fillStyle = this.colorCss(node.finalColor);
      this.context.beginPath();
      this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.context.fill();
      if (node.strokeWidth !== undefined && node.strokeColor !== undefined) {
        this.context.strokeStyle = this.colorCss(node.strokeColor);
        this.context.lineWidth = node.strokeWidth;
        this.context.stroke();
      }
    }
    this.context.restore();
  }

  private drawLabels(frame: GraphRenderFrameV1, nodes: readonly ProjectedNode[]): Pick<GraphRenderTimingV1, 'labelLayoutMs' | 'labelDrawMs'> {
    const mode = renderPolicy(frame).labelMode ?? 'adaptive';
    this.context.save();
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';
    this.context.font = graphFontToCss(frame.labelFont);
    const candidates = nodes
      .filter(({ node }) => node.showLabel !== false && (mode !== 'off' || node.labelForceVisible === true))
      .sort(compareLabelCandidates);
    const layoutStart = this.now();
    let acceptedCandidates: readonly ProjectedNode[];
    if (mode === 'all' || mode === 'off') {
      acceptedCandidates = candidates;
    } else {
      const cameraState = this.camera.getState();
      const zoom = cameraState.projection === 'perspective'
        ? this.camera.worldToScreen(cameraState.target).scale
        : Math.max(0.1, cameraState.zoom);
      const threshold = Math.max(0, Math.min(100, renderPolicy(frame).adaptiveLabelThreshold ?? 50));
      const thresholdFactor = 2 ** ((50 - threshold) / 50);
      const minimumBudget = clampInteger(Math.round(12 * thresholdFactor), 4, 24);
      const budget = clampInteger(
        Math.round(this.width * this.height / 12000 * Math.sqrt(zoom) * thresholdFactor),
        minimumBudget,
        120,
      );
      const occupied: LabelBounds[] = [];
      const accepted: ProjectedNode[] = [];
      for (const candidate of candidates) {
        const forced = candidate.node.labelForceVisible === true
          || candidate.node.labelAlwaysVisible === true;
        if (!forced && accepted.length >= budget) continue;
        const bounds = this.labelBounds(frame, candidate);
        if (!forced && occupied.some((other) => overlaps(bounds, other))) continue;
        occupied.push(bounds);
        accepted.push(candidate);
      }
      acceptedCandidates = accepted;
    }
    const labelLayoutMs = elapsed(layoutStart, this.now());
    const drawStart = this.now();
    for (const { node, point, radius } of acceptedCandidates) {
      const offset = node.labelOffset ?? { x: 0, y: 0 };
      this.context.globalAlpha = clampOpacity(node.labelOpacity);
      this.context.fillStyle = this.colorCss(node.labelColor);
      const font = nodeFont(frame, node, this.camera.getState().zoom, this.camera.getState().projection);
      this.context.font = font;
      this.context.fillText(node.label, point.x + offset.x, labelTop(frame, point.y, radius, font) + offset.y);
    }
    const labelDrawMs = elapsed(drawStart, this.now());
    this.context.restore();
    return { labelLayoutMs, labelDrawMs };
  }

  private labelBounds(frame: GraphRenderFrameV1, value: ProjectedNode): LabelBounds {
    this.context.font = nodeFont(frame, value.node, this.camera.getState().zoom, this.camera.getState().projection);
    const cacheKey = `${this.context.font}\u0000${value.node.label}`;
    let width = this.textWidthCache.get(cacheKey);
    if (width === undefined) {
      const measured = this.context.measureText?.(value.node.label)?.width;
      width = Number.isFinite(measured) ? measured! : value.node.label.length * 7;
      if (this.textWidthCache.size >= 20_000) this.textWidthCache.clear();
      this.textWidthCache.set(cacheKey, width);
    }
    const height = fontPixelHeight(this.context.font);
    const offset = value.node.labelOffset ?? { x: 0, y: 0 };
    const centerX = value.point.x + offset.x;
    const top = labelTop(frame, value.point.y, value.radius, this.context.font) + offset.y;
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

function compareLabelCandidates(a: ProjectedNode, b: ProjectedNode): number {
  return b.node.labelStatePriority - a.node.labelStatePriority
    || (b.node.labelPriority ?? 0) - (a.node.labelPriority ?? 0)
    || b.node.radius - a.node.radius
    || b.point.scale - a.point.scale
    || a.node.id.localeCompare(b.node.id);
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

function labelTop(
  frame: GraphRenderFrameV1,
  nodeY: number,
  radius: number,
  font: string,
): number {
  return renderPolicy(frame).labelPosition === 'above'
    ? nodeY - radius - 4 - fontPixelHeight(font)
    : nodeY + radius + 4;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function projectedRadius(
  frame: GraphRenderFrameV1,
  radius: number,
  scale: number,
  projection: 'orthographic' | 'perspective',
  nodeScaleExponent?: number,
): number {
  const policy = renderPolicy(frame);
  const legacyExponent = projection === 'orthographic' && policy.nodeScaleMode === 'sqrt-orthographic' ? 0.5 : 1;
  const exponent = Math.max(0, Math.min(2, nodeScaleExponent ?? policy.nodeScaleExponent ?? legacyExponent));
  const projected = radius * Math.pow(Math.max(0, scale), exponent);
  if (projection !== 'perspective') return projected;
  const relativeFloor = radius * Math.max(0, policy.minimumPerspectiveNodeScale ?? 0);
  return Math.max(policy.minimumPerspectiveNodeRadius ?? 0, relativeFloor, projected);
}

function nodeFont(
  frame: GraphRenderFrameV1,
  node: GraphRenderNodeV1,
  zoom: number,
  projection: 'orthographic' | 'perspective',
): string {
  const scale = renderPolicy(frame).labelScaleMode === 'sqrt-orthographic' && projection === 'orthographic'
    ? Math.sqrt(Math.max(0, zoom))
    : 1;
  const size = Math.max(1, node.labelFontSize * scale);
  const family = frame.labelFont.family;
  return `${size}px ${family || 'sans-serif'}`;
}

function graphFontToCss(font: GraphFontV2): string {
  return `${font.style} ${font.weight} ${font.sizePx}px/${font.lineHeightPx}px ${font.family}`;
}

function renderPolicy(frame: GraphRenderFrameV1) {
  return frame.policy ?? {};
}

function clampOpacity(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, Math.min(1, value));
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
