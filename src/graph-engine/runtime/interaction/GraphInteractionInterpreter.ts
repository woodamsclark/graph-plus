import type { GraphDimensionsV1 } from '../../contracts/v1/index.ts';
import { GRAPH_VIEW_DEFINITIONS_V1 } from '../../contracts/v1/index.ts';
import type { BufferedQueue } from './BufferedQueue.ts';
import { GraphTaggingController } from './GraphTaggingController.ts';
import {
  appendInteractionReceiptEventV1,
  type InteractionReceiptEventV1,
  type InteractionReceiptV1,
} from './InteractionReceipt.ts';
import { ReflexV1 } from './Reflex.ts';
import type {
  GraphHitV1,
  GraphInputEventV1,
  GraphRuntimeCommandPayloadV1,
  GraphRuntimeCommandV1,
  GraphScreenPointV1,
  InputGraphIdentityV1,
} from './GraphInteractionTypes.ts';
import { GRAPH_INTERACTION_STATE_POLICIES_V1, canDragGraphNodeV1, graphInteractionPolicyV1, type GraphUxStateV1 } from './GraphInteractionStatePolicy.ts';

interface PointerRecord {
  readonly id: number;
  readonly kind: 'mouse' | 'touch' | 'pen';
  point: GraphScreenPointV1;
}

interface InteractionStateSnapshot {
  readonly selectedNodeIds: readonly string[];
  readonly focusedNodeId?: string;
  readonly viewMode: GraphUxStateV1;
}

interface PrimaryTapReceiptPayload {
  readonly hit: GraphHitV1 | null;
  readonly before: InteractionStateSnapshot;
}

type PrimaryTapReceiptEvent = InteractionReceiptEventV1<
  'press' | 'release',
  {
    readonly pointerId: number;
    readonly pointerKind: 'mouse' | 'touch' | 'pen';
    readonly button: number;
    readonly point: GraphScreenPointV1;
  }
>;

type PrimaryTapReceipt = InteractionReceiptV1<'primary-tap', PrimaryTapReceiptPayload> & {
  readonly events: readonly PrimaryTapReceiptEvent[];
};

type SinglePointerMode =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'press';
      readonly pointerId: number;
      readonly pointerKind: 'mouse' | 'touch' | 'pen';
      readonly button: number;
      readonly downEvent: Extract<GraphInputEventV1, { type: 'pointer-down' }>;
      readonly downPoint: GraphScreenPointV1;
      lastPoint: GraphScreenPointV1;
      readonly hit: GraphHitV1 | null;
      readonly precisionZoomCandidate: boolean;
      readonly receiptSource?: PrimaryTapReceipt;
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
    }
  | {
      readonly kind: 'focus-transition';
      readonly pointerId: number;
      readonly pointerKind: 'mouse' | 'touch' | 'pen';
      readonly nodeId: string;
      readonly origin: GraphScreenPointV1;
      progress: number;
    };

interface TouchGesture {
  readonly pointerA: number;
  readonly pointerB: number;
  centroid: GraphScreenPointV1;
  distance: number;
  angle: number;
  readonly startCentroid: GraphScreenPointV1;
  readonly startDistance: number;
  readonly mode: 'pending' | 'navigation';
  readonly samples: number;
  readonly navigationStarted: boolean;
}

interface TrackpadPinchMomentum {
  readonly anchor?: GraphScreenPointV1;
  readonly identity: InputGraphIdentityV1;
  readonly timestamp: number;
  velocity: number;
}

const TRACKPAD_PINCH_ZOOM_MULTIPLIER = 12;
const TRACKPAD_PINCH_MOMENTUM_DELAY_MS = 48;
const TRACKPAD_PINCH_MOMENTUM_INTERVAL_MS = 16;
const TRACKPAD_PINCH_MOMENTUM_INITIAL_SCALE = 0.35;
const TRACKPAD_PINCH_MOMENTUM_DECAY = 0.78;
const TRACKPAD_PINCH_MOMENTUM_MIN_DELTA = 0.1;
const DEFAULT_PRIMARY_TAP_RECEIPT_WINDOW_MS = 240;
const DEFAULT_FOCUS_TRANSITION_DISTANCE_RATIO = 0.35;

export class GraphInteractionInterpreter {
  private readonly pointers = new Map<number, PointerRecord>();
  private mode: SinglePointerMode = { kind: 'idle' };
  private touchGesture: TouchGesture | null = null;
  private dimensions: GraphDimensionsV1;
  private lastPointerPoint: GraphScreenPointV1 | undefined;
  private pendingHover: Extract<GraphInputEventV1, { type: 'pointer-move' }> | null = null;
  private readonly primaryTapReflex = new ReflexV1<PrimaryTapReceipt>();
  private trackpadPinchMomentum: TrackpadPinchMomentum | null = null;
  private trackpadPinchMomentumTimer: number | null = null;
  private readonly tagging = new GraphTaggingController();

  constructor(private readonly options: {
    readonly spacePhysicsOverride?: boolean;
    readonly dimensions: GraphDimensionsV1;
    readonly events: BufferedQueue<GraphInputEventV1>;
    readonly commands: BufferedQueue<GraphRuntimeCommandV1>;
    readonly hitTest: (point: GraphScreenPointV1, pointerKind?: 'mouse' | 'touch' | 'pen') => GraphHitV1 | null;
    readonly getSelectedNodeIds: () => readonly string[];
    readonly getFocusedNodeId: () => string | undefined;
    readonly getViewMode: () => GraphUxStateV1;
    readonly getHoveredNodeId: () => string | undefined;
    readonly getPreviewedNodeId?: () => string | undefined;
    readonly getFocusedNodeScreenPoint: () => GraphScreenPointV1 | undefined;
    readonly getNodeScreenPoint: (nodeId: string) => GraphScreenPointV1 | undefined;
    readonly getViewport: () => { readonly width: number; readonly height: number };
    readonly dragThresholdPx?: number;
    readonly primaryTapReceiptWindowMs?: number;
    readonly primaryTapReceiptDistancePx?: number;
    readonly focusTransitionDistanceRatio?: number;
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
        mod: hoverEvent.mod, ctrl: hoverEvent.ctrl,
        input: { phase: 'hover', target: hover ? { kind: 'node', nodeId: hover.nodeId } : { kind: 'background' },
          modality: hoverEvent.pointerKind, modifiers: { ctrl: hoverEvent.ctrl === true, meta: hoverEvent.meta === true,
            shift: hoverEvent.shift === true, alt: hoverEvent.alt === true } },
      });
      if (hoverEvent.pointerKind === 'mouse' && hoverEvent.mod && hover) {
        this.command(hoverEvent, { type: 'set-preview-hover', nodeId: hover.nodeId, point: hoverEvent.point });
      } else {
        this.command(hoverEvent, { type: 'set-preview-hover' });
      }
    }
  }

  isViewProposalSuspended(): boolean {
    return (this.mode.kind !== 'idle' && this.mode.kind !== 'press') || this.touchGesture !== null;
  }

  isCameraGestureActive(): boolean {
    return this.mode.kind === 'pan' || this.mode.kind === 'elastic-pan'
      || this.mode.kind === 'orbit' || this.mode.kind === 'radial-zoom'
      || this.mode.kind === 'precision-zoom' || this.touchGesture?.mode === 'navigation';
  }

  isSelectionPresentationSuspended(): boolean {
    return this.tagging.isPresentationSuspended();
  }

  isSelectionNeighborRevealActive(): boolean {
    return this.tagging.isSelectionNeighborRevealActive();
  }

  reset(): void {
    this.clearPrimaryTapReceipt();
    this.cancelTrackpadPinchMomentum();
    this.pointers.clear();
    this.mode = { kind: 'idle' };
    this.touchGesture = null;
    this.pendingHover = null;
    this.lastPointerPoint = undefined;
    this.tagging.reset();
  }

  private ingest(event: GraphInputEventV1): void {
    if (event.type === 'wheel' || event.type === 'pointer-move' || event.type === 'pointer-down') {
      this.lastPointerPoint = event.point;
    } else if (event.type === 'pointer-leave' || event.type === 'pointer-cancel') {
      this.lastPointerPoint = undefined;
    }
    if (event.type !== 'wheel' || !event.ctrl || event.meta || event.physicalCtrl) {
      this.cancelTrackpadPinchMomentum();
    }
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
    if (event.alt && this.tagging.updateOptionReveal(true)) {
      this.command(event, { type: 'selection-presentation-changed' });
    }
    this.pointers.set(event.pointerId, { id: event.pointerId, kind: event.pointerKind, point: event.point });
    if (this.pointers.size === 2) {
      this.clearPrimaryTapReceipt();
      this.mode = { kind: 'idle' };
      this.touchGesture = this.readTouchGesture();
      return;
    }
    const hit = this.options.hitTest(event.point, event.pointerKind);
    // A press elsewhere ends the old visit even if no pointer-move arrived first.
    if (event.pointerKind !== 'touch' && this.options.getHoveredNodeId() !== undefined
      && hit?.nodeId !== this.options.getHoveredNodeId()) {
      this.command(event, { type: 'set-hover', mod: false });
      this.command(event, { type: 'set-preview-hover' });
    }
    const matchingReceipt = event.button === 0 && !event.ctrl && !event.meta && !event.shift && !event.alt
      ? this.matchingPrimaryTapReceipt(event, hit)
      : undefined;
    const receiptSource = matchingReceipt
      ? this.appendPrimaryTapReceiptEvent(matchingReceipt, 'press', event)
      : undefined;
    const effectiveHit = receiptSource?.payload.hit && hit === null ? receiptSource.payload.hit : hit;
    const precisionZoomCandidate = event.pointerKind === 'touch' && receiptSource !== undefined;
    if (event.button === 0 && !receiptSource) this.clearPrimaryTapReceipt();
    if (receiptSource) {
      this.clearPrimaryTapReceipt();
      this.options.cancelLongPress();
      this.reconcilePrimaryTapReceipt(event, effectiveHit, receiptSource);
    }
    this.mode = {
      kind: 'press',
      pointerId: event.pointerId,
      pointerKind: event.pointerKind,
      button: event.button,
      downEvent: event,
      downPoint: event.point,
      lastPoint: event.point,
      hit: effectiveHit,
      precisionZoomCandidate,
      ...(receiptSource ? { receiptSource } : {}),
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
      const receiptNodeId = this.mode.receiptSource?.payload.hit?.nodeId;
      if (receiptNodeId && this.mode.hit?.nodeId === receiptNodeId) {
        const progress = this.focusTransitionProgress(this.mode.downPoint, event.point);
        this.command(event, {
          type: 'transition-focus',
          nodeId: receiptNodeId,
          progress,
          complete: false,
          modality: this.mode.pointerKind,
        });
        this.mode = {
          kind: 'focus-transition',
          pointerId: event.pointerId,
          pointerKind: this.mode.pointerKind,
          nodeId: receiptNodeId,
          origin: this.mode.downPoint,
          progress,
        };
        return;
      }
      if (this.mode.precisionZoomCandidate) {
        const receipt = this.mode.receiptSource;
        const receiptNodeId = receipt?.payload.hit?.nodeId;
        const receiptState = receipt?.payload.before;
        const restoresFocus = receiptNodeId !== undefined
          && receiptState?.focusedNodeId === receiptNodeId;
        const focusPoint = restoresFocus
          ? this.options.getNodeScreenPoint(receiptNodeId)
          : this.options.getFocusedNodeScreenPoint();
        const focusMode = restoresFocus || this.viewMode() === 'focus';
        const lastRadius = focusPoint ? pointDistance(this.mode.lastPoint, focusPoint) : undefined;
        if (focusMode && focusPoint && lastRadius !== undefined) {
          this.radialZoom(event, lastRadius, pointDistance(event.point, focusPoint));
        } else {
          const deltaY = event.point.y - this.mode.lastPoint.y;
          if (Math.abs(deltaY) > 0) this.command(event, {
            type: 'zoom-by', deltaY: -deltaY * 3, anchor: this.pointerZoomAnchor(this.mode.downPoint),
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
      const committedView = {
        selectedNodeIds,
        focusedNodeId: this.options.getFocusedNodeId(),
        viewMode: this.options.getViewMode(),
      };
      const policy = graphInteractionPolicyV1(committedView);
      const hitDraggableNode = this.mode.hit !== null && canDragGraphNodeV1(this.mode.hit.nodeId, committedView);
      const startsStableFocusDrag = policy.state === 'focus'
        && this.mode.hit !== null
        && (this.mode.pointerKind === 'touch'
          || (this.mode.pointerKind === 'mouse'
            && this.options.getHoveredNodeId() === this.mode.hit.nodeId));
      const startsOrdinaryNodeDrag = policy.state !== 'focus'
        && hitDraggableNode;
      if (this.mode.hit && hitDraggableNode && this.mode.button === 0
        && (startsOrdinaryNodeDrag || startsStableFocusDrag)) {
        this.command(event, { type: 'drag-start', nodeId: this.mode.hit.nodeId, point: this.mode.downPoint });
        this.command(event, { type: 'drag-update', nodeId: this.mode.hit.nodeId, point: event.point });
        this.mode = {
          kind: 'drag', pointerId: event.pointerId, pointerKind: this.mode.pointerKind,
          nodeId: this.mode.hit.nodeId, lastPoint: event.point,
        };
        return;
      }
      const navigation = this.mode.pointerKind === 'touch'
        ? policy.mobilePrimaryDrag[this.dimensions]
        : this.mode.button === 2
          ? policy.secondaryDrag
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
        if (Math.abs(deltaY) > 0) this.command(event, { type: 'zoom-by', deltaY: -deltaY * 3, anchor: this.pointerZoomAnchor(this.mode.anchor) });
        const deltaX = event.point.x - this.mode.lastPoint.x;
        if (this.dimensions === '3d' && Math.abs(deltaX) > 0) {
          this.command(event, { type: 'orbit-by', deltaX, deltaY: 0 });
        }
      }
      this.mode.lastPoint = event.point;
      return;
    }
    if (this.mode.kind === 'focus-transition' && this.mode.pointerId === event.pointerId) {
      const progress = this.focusTransitionProgress(this.mode.origin, event.point);
      this.command(event, {
        type: 'transition-focus',
        nodeId: this.mode.nodeId,
        progress,
        complete: false,
        modality: this.mode.pointerKind,
      });
      this.mode.progress = progress;
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
    if (this.mode.kind === 'focus-transition' && this.mode.pointerId === event.pointerId) {
      this.command(event, {
        type: 'transition-focus',
        nodeId: this.mode.nodeId,
        progress: this.mode.progress,
        complete: true,
        modality: this.mode.pointerKind,
      });
      this.mode = { kind: 'idle' };
      return;
    }
    if (this.mode.kind !== 'press' || this.mode.pointerId !== event.pointerId) {
      this.mode = { kind: 'idle' };
      return;
    }
    const hit = this.mode.hit;
    const pointerKind = this.mode.pointerKind;
    const downEvent = this.mode.downEvent;
    const receiptSource = this.mode.receiptSource;
    this.mode = { kind: 'idle' };
    if (event.button === 2) {
      if (hit) this.command(event, {
        type: 'request-node-context',
        nodeId: hit.nodeId,
        point: event.point,
        modality: pointerKind,
      });
      else this.command(event, { type: 'center-and-fit-camera', modality: pointerKind });
      return;
    }
    if (receiptSource && event.button === 0) {
      const completedReceipt = this.appendPrimaryTapReceiptEvent(receiptSource, 'release', event);
      this.resolvePrimaryTapReceipt(event, hit, completedReceipt);
      return;
    }
    const before = this.interactionStateSnapshot();
    this.resolveTap(event, hit);
    if (event.button === 0 && !downEvent.ctrl && !downEvent.meta && !downEvent.shift && !downEvent.alt) {
      this.issuePrimaryTapReceipt(downEvent, event, hit, before);
    }
  }

  private pointerCancel(event: Extract<GraphInputEventV1, { type: 'pointer-cancel' }>): void {
    this.pendingHover = null;
    this.pointers.delete(event.pointerId);
    if (this.mode.kind === 'drag' && this.mode.pointerId === event.pointerId) {
      this.command(event, {
        type: 'drag-end', nodeId: this.mode.nodeId, point: event.point,
        pointerKind: this.mode.pointerKind,
      });
    }
    this.mode = { kind: 'idle' };
    this.command(event, { type: 'set-hover', mod: false });
    this.command(event, { type: 'set-preview-hover' });
    if (this.pointers.size < 2) this.touchGesture = null;
  }

  private pointerLeave(event: Extract<GraphInputEventV1, { type: 'pointer-leave' }>): void {
    if (event.pointerKind === 'touch') return;
    this.pendingHover = null;
    this.command(event, { type: 'set-preview-hover' });
    this.command(event, { type: 'set-hover', mod: false });
  }

  private modifierChange(event: Extract<GraphInputEventV1, { type: 'modifier-change' }>): void {
    if (this.tagging.updateOptionReveal(event.alt)) {
      this.command(event, { type: 'selection-presentation-changed' });
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
      mod: event.mod, ctrl: event.ctrl,
      input: { phase: 'hover', target: hover ? { kind: 'node', nodeId: hover.nodeId } : { kind: 'background' },
        modality: 'mouse', modifiers: { ctrl: event.ctrl, meta: event.meta === true, shift: event.shift, alt: event.alt } },
    });
    if (event.mod && hover) {
      this.command(event, { type: 'set-preview-hover', nodeId: hover.nodeId, point: event.point });
    } else {
      this.command(event, { type: 'set-preview-hover' });
    }
  }

  private pointerZoomAnchor(point?: GraphScreenPointV1): GraphScreenPointV1 | undefined {
    return GRAPH_INTERACTION_STATE_POLICIES_V1[this.viewMode()].zoomAnchor === 'pointer' ? point : undefined;
  }

  private wheel(event: Extract<GraphInputEventV1, { type: 'wheel' }>): void {
    const delta = this.normalizedWheel(event);
    if (event.ctrl && !event.meta) {
      const zoomDelta = delta.y * TRACKPAD_PINCH_ZOOM_MULTIPLIER;
      const anchor = event.physicalCtrl ? event.point : this.pointerZoomAnchor(event.point);
      this.command(event, { type: 'zoom-by', deltaY: zoomDelta, ...(anchor ? { anchor } : {}) });
      if (!event.physicalCtrl) this.captureTrackpadPinchMomentum(event, zoomDelta, anchor);
      return;
    }
    const policy = graphInteractionPolicyV1({
      selectedNodeIds: this.options.getSelectedNodeIds(),
      focusedNodeId: this.options.getFocusedNodeId(),
      viewMode: this.options.getViewMode(),
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
    // A node hold remains an ordinary press, so it may continue into a drag or
    // resolve as a normal click on release. Only background hold owns an action.
    if (hit) return;
    if (this.mode.kind === 'press' && this.mode.pointerId === event.pointerId) this.mode = { kind: 'idle' };
    this.command(event, { type: 'center-and-fit-camera', modality: event.pointerKind });
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
      this.command(event, { type: 'zoom-by', deltaY: -120, anchor: this.pointerZoomAnchor(this.lastPointerPoint) });
      return;
    }
    if (event.key === '-' || event.key === '_') {
      this.command(event, { type: 'zoom-by', deltaY: 120, anchor: this.pointerZoomAnchor(this.lastPointerPoint) });
      return;
    }
    if (event.key === 'Escape') {
      this.tagging.reset();
      this.command(event, { type: 'activate-view', input: { phase: 'activate', target: { kind: 'background' },
        modality: 'keyboard', modifiers: { ctrl: event.ctrl, meta: event.meta, shift: event.shift, alt: event.alt } } });
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (this.options.spacePhysicsOverride) return;
      if (event.repeat || event.composing || event.ctrl || event.meta || event.shift || event.alt) return;
      if (GRAPH_VIEW_DEFINITIONS_V1[this.viewMode()].interactions.spaceActivation === 'clear-constellation') {
        this.command(event, { type: 'direct-attention', nodeIds: [], clearFocus: true, viewMode: 'overview' });
        return;
      }
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
    if (this.options.spacePhysicsOverride) return;
    if (this.tagging.updateSpace(false)) this.command(event, { type: 'selection-presentation-changed' });
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
      if (totalPan > threshold || totalDistance > threshold) mode = 'navigation';
    }
    let navigationStarted = previous.navigationStarted;
    if (mode === 'navigation') {
      navigationStarted = true;
      const policy = graphInteractionPolicyV1({
        selectedNodeIds: this.options.getSelectedNodeIds(),
        focusedNodeId: this.options.getFocusedNodeId(),
        viewMode: this.options.getViewMode(),
      });
      const originCentroid = previous.mode === 'pending' ? previous.startCentroid : previous.centroid;
      const deltaX = originCentroid.x - next.centroid.x;
      const deltaY = originCentroid.y - next.centroid.y;
      if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
        const navigation = policy.mobileTwoFingerDrag[this.dimensions];
        this.command(event, navigation === 'rotate-and-zoom'
          ? { type: 'orbit-by', deltaX: -deltaX, deltaY }
          : { type: 'pan-by', deltaX, deltaY });
      }
      const originDistance = previous.mode === 'pending' ? previous.startDistance : previous.distance;
      const distanceDelta = next.distance - originDistance;
      if (Math.abs(distanceDelta) >= 1) this.command(event, {
        type: 'zoom-by',
        deltaY: -distanceDelta * 3,
        anchor: this.pointerZoomAnchor(next.centroid),
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

  private focusTransitionProgress(
    origin: GraphScreenPointV1,
    point: GraphScreenPointV1,
  ): number {
    const viewport = this.options.getViewport();
    const ratio = this.options.focusTransitionDistanceRatio
      ?? DEFAULT_FOCUS_TRANSITION_DISTANCE_RATIO;
    const distance = Math.max(48, Math.min(viewport.width, viewport.height) * ratio);
    return Math.max(0, Math.min(1, pointDistance(origin, point) / distance));
  }

  private matchingPrimaryTapReceipt(
    event: Extract<GraphInputEventV1, { type: 'pointer-down' }>,
    hit: GraphHitV1 | null,
  ): PrimaryTapReceipt | undefined {
    const decision = this.primaryTapReflex.recognize(
      event,
      (receipt, candidate) => {
        const source = receipt.payload;
        const release = [...receipt.events].reverse().find((entry) => entry.phase === 'release');
        if (!release || release.payload.pointerKind !== candidate.pointerKind) return false;
        if (source.hit !== null && hit !== null && source.hit.nodeId === hit.nodeId) return true;
        if (distanceSquared(candidate.point, release.payload.point)
          > (this.options.primaryTapReceiptDistancePx ?? 24) ** 2) return false;
        if (source.hit === null && hit === null) return candidate.pointerKind === 'touch';
        return source.hit !== null && hit === null;
      },
    );
    return decision.status === 'matched' ? decision.receipt : undefined;
  }

  private issuePrimaryTapReceipt(
    downEvent: Extract<GraphInputEventV1, { type: 'pointer-down' }>,
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
    before: InteractionStateSnapshot,
  ): void {
    this.primaryTapReflex.remember({
      schemaVersion: 1,
      kind: 'primary-tap',
      identity: { ...event.identity },
      issuedAt: event.timestamp,
      expiresAt: event.timestamp
        + (this.options.primaryTapReceiptWindowMs ?? DEFAULT_PRIMARY_TAP_RECEIPT_WINDOW_MS),
      events: [
        this.primaryTapReceiptEvent('press', downEvent),
        this.primaryTapReceiptEvent('release', event),
      ],
      payload: { hit, before },
    });
  }

  private clearPrimaryTapReceipt(): void {
    this.primaryTapReflex.forget();
  }

  private reconcilePrimaryTapReceipt(
    event: Extract<GraphInputEventV1, { type: 'pointer-down' }>,
    hit: GraphHitV1 | null,
    source: PrimaryTapReceipt,
  ): void {
    const sourceHit = source.payload.hit;
    if (hit && sourceHit?.nodeId === hit.nodeId) {
      // The first release already committed its View transition. The matching
      // second press consumes that receipt without replaying or undoing it.
      return;
    }
    if (!hit && !sourceHit && event.pointerKind === 'touch') {
      const before = source.payload.before;
      this.command(event, {
        type: 'reconcile-interaction-state',
        nodeIds: before.selectedNodeIds,
        viewMode: before.viewMode,
        ...(before.focusedNodeId === undefined ? {} : { focusedNodeId: before.focusedNodeId }),
      });
    }
  }

  private resolvePrimaryTapReceipt(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
    source: PrimaryTapReceipt,
  ): void {
    const sourceHit = source.payload.hit;
    if (hit && sourceHit?.nodeId === hit.nodeId) {
      this.command(event, { type: 'activate-node', nodeId: hit.nodeId, activation: 'primary' });
      return;
    }
    if (!hit && !sourceHit && event.pointerKind === 'touch') {
      this.command(event, { type: 'center-and-fit-camera', modality: event.pointerKind });
    }
  }

  private appendPrimaryTapReceiptEvent(
    receipt: PrimaryTapReceipt,
    phase: PrimaryTapReceiptEvent['phase'],
    event: Extract<GraphInputEventV1, { type: 'pointer-down' | 'pointer-up' }>,
  ): PrimaryTapReceipt {
    return appendInteractionReceiptEventV1(receipt, this.primaryTapReceiptEvent(phase, event));
  }

  private primaryTapReceiptEvent(
    phase: PrimaryTapReceiptEvent['phase'],
    event: Extract<GraphInputEventV1, { type: 'pointer-down' | 'pointer-up' }>,
  ): PrimaryTapReceiptEvent {
    return {
      phase,
      timestamp: event.timestamp,
      payload: {
        pointerId: event.pointerId,
        pointerKind: event.pointerKind,
        button: event.button,
        point: event.point,
      },
    };
  }

  private interactionStateSnapshot(): InteractionStateSnapshot {
    const focusedNodeId = this.options.getFocusedNodeId();
    return {
      selectedNodeIds: [...this.options.getSelectedNodeIds()],
      viewMode: this.options.getViewMode(),
      ...(focusedNodeId === undefined ? {} : { focusedNodeId }),
    };
  }

  private resolveTap(
    event: Extract<GraphInputEventV1, { type: 'pointer-up' }>,
    hit: GraphHitV1 | null,
  ): void {
    if (hit && event.meta && !event.ctrl && !event.shift && !event.alt
      && this.options.getPreviewedNodeId?.() === hit.nodeId) {
      this.command(event, { type: 'activate-node', nodeId: hit.nodeId, activation: 'primary' });
      return;
    }
    if (!hit) this.tagging.reset();
    this.command(event, { type: 'activate-view', input: {
      phase: 'activate', target: hit ? { kind: 'node', nodeId: hit.nodeId } : { kind: 'background' },
      modality: event.pointerKind,
      modifiers: { ctrl: event.ctrl, meta: event.meta, shift: event.shift, alt: event.alt },
    } });
  }

  private viewMode(): GraphUxStateV1 {
    return this.options.getViewMode();
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
    anchor?: GraphScreenPointV1,
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
