import type { GraphDimensionsV1 } from '../../contracts/v1/index.ts';
import type { BufferedQueue } from './BufferedQueue.ts';
import { GraphTaggingController, type GraphTaggingResultV1 } from './GraphTaggingController.ts';
import type {
  GraphHitV1,
  GraphInputEventV1,
  GraphRuntimeCommandPayloadV1,
  GraphRuntimeCommandV1,
  GraphScreenPointV1,
  InputGraphIdentityV1,
} from './GraphInteractionTypes.ts';

interface PointerRecord {
  readonly id: number;
  readonly kind: 'mouse' | 'touch' | 'pen';
  point: GraphScreenPointV1;
}

interface PendingTouchTap {
  readonly event: Extract<GraphInputEventV1, { type: 'pointer-up' }>;
  readonly hit: GraphHitV1 | null;
}

type SinglePointerMode =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'press';
      readonly pointerId: number;
      readonly pointerKind: 'mouse' | 'touch' | 'pen';
      readonly button: number;
      readonly downPoint: GraphScreenPointV1;
      lastPoint: GraphScreenPointV1;
      readonly hit: GraphHitV1 | null;
      readonly precisionZoomCandidate: boolean;
    }
  | {
      readonly kind: 'pan' | 'orbit';
      readonly pointerId: number;
      lastPoint: GraphScreenPointV1;
    }
  | {
      readonly kind: 'drag';
      readonly pointerId: number;
      readonly pointerKind: 'mouse' | 'touch' | 'pen';
      readonly nodeId: string;
      lastPoint: GraphScreenPointV1;
    }
  | {
      readonly kind: 'precision-zoom';
      readonly pointerId: number;
      readonly anchor: GraphScreenPointV1;
      lastPoint: GraphScreenPointV1;
    };

type GraphInteractionViewMode = 'overview' | 'explore';

interface TouchGesture {
  readonly pointerA: number;
  readonly pointerB: number;
  centroid: GraphScreenPointV1;
  distance: number;
  angle: number;
  readonly startCentroid: GraphScreenPointV1;
  readonly startDistance: number;
  readonly mode: 'pending' | 'navigation' | 'pinch';
  readonly samples: number;
  readonly navigationStarted: boolean;
}

interface TrackpadPinchMomentum {
  readonly identity: InputGraphIdentityV1;
  readonly timestamp: number;
  readonly anchor: GraphScreenPointV1;
  velocity: number;
}

const TRACKPAD_PINCH_ZOOM_MULTIPLIER = 12;
const TRACKPAD_PINCH_MOMENTUM_DELAY_MS = 48;
const TRACKPAD_PINCH_MOMENTUM_INTERVAL_MS = 16;
const TRACKPAD_PINCH_MOMENTUM_INITIAL_SCALE = 0.35;
const TRACKPAD_PINCH_MOMENTUM_DECAY = 0.78;
const TRACKPAD_PINCH_MOMENTUM_MIN_DELTA = 0.1;

export class GraphInteractionInterpreter {
  private readonly pointers = new Map<number, PointerRecord>();
  private mode: SinglePointerMode = { kind: 'idle' };
  private touchGesture: TouchGesture | null = null;
  private dimensions: GraphDimensionsV1;
  private pendingHover: Extract<GraphInputEventV1, { type: 'pointer-move' }> | null = null;
  private pendingTouchTap: PendingTouchTap | null = null;
  private pendingTouchTapTimer: number | null = null;
  private trackpadPinchMomentum: TrackpadPinchMomentum | null = null;
  private trackpadPinchMomentumTimer: number | null = null;
  private readonly tagging = new GraphTaggingController();

  constructor(private readonly options: {
    readonly dimensions: GraphDimensionsV1;
    readonly events: BufferedQueue<GraphInputEventV1>;
    readonly commands: BufferedQueue<GraphRuntimeCommandV1>;
    readonly hitTest: (point: GraphScreenPointV1, pointerKind?: 'mouse' | 'touch' | 'pen') => GraphHitV1 | null;
    readonly getFocusedNodeId: () => string | undefined;
    readonly getHoveredNodeId: () => string | undefined;
    readonly isDirectNeighbor: (nodeId: string, focusedNodeId: string) => boolean;
    readonly getSelectedNodeIds: () => readonly string[];
    readonly getNodeSelection: (nodeId: string) => readonly string[];
    readonly getViewport: () => { readonly width: number; readonly height: number };
    readonly dragThresholdPx?: number;
    readonly doubleTapIntervalMs?: number;
    readonly doubleTapDistancePx?: number;
    readonly setTimeout: (callback: () => void, delayMs: number) => number;
    readonly clearTimeout: (handle: number) => void;
    readonly onDeferredCommand: () => void;
    readonly cancelLongPress: () => void;
  }) {
    this.dimensions = options.dimensions;
  }

  setDimensions(dimensions: GraphDimensionsV1): void {
    this.dimensions = dimensions;
    this.reset();
  }

  tick(): void {
    for (const event of this.options.events.drain()) this.ingest(event);
    const hoverEvent = this.pendingHover;
    this.pendingHover = null;
    if (hoverEvent && hoverEvent.pointerKind !== 'touch'
      && this.mode.kind === 'idle' && this.pointers.size === 0 && !this.touchGesture) {
      const hover = this.options.hitTest(hoverEvent.point);
      this.command(hoverEvent, {
        type: 'set-hover',
        ...(hover ? { nodeId: hover.nodeId, point: hoverEvent.point } : {}),
        mod: hoverEvent.mod,
      });
      if (hoverEvent.pointerKind === 'mouse' && hoverEvent.mod && hover) {
        this.command(hoverEvent, { type: 'set-preview-hover', nodeId: hover.nodeId, point: hoverEvent.point });
      } else {
        this.command(hoverEvent, { type: 'set-preview-hover' });
      }
    }
  }

  isOverviewModifierActive(): boolean {
    return this.tagging.isOverviewHeld();
  }

  reset(): void {
    this.clearPendingTouchTap();
    this.cancelTrackpadPinchMomentum();
    this.pointers.clear();
    this.mode = { kind: 'idle' };
    this.touchGesture = null;
    this.pendingHover = null;
    this.tagging.reset();
  }

  private ingest(event: GraphInputEventV1): void {
    if (event.type !== 'wheel' || !event.ctrl || event.meta) this.cancelTrackpadPinchMomentum();
    switch (event.type) {
      case 'pointer-down': this.pointerDown(event); return;
      case 'pointer-move': this.pointerMove(event); return;
      case 'pointer-leave': this.pointerLeave(event); return;
      case 'modifier-change': this.modifierChange(event); return;
      case 'pointer-up': this.pointerUp(event); return;
      case 'pointer-cancel': this.pointerCancel(event); return;
      case 'wheel': this.wheel(event); return;
      case 'long-press': this.longPress(event); return;
      case 'key-down': this.keyDown(event); return;
    }
  }

  private pointerDown(event: Extract<GraphInputEventV1, { type: 'pointer-down' }>): void {
    this.pointers.set(event.pointerId, { id: event.pointerId, kind: event.pointerKind, point: event.point });
    if (this.pointers.size === 2) {
      this.clearPendingTouchTap();
      this.mode = { kind: 'idle' };
      this.touchGesture = this.readTouchGesture();
      return;
    }
    const precisionZoomCandidate = event.pointerKind === 'touch'
      && event.button === 0
      && this.matchesPendingTouchTap(event);
    if (event.pointerKind === 'touch' && this.pendingTouchTap && !precisionZoomCandidate) {
      this.resolvePendingTouchTap();
    }
    if (precisionZoomCandidate) {
      this.clearPendingTouchTap();
      this.options.cancelLongPress();
    }
    this.mode = {
      kind: 'press',
      pointerId: event.pointerId,
      pointerKind: event.pointerKind,
      button: event.button,
      downPoint: event.point,
      lastPoint: event.point,
      hit: this.options.hitTest(event.point, event.pointerKind),
      precisionZoomCandidate,
    };
  }

  private pointerMove(event: Extract<GraphInputEventV1, { type: 'pointer-move' }>): void {
    const pointer = this.pointers.get(event.pointerId);
    if (pointer) pointer.point = event.point;

    if (this.touchGesture && this.pointers.size === 2) {
      this.updateTouchGesture(event);
      return;
    }
    if (this.mode.kind === 'press' && this.mode.pointerId === event.pointerId) {
      const threshold = this.options.dragThresholdPx ?? 6;
      if (distanceSquared(this.mode.downPoint, event.point) <= threshold ** 2) return;
      if (this.mode.precisionZoomCandidate) {
        const deltaY = event.point.y - this.mode.lastPoint.y;
        if (Math.abs(deltaY) > 0) this.command(event, {
          type: 'zoom-by', deltaY: -deltaY * 3, anchor: this.mode.downPoint,
        });
        this.mode = {
          kind: 'precision-zoom', pointerId: event.pointerId,
          anchor: this.mode.downPoint, lastPoint: event.point,
        };
        return;
      }
      const focusedNodeId = this.options.getFocusedNodeId();
      const viewMode = this.viewMode();
      const exploreThreeDimensionalPrimaryOrbit = this.dimensions === '3d'
        && this.mode.button === 0
        && viewMode === 'explore';
      const focusedNeighborDrag = this.mode.pointerKind === 'mouse'
        && focusedNodeId !== undefined
        && this.mode.hit !== null
        && this.options.getHoveredNodeId() === this.mode.hit.nodeId
        && this.options.isDirectNeighbor(this.mode.hit.nodeId, focusedNodeId);
      if (this.mode.hit && this.mode.button === 0
        && (!exploreThreeDimensionalPrimaryOrbit || focusedNeighborDrag)
        && (focusedNodeId === undefined || focusedNeighborDrag)) {
        if (!focusedNeighborDrag) {
          this.command(event, { type: 'set-focus' });
          this.command(event, { type: 'set-selection', nodeIds: [this.mode.hit.nodeId] });
        }
        this.command(event, { type: 'drag-start', nodeId: this.mode.hit.nodeId, point: this.mode.downPoint });
        this.command(event, { type: 'drag-update', nodeId: this.mode.hit.nodeId, point: event.point });
        this.mode = {
          kind: 'drag', pointerId: event.pointerId, pointerKind: this.mode.pointerKind,
          nodeId: this.mode.hit.nodeId, lastPoint: event.point,
        };
        return;
      }
      const orbit = this.dimensions === '3d' && (exploreThreeDimensionalPrimaryOrbit
        || (this.mode.button === 2 && viewMode === 'overview'));
      if (orbit) {
        this.command(event, {
          type: 'orbit-by',
          deltaX: event.point.x - this.mode.lastPoint.x,
          deltaY: this.mode.lastPoint.y - event.point.y,
        });
        this.mode = { kind: 'orbit', pointerId: event.pointerId, lastPoint: event.point };
      } else {
        const preserveFocus = this.mode.pointerKind === 'mouse'
          && (this.mode.button === 0 || this.mode.button === 2)
          && focusedNodeId !== undefined;
        if (!preserveFocus) {
          this.command(event, { type: 'set-selection', nodeIds: [] });
          this.command(event, { type: 'set-focus' });
        }
        this.command(event, {
          type: 'pan-by',
          deltaX: this.mode.lastPoint.x - event.point.x,
          deltaY: this.mode.lastPoint.y - event.point.y,
        });
        this.mode = { kind: 'pan', pointerId: event.pointerId, lastPoint: event.point };
      }
      return;
    }
    if ((this.mode.kind === 'pan' || this.mode.kind === 'orbit') && this.mode.pointerId === event.pointerId) {
      const type = this.mode.kind === 'pan' ? 'pan-by' : 'orbit-by';
      this.command(event, {
        type,
        deltaX: this.mode.kind === 'pan'
          ? this.mode.lastPoint.x - event.point.x
          : event.point.x - this.mode.lastPoint.x,
        deltaY: this.mode.kind === 'pan'
          ? this.mode.lastPoint.y - event.point.y
          : this.mode.lastPoint.y - event.point.y,
      });
      this.mode.lastPoint = event.point;
      return;
    }
    if (this.mode.kind === 'drag' && this.mode.pointerId === event.pointerId) {
      this.command(event, { type: 'drag-update', nodeId: this.mode.nodeId, point: event.point });
      this.mode.lastPoint = event.point;
      return;
    }
    if (this.mode.kind === 'precision-zoom' && this.mode.pointerId === event.pointerId) {
      const deltaY = event.point.y - this.mode.lastPoint.y;
      if (Math.abs(deltaY) > 0) this.command(event, {
        type: 'zoom-by', deltaY: -deltaY * 3, anchor: this.mode.anchor,
      });
      this.mode.lastPoint = event.point;
      return;
    }
    if (this.mode.kind === 'idle' && this.pointers.size === 0) this.pendingHover = event;
  }

  private pointerUp(event: Extract<GraphInputEventV1, { type: 'pointer-up' }>): void {
    this.pointers.delete(event.pointerId);
    if (this.touchGesture) {
      if (this.pointers.size < 2) this.touchGesture = null;
      this.mode = { kind: 'idle' };
      return;
    }
    if (this.mode.kind === 'drag' && this.mode.pointerId === event.pointerId) {
      this.command(event, {
        type: 'drag-end', nodeId: this.mode.nodeId, point: event.point,
        pointerKind: this.mode.pointerKind,
      });
      this.mode = { kind: 'idle' };
      return;
    }
    if ((this.mode.kind === 'pan' || this.mode.kind === 'orbit') && this.mode.pointerId === event.pointerId) {
      this.mode = { kind: 'idle' };
      return;
    }
    if (this.mode.kind === 'precision-zoom' && this.mode.pointerId === event.pointerId) {
      this.mode = { kind: 'idle' };
      return;
    }
    if (this.mode.kind !== 'press' || this.mode.pointerId !== event.pointerId) {
      this.mode = { kind: 'idle' };
      return;
    }
    const hit = this.mode.hit;
    const pointerKind = this.mode.pointerKind;
    const precisionZoomCandidate = this.mode.precisionZoomCandidate;
    this.mode = { kind: 'idle' };
    if (event.button === 2) {
      if (hit) this.command(event, {
        type: 'request-node-context',
        nodeId: hit.nodeId,
        point: event.point,
        modality: pointerKind,
      });
      else this.command(event, { type: 'reset-camera' });
      return;
    }
    if (pointerKind === 'touch' && event.button === 0 && !precisionZoomCandidate) {
      this.deferTouchTap(event, hit);
      return;
    }
    this.resolveTap(event, hit);
  }

  private pointerCancel(event: Extract<GraphInputEventV1, { type: 'pointer-cancel' }>): void {
    this.pointers.delete(event.pointerId);
    if (this.mode.kind === 'drag' && this.mode.pointerId === event.pointerId) {
      this.command(event, {
        type: 'drag-end', nodeId: this.mode.nodeId, point: event.point,
        pointerKind: this.mode.pointerKind,
      });
    }
    this.mode = { kind: 'idle' };
    if (this.pointers.size < 2) this.touchGesture = null;
  }

  private pointerLeave(event: Extract<GraphInputEventV1, { type: 'pointer-leave' }>): void {
    if (event.pointerKind !== 'mouse' || this.mode.kind !== 'idle') return;
    this.pendingHover = null;
    this.command(event, { type: 'set-preview-hover' });
    this.command(event, { type: 'set-hover', mod: false });
  }

  private modifierChange(event: Extract<GraphInputEventV1, { type: 'modifier-change' }>): void {
    if (this.tagging.updateShift(event.shift)) this.command(event, { type: 'selection-presentation-changed' });
    if (this.mode.kind !== 'idle' || this.pointers.size > 0 || this.touchGesture) return;
    if (!event.pointerInside) {
      this.command(event, { type: 'set-preview-hover' });
      this.command(event, { type: 'set-hover', mod: false });
      return;
    }
    const hover = this.options.hitTest(event.point);
    this.command(event, {
      type: 'set-hover',
      ...(hover ? { nodeId: hover.nodeId, point: event.point } : {}),
      mod: event.mod,
    });
    if (event.mod && hover) {
      this.command(event, { type: 'set-preview-hover', nodeId: hover.nodeId, point: event.point });
    } else {
      this.command(event, { type: 'set-preview-hover' });
    }
  }

  private wheel(event: Extract<GraphInputEventV1, { type: 'wheel' }>): void {
    const delta = this.normalizedWheel(event);
    if (event.ctrl || event.meta) {
      const zoomDelta = event.ctrl && !event.meta
        ? delta.y * TRACKPAD_PINCH_ZOOM_MULTIPLIER
        : delta.y;
      this.command(event, { type: 'zoom-by', deltaY: zoomDelta, anchor: event.point });
      if (event.ctrl && !event.meta) this.captureTrackpadPinchMomentum(event, zoomDelta);
      return;
    }
    if (this.dimensions === '3d' && this.viewMode() === 'explore') {
      this.command(event, { type: 'orbit-by', deltaX: -delta.x, deltaY: delta.y });
      return;
    }
    this.command(event, { type: 'pan-by', deltaX: delta.x, deltaY: delta.y });
  }

  private longPress(event: Extract<GraphInputEventV1, { type: 'long-press' }>): void {
    const hit = this.options.hitTest(event.point, event.pointerKind);
    if (this.mode.kind === 'press' && this.mode.pointerId === event.pointerId) this.mode = { kind: 'idle' };
    if (hit) {
      this.command(event, {
        type: 'request-node-context',
        nodeId: hit.nodeId,
        point: event.point,
        modality: event.pointerKind,
      });
    } else {
      this.command(event, { type: 'reset-camera' });
    }
  }

  private keyDown(event: Extract<GraphInputEventV1, { type: 'key-down' }>): void {
    const amount = 40;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const deltaX = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const deltaY = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      if (event.shift && this.dimensions === '3d') this.command(event, { type: 'orbit-by', deltaX, deltaY });
      else this.command(event, { type: 'pan-by', deltaX, deltaY });
      return;
    }
    if (event.key === '+' || event.key === '=') {
      this.command(event, { type: 'zoom-by', deltaY: -120 });
      return;
    }
    if (event.key === '-' || event.key === '_') {
      this.command(event, { type: 'zoom-by', deltaY: 120 });
      return;
    }
    if (event.key === '0') {
      this.command(event, { type: 'reset-camera' });
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      this.command(event, { type: 'fit-camera' });
      return;
    }
    if (event.key === 'Escape') {
      this.tagging.reset();
      this.command(event, { type: 'set-selection', nodeIds: [] });
      this.command(event, { type: 'set-focus' });
      return;
    }
    if (event.key === 'Enter') {
      if (event.repeat || event.composing || event.ctrl || event.meta || event.shift || event.alt) return;
      const nodeId = this.options.getFocusedNodeId();
      if (nodeId) this.command(event, { type: 'activate-node', nodeId, activation: 'keyboard' });
    }
  }

  private updateTouchGesture(event: GraphInputEventV1): void {
    const next = this.readTouchGesture();
    if (!next || !this.touchGesture) return;
    const previous = this.touchGesture;
    const totalPan = Math.hypot(
      next.centroid.x - previous.startCentroid.x,
      next.centroid.y - previous.startCentroid.y,
    );
    const totalDistance = Math.abs(next.distance - previous.startDistance);
    const samples = previous.samples + 1;
    const threshold = this.options.dragThresholdPx ?? 6;
    let mode = previous.mode;
    if (mode === 'pending' && samples >= 2) {
      if (totalDistance > threshold && totalDistance > totalPan * 0.75) mode = 'pinch';
      else if (totalPan > threshold) mode = 'navigation';
    } else if (mode === 'navigation' && totalDistance > threshold * 2 && totalDistance > totalPan * 0.75) {
      mode = 'pinch';
    }
    let navigationStarted = previous.navigationStarted;
    if (mode === 'navigation') {
      navigationStarted = true;
      const origin = previous.mode === 'pending' ? previous.startCentroid : previous.centroid;
      const deltaX = origin.x - next.centroid.x;
      const deltaY = origin.y - next.centroid.y;
      this.command(event, { type: 'pan-by', deltaX, deltaY });
    } else if (mode === 'pinch') {
      const originDistance = previous.mode === 'pending' ? previous.startDistance : previous.distance;
      const distanceDelta = next.distance - originDistance;
      if (Math.abs(distanceDelta) >= 1) this.command(event, {
        type: 'zoom-by', deltaY: -distanceDelta * 3, anchor: next.centroid,
      });
    }
    this.touchGesture = {
      ...next,
      startCentroid: previous.startCentroid,
      startDistance: previous.startDistance,
      mode,
      samples,
      navigationStarted,
    };
  }

  private matchesPendingTouchTap(event: Extract<GraphInputEventV1, { type: 'pointer-down' }>): boolean {
    const pending = this.pendingTouchTap;
    if (!pending) return false;
    return event.timestamp - pending.event.timestamp <= (this.options.doubleTapIntervalMs ?? 320)
      && distanceSquared(event.point, pending.event.point) <= (this.options.doubleTapDistancePx ?? 24) ** 2;
  }

  private deferTouchTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
  ): void {
    this.clearPendingTouchTap();
    this.pendingTouchTap = { event, hit };
    this.pendingTouchTapTimer = this.options.setTimeout(() => {
      const pending = this.pendingTouchTap;
      this.pendingTouchTap = null;
      this.pendingTouchTapTimer = null;
      if (!pending) return;
      this.resolveTap(pending.event, pending.hit);
      this.options.onDeferredCommand();
    }, this.options.doubleTapIntervalMs ?? 320);
  }

  private resolvePendingTouchTap(): void {
    const pending = this.pendingTouchTap;
    this.clearPendingTouchTap();
    if (pending) this.resolveTap(pending.event, pending.hit);
  }

  private clearPendingTouchTap(): void {
    if (this.pendingTouchTapTimer !== null) this.options.clearTimeout(this.pendingTouchTapTimer);
    this.pendingTouchTapTimer = null;
    this.pendingTouchTap = null;
  }

  private resolveTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
  ): void {
    if (!hit) {
      this.tagging.reset();
      this.command(event, { type: 'set-selection', nodeIds: [] });
      this.command(event, { type: 'set-focus' });
      this.command(event, { type: 'activate-background' });
      return;
    }
    if (!event.shift && this.options.getFocusedNodeId() === hit.nodeId) {
      this.command(event, { type: 'activate-node', nodeId: hit.nodeId, activation: 'primary' });
      return;
    }
    const nodeIds = this.options.getNodeSelection(hit.nodeId);
    const result = this.tagging.tag(
      nodeIds,
      hit.nodeId,
      this.options.getSelectedNodeIds(),
      this.options.getFocusedNodeId(),
      event.shift,
    );
    this.command(event, { type: 'set-selection', nodeIds: result.selectedNodeIds });
    this.updateTaggedStructure(event, result);
  }

  private updateTaggedStructure(
    event: Pick<GraphInputEventV1, 'identity' | 'timestamp'>,
    result: GraphTaggingResultV1,
  ): void {
    this.command(event, { type: 'set-focus', nodeId: result.focusNodeId });
  }

  private viewMode(): GraphInteractionViewMode {
    const hasExploreState = this.options.getSelectedNodeIds().length > 0
      || this.options.getFocusedNodeId() !== undefined;
    return hasExploreState && !this.tagging.isOverviewHeld() ? 'explore' : 'overview';
  }

  private readTouchGesture(): TouchGesture | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    const dx = b.point.x - a.point.x;
    const dy = b.point.y - a.point.y;
    const centroid = { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 };
    return {
      pointerA: a.id,
      pointerB: b.id,
      centroid,
      distance: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx),
      startCentroid: centroid,
      startDistance: Math.hypot(dx, dy),
      mode: 'pending',
      samples: 0,
      navigationStarted: false,
    };
  }

  private normalizedWheel(event: Extract<GraphInputEventV1, { type: 'wheel' }>): GraphScreenPointV1 {
    const viewport = this.options.getViewport();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, viewport.width, viewport.height) : 1;
    return {
      x: clamp(event.deltaX * scale, -48, 48),
      y: clamp(event.deltaY * scale, -48, 48),
    };
  }

  private captureTrackpadPinchMomentum(
    event: Extract<GraphInputEventV1, { type: 'wheel' }>,
    zoomDelta: number,
  ): void {
    if (this.trackpadPinchMomentumTimer !== null) {
      this.options.clearTimeout(this.trackpadPinchMomentumTimer);
      this.trackpadPinchMomentumTimer = null;
    }
    const previousVelocity = this.trackpadPinchMomentum?.velocity;
    const sameDirection = previousVelocity !== undefined
      && Math.sign(previousVelocity) === Math.sign(zoomDelta);
    this.trackpadPinchMomentum = {
      identity: { ...event.identity },
      timestamp: event.timestamp,
      anchor: { ...event.point },
      velocity: sameDirection ? previousVelocity * 0.65 + zoomDelta * 0.35 : zoomDelta,
    };
    this.trackpadPinchMomentumTimer = this.options.setTimeout(() => {
      this.trackpadPinchMomentumTimer = null;
      if (!this.trackpadPinchMomentum) return;
      this.trackpadPinchMomentum.velocity *= TRACKPAD_PINCH_MOMENTUM_INITIAL_SCALE;
      this.advanceTrackpadPinchMomentum();
    }, TRACKPAD_PINCH_MOMENTUM_DELAY_MS);
  }

  private advanceTrackpadPinchMomentum(): void {
    const momentum = this.trackpadPinchMomentum;
    if (!momentum || Math.abs(momentum.velocity) < TRACKPAD_PINCH_MOMENTUM_MIN_DELTA) {
      this.cancelTrackpadPinchMomentum();
      return;
    }
    this.command(momentum, { type: 'zoom-by', deltaY: momentum.velocity, anchor: momentum.anchor });
    momentum.velocity *= TRACKPAD_PINCH_MOMENTUM_DECAY;
    this.options.onDeferredCommand();
    this.trackpadPinchMomentumTimer = this.options.setTimeout(
      () => {
        this.trackpadPinchMomentumTimer = null;
        this.advanceTrackpadPinchMomentum();
      },
      TRACKPAD_PINCH_MOMENTUM_INTERVAL_MS,
    );
  }

  private cancelTrackpadPinchMomentum(): void {
    if (this.trackpadPinchMomentumTimer !== null) this.options.clearTimeout(this.trackpadPinchMomentumTimer);
    this.trackpadPinchMomentumTimer = null;
    this.trackpadPinchMomentum = null;
  }

  private command(
    source: { readonly identity: InputGraphIdentityV1; readonly timestamp: number },
    command: GraphRuntimeCommandPayloadV1,
  ): void {
    this.options.commands.push({ ...command, identity: { ...source.identity }, timestamp: source.timestamp } as GraphRuntimeCommandV1);
  }
}

function distanceSquared(a: GraphScreenPointV1, b: GraphScreenPointV1): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
