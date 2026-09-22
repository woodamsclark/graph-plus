import type { GraphDimensionsV1 } from '../../contracts/v1/index.ts';
import type { BufferedQueue } from './BufferedQueue.ts';
import { GraphTaggingController } from './GraphTaggingController.ts';
import type {
  GraphHitV1,
  GraphInputEventV1,
  GraphRuntimeCommandPayloadV1,
  GraphRuntimeCommandV1,
  GraphScreenPointV1,
  InputGraphIdentityV1,
} from './GraphInteractionTypes.ts';
import { graphInteractionPolicyV1, type GraphUxStateV1 } from './GraphInteractionStatePolicy.ts';

interface PointerRecord {
  readonly id: number;
  readonly kind: 'mouse' | 'touch' | 'pen';
  point: GraphScreenPointV1;
}

interface PendingTap {
  readonly event: Extract<GraphInputEventV1, { type: 'pointer-up' }>;
  readonly hit: GraphHitV1 | null;
  readonly focusedNodeId?: string;
  readonly deferred: boolean;
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
      readonly doubleTapSource?: PendingTap;
    }
  | {
      readonly kind: 'pan' | 'elastic-pan' | 'orbit' | 'radial-zoom';
      readonly pointerId: number;
      lastPoint: GraphScreenPointV1;
      lastRadius?: number;
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
      lastRadius?: number;
    };

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
  readonly anchor?: GraphScreenPointV1;
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
  private pendingTap: PendingTap | null = null;
  private pendingTapTimer: number | null = null;
  private trackpadPinchMomentum: TrackpadPinchMomentum | null = null;
  private trackpadPinchMomentumTimer: number | null = null;
  private readonly tagging = new GraphTaggingController();
  private ctrlSelectionBaseline: ReadonlySet<string> | undefined;

  constructor(private readonly options: {
    readonly dimensions: GraphDimensionsV1;
    readonly events: BufferedQueue<GraphInputEventV1>;
    readonly commands: BufferedQueue<GraphRuntimeCommandV1>;
    readonly hitTest: (point: GraphScreenPointV1, pointerKind?: 'mouse' | 'touch' | 'pen') => GraphHitV1 | null;
    readonly getSelectedNodeIds: () => readonly string[];
    readonly getFocusedNodeId: () => string | undefined;
    readonly getFocusedNodeScreenPoint: () => GraphScreenPointV1 | undefined;
    readonly getNodeSelection: (nodeId: string) => readonly string[];
    readonly getSelectionBridge: (nodeId: string, selectedNodeIds: readonly string[]) => readonly string[];
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

  isSelectionPresentationSuspended(): boolean {
    return this.tagging.isPresentationSuspended();
  }

  isSelectionNeighborRevealActive(): boolean {
    return this.tagging.isSelectionNeighborRevealActive();
  }

  reset(): void {
    this.clearPendingTap();
    this.cancelTrackpadPinchMomentum();
    this.pointers.clear();
    this.mode = { kind: 'idle' };
    this.touchGesture = null;
    this.pendingHover = null;
    this.ctrlSelectionBaseline = undefined;
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
      case 'key-up': this.keyUp(event); return;
    }
  }

  private pointerDown(event: Extract<GraphInputEventV1, { type: 'pointer-down' }>): void {
    if (event.ctrl && !this.tagging.isCtrlHeld()) {
      this.ctrlSelectionBaseline = new Set(this.options.getSelectedNodeIds());
      this.tagging.updateCtrl(true);
    }
    if (event.alt && this.tagging.updateOptionReveal(true)) {
      this.command(event, { type: 'selection-presentation-changed' });
    }
    this.pointers.set(event.pointerId, { id: event.pointerId, kind: event.pointerKind, point: event.point });
    if (this.pointers.size === 2) {
      this.clearPendingTap();
      this.mode = { kind: 'idle' };
      this.touchGesture = this.readTouchGesture();
      return;
    }
    const hit = this.options.hitTest(event.point, event.pointerKind);
    const doubleTapSource = event.button === 0 ? this.matchingPendingTap(event, hit) : undefined;
    const effectiveHit = doubleTapSource?.hit && hit === null ? doubleTapSource.hit : hit;
    const precisionZoomCandidate = event.pointerKind === 'touch' && doubleTapSource !== undefined;
    if (this.pendingTap && !doubleTapSource) {
      this.resolvePendingTap();
    }
    if (doubleTapSource) {
      this.clearPendingTap();
      this.options.cancelLongPress();
    }
    this.mode = {
      kind: 'press',
      pointerId: event.pointerId,
      pointerKind: event.pointerKind,
      button: event.button,
      downPoint: event.point,
      lastPoint: event.point,
      hit: effectiveHit,
      precisionZoomCandidate,
      ...(doubleTapSource ? { doubleTapSource } : {}),
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
        const focusPoint = this.options.getFocusedNodeScreenPoint();
        const state = this.viewMode();
        const lastRadius = focusPoint ? pointDistance(this.mode.lastPoint, focusPoint) : undefined;
        if (state === 'focus' && focusPoint && lastRadius !== undefined) {
          this.radialZoom(event, lastRadius, pointDistance(event.point, focusPoint));
        } else {
          const deltaY = event.point.y - this.mode.lastPoint.y;
          if (Math.abs(deltaY) > 0) this.command(event, {
            type: 'zoom-by', deltaY: -deltaY * 3,
          });
          const deltaX = event.point.x - this.mode.lastPoint.x;
          if (this.dimensions === '3d' && Math.abs(deltaX) > 0) {
            this.command(event, { type: 'orbit-by', deltaX, deltaY: 0 });
          }
        }
        this.mode = {
          kind: 'precision-zoom', pointerId: event.pointerId,
          anchor: this.mode.downPoint, lastPoint: event.point,
          ...(lastRadius === undefined ? {} : { lastRadius: pointDistance(event.point, focusPoint!) }),
        };
        return;
      }
      const selectedNodeIds = this.options.getSelectedNodeIds();
      const policy = graphInteractionPolicyV1({
        selectedNodeIds,
        focusedNodeId: this.options.getFocusedNodeId(),
      });
      const hitSelectedNode = this.mode.hit !== null && selectedNodeIds.includes(this.mode.hit.nodeId);
      const startsInitialNodeDrag = this.mode.hit !== null && selectedNodeIds.length === 0;
      if (policy.state !== 'focus'
        && this.mode.pointerKind !== 'touch'
        && this.mode.hit
        && this.mode.button === 0
        && (hitSelectedNode || startsInitialNodeDrag)) {
        if (startsInitialNodeDrag) {
          this.command(event, { type: 'set-selection', nodeIds: [this.mode.hit.nodeId] });
          this.command(event, { type: 'enter-focus', nodeId: this.mode.hit.nodeId });
        }
        this.command(event, { type: 'drag-start', nodeId: this.mode.hit.nodeId, point: this.mode.downPoint });
        this.command(event, { type: 'drag-update', nodeId: this.mode.hit.nodeId, point: event.point });
        this.mode = {
          kind: 'drag', pointerId: event.pointerId, pointerKind: this.mode.pointerKind,
          nodeId: this.mode.hit.nodeId, lastPoint: event.point,
        };
        return;
      }
      if (policy.state === 'focus' && this.mode.button === 2) {
        const focusPoint = this.options.getFocusedNodeScreenPoint();
        const lastRadius = focusPoint ? pointDistance(this.mode.lastPoint, focusPoint) : undefined;
        if (focusPoint && lastRadius !== undefined) {
          this.radialZoom(event, lastRadius, pointDistance(event.point, focusPoint));
        }
        this.mode = {
          kind: 'radial-zoom', pointerId: event.pointerId, lastPoint: event.point,
          ...(focusPoint ? { lastRadius: pointDistance(event.point, focusPoint) } : {}),
        };
        return;
      }
      const navigation = this.mode.pointerKind === 'touch'
        ? (this.dimensions === '3d' ? 'rotate' : policy.primaryDrag[this.dimensions])
        : this.mode.button === 2
          ? 'rotate'
          : policy.primaryDrag[this.dimensions];
      const orbit = navigation === 'rotate' && this.dimensions === '3d';
      if (orbit) {
        this.command(event, {
          type: 'orbit-by',
          deltaX: event.point.x - this.mode.lastPoint.x,
          deltaY: this.mode.lastPoint.y - event.point.y,
        });
        this.mode = { kind: 'orbit', pointerId: event.pointerId, lastPoint: event.point };
      } else {
        const type = navigation === 'elastic-pan' ? 'elastic-pan-by' : 'pan-by';
        this.command(event, {
          type,
          deltaX: this.mode.lastPoint.x - event.point.x,
          deltaY: this.mode.lastPoint.y - event.point.y,
        });
        this.mode = { kind: navigation === 'elastic-pan' ? 'elastic-pan' : 'pan', pointerId: event.pointerId, lastPoint: event.point };
      }
      return;
    }
    if ((this.mode.kind === 'pan' || this.mode.kind === 'elastic-pan' || this.mode.kind === 'orbit')
      && this.mode.pointerId === event.pointerId) {
      const type = this.mode.kind === 'pan'
        ? 'pan-by'
        : this.mode.kind === 'elastic-pan'
          ? 'elastic-pan-by'
          : 'orbit-by';
      this.command(event, {
        type,
        deltaX: this.mode.kind === 'pan' || this.mode.kind === 'elastic-pan'
          ? this.mode.lastPoint.x - event.point.x
          : event.point.x - this.mode.lastPoint.x,
        deltaY: this.mode.kind === 'pan' || this.mode.kind === 'elastic-pan'
          ? this.mode.lastPoint.y - event.point.y
          : this.mode.lastPoint.y - event.point.y,
      });
      this.mode.lastPoint = event.point;
      return;
    }
    if (this.mode.kind === 'radial-zoom' && this.mode.pointerId === event.pointerId) {
      const focusPoint = this.options.getFocusedNodeScreenPoint();
      const nextRadius = focusPoint ? pointDistance(event.point, focusPoint) : undefined;
      if (nextRadius !== undefined && this.mode.lastRadius !== undefined) {
        this.radialZoom(event, this.mode.lastRadius, nextRadius);
      }
      this.mode.lastPoint = event.point;
      this.mode.lastRadius = nextRadius;
      return;
    }
    if (this.mode.kind === 'drag' && this.mode.pointerId === event.pointerId) {
      this.command(event, { type: 'drag-update', nodeId: this.mode.nodeId, point: event.point });
      this.mode.lastPoint = event.point;
      return;
    }
    if (this.mode.kind === 'precision-zoom' && this.mode.pointerId === event.pointerId) {
      const focusPoint = this.options.getFocusedNodeScreenPoint();
      if (this.viewMode() === 'focus' && focusPoint && this.mode.lastRadius !== undefined) {
        const nextRadius = pointDistance(event.point, focusPoint);
        this.radialZoom(event, this.mode.lastRadius, nextRadius);
        this.mode.lastRadius = nextRadius;
      } else {
        const deltaY = event.point.y - this.mode.lastPoint.y;
        if (Math.abs(deltaY) > 0) this.command(event, { type: 'zoom-by', deltaY: -deltaY * 3 });
        const deltaX = event.point.x - this.mode.lastPoint.x;
        if (this.dimensions === '3d' && Math.abs(deltaX) > 0) {
          this.command(event, { type: 'orbit-by', deltaX, deltaY: 0 });
        }
      }
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
    if ((this.mode.kind === 'pan' || this.mode.kind === 'elastic-pan'
      || this.mode.kind === 'orbit' || this.mode.kind === 'radial-zoom')
      && this.mode.pointerId === event.pointerId) {
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
    const doubleTapSource = this.mode.doubleTapSource;
    this.mode = { kind: 'idle' };
    if (event.button === 2) {
      if (hit) this.command(event, {
        type: 'request-node-context',
        nodeId: hit.nodeId,
        point: event.point,
        modality: pointerKind,
      });
      else this.command(event, { type: 'center-and-fit-camera' });
      return;
    }
    if (doubleTapSource && event.button === 0) {
      this.resolveDoubleTap(event, hit, doubleTapSource);
      return;
    }
    if (event.button === 0 && !precisionZoomCandidate && this.shouldDeferTap(pointerKind, hit)) {
      this.deferTap(event, hit);
      return;
    }
    this.resolveTap(event, hit);
    if (event.button === 0) this.rememberImmediateTap(event, hit);
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
    const wasCtrlHeld = this.tagging.isCtrlHeld();
    if (!wasCtrlHeld && event.ctrl) {
      this.ctrlSelectionBaseline = new Set(this.options.getSelectedNodeIds());
    }
    this.tagging.updateCtrl(event.ctrl);
    if (this.tagging.updateOptionReveal(event.alt)) {
      this.command(event, { type: 'selection-presentation-changed' });
    }
    if (wasCtrlHeld && !event.ctrl) {
      const baseline = this.ctrlSelectionBaseline ?? new Set<string>();
      const selectedNodeIds = this.options.getSelectedNodeIds();
      this.ctrlSelectionBaseline = undefined;
      const entersExplore = baseline.size <= 1
        && selectedNodeIds.length > 1
        && this.viewMode() === 'focus';
      if (entersExplore) this.command(event, { type: 'set-focus' });
      if (baseline.size === 0 && selectedNodeIds.length > 0) {
        this.command(event, { type: 'center-and-fit-camera' });
      }
    }
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
    if (event.ctrl && !event.meta) {
      const zoomDelta = delta.y * TRACKPAD_PINCH_ZOOM_MULTIPLIER;
      const anchor = this.viewMode() === 'focus' ? undefined : event.point;
      this.command(event, { type: 'zoom-by', deltaY: zoomDelta, ...(anchor ? { anchor } : {}) });
      this.captureTrackpadPinchMomentum(event, zoomDelta, anchor);
      return;
    }
    const policy = graphInteractionPolicyV1({
      selectedNodeIds: this.options.getSelectedNodeIds(),
      focusedNodeId: this.options.getFocusedNodeId(),
    });
    if (this.dimensions === '3d' && policy.wheel['3d'] === 'rotate') {
      this.command(event, { type: 'orbit-by', deltaX: -delta.x, deltaY: delta.y });
      return;
    }
    this.command(event, {
      type: policy.wheel[this.dimensions] === 'elastic-pan' ? 'elastic-pan-by' : 'pan-by',
      deltaX: delta.x,
      deltaY: delta.y,
    });
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
    } else this.command(event, { type: 'center-and-fit-camera' });
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
    if (event.key === 'Escape') {
      this.tagging.reset();
      this.command(event, { type: 'set-selection', nodeIds: [] });
      this.command(event, { type: 'set-focus' });
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (event.repeat || event.composing || event.ctrl || event.meta || event.shift || event.alt) return;
      if (this.tagging.updateSpace(true)) this.command(event, { type: 'selection-presentation-changed' });
      return;
    }
    if (event.key === 'Enter') {
      if (event.repeat || event.composing || event.ctrl || event.meta || event.shift || event.alt) return;
      const selectedNodeIds = this.options.getSelectedNodeIds();
      const nodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined;
      if (nodeId) this.command(event, { type: 'activate-node', nodeId, activation: 'keyboard' });
    }
  }

  private keyUp(event: Extract<GraphInputEventV1, { type: 'key-up' }>): void {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    if (this.tagging.updateSpace(false)) this.command(event, { type: 'selection-presentation-changed' });
  }

  private updateTouchGesture(event: GraphInputEventV1): void {
    const next = this.readTouchGesture();
    if (!next || !this.touchGesture) return;
    const previous = this.touchGesture;
    if (this.viewMode() === 'focus') {
      const focusPoint = this.options.getFocusedNodeScreenPoint();
      if (focusPoint) {
        this.radialZoom(
          event,
          pointDistance(previous.centroid, focusPoint),
          pointDistance(next.centroid, focusPoint),
        );
      }
      const pinchDelta = next.distance - previous.distance;
      if (Math.abs(pinchDelta) >= 1) this.command(event, {
        type: 'zoom-by', deltaY: -pinchDelta * 3,
      });
      this.touchGesture = {
        ...next,
        startCentroid: previous.startCentroid,
        startDistance: previous.startDistance,
        mode: 'navigation',
        samples: previous.samples + 1,
        navigationStarted: true,
      };
      return;
    }
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
      const selectionExists = this.options.getSelectedNodeIds().length > 0;
      this.command(event, this.dimensions === '3d' && !selectionExists
        ? { type: 'orbit-by', deltaX: -deltaX, deltaY }
        : { type: 'pan-by', deltaX, deltaY });
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

  private matchingPendingTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-down' }>,
    hit: GraphHitV1 | null,
  ): PendingTap | undefined {
    const pending = this.pendingTap;
    if (!pending) return undefined;
    return event.timestamp - pending.event.timestamp <= (this.options.doubleTapIntervalMs ?? 320)
      && distanceSquared(event.point, pending.event.point) <= (this.options.doubleTapDistancePx ?? 24) ** 2
      && (pending.hit?.nodeId === hit?.nodeId
        || (hit === null && pending.hit?.nodeId === this.options.getFocusedNodeId()))
      ? pending
      : undefined;
  }

  private shouldDeferTap(pointerKind: 'mouse' | 'touch' | 'pen', hit: GraphHitV1 | null): boolean {
    return (hit !== null && hit.nodeId === this.options.getFocusedNodeId())
      || (pointerKind === 'touch' && hit === null);
  }

  private deferTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
  ): void {
    this.clearPendingTap();
    this.pendingTap = {
      event,
      hit,
      focusedNodeId: this.options.getFocusedNodeId(),
      deferred: true,
    };
    this.pendingTapTimer = this.options.setTimeout(() => {
      const pending = this.pendingTap;
      this.pendingTap = null;
      this.pendingTapTimer = null;
      if (!pending) return;
      this.resolveTap(pending.event, pending.hit);
      this.options.onDeferredCommand();
    }, this.options.doubleTapIntervalMs ?? 320);
  }

  private rememberImmediateTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
  ): void {
    this.clearPendingTap();
    this.pendingTap = {
      event,
      hit,
      focusedNodeId: this.options.getFocusedNodeId(),
      deferred: false,
    };
    this.pendingTapTimer = this.options.setTimeout(() => {
      this.pendingTap = null;
      this.pendingTapTimer = null;
    }, this.options.doubleTapIntervalMs ?? 320);
  }

  private resolvePendingTap(): void {
    const pending = this.pendingTap;
    this.clearPendingTap();
    if (pending?.deferred) this.resolveTap(pending.event, pending.hit);
  }

  private clearPendingTap(): void {
    if (this.pendingTapTimer !== null) this.options.clearTimeout(this.pendingTapTimer);
    this.pendingTapTimer = null;
    this.pendingTap = null;
  }

  private resolveDoubleTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
    source: PendingTap,
  ): void {
    if (hit && source.hit?.nodeId === hit.nodeId && source.focusedNodeId === hit.nodeId) {
      this.command(event, { type: 'activate-node', nodeId: hit.nodeId, activation: 'primary' });
      return;
    }
    if (!hit && !source.hit && event.pointerKind === 'touch') {
      this.command(event, { type: 'center-and-fit-camera' });
    }
  }

  private resolveTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
  ): void {
    const selectedNodeIds = this.options.getSelectedNodeIds();
    const focusedNodeId = this.options.getFocusedNodeId();
    const state = this.viewMode();
    if (!hit) {
      this.tagging.reset();
      if (state === 'focus' && selectedNodeIds.length > 1) {
        this.command(event, { type: 'set-focus' });
        this.command(event, { type: 'fit-camera', nodeIds: selectedNodeIds });
      } else if (state !== 'overview') {
        this.command(event, { type: 'set-selection', nodeIds: [] });
        this.command(event, { type: 'set-focus' });
        this.command(event, { type: 'fit-camera' });
      } else {
        this.command(event, { type: 'set-focus' });
      }
      this.command(event, { type: 'activate-background' });
      return;
    }

    if (!event.ctrl && state === 'focus') {
      if (hit.nodeId !== focusedNodeId) {
        this.command(event, { type: 'enter-focus', nodeId: hit.nodeId });
        return;
      }
      const nextSelection = selectedNodeIds.includes(hit.nodeId)
        ? selectedNodeIds.filter((nodeId) => nodeId !== hit.nodeId)
        : [...selectedNodeIds, hit.nodeId];
      this.command(event, { type: 'set-selection', nodeIds: nextSelection });
      if (nextSelection.length === 0) {
        this.command(event, { type: 'set-focus' });
        this.command(event, { type: 'fit-camera' });
      }
      return;
    }

    if (!event.ctrl && state === 'explore' && selectedNodeIds.includes(hit.nodeId)) {
      this.command(event, { type: 'enter-focus', nodeId: hit.nodeId });
      return;
    }

    if (event.ctrl && this.ctrlSelectionBaseline === undefined) {
      this.ctrlSelectionBaseline = new Set(selectedNodeIds);
    }
    const removing = event.ctrl && selectedNodeIds.includes(hit.nodeId);
    const nodeIds = removing
      ? this.options.getNodeSelection(hit.nodeId)
      : [
          hit.nodeId,
          ...this.options.getNodeSelection(hit.nodeId),
          ...(event.ctrl ? [] : this.options.getSelectionBridge(hit.nodeId, selectedNodeIds)),
        ];
    const result = this.tagging.tag(
      nodeIds,
      hit.nodeId,
      selectedNodeIds,
      event.ctrl,
    );
    this.command(event, { type: 'set-selection', nodeIds: result.selectedNodeIds });
    if (result.selectedNodeIds.length === 0) {
      this.command(event, { type: 'set-focus' });
      this.command(event, { type: 'fit-camera' });
    } else if (selectedNodeIds.length === 0 && !event.ctrl) {
      this.command(event, { type: 'enter-focus', nodeId: hit.nodeId });
    } else if (selectedNodeIds.length === 0 && event.ctrl && result.selectedNodeIds.length === 1) {
      this.command(event, { type: 'enter-focus', nodeId: hit.nodeId });
    }
  }

  private viewMode(): GraphUxStateV1 {
    return graphInteractionPolicyV1({
      selectedNodeIds: this.options.getSelectedNodeIds(),
      focusedNodeId: this.options.getFocusedNodeId(),
    }).state;
  }

  private radialZoom(
    event: { readonly identity: InputGraphIdentityV1; readonly timestamp: number },
    previousRadius: number,
    nextRadius: number,
  ): void {
    const radiusDelta = nextRadius - previousRadius;
    if (Math.abs(radiusDelta) < 0.25) return;
    this.command(event, { type: 'zoom-by', deltaY: -radiusDelta * 3 });
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
    anchor: GraphScreenPointV1 | undefined,
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
      ...(anchor ? { anchor: { ...anchor } } : {}),
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
    this.command(momentum, {
      type: 'zoom-by',
      deltaY: momentum.velocity,
      ...(momentum.anchor ? { anchor: momentum.anchor } : {}),
    });
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

function pointDistance(a: GraphScreenPointV1, b: GraphScreenPointV1): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
