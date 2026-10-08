import { Vision, type ProjectedGraphPointV1 } from '../vision/index.ts';
import type { SessionInvalidationClassV1 } from '../session/SessionFrameScheduler.ts';
import type {
  GraphPickRequestV2,
  GraphPickFrame,
  GraphPickNode,
  GraphPickSourceV2,
  GraphNearestNodeRequestV2,
  GraphNearestNodeResultV2,
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

interface ProjectedPickNode {
  node: GraphPickNode;
  readonly point: ProjectedGraphPointV1;
  radius: number;
}

interface ProjectedNode extends ProjectedPickNode { node: GraphRenderNodeV1; }

interface PickIndex {
  readonly source: GraphPickSourceV2;
  readonly geometryRevision: number | undefined;
  readonly visionKey: string;
  readonly grid: Map<string, ProjectedPickNode[]>;
  readonly projected: readonly ProjectedPickNode[];
  centers?: Map<string, ProjectedPickNode[]>;
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
  readonly labelRepresentation = 'node-fields' as const;
  readonly interactionElement: HTMLElement;
  private context!: CanvasRenderingContext2D;
  private vision!: Vision;
  private scene: GraphRenderSceneV2 | null = null;
  private readonly now: () => number;
  private lifecycle: 'created' | 'initialized' | 'disposed' = 'created';
  private readonly textWidthCache = new Map<string, number>();
  private colorCssCache = new WeakMap<GraphColorV2, string>();
  private readonly hitGrid = new Map<string, ProjectedNode[]>();
  private readonly hitCellSize = 32;
  private readonly centerGrid = new Map<string, ProjectedPickNode[]>();
  private centerGridDirty = true;
  private centerIndexBuilds = 0;
  private nearestQueries = 0;
  private nearestQueryCandidates = 0;
  private lastNearestQueryCandidates = 0;
  private pickVision?: Vision;
  // Normal preview and committed fallback are the only alternate pick sources.
  private readonly pickIndexes: PickIndex[] = [];
  private pickIndexBuilds = 0;
  private pickIndexCacheHits = 0;
  private indexedFrame: GraphRenderFrameV1 | null = null;
  private indexedVisionKey = '';
  private projectedGeometryRevision = -1;
  private projectedGeometryVisionKey = '';
  private sourceNodes?: readonly GraphRenderNodeV1[];
  private readonly nodeById = new Map<string, GraphRenderNodeV1>();
  private readonly projectedById = new Map<string, ProjectedNode>();
  private projectedNodes: readonly ProjectedNode[] = [];
  private visibleNodes: readonly ProjectedNode[] = [];
  private spatialDirty = true;
  private indexedWidth = -1;
  private indexedHeight = -1;
  private hitShapePolicyKey = '';
  private readonly pendingInvalidations = new Set<SessionInvalidationClassV1>();
  private spatialIndexBuilds = 0;
  private nodeLookupRefreshes = 0;
  private projectedLookupBuilds = 0;
  private projectionCacheHits = 0;
  private readonly regionContourCache = new Map<string, {
    readonly signature: string;
    readonly points: readonly import('../../contracts/v1/index.ts').Vec3[];
  }>();
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement, now: () => number) {
    this.interactionElement = canvas;
    this.now = now;
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
    const frame = this.scene;
    if (!frame) {
      this.hitGrid.clear();
      this.indexedFrame = null;
      this.indexedVisionKey = '';
      this.spatialDirty = true;
      this.centerGrid.clear();
      this.centerGridDirty = true;
      return emptyRenderTiming();
    }
    this.clear(frame);
    const projectionStart = this.now();
    this.prepareSpatialFrame(frame);
    const projectionMs = elapsed(projectionStart, this.now());
    const regionStart = this.now();
    this.drawRegions(frame, this.nodeById);
    const regionRenderMs = elapsed(regionStart, this.now());
    const edgeStart = this.now();
    this.drawEdges(frame, this.projectedById);
    const edgeRenderMs = elapsed(edgeStart, this.now());
    const nodeStart = this.now();
    this.drawNodes(frame, this.visibleNodes);
    const nodeRenderMs = elapsed(nodeStart, this.now());
    const labels = this.drawLabels(frame, this.visibleNodes);
    return { projectionMs, regionRenderMs, edgeRenderMs, nodeRenderMs, ...labels };
  }

  hitTest(point: { readonly x: number; readonly y: number }, pointerKind: 'mouse' | 'touch' | 'pen' = 'mouse'): {
    readonly nodeId: string;
    readonly position: import('../../contracts/v1/index.ts').Vec3;
    readonly depth: number;
  } | null {
    const frame = this.scene;
    if (frame) this.ensureCurrentSpatialFrame(frame);
    return this.pickFromGrid(point, pointerKind, frame, this.vision, this.hitGrid);
  }

  private ensureCurrentSpatialFrame(frame: GraphRenderFrameV1): void {
    const visionKey = this.visionKey();
    if (frame !== this.indexedFrame || visionKey !== this.indexedVisionKey
      || (frame.geometryRevision !== undefined && frame.geometryRevision !== this.projectedGeometryRevision)
      || this.width !== this.indexedWidth || this.height !== this.indexedHeight
      || this.pendingInvalidations.size > 0) this.prepareSpatialFrame(frame);
  }

  private pickFromGrid(
    point: { readonly x: number; readonly y: number },
    pointerKind: 'mouse' | 'touch' | 'pen',
    frame: GraphPickFrame | null,
    vision: Vision,
    grid: Map<string, ProjectedPickNode[]>,
  ) {
    const minimumTouchRadius = pointerKind === 'touch' && frame !== null
      && renderPolicy(frame).minimumPerspectiveTouchHitRadius !== undefined
      && vision.getState().projection === 'perspective'
      ? renderPolicy(frame).minimumPerspectiveTouchHitRadius!
      : 0;
    const candidates = this.hitCandidates(point.x, point.y, minimumTouchRadius, grid);
    let bestVisible: ProjectedPickNode | undefined;
    let bestVisibleDistance = Number.POSITIVE_INFINITY;
    let bestTouch: ProjectedPickNode | undefined;
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
      pickIndexBuilds: this.pickIndexBuilds,
      pickIndexCacheHits: this.pickIndexCacheHits,
      pickIndexEntries: this.pickIndexes.length,
      centerIndexBuilds: this.centerIndexBuilds,
      nearestQueries: this.nearestQueries,
      nearestQueryCandidates: this.nearestQueryCandidates,
      lastNearestQueryCandidates: this.lastNearestQueryCandidates,
      spatialIndexBuilds: this.spatialIndexBuilds,
      nodeLookupRefreshes: this.nodeLookupRefreshes,
      projectedLookupBuilds: this.projectedLookupBuilds,
      projectedGeometryEntries: this.projectedNodes.length,
      projectionCacheHits: this.projectionCacheHits,
      hitGridCells: this.hitGrid.size,
      textWidthCacheEntries: this.textWidthCache.size,
      regionContourCacheEntries: this.regionContourCache.size,
    };
  }

  updateTheme(_theme: import('../theme/index.ts').GraphVisualThemeV2): void {}

  updateScene(scene: GraphRenderSceneV2, invalidations: readonly SessionInvalidationClassV1[] = []): void {
    for (const reason of invalidations) this.pendingInvalidations.add(reason);
    this.scene = scene;
    if (!this.vision) this.vision = new Vision(scene.view.camera, scene.view.dimensions);
    else this.vision.reconfigure(scene.view.camera, scene.view.dimensions);
    this.vision.setViewport(scene.view.viewport.width, scene.view.viewport.height);
  }

  pick(request: GraphPickRequestV2, source?: GraphPickSourceV2) {
    if (!source) return this.hitTest(request.point, request.pointerKind);
    const spatial = this.pickSpatialSource(source);
    return this.pickFromGrid(request.point, request.pointerKind ?? 'mouse', source.frame, spatial.vision, spatial.grid);
  }

  private pickSpatialSource(source: GraphPickSourceV2): { vision: Vision; grid: Map<string, ProjectedPickNode[]>; index?: PickIndex } {
    if (!this.pickVision) this.pickVision = new Vision(source.view.camera, source.view.dimensions);
    else this.pickVision.reconfigure(source.view.camera, source.view.dimensions);
    this.pickVision.setViewport(source.view.viewport.width, source.view.viewport.height);
    const visionKey = `${source.view.dimensions}:${this.visionKey(this.pickVision)}`;
    // Ordinary picking can use the spatial index installed by the last draw.
    // Alternate sources keep their own indexes and never disturb that index.
    if (!source.positions && !source.nodeIds && !source.retainedNodeId && this.pendingInvalidations.size === 0
      && source.frame.nodes === this.indexedFrame?.nodes
      && source.frame.geometryRevision === this.indexedFrame?.geometryRevision
      && hitShapePolicyKey(source.frame) === hitShapePolicyKey(this.indexedFrame)
      && this.visionKey(this.pickVision) === this.indexedVisionKey) {
      this.pickIndexCacheHits += 1;
      return { vision: this.pickVision, grid: this.hitGrid };
    }
    const cached = this.pickIndexes.find(index => index.source.frame === source.frame
      && index.geometryRevision === source.frame.geometryRevision
      && index.source.positions === source.positions
      && index.source.nodeIds === source.nodeIds
      && index.source.retainedNodeId === source.retainedNodeId
      && index.visionKey === visionKey);
    if (cached) { this.pickIndexCacheHits += 1; return { vision: this.pickVision, grid: cached.grid, index: cached }; }
    const grid = new Map<string, ProjectedPickNode[]>();
    const projected: ProjectedPickNode[] = [];
    const projection = this.pickVision.getState().projection;
    for (const node of source.frame.nodes) {
      if (source.nodeIds && !source.nodeIds.has(node.id)) continue;
      if (node.opacity <= 0 && node.id !== source.retainedNodeId) continue;
      const position = source.positions?.[node.id] ?? node.position;
      const point = this.pickVision.worldToScreen(position);
      if (point.depth <= 0) continue;
      const radius = projectedRadius(source.frame, node.radius, point.scale, projection, node.nodeScaleExponent);
      projected.push({ node: position !== node.position || node.id === source.retainedNodeId
        ? { ...node, position, ...(node.id === source.retainedNodeId ? { opacity: 1 } : {}) } : node, point, radius });
    }
    this.rebuildHitGrid(projected.filter(({ point, radius }) => circleIntersectsViewport(
      point.x, point.y, radius + 4, source.view.viewport.width, source.view.viewport.height,
    )), grid, source.view.viewport.width, source.view.viewport.height);
    this.pickIndexBuilds += 1;
    const index: PickIndex = { source, geometryRevision: source.frame.geometryRevision, visionKey, grid, projected };
    this.pickIndexes.unshift(index);
    if (this.pickIndexes.length > 2) this.pickIndexes.pop();
    return { vision: this.pickVision, grid, index };
  }

  queryNearest(request: GraphNearestNodeRequestV2, source?: GraphPickSourceV2): GraphNearestNodeResultV2 | null {
    this.nearestQueries += 1;
    this.lastNearestQueryCandidates = 0;
    if (!(request.radius > 0) || !Number.isFinite(request.radius)
      || !Number.isFinite(request.point.x) || !Number.isFinite(request.point.y)) return null;
    let centers: Map<string, ProjectedPickNode[]>;
    if (source) {
      const spatial = this.pickSpatialSource(source);
      if (spatial.index) {
        if (!spatial.index.centers) {
          spatial.index.centers = new Map();
          this.rebuildCenterGrid(spatial.index.projected, spatial.index.centers);
        }
        centers = spatial.index.centers;
      } else centers = this.currentCenterGrid();
    } else {
      const frame = this.scene;
      if (!frame) return null;
      this.ensureCurrentSpatialFrame(frame);
      centers = this.currentCenterGrid();
    }
    let best: ProjectedPickNode | undefined;
    let bestDistance = request.radius;
    for (const entry of this.centerCandidates(centers, request)) {
      this.lastNearestQueryCandidates += 1;
      if (request.exclusions?.has(entry.node.id) || request.isEligible?.(entry.node.id) === false) continue;
      const distance = Math.hypot(request.point.x - entry.point.x, request.point.y - entry.point.y);
      if (distance >= request.radius) continue;
      if (!best || distance < bestDistance || (distance === bestDistance && entry.node.id.localeCompare(best.node.id) < 0)) {
        best = entry; bestDistance = distance;
      }
    }
    this.nearestQueryCandidates += this.lastNearestQueryCandidates;
    return best ? { nodeId: best.node.id, position: { ...best.node.position },
      point: { x: best.point.x, y: best.point.y, depth: best.point.depth }, depth: best.point.depth, distance: bestDistance } : null;
  }

  private *centerCandidates(grid: Map<string, ProjectedPickNode[]>, request: GraphNearestNodeRequestV2): Iterable<ProjectedPickNode> {
    const minX = Math.floor((request.point.x - request.radius) / this.hitCellSize);
    const maxX = Math.floor((request.point.x + request.radius) / this.hitCellSize);
    const minY = Math.floor((request.point.y - request.radius) / this.hitCellSize);
    const maxY = Math.floor((request.point.y + request.radius) / this.hitCellSize);
    // Broad queries are bounded by existing entries rather than empty world cells.
    if (![minX, maxX, minY, maxY].every(Number.isSafeInteger)
      || (maxX - minX + 1) * (maxY - minY + 1) > Math.max(4096, grid.size)) {
      for (const bucket of grid.values()) yield* bucket;
      return;
    }
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      yield* grid.get(`${x}:${y}`) ?? [];
    }
  }

  private currentCenterGrid(): Map<string, ProjectedPickNode[]> {
    if (this.centerGridDirty) {
      this.rebuildCenterGrid(this.projectedNodes, this.centerGrid);
      this.centerGridDirty = false;
    }
    return this.centerGrid;
  }

  private rebuildCenterGrid(nodes: readonly ProjectedPickNode[], grid: Map<string, ProjectedPickNode[]>): void {
    grid.clear();
    for (const entry of nodes) {
      if (entry.node.opacity <= 0) continue;
      const key = this.hitGridKey(entry.point.x, entry.point.y);
      const bucket = grid.get(key);
      if (bucket) bucket.push(entry); else grid.set(key, [entry]);
    }
    this.centerIndexBuilds += 1;
  }

  getRendererDiagnostics(): GraphRendererDiagnosticsV2 {
    return { backendId: this.backendId, lifecycle: this.lifecycle, resources: this.getDiagnostics() };
  }

  dispose(): void {
    if (this.lifecycle === 'disposed') return;
    this.lifecycle = 'disposed';
    this.scene = null;
    this.pickIndexes.length = 0;
    this.pickVision = undefined;
    this.hitGrid.clear();
    this.centerGrid.clear();
    this.textWidthCache.clear();
    this.regionContourCache.clear();
    this.projectedNodes = [];
    this.visibleNodes = [];
    this.nodeById.clear();
    this.projectedById.clear();
    this.sourceNodes = undefined;
    this.indexedFrame = null;
    this.pendingInvalidations.clear();
    this.colorCssCache = new WeakMap();
    this.canvas.remove();
  }

  private colorCss(color: GraphColorV2): string {
    const cached = this.colorCssCache.get(color);
    if (cached) return cached;
    const value = graphColorToCssV2(color);
    this.colorCssCache.set(color, value);
    return value;
  }

  /** Presentation refreshes update shared entries; only changed hit shapes rebuild the grid. */
  private prepareSpatialFrame(frame: GraphRenderFrameV1): void {
    this.projectFrame(frame);
    if (this.width !== this.indexedWidth || this.height !== this.indexedHeight) this.spatialDirty = true;
    if (this.spatialDirty) {
      this.visibleNodes = this.projectedNodes.filter(({ point, radius }) =>
        circleIntersectsViewport(point.x, point.y, radius + 4, this.width, this.height));
      this.rebuildHitGrid(this.visibleNodes);
      this.spatialDirty = false;
    }
    this.indexedFrame = frame;
    this.indexedVisionKey = this.visionKey();
    this.indexedWidth = this.width;
    this.indexedHeight = this.height;
    this.pendingInvalidations.clear();
    // Keep the center index ready for the next attraction tick only while the
    // visible scene has an active cursor well. Off/drag/leave add no index work.
    if (this.scene?.cursorScreenPoint && (this.scene.policy?.cursorAttractionRadiusPx ?? 0) > 0) this.currentCenterGrid();
  }

  private projectFrame(frame: GraphRenderFrameV1): readonly ProjectedNode[] {
    const visionKey = this.visionKey();
    const nodesChanged = frame.nodes !== this.sourceNodes || this.pendingInvalidations.has('content');
    const membershipChanged = nodesChanged && (frame.nodes.length !== this.nodeById.size
      || frame.nodes.some(node => !this.nodeById.has(node.id)));
    if (nodesChanged) {
      // One canonical lookup serves projection, region geometry and presentation.
      if (membershipChanged) this.nodeById.clear();
      for (const node of frame.nodes) this.nodeById.set(node.id, node);
      this.sourceNodes = frame.nodes;
      this.nodeLookupRefreshes += 1;
    }
    const policyKey = hitShapePolicyKey(frame);
    const projection = this.vision.getState().projection;
    const geometryChanged = frame.geometryRevision === undefined || membershipChanged
      || (frame.geometryRevision !== undefined && frame.geometryRevision !== this.projectedGeometryRevision)
      || visionKey !== this.projectedGeometryVisionKey
      || this.pendingInvalidations.has('geometry') || this.pendingInvalidations.has('content');
    if (!geometryChanged) {
      this.projectionCacheHits += 1;
      if (nodesChanged || policyKey !== this.hitShapePolicyKey) {
        for (const entry of this.projectedNodes) {
          const node = this.nodeById.get(entry.node.id)!;
          const radius = projectedRadius(frame, node.radius, entry.point.scale, projection, node.nodeScaleExponent);
          if (radius !== entry.radius || (node.opacity > 0) !== (entry.node.opacity > 0)) this.spatialDirty = true;
          if ((node.opacity > 0) !== (entry.node.opacity > 0)) this.centerGridDirty = true;
          // Hit-grid buckets and edge lookups reference this same entry, so they
          // see current visuals and positions without rebuilding their structures.
          entry.node = node;
          entry.radius = radius;
        }
      }
      this.hitShapePolicyKey = policyKey;
      return this.projectedNodes;
    }
    this.projectedNodes = frame.nodes.map(node => {
      const point = this.vision.worldToScreen(node.position);
      return { node, point, radius: projectedRadius(frame, node.radius, point.scale, projection, node.nodeScaleExponent) };
    }).filter(({ point }) => point.depth > 0).sort((a, b) => b.point.depth - a.point.depth);
    if (this.projectedNodes.length !== this.projectedById.size
      || this.projectedNodes.some(entry => !this.projectedById.has(entry.node.id))) this.projectedById.clear();
    for (const entry of this.projectedNodes) this.projectedById.set(entry.node.id, entry);
    this.projectedLookupBuilds += 1;
    this.projectedGeometryRevision = frame.geometryRevision ?? -1;
    this.projectedGeometryVisionKey = visionKey;
    this.hitShapePolicyKey = policyKey;
    this.spatialDirty = true;
    this.centerGridDirty = true;
    return this.projectedNodes;
  }

  private hitCandidates(x: number, y: number, searchRadius: number, grid: Map<string, ProjectedPickNode[]> = this.hitGrid): readonly ProjectedPickNode[] {
    if (searchRadius <= 0) return grid.get(this.hitGridKey(x, y)) ?? [];
    const centerX = Math.floor(x / this.hitCellSize);
    const centerY = Math.floor(y / this.hitCellSize);
    const cellRadius = Math.ceil(searchRadius / this.hitCellSize) + 1;
    const candidates = new Set<ProjectedPickNode>();
    for (let offsetX = -cellRadius; offsetX <= cellRadius; offsetX += 1) {
      for (let offsetY = -cellRadius; offsetY <= cellRadius; offsetY += 1) {
        for (const candidate of grid.get(`${centerX + offsetX}:${centerY + offsetY}`) ?? []) {
          candidates.add(candidate);
        }
      }
    }
    return [...candidates];
  }

  private rebuildHitGrid(nodes: readonly ProjectedPickNode[], grid: Map<string, ProjectedPickNode[]> = this.hitGrid, width = this.width, height = this.height): void {
    if (grid === this.hitGrid) this.spatialIndexBuilds += 1;
    grid.clear();
    for (const node of nodes) {
      if (node.node.opacity <= 0) continue;
      // Picking only needs cells on the canvas, even when zoom makes a disc enormous.
      const minX = Math.max(0, Math.floor((node.point.x - node.radius) / this.hitCellSize));
      const maxX = Math.min(Math.floor(width / this.hitCellSize),
        Math.floor((node.point.x + node.radius) / this.hitCellSize));
      const minY = Math.max(0, Math.floor((node.point.y - node.radius) / this.hitCellSize));
      const maxY = Math.min(Math.floor(height / this.hitCellSize),
        Math.floor((node.point.y + node.radius) / this.hitCellSize));
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(node);
          else grid.set(key, [node]);
        }
      }
    }
  }

  private hitGridKey(x: number, y: number): string {
    return `${Math.floor(x / this.hitCellSize)}:${Math.floor(y / this.hitCellSize)}`;
  }

  private visionKey(vision = this.vision): string {
    const state = vision.getState();
    const viewport = vision.getViewport();
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
        .map((position) => this.vision.worldToScreen(position))
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
      if (node.strokeWidth !== undefined && node.strokeWidth > 0 && node.strokeColor !== undefined) {
        this.context.strokeStyle = this.colorCss(node.strokeColor);
        this.context.lineWidth = node.strokeWidth;
        this.context.stroke();
      }
    }
    this.context.restore();
  }

  private drawLabels(frame: GraphRenderFrameV1, nodes: readonly ProjectedNode[]): Pick<GraphRenderTimingV1, 'labelLayoutMs' | 'labelDrawMs'> {
    const mode = renderPolicy(frame).labelMode ?? 'adaptive';
    if (mode === 'off') return { labelLayoutMs: 0, labelDrawMs: 0 };
    this.context.save();
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';
    this.context.font = graphFontToCss(frame.labelFont);
    const layoutStart = this.now();
    const occupied: LabelBounds[] = [];
    const accepted: ProjectedNode[] = [];
    const automaticIds = new Set<string>();
    const cameraState = this.vision.getState();
    const zoom = cameraState.projection === 'perspective'
      ? this.vision.worldToScreen(cameraState.target).scale
      : Math.max(0.1, cameraState.zoom);
    const saliency = Math.max(0, Math.min(100,
      renderPolicy(frame).adaptiveLabelSaliency ?? renderPolicy(frame).adaptiveLabelThreshold ?? 50));
    // Resolve automatic eligibility independently of proximity. A cursor-only
    // label must not inherit a full-opacity baseline merely because it is standard.
    const automaticCandidates = nodes.filter(candidate => candidate.node.showLabel !== false
      && (mode !== 'proximity' || candidate.node.labelForceVisible === true
        || candidate.node.labelAlwaysVisible === true)).sort(compareLabelCandidates);
    for (const candidate of automaticCandidates) {
      const forced = candidate.node.labelForceVisible === true || candidate.node.labelAlwaysVisible === true;
      if (mode === 'adaptive') {
        const boost = Math.max(0, Math.min(1, candidate.node.labelSaliencyBoost ?? 0));
        const effectiveSaliency = saliency * (1 - boost);
        // Shift the whole 0–100 range one octave stricter: half the old budget.
        const saliencyFactor = 2 ** (-effectiveSaliency / 50);
        const minimumBudget = clampInteger(Math.round(12 * saliencyFactor), 1, 12);
        const candidateBudget = clampInteger(
          Math.round(this.width * this.height / 12000 * Math.sqrt(zoom) * saliencyFactor),
          minimumBudget, 60,
        );
        if (!forced && accepted.length >= candidateBudget) continue;
      }
      const bounds = this.labelBounds(frame, candidate);
      if (mode === 'adaptive' && !forced && (labelIsOccludedByCloserNode(
        candidate, bounds, this.labelOcclusionCandidates(candidate, bounds),
      ) || occupied.some(other => overlaps(bounds, other)))) continue;
      occupied.push(bounds);
      accepted.push(candidate);
      automaticIds.add(candidate.node.id);
    }
    // View-required labels are shared by both modes. Proximity replaces only
    // adaptive admission; void objects, occlusion and collisions still apply.
    const proximityCandidates = nodes.filter(candidate => !automaticIds.has(candidate.node.id)
      && this.cursorLabelReveal(frame, candidate) > 0)
      .sort((a, b) => this.cursorLabelReveal(frame, b) - this.cursorLabelReveal(frame, a) || compareLabelCandidates(a, b));
    for (const candidate of proximityCandidates) {
      const bounds = this.labelBounds(frame, candidate);
      if (labelIsOccludedByCloserNode(candidate, bounds, this.labelOcclusionCandidates(candidate, bounds))
        || occupied.some(other => overlaps(bounds, other))) continue;
      occupied.push(bounds);
      accepted.push(candidate);
    }
    const acceptedCandidates = accepted;
    const labelLayoutMs = elapsed(layoutStart, this.now());
    const drawStart = this.now();
    for (const candidate of acceptedCandidates) {
      const { node, point, radius } = candidate;
      const offset = node.labelOffset ?? { x: 0, y: 0 };
      const automaticOpacity = automaticIds.has(node.id) ? clampOpacity(node.labelOpacity) : 0;
      this.context.globalAlpha = Math.max(automaticOpacity, this.cursorLabelReveal(frame, candidate));
      this.context.fillStyle = this.colorCss(node.labelColor);
      const font = nodeFont(frame, node, this.vision.getState().zoom, this.vision.getState().projection, this.cursorLabelReveal(frame, candidate) > 0 ? 12 : 1);
      this.context.font = font;
      this.context.fillText(node.label, point.x + offset.x, labelTop(frame, point.y, radius, font) + offset.y);
    }
    const labelDrawMs = elapsed(drawStart, this.now());
    this.context.restore();
    return { labelLayoutMs, labelDrawMs };
  }

  private cursorLabelReveal(frame: GraphRenderFrameV1, candidate: ProjectedNode): number {
    if (renderPolicy(frame).labelMode !== 'proximity') return 0;
    const cursor = this.scene?.cursorScreenPoint;
    const radius = renderPolicy(frame).cursorLabelRevealRadiusPx ?? 0;
    if (!cursor || radius <= 0 || candidate.node.opacity <= 0) return 0;
    return Math.max(0, 1 - Math.hypot(cursor.x - candidate.point.x, cursor.y - candidate.point.y) / radius);
  }

  private labelBounds(frame: GraphRenderFrameV1, value: ProjectedNode): LabelBounds {
    this.context.font = nodeFont(frame, value.node, this.vision.getState().zoom, this.vision.getState().projection, this.cursorLabelReveal(frame, value) > 0 ? 12 : 1);
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

  private labelOcclusionCandidates(candidate: ProjectedNode, bounds: LabelBounds): readonly ProjectedNode[] {
    const minX = Math.floor(Math.min(candidate.point.x, bounds.left) / this.hitCellSize);
    const maxX = Math.floor(Math.max(candidate.point.x, bounds.right) / this.hitCellSize);
    const minY = Math.floor(Math.min(candidate.point.y, bounds.top) / this.hitCellSize);
    const maxY = Math.floor(Math.max(candidate.point.y, bounds.bottom) / this.hitCellSize);
    const candidates = new Set<ProjectedNode>();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const value of this.hitGrid.get(`${x}:${y}`) ?? []) candidates.add(value);
      }
    }
    return [...candidates];
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
    || a.point.depth - b.point.depth
    || b.node.radius - a.node.radius
    || b.point.scale - a.point.scale
    || a.node.id.localeCompare(b.node.id);
}

function labelIsOccludedByCloserNode(
  candidate: ProjectedNode,
  bounds: LabelBounds,
  nodes: readonly ProjectedNode[],
): boolean {
  return nodes.some((other) => {
    if (other.node.id === candidate.node.id || other.node.opacity <= 0
      || other.point.depth >= candidate.point.depth) return false;
    const dx = candidate.point.x - other.point.x;
    const dy = candidate.point.y - other.point.y;
    if (dx * dx + dy * dy < other.radius * other.radius) return true;
    const nearestX = Math.max(bounds.left, Math.min(other.point.x, bounds.right));
    const nearestY = Math.max(bounds.top, Math.min(other.point.y, bounds.bottom));
    const labelDx = other.point.x - nearestX;
    const labelDy = other.point.y - nearestY;
    return labelDx * labelDx + labelDy * labelDy < other.radius * other.radius;
  });
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

function hitShapePolicyKey(frame: GraphPickFrame): string {
  const policy = renderPolicy(frame);
  return [policy.nodeScaleMode, policy.nodeScaleExponent,
    policy.minimumPerspectiveNodeScale, policy.minimumPerspectiveNodeRadius].join(':');
}

function projectedRadius(
  frame: GraphPickFrame,
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
  minimumSize = 1,
): string {
  const scale = renderPolicy(frame).labelScaleMode === 'sqrt-orthographic' && projection === 'orthographic'
    ? Math.sqrt(Math.max(0, zoom))
    : 1;
  const size = Math.max(minimumSize, node.labelFontSize * scale);
  const family = frame.labelFont.family;
  return `${size}px ${family || 'sans-serif'}`;
}

function graphFontToCss(font: GraphFontV2): string {
  return `${font.style} ${font.weight} ${font.sizePx}px/${font.lineHeightPx}px ${font.family}`;
}

function renderPolicy(frame: GraphPickFrame) {
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
