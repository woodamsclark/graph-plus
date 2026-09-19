import type {
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphIntentV1,
  GraphViewStateV1,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import type { GraphCameraController } from '../camera/index.ts';
import type { SessionRuntimePlatformV1 } from '../platform/index.ts';
import type { SessionSurfaceV1 } from '../surface/index.ts';
import { BufferedQueue } from './BufferedQueue.ts';
import { animaPreviewTiming } from '../modules/shipped/AnimaPreviewPresentation.ts';
import { GraphCommander, GraphCommandRegistry } from './GraphCommander.ts';
import { GraphInput } from './GraphInput.ts';
import { GraphInteractionInterpreter } from './GraphInteractionInterpreter.ts';
import type {
  GraphInputEventV1,
  GraphRuntimeCommandV1,
  GraphScreenPointV1,
} from './GraphInteractionTypes.ts';

export type GraphRuntimeViewChangeV1 = 'camera' | 'interaction' | 'layout' | 'positions';

export class SessionInteractionRuntime {
  private readonly inputEvents = new BufferedQueue<GraphInputEventV1>();
  private readonly commands = new BufferedQueue<GraphRuntimeCommandV1>();
  private readonly commandRegistry = new GraphCommandRegistry();
  private readonly commander = new GraphCommander(this.commands, this.commandRegistry);
  private readonly input: GraphInput;
  private readonly interpreter: GraphInteractionInterpreter;
  private hoveredNodeId: string | undefined;
  private previewedNodeId: string | undefined;
  private previewPoint: GraphScreenPointV1 | undefined;
  private previewSurfaceActive = false;
  private previewReleaseTimer: number | undefined;
  private hoverMod = false;
  private hoverPoint: GraphScreenPointV1 | undefined;
  private hitTestMs = 0;
  private hitTestCount = 0;
  private dragContext: {
    readonly nodeId: string;
    readonly depth: number;
    readonly offset: Vec3;
    readonly wasPinned: boolean;
  } | null = null;

  constructor(private readonly options: {
    readonly sessionId: string;
    readonly dimensions: GraphDimensionsV1;
    readonly platform: SessionRuntimePlatformV1;
    readonly surface: SessionSurfaceV1;
    readonly interactionElement: HTMLElement;
    readonly camera: GraphCameraController;
    readonly hitTest: (
      point: GraphScreenPointV1,
      pointerKind?: 'mouse' | 'touch' | 'pen',
    ) => import('./GraphInteractionTypes.ts').GraphHitV1 | null;
    readonly getDocument: () => GraphDocumentV1;
    readonly getViewState: () => GraphViewStateV1;
    readonly getInteractivePositions: () => Readonly<Record<string, Vec3>>;
    readonly getNodeSelection: (nodeId: string) => readonly string[];
    readonly isNodeDraggable: (nodeId: string) => boolean;
    readonly setViewState: (state: GraphViewStateV1) => void;
    readonly getRenderSelection: () => GraphFilterSelectionV1;
    readonly resetCamera: () => void;
    readonly getDragReleasePolicy: () => 'pin' | 'dynamic';
    readonly getDragConstraintPolicy?: () => 'persistent-pin' | 'transient';
    readonly onViewStateChanged: (change: GraphRuntimeViewChangeV1) => void;
    readonly onIntent: (intent: GraphIntentV1) => void;
    readonly onActivateNode: (nodeId: string) => boolean;
    readonly onInputQueued?: () => void;
  }) {
    this.registerCommandHandlers();
    this.input = new GraphInput({
      element: this.options.interactionElement,
      platform: this.options.platform,
      events: this.inputEvents,
      getIdentity: () => {
        const document = this.options.getDocument();
        return { documentId: document.documentId, documentRevision: document.revision };
      },
      onInputQueued: this.options.onInputQueued,
    });
    this.interpreter = new GraphInteractionInterpreter({
      dimensions: this.options.dimensions,
      events: this.inputEvents,
      commands: this.commands,
      hitTest: (point, pointerKind) => {
        const start = this.options.platform.now();
        const hit = this.options.hitTest(point, pointerKind);
        this.hitTestCount += 1;
        this.hitTestMs += Math.max(0, this.options.platform.now() - start);
        return hit;
      },
      getFocusedNodeId: () => this.options.getViewState().focusedNodeId,
      getHoveredNodeId: () => this.hoveredNodeId,
      isDirectNeighbor: (nodeId, focusedNodeId) => this.isDirectNeighbor(nodeId, focusedNodeId),
      getSelectedNodeIds: () => this.options.getViewState().selectedNodeIds,
      getNodeSelection: (nodeId) => this.options.getNodeSelection(nodeId),
      getViewport: () => this.options.surface.getViewport(),
      setTimeout: (callback, delayMs) => this.options.platform.setTimeout(callback, delayMs),
      clearTimeout: (handle) => this.options.platform.clearTimeout(handle),
      onDeferredCommand: this.options.onInputQueued ?? (() => undefined),
      cancelLongPress: () => this.input.cancelLongPress(),
    });
  }

  tick(): void {
    this.interpreter.tick();
    this.commander.tick();
  }

  consumeHitTestDuration(): number {
    const value = this.hitTestMs;
    this.hitTestMs = 0;
    return value;
  }

  consumeHitTestCount(): number {
    const value = this.hitTestCount;
    this.hitTestCount = 0;
    return value;
  }

  setEnabled(enabled: boolean): void {
    this.input.setEnabled(enabled);
    if (!enabled) this.resetTransientState();
  }

  setDimensions(dimensions: GraphDimensionsV1): void {
    this.interpreter.setDimensions(dimensions);
    this.resetTransientState();
  }

  reset(): void {
    this.input.reset();
    this.resetTransientState();
  }

  getHoveredNodeId(): string | undefined {
    return this.hoveredNodeId;
  }

  isTaggingActive(): boolean {
    return this.interpreter.isTaggingActive();
  }

  getPreviewedNodeId(): string | undefined {
    return this.previewedNodeId;
  }

  setPreviewSurfaceActive(active: boolean): void {
    if (active) this.cancelPreviewRelease();
    this.previewSurfaceActive = active && this.previewedNodeId !== undefined;
  }

  private cancelPreviewRelease(): void {
    if (this.previewReleaseTimer !== undefined) this.options.platform.clearTimeout(this.previewReleaseTimer);
    this.previewReleaseTimer = undefined;
  }

  clearPreview(): void {
    this.cancelPreviewRelease();
    if (this.previewedNodeId === undefined) return;
    this.previewSurfaceActive = false;
    this.previewedNodeId = undefined;
    this.previewPoint = undefined;
    this.updateCursor();
    this.options.onViewStateChanged('interaction');
    this.options.onIntent({
      ...this.currentIntentBase(),
      type: 'preview-changed',
    });
  }

  getDraggedNodeId(): string | undefined {
    return this.dragContext?.nodeId;
  }

  dispose(): void {
    this.input.dispose();
    this.resetTransientState();
  }

  private registerCommandHandlers(): void {
    const types: readonly GraphRuntimeCommandV1['type'][] = [
      'pan-by',
      'orbit-by',
      'zoom-by',
      'reset-camera',
      'fit-camera',
      'set-selection',
      'set-focus',
      'tagging-changed',
      'activate-node',
      'activate-background',
      'request-node-context',
      'set-hover',
      'set-preview-hover',
      'drag-start',
      'drag-update',
      'drag-end',
    ];
    for (const type of types) this.commandRegistry.register(type, (command) => this.applyCommand(command));
  }

  private applyCommand(command: GraphRuntimeCommandV1): void {
    if (!this.commandBelongsToActiveDocument(command)) return;
    switch (command.type) {
      case 'pan-by':
        this.options.camera.panByPixels(command.deltaX, command.deltaY);
        this.cameraChanged(command);
        return;
      case 'orbit-by':
        this.options.camera.orbitByPixels(command.deltaX, command.deltaY);
        this.cameraChanged(command);
        return;
      case 'zoom-by':
        this.options.camera.zoomByWheel(
          command.deltaY,
          this.options.getViewState().focusedNodeId === undefined || this.isTaggingActive()
            ? command.anchor
            : undefined,
        );
        this.cameraChanged(command);
        return;
      case 'reset-camera':
        this.options.resetCamera();
        this.cameraChanged(command);
        this.options.onIntent({
          ...this.intentBase(command),
          type: 'camera-reset',
          ...(this.options.getViewState().focusedNodeId
            ? { focusedNodeId: this.options.getViewState().focusedNodeId }
            : {}),
        });
        return;
      case 'fit-camera':
        this.fitVisibleNodes(command.nodeIds, command.centerNodeId);
        this.emitViewportIntent(command);
        return;
      case 'set-selection':
        this.setSelection(command.nodeIds, command);
        return;
      case 'set-focus':
        this.setFocus(command.nodeId, command);
        return;
      case 'tagging-changed':
        this.options.onViewStateChanged('interaction');
        return;
      case 'activate-node':
        if (!this.options.getRenderSelection().nodeIds.has(command.nodeId)) return;
        if (!this.options.onActivateNode(command.nodeId)) return;
        this.options.onIntent({
          ...this.intentBase(command),
          type: 'node-activated',
          nodeId: command.nodeId,
          activation: command.activation,
        });
        return;
      case 'activate-background':
        this.options.onIntent({ ...this.intentBase(command), type: 'background-activated' });
        return;
      case 'request-node-context':
        if (!this.options.getRenderSelection().nodeIds.has(command.nodeId)) return;
        this.options.onIntent({
          ...this.intentBase(command),
          type: 'node-context-requested',
          nodeId: command.nodeId,
          anchor: { ...command.point },
          modality: command.modality,
        });
        return;
      case 'set-hover':
        if (this.hoveredNodeId === command.nodeId
          && this.hoverMod === command.mod
          && samePoint(this.hoverPoint, command.point)) return;
        this.hoveredNodeId = command.nodeId;
        this.hoverMod = command.mod;
        this.hoverPoint = command.point ? { ...command.point } : undefined;
        this.updateCursor();
        this.options.onViewStateChanged('interaction');
        this.options.onIntent({
          ...this.intentBase(command),
          type: 'node-hover-changed',
          ...(command.nodeId ? { nodeId: command.nodeId } : {}),
          ...(command.point ? { anchor: { ...command.point } } : {}),
          mod: command.mod,
        });
        return;
      case 'set-preview-hover':
        if (command.nodeId === undefined && this.previewSurfaceActive) return;
        if (command.nodeId === undefined && this.previewedNodeId !== undefined) {
          if (this.previewReleaseTimer !== undefined) return;
          this.previewReleaseTimer = this.options.platform.setTimeout(() => {
            this.previewReleaseTimer = undefined;
            this.clearPreview();
          }, animaPreviewTiming.handoff);
          this.options.onIntent({ ...this.intentBase(command), type: 'preview-changed', closing: true });
          return;
        }
        const wasClosing = this.previewReleaseTimer !== undefined;
        this.cancelPreviewRelease();
        if (!wasClosing && this.previewedNodeId === command.nodeId && samePoint(this.previewPoint, command.point)) return;
        this.previewedNodeId = command.nodeId;
        this.previewPoint = command.point ? { ...command.point } : undefined;
        if (command.nodeId === undefined) this.previewSurfaceActive = false;
        this.updateCursor();
        this.options.onViewStateChanged('interaction');
        this.options.onIntent({
          ...this.intentBase(command),
          type: 'preview-changed',
          ...(command.nodeId ? { nodeId: command.nodeId } : {}),
          ...(command.point ? { anchor: { ...command.point } } : {}),
        });
        return;
      case 'drag-start':
        this.beginNodeDrag(command.nodeId, command.point);
        return;
      case 'drag-update':
        this.updateNodeDrag(command.nodeId, command.point);
        return;
      case 'drag-end':
        this.updateNodeDrag(command.nodeId, command.point);
        this.endNodeDrag(command);
        return;
    }
  }

  private commandBelongsToActiveDocument(command: GraphRuntimeCommandV1): boolean {
    const document = this.options.getDocument();
    return command.identity.documentId === document.documentId
      && command.identity.documentRevision === document.revision;
  }

  private isDirectNeighbor(nodeId: string, focusedNodeId: string): boolean {
    if (nodeId === focusedNodeId || !this.options.getRenderSelection().nodeIds.has(nodeId)) return false;
    return this.options.getDocument().edges.some((edge) => this.options.getRenderSelection().edgeIds.has(edge.id)
      && ((edge.sourceId === focusedNodeId && edge.targetId === nodeId)
        || (edge.targetId === focusedNodeId && edge.sourceId === nodeId)));
  }

  private cameraChanged(command: GraphRuntimeCommandV1): void {
    this.commitCamera();
    this.options.onViewStateChanged('camera');
    this.emitViewportIntent(command);
  }

  private commitCamera(): void {
    this.commit({ ...this.options.getViewState(), camera: this.options.camera.getState() });
  }

  private fitVisibleNodes(nodeIds?: readonly string[], centerNodeId?: string): void {
    const positionsById = this.options.getInteractivePositions();
    const candidates = nodeIds ?? [...this.options.getRenderSelection().nodeIds];
    const positions = [...new Set(candidates)]
      .map((id) => positionsById[id])
      .filter(isVec3);
    if (!positions.length) return;
    const center = centerNodeId === undefined ? undefined : positionsById[centerNodeId];
    this.options.camera.fit(positions, 48, nodeIds === undefined ? undefined : 1.75, center);
    this.commitCamera();
    this.options.onViewStateChanged('camera');
  }

  private setSelection(nodeIds: readonly string[], command: GraphRuntimeCommandV1): void {
    const state = this.options.getViewState();
    const known = new Set(this.options.getDocument().nodes.map((node) => node.id));
    const selectedNodeIds = [...new Set(nodeIds)].filter((id) => known.has(id));
    if (sameIds(selectedNodeIds, state.selectedNodeIds)) return;
    this.commit({ ...state, selectedNodeIds });
    this.options.onViewStateChanged('interaction');
    this.options.onIntent({
      ...this.intentBase(command),
      type: 'selection-changed',
      selectedNodeIds: [...selectedNodeIds],
    });
  }

  private setFocus(nodeId: string | undefined, command: GraphRuntimeCommandV1): void {
    this.cancelPreviewRelease();
    const document = this.options.getDocument();
    if (nodeId !== undefined && !document.nodes.some((node) => node.id === nodeId)) return;
    const state = this.options.getViewState();
    const focusChanged = state.focusedNodeId !== nodeId;
    const hoverChanged = this.hoveredNodeId !== undefined || this.previewedNodeId !== undefined;
    const previewChanged = this.previewedNodeId !== undefined;
    if (!focusChanged && !hoverChanged) return;
    this.hoveredNodeId = undefined;
    this.previewedNodeId = undefined;
    this.previewPoint = undefined;
    this.previewSurfaceActive = false;
    this.hoverMod = false;
    this.hoverPoint = undefined;
    this.updateCursor();
    if (hoverChanged) this.options.onIntent({
      ...this.intentBase(command),
      type: 'node-hover-changed',
      mod: false,
    });
    if (previewChanged) this.options.onIntent({
      ...this.intentBase(command),
      type: 'preview-changed',
    });
    if (focusChanged) {
      const { focusedNodeId: _focusedNodeId, ...withoutFocus } = state;
      this.commit(nodeId === undefined ? withoutFocus : { ...withoutFocus, focusedNodeId: nodeId });
      if (nodeId) {
        const position = this.options.getInteractivePositions()[nodeId];
        if (position) {
          this.options.camera.setTarget(position);
          this.commitCamera();
        }
      }
    }
    this.options.onViewStateChanged('interaction');
    if (!focusChanged) return;
    this.options.onIntent({
      ...this.intentBase(command),
      type: 'focus-changed',
      ...(nodeId === undefined ? {} : { focusedNodeId: nodeId }),
    });
  }

  private beginNodeDrag(nodeId: string, point: GraphScreenPointV1): void {
    if (!this.options.getRenderSelection().nodeIds.has(nodeId)) return;
    if (!this.options.isNodeDraggable(nodeId)) return;
    const position = this.options.getInteractivePositions()[nodeId];
    if (!position) return;
    const projected = this.options.camera.worldToScreen(position);
    const underPointer = this.options.camera.screenToWorld(point.x, point.y, projected.depth);
    const state = this.options.getViewState();
    const wasPinned = state.pinnedNodeIds.includes(nodeId);
    this.dragContext = {
      nodeId,
      depth: projected.depth,
      offset: subtract(position, underPointer),
      wasPinned,
    };
    if (!wasPinned && this.options.getDragConstraintPolicy?.() !== 'transient') {
      this.commit({ ...state, pinnedNodeIds: [...state.pinnedNodeIds, nodeId] });
      this.options.onViewStateChanged('layout');
    }
    this.updateCursor();
  }

  private updateNodeDrag(nodeId: string, point: GraphScreenPointV1): void {
    if (!this.dragContext || this.dragContext.nodeId !== nodeId) return;
    const state = this.options.getViewState();
    const underPointer = this.options.camera.screenToWorld(point.x, point.y, this.dragContext.depth);
    const position = add(underPointer, this.dragContext.offset);
    this.commit({ ...state, positions: { ...state.positions, [nodeId]: position } });
    if (state.focusedNodeId === nodeId) this.options.camera.setTarget(position);
    this.commitCamera();
    this.options.onViewStateChanged('positions');
  }

  private endNodeDrag(command: Extract<GraphRuntimeCommandV1, { type: 'drag-end' }>): void {
    if (!this.dragContext || this.dragContext.nodeId !== command.nodeId) return;
    const position = this.options.getViewState().positions[command.nodeId];
    const wasPinned = this.dragContext.wasPinned;
    this.dragContext = null;
    this.hoveredNodeId = command.pointerKind === 'touch' ? undefined : command.nodeId;
    this.updateCursor();
    if (!position) return;
    if (!wasPinned && this.options.getDragConstraintPolicy?.() !== 'transient'
      && this.options.getDragReleasePolicy() === 'dynamic') {
      const state = this.options.getViewState();
      this.commit({ ...state, pinnedNodeIds: state.pinnedNodeIds.filter((id) => id !== command.nodeId) });
      this.options.onViewStateChanged('layout');
    }
    this.options.onIntent({
      ...this.intentBase(command),
      type: 'node-drag-ended',
      nodeId: command.nodeId,
      position: { ...position },
    });
  }

  private updateCursor(): void {
    this.options.surface.setCursor(this.dragContext
      ? 'grabbing'
      : this.previewedNodeId ?? this.hoveredNodeId
        ? 'pointer'
        : 'default');
  }

  private resetTransientState(): void {
    this.cancelPreviewRelease();
    const previewChanged = this.previewedNodeId !== undefined;
    this.interpreter.reset();
    this.inputEvents.clear();
    this.commands.clear();
    this.dragContext = null;
    this.hoveredNodeId = undefined;
    this.previewedNodeId = undefined;
    this.previewPoint = undefined;
    this.previewSurfaceActive = false;
    this.hoverMod = false;
    this.hoverPoint = undefined;
    this.updateCursor();
    if (previewChanged) this.options.onIntent({
      ...this.currentIntentBase(),
      type: 'preview-changed',
    });
  }

  private intentBase(command: GraphRuntimeCommandV1) {
    return {
      sessionId: this.options.sessionId,
      documentId: command.identity.documentId,
      documentRevision: command.identity.documentRevision,
      timestamp: command.timestamp,
    } as const;
  }

  private currentIntentBase() {
    const document = this.options.getDocument();
    return {
      sessionId: this.options.sessionId,
      documentId: document.documentId,
      documentRevision: document.revision,
      timestamp: this.options.platform.now(),
    } as const;
  }

  private emitViewportIntent(command: GraphRuntimeCommandV1): void {
    this.options.onIntent({
      ...this.intentBase(command),
      type: 'viewport-changed',
      camera: this.options.camera.getState(),
    });
  }

  private commit(state: GraphViewStateV1): void {
    this.options.setViewState(state);
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function samePoint(
  a: GraphScreenPointV1 | undefined,
  b: GraphScreenPointV1 | undefined,
): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.x === b.x && a.y === b.y;
}

function isVec3(value: Vec3 | undefined): value is Vec3 {
  return value !== undefined;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
