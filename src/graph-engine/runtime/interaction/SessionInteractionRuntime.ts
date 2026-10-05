import { presentEgoInteractionPlanV1, type GraphInteractionPreviewV1 } from '../anima/AnimaInteractionPreview.ts';
import { isEgoInteractionPlanCurrentV1, realizeEgoViewDirectiveV1, sameEgoInteractionV1,
  type EgoInteractionInputV1, type EgoInteractionContextV1, type EgoInteractionStateV1 } from '../consciousness/EgoInteractionPlan.ts';
import type {
  GraphCameraStateV1,
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphExperienceContractV1,
  GraphIntentV1,
  GraphViewStateV1,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import type { GraphTopologyIndex } from '../../core/document/GraphTopologyIndex.ts';
import { Vision } from '../vision/index.ts';
import type {
  Attention,
  Ego,
  EgoIntentOutcome,
} from '../consciousness/index.ts';
import { adjudicateGraphExperienceCommandV1 } from '../experience/index.ts';
import type { SessionRuntimePlatformV1 } from '../platform/index.ts';
import type { SessionSurfaceV1 } from '../surface/index.ts';
import { BufferedQueue } from './BufferedQueue.ts';
import { animaPreviewTiming } from '../modules/shipped/AnimaPreviewPresentation.ts';
import { GraphCommander, GraphCommandRegistry } from './GraphCommander.ts';
import { GraphInput } from './GraphInput.ts';
import { GraphInteractionInterpreter } from './GraphInteractionInterpreter.ts';
import {
  FOCUS_FIT_PADDING_PX,
  canDragGraphNodeV1,
  graphInteractionPolicyV1,
  immediateNeighborhoodFitNodeIdsV1,
  resolveGraphUxStateV1,
  singleNodeFitMaxProjectedScale,
} from './GraphInteractionStatePolicy.ts';
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
  private readonly commander: GraphCommander;
  private readonly input: GraphInput;
  private readonly interpreter: GraphInteractionInterpreter;
  private hoveredNodeId: string | undefined;
  private previewedNodeId: string | undefined;
  private previewPoint: GraphScreenPointV1 | undefined;
  private previewSurfaceActive = false;
  private previewReleaseTimer: number | undefined;
  private hoverMod = false;
  private hoverCtrl = false;
  private hoverInput: EgoInteractionInputV1 | undefined;
  /** Activation latches the admitted preview; only a real leave/different target rearms it. */
  private consumedHoverNodeId: string | undefined;
  private consumedHoverPreview: GraphInteractionPreviewV1 | undefined;
  private presentedHoverNodeId: string | undefined;
  private presentedHoverPreview: GraphInteractionPreviewV1 | undefined;
  /** The admitted hover scene captured at drag start, held without replanning. */
  private dragHoverPreview: GraphInteractionPreviewV1 | undefined;
  private hoverPoint: GraphScreenPointV1 | undefined;
  /** Borrowed controls and spatial interest; never realized as Attention or a saved View. */
  private navigationPeek?: {
    readonly preview: GraphInteractionPreviewV1;
    readonly state: EgoInteractionStateV1;
    readonly returnTarget: Vec3;
    readonly source: string;
    navigated: boolean;
  };

  private elasticReturnTimer: number | undefined;
  private focusTransition: {
    readonly nodeId: string;
    readonly start: GraphCameraStateV1;
    readonly target: GraphCameraStateV1;
  } | undefined;
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
    readonly vision: Vision;
    readonly experience: GraphExperienceContractV1;
    readonly ego: Ego;
    readonly getAttention: () => Attention;
    readonly getOverviewConstellationNodeIds: () => ReadonlySet<string>;
    readonly getRememberedNodeIds: () => ReadonlySet<string>;
    readonly setAttention: (nodeIds: readonly string[]) => readonly string[];
    readonly hitTest: (
      point: GraphScreenPointV1,
      pointerKind?: 'mouse' | 'touch' | 'pen',
      retainedHoverNodeId?: string,
    ) => import('./GraphInteractionTypes.ts').GraphHitV1 | null;
    readonly getDocument: () => GraphDocumentV1;
    readonly getViewState: () => GraphViewStateV1;
    readonly getInteractivePositions: () => Readonly<Record<string, Vec3>>;
    readonly getNodeSelection: (nodeId: string) => readonly string[];
    readonly isNodeDraggable: (nodeId: string) => boolean;
    readonly setViewState: (state: GraphViewStateV1) => void;
    readonly getRenderSelection: () => GraphFilterSelectionV1;
    readonly getPlanningTopology: () => {
      readonly revision: number | string;
      readonly topology: GraphTopologyIndex;
      readonly availableNodeIds: ReadonlySet<string>;
    };
    readonly resetCamera: () => void;
    readonly getDragReleasePolicy: () => 'pin' | 'dynamic';
    readonly getDragConstraintPolicy?: () => 'persistent-pin' | 'transient';
    readonly onViewStateChanged: (change: GraphRuntimeViewChangeV1) => void;
    readonly onIntent: (intent: GraphIntentV1) => void;
    readonly onActivateNode: (nodeId: string) => boolean;
    readonly onInputQueued?: () => void;
  }) {
    this.registerCommandHandlers();
    this.commander = new GraphCommander(
      this.commands,
      this.commandRegistry,
      (command) => this.routeEndogenousCommand(command),
    );
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
        const retainedHoverNodeId = this.hoverCtrl && this.hoveredNodeId !== undefined
          && this.options.getViewState().selectedNodeIds.includes(this.hoveredNodeId)
          && !this.isNodeInteractiveInCurrentState(this.hoveredNodeId) ? this.hoveredNodeId : undefined;
        const hit = this.options.hitTest(point, pointerKind, retainedHoverNodeId);
        this.hitTestCount += 1;
        this.hitTestMs += Math.max(0, this.options.platform.now() - start);
        return hit && (hit.nodeId === retainedHoverNodeId || this.isNodeInteractiveInCurrentState(hit.nodeId)) ? hit : null;
      },
      getSelectedNodeIds: () => this.getNavigationState().attentionNodeIds,
      getFocusedNodeId: () => this.getNavigationState().focusedNodeId,
      getViewMode: () => this.getNavigationState().viewId,
      getHoveredNodeId: () => this.hoveredNodeId,
      getFocusedNodeScreenPoint: () => {
        const focusedNodeId = this.getNavigationState().focusedNodeId;
        const position = focusedNodeId === undefined
          ? undefined
          : this.options.getInteractivePositions()[focusedNodeId];
        if (!position) return undefined;
        const projected = this.options.vision.worldToScreen(position);
        return { x: projected.x, y: projected.y };
      },
      getNodeScreenPoint: (nodeId) => {
        const position = this.options.getInteractivePositions()[nodeId];
        if (!position) return undefined;
        const projected = this.options.vision.worldToScreen(position);
        return { x: projected.x, y: projected.y };
      },
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
    this.updateCursor();
  }

  queueConstellationToggle(nodeId: string, modality: EgoInteractionInputV1['modality'] = 'keyboard'): void {
    this.queueViewIntent({ phase: 'activate', target: { kind: 'node', nodeId }, modality,
      modifiers: { ctrl: false, meta: false, shift: false, alt: false }, membershipAction: 'toggle' });
  }

  queueViewIntent(input: EgoInteractionInputV1): void {
    const document = this.options.getDocument();
    this.commands.push({ type: 'activate-view',
      identity: { documentId: document.documentId, documentRevision: document.revision },
      timestamp: this.options.platform.now(),
      input,
    });
    this.options.onInputQueued?.();
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

  getCursorPoint(): GraphScreenPointV1 | undefined {
    return this.input.getCursorPoint();
  }

  getHoveredNodeId(): string | undefined {
    return this.hoveredNodeId;
  }

  isSelectionPresentationSuspended(): boolean {
    return this.interpreter.isSelectionPresentationSuspended();
  }

  isSelectionNeighborRevealActive(): boolean {
    return this.interpreter.isSelectionNeighborRevealActive();
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
      'elastic-pan-by',
      'orbit-by',
      'zoom-by',
      'center-camera',
      'center-and-fit-camera',
      'reset-camera',
      'fit-camera',
      'direct-attention',
      'reconcile-interaction-state',
      'set-focus',
      'enter-focus',
      'transition-focus',
      'selection-presentation-changed',
      'activate-node',
      'activate-background',
      'activate-view',
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
    switch (command.type) {
      case 'pan-by':
        this.getNavigationState();
        if (this.navigationPeek) this.navigationPeek.navigated = true;
        this.options.ego.clearWill();
        this.options.vision.panByPixels(command.deltaX, command.deltaY);
        this.cameraChanged(command);
        return;
      case 'elastic-pan-by':
        this.options.ego.clearWill();
        this.elasticPan(command.deltaX, command.deltaY);
        this.cameraChanged(command);
        return;
      case 'orbit-by':
        this.options.ego.clearWill();
        this.options.vision.orbitByPixels(
          command.deltaX,
          command.deltaY,
          this.navigationPivot(),
        );
        this.cameraChanged(command);
        return;
      case 'zoom-by':
        this.options.vision.zoomByWheel(command.deltaY, command.anchor, this.navigationPivot());
        this.cameraChanged(command);
        return;
      case 'center-camera':
        this.cancelCameraTransition();
        this.resetVisionInterest();
        this.centerCamera();
        this.cameraChanged(command);
        return;
      case 'center-and-fit-camera':
        this.resetVisionInterest();
        this.fitStateTarget(command.modality);
        this.emitViewportIntent(command);
        return;
      case 'reset-camera':
        this.cancelCameraTransition();
        this.resetVisionInterest();
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
        this.cancelCameraTransition();
        this.resetVisionInterest();
        this.fitVisibleNodes(
          command.centerNodeId !== undefined && command.nodeIds?.length === 1
            ? this.focusNeighborhoodNodeIds(command.centerNodeId)
            : command.nodeIds,
          command.centerNodeId,
        );
        this.emitViewportIntent(command);
        return;
      case 'direct-attention':
        this.setAttention(command.nodeIds, command, command.clearFocus, command.focusNodeId);
        return;
      case 'reconcile-interaction-state':
        this.setInteractionState(
          command.nodeIds,
          command.focusedNodeId,
          command,
          true,
          command.viewMode,
        );
        return;
      case 'set-focus':
        this.setFocus(command.nodeId, command);
        return;
      case 'enter-focus':
        this.focusTransition = undefined;
        this.enterFocus(command.nodeId, command);
        return;
      case 'transition-focus':
        this.transitionFocus(command);
        return;
      case 'selection-presentation-changed':
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
      case 'activate-view':
        this.commitWill(command);
        return;
      case 'activate-background':
        this.commitWill({ ...command, type: 'activate-view', input: this.backgroundInput() });
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
      case 'set-hover': {
        if (this.presentedHoverNodeId !== command.nodeId) {
          this.presentedHoverNodeId = undefined;
          this.presentedHoverPreview = undefined;
        }
        if (this.consumedHoverNodeId !== command.nodeId) {
          this.consumedHoverNodeId = undefined;
          this.consumedHoverPreview = undefined;
        }
        const input = command.input ?? (command.nodeId === undefined ? undefined : {
          phase: 'hover' as const, target: { kind: 'node' as const, nodeId: command.nodeId }, modality: 'mouse' as const,
          modifiers: { ctrl: command.ctrl === true, meta: command.mod && !command.ctrl, shift: false, alt: false },
        });
        const inputChanged = input === undefined || this.hoverInput === undefined
          ? input !== this.hoverInput : !sameEgoInteractionV1(input, this.hoverInput);
        this.hoverInput = input;
        if (input) this.options.ego.resolveWill(input, this.planningContext());
        else this.options.ego.clearWill();
        if (!inputChanged && this.hoveredNodeId === command.nodeId
          && this.hoverMod === command.mod
          && this.hoverCtrl === (command.ctrl === true)
          && samePoint(this.hoverPoint, command.point)) return;
        this.hoveredNodeId = command.nodeId;
        this.hoverMod = command.mod;
        this.hoverCtrl = command.ctrl === true;
        this.hoverPoint = command.point ? { ...command.point } : undefined;
        this.getNavigationState();
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
      }
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
      case 'drag-start': {
        const preview = this.presentedHoverNodeId === command.nodeId
          ? this.presentedHoverPreview
          : undefined;
        this.options.ego.clearWill();
        this.beginNodeDrag(command.nodeId, command.point, preview);
        return;
      }
      case 'drag-update':
        this.updateNodeDrag(command.nodeId, command.point);
        return;
      case 'drag-end':
        this.updateNodeDrag(command.nodeId, command.point);
        this.endNodeDrag(command);
        return;
    }
  }

  private getNavigationState(): EgoInteractionStateV1 {
    const state = this.options.getViewState();
    const committed: EgoInteractionStateV1 = { viewId: resolveGraphUxStateV1(state),
      attentionNodeIds: this.attentionNodeIds(), focusedNodeId: state.focusedNodeId };
    const document = this.options.getDocument();
    const source = JSON.stringify([document.documentId, document.revision, committed]);
    if (this.navigationPeek && this.navigationPeek.source !== source) this.endNavigationPeek(false);
    const preview = this.isHoverPreviewCommitted() ? null : this.resolveCurrentHoverPreview();
    if (preview?.activation !== 'primary' || preview.kind !== 'view-transition') {
      this.endNavigationPeek();
      return committed;
    }
    const returnTarget = this.navigationPeek?.returnTarget ?? this.options.vision.getState().target;
    this.navigationPeek = { preview, state: preview.resultingState, returnTarget: { ...returnTarget }, source,
      navigated: this.navigationPeek?.navigated ?? false };
    return this.navigationPeek.state;
  }

  private endNavigationPeek(restoreTarget = true): void {
    const peek = this.navigationPeek;
    this.navigationPeek = undefined;
    if (!peek) return;
    this.cancelElasticReturn();
    if (restoreTarget && peek.navigated) {
      // Keep user navigation, restoring just the old target coordinate and controls.
      this.options.vision.setTarget(peek.returnTarget, true);
      this.commitCamera();
    }
  }

  /** Node motion follows committed camera interest, independently of the peek pivot. */
  getCameraTrackingNodeIds(): readonly string[] {
    const state = this.options.getViewState();
    const tracking = graphInteractionPolicyV1(state).cameraTracking;
    if (tracking === 'none') return [];
    const intent = this.options.ego.visionIntent;
    if (intent?.kind === 'retain-focal-point') return [];
    if (intent?.kind === 'follow-subject') return [intent.nodeId];
    if (tracking === 'focused-node') return state.focusedNodeId ? [state.focusedNodeId] : [];
    return this.attentionNodeIds().filter((id) => this.options.getRenderSelection().nodeIds.has(id));
  }

  private navigationPivot(): Vec3 | undefined {
    const navigation = this.getNavigationState();
    if (this.navigationPeek) {
      this.navigationPeek.navigated = true;
      return this.options.vision.deriveCentroid(
        navigation.viewId === 'focus' && navigation.focusedNodeId ? [navigation.focusedNodeId] : navigation.attentionNodeIds,
        this.options.getInteractivePositions(),
      );
    }
    if (this.options.ego.visionIntent?.kind === 'retain-focal-point') {
      return this.options.vision.getState().target;
    }
    return this.options.vision.deriveCentroid(
      this.getCameraTrackingNodeIds(),
      this.options.getInteractivePositions(),
    );
  }

  /** Explicit framing actions accept the active View's suggested interest. */
  resetVisionInterest(): void {
    this.getNavigationState();
    if (this.navigationPeek) { this.navigationPeek.navigated = true; return; }
    const state = this.options.getViewState();
    const view = resolveGraphUxStateV1(state);
    this.options.ego.intendVision(view === 'focus' && state.focusedNodeId !== undefined
      ? { kind: 'follow-subject', nodeId: state.focusedNodeId }
      : view === 'explore' ? { kind: 'follow-constellation' } : { kind: 'retain-focal-point' });
  }

  private routeEndogenousCommand(
    command: GraphRuntimeCommandV1,
  ): EgoIntentOutcome<GraphRuntimeCommandV1> {
    if (!this.commandBelongsToActiveDocument(command)) {
      return { status: 'rejected', reason: 'stale-document' };
    }
    const candidate = command;
    if (candidate.type === 'activate-view' || candidate.type === 'activate-background') {
      const input = candidate.type === 'activate-view' ? candidate.input : this.backgroundInput();
      const plan = this.options.ego.resolveWill(input, this.planningContext());
      return plan.outcome === 'rejected' ? { status: 'rejected', reason: plan.reason }
        : { status: plan.outcome, directive: { ...candidate, type: 'activate-view', input, plan } };
    }
    const state = this.options.getViewState();
    return this.options.ego.consider(this.options.ego.intend(command), (intent) => adjudicateGraphExperienceCommandV1({
      command: intent.directive,
      experience: this.options.experience,
      currentState: resolveGraphUxStateV1(state),
      attentionNodeIds: this.attentionNodeIds(),
      focusedNodeId: state.focusedNodeId,
    }));
  }

  private commandBelongsToActiveDocument(command: GraphRuntimeCommandV1): boolean {
    const document = this.options.getDocument();
    return command.identity.documentId === document.documentId
      && command.identity.documentRevision === document.revision;
  }

  private backgroundInput(): EgoInteractionInputV1 {
    return { phase: 'activate', target: { kind: 'background' }, modality: 'keyboard',
      modifiers: { ctrl: false, meta: false, shift: false, alt: false } };
  }

  private planningContext(): EgoInteractionContextV1 {
    const document = this.options.getDocument();
    const state = this.options.getViewState();
    const visible = this.options.getRenderSelection();
    const planning = this.options.getPlanningTopology();
    return {
      identity: { documentId: document.documentId, documentRevision: document.revision },
      planningRevision: planning.revision,
      state: { viewId: resolveGraphUxStateV1(state), attentionNodeIds: this.attentionNodeIds(), focusedNodeId: state.focusedNodeId },
      experience: this.options.experience,
      judgement: this.options.ego.judgement,
      availableNodeIds: planning.availableNodeIds,
      visibleNodeIds: visible.nodeIds, visibleEdgeIds: visible.edgeIds, edges: document.edges,
      topology: planning.topology,
      awarenessNodeIds: this.options.getOverviewConstellationNodeIds(), getConstellation: this.options.getNodeSelection,
      rememberedNodeIds: this.options.getRememberedNodeIds(),
    };
  }

  isHoverPreviewCommitted(): boolean {
    return this.hoverInput?.target.kind === 'node'
      && this.hoverInput.target.nodeId === this.consumedHoverNodeId;
  }

  getObjectActivationPreview(): GraphInteractionPreviewV1 | null {
    // A drag owns an already-admitted snapshot, so gesture suspension must not
    // discard it or ask Ego to plan a replacement.
    if (this.dragContext !== null) return this.dragHoverPreview ?? null;
    if (this.interpreter.isViewProposalSuspended()) {
      this.options.ego.clearWill();
      return this.interpreter.isCameraGestureActive() ? this.navigationPeek?.preview ?? null : null;
    }
    return this.resolveCurrentHoverPreview();
  }

  private resolveCurrentHoverPreview(): GraphInteractionPreviewV1 | null {
    if (!this.hoverInput) return null;
    if (this.hoverInput.target.kind === 'node' && this.hoverInput.target.nodeId === this.consumedHoverNodeId) {
      // Keep presenting the exact state admitted by the click. Replanning here
      // would expose the following action before the pointer begins a new visit.
      const preview = this.consumedHoverPreview ?? null;
      this.presentedHoverNodeId = this.hoverInput.target.nodeId;
      this.presentedHoverPreview = preview ?? undefined;
      return preview;
    }
    const context = this.planningContext();
    const plan = this.options.ego.resolveWill(this.hoverInput, context);
    const preview = presentEgoInteractionPlanV1(plan) ?? null;
    this.presentedHoverNodeId = this.hoverInput.target.kind === 'node' ? this.hoverInput.target.nodeId : undefined;
    this.presentedHoverPreview = preview ?? undefined;
    return preview;
  }

  private commitWill(command: Extract<GraphRuntimeCommandV1, { type: 'activate-view' }>): void {
    const context = this.planningContext();
    const plan = command.plan && isEgoInteractionPlanCurrentV1(command.plan, context)
      && sameEgoInteractionV1(command.plan.input, command.input) ? command.plan : this.options.ego.resolveWill(command.input, context);
    if (plan.outcome === 'rejected' || plan.action === 'none') return;
    // A matching click promotes the peek; other actions cancel its borrowed pivot.
    const commitsPeek = plan.input.target.kind === 'node' && this.hoverInput?.target.kind === 'node'
      && this.hoverInput.target.nodeId === plan.input.target.nodeId;
    const preservePeekCamera = commitsPeek && this.navigationPeek?.navigated === true;
    this.endNavigationPeek(!commitsPeek);
    if (plan.action === 'choose-constellation') {
      this.options.ego.intendVision({ kind: 'follow-constellation' });
    }
    const background = plan.input.target.kind === 'background';
    if (background && plan.before.viewId !== plan.resultingState.viewId) {
      this.cancelElasticReturn();
    }
    if (plan.input.target.kind === 'node') {
      this.consumedHoverNodeId = plan.input.target.nodeId;
      this.consumedHoverPreview = presentEgoInteractionPlanV1(plan);
    }
    const preserveHover = plan.input.target.kind === 'node' && this.hoverInput?.target.kind === 'node'
      && this.hoverInput.target.nodeId === plan.input.target.nodeId;
    this.setInteractionState(plan.resultingState.attentionNodeIds, plan.resultingState.focusedNodeId,
      command, !preserveHover && plan.effects.some((effect) => effect.type === 'clear-presentation'), plan.resultingState.viewId);
    for (const effect of plan.effects) {
      if (effect.type === 'recenter-focus' && !preservePeekCamera) this.recenterFocus(effect.nodeId, command);
    }
    if (background) this.options.onIntent({ ...this.intentBase(command), type: 'background-activated' });
    if (plan.input.target.kind === 'node') {
      this.options.onViewStateChanged('interaction');
    }
    this.options.ego.clearWill();
  }

  private isNodeInteractiveInCurrentState(nodeId: string): boolean {
    const state = this.options.getViewState();
    const viewId = resolveGraphUxStateV1(state);
    const preview = this.getObjectActivationPreview();
    // Only explicit View-entry previews may supply a prospective picking neighborhood.
    const transition = preview?.kind === 'view-transition' ? preview.resultingState : undefined;
    const subject = transition ? transition.focusedNodeId : state.focusedNodeId;
    if ((transition?.viewId ?? viewId) !== 'focus' || !subject) return true;
    return preview?.hoverPathNodeIds.includes(nodeId) === true
      || this.options.getRememberedNodeIds().has(nodeId)
      || ((preview?.addedNodeIds.includes(nodeId) === true || this.attentionNodeIds().includes(nodeId))
        && preview?.removedNodeIds.includes(nodeId) !== true)
      || this.focusNeighborhoodNodeIds(subject).includes(nodeId)
      || (preview?.activation === 'primary' && this.hoveredNodeId !== undefined
        && this.focusNeighborhoodNodeIds(this.hoveredNodeId).includes(nodeId));
  }

  private focusVisibleNodeIds(focusedNodeId: string, attentionNodeIds: readonly string[] = this.attentionNodeIds()): readonly string[] {
    const visible = this.options.getRenderSelection().nodeIds;
    return [...new Set([
      ...attentionNodeIds.filter((id) => visible.has(id)),
      ...[...this.options.getRememberedNodeIds()].filter((id) => visible.has(id)),
      ...this.focusNeighborhoodNodeIds(focusedNodeId),
    ])];
  }

  private focusNeighborhoodNodeIds(focusedNodeId: string): readonly string[] {
    const visible = this.options.getRenderSelection();
    return immediateNeighborhoodFitNodeIdsV1(
      focusedNodeId,
      this.options.getDocument().edges,
      visible.nodeIds,
      visible.edgeIds,
    );
  }

  private fitStateTarget(modality?: 'mouse' | 'touch' | 'pen'): void {
    const navigation = this.getNavigationState();
    if (this.navigationPeek) this.navigationPeek.navigated = true;
    const state = { ...this.options.getViewState(), viewMode: navigation.viewId, focusedNodeId: navigation.focusedNodeId };
    const policy = this.options.experience.framing[navigation.viewId];
    const attentionNodeIds = navigation.attentionNodeIds;
    const targetNodeIds = attentionNodeIds;
    const singleConstellation = resolveGraphUxStateV1(state) === 'explore' && targetNodeIds.length === 1
      && policy.target === 'attention';
    const visible = this.options.getRenderSelection();
    const nodeIds = singleConstellation ? this.focusVisibleNodeIds(targetNodeIds[0], attentionNodeIds)
      : policy.target === 'focused-neighborhood' && state.focusedNodeId
      ? this.focusVisibleNodeIds(state.focusedNodeId, attentionNodeIds)
      : policy.target === 'attention'
        ? targetNodeIds.filter((id) => visible.nodeIds.has(id))
        : [...visible.nodeIds];
    const centerNodeId = policy.center === 'focused-node'
      ? state.focusedNodeId
      : policy.target === 'attention' && targetNodeIds.length === 1
        ? targetNodeIds[0]
        : undefined;
    this.cancelElasticReturn();
    this.fitVisibleNodes(
      nodeIds,
      centerNodeId,
      policy.target === 'focused-neighborhood' || singleConstellation,
      modality,
    );
  }

  private elasticPan(deltaX: number, deltaY: number): void {
    this.getNavigationState();
    if (this.navigationPeek) this.navigationPeek.navigated = true;
    this.options.vision.panByPixels(deltaX * 0.55, deltaY * 0.55);
    const focusedNodeId = this.getNavigationState().focusedNodeId;
    const focusedPosition = focusedNodeId
      ? this.options.getInteractivePositions()[focusedNodeId]
      : undefined;
    if (!focusedPosition) return;
    const target = this.options.vision.getState().target;
    const pull = subtract(focusedPosition, target);
    this.options.vision.translateBy({ x: pull.x * 0.22, y: pull.y * 0.22, z: pull.z * 0.22 });
    this.scheduleElasticReturn();
  }

  private scheduleElasticReturn(): void {
    if (this.elasticReturnTimer !== undefined) return;
    this.elasticReturnTimer = this.options.platform.setTimeout(() => {
      this.elasticReturnTimer = undefined;
      const focusedNodeId = this.getNavigationState().focusedNodeId;
      const focusedPosition = focusedNodeId
        ? this.options.getInteractivePositions()[focusedNodeId]
        : undefined;
      if (!focusedPosition) return;
      const target = this.options.vision.getState().target;
      const pull = subtract(focusedPosition, target);
      const remaining = vectorDistance(focusedPosition, target);
      if (remaining < 0.01) {
        this.options.vision.translateBy(pull);
      } else {
        this.options.vision.translateBy({ x: pull.x * 0.22, y: pull.y * 0.22, z: pull.z * 0.22 });
      }
      this.commitCamera();
      this.options.onViewStateChanged('camera');
      this.options.onInputQueued?.();
      if (remaining >= 0.01) this.scheduleElasticReturn();
    }, 16);
  }

  private enterFocus(nodeId: string, command: GraphRuntimeCommandV1): void {
    if (!this.options.getAttention().nodeIds.has(nodeId)) return;
    const changed = this.options.getViewState().focusedNodeId !== nodeId;
    this.setFocus(nodeId, command);
    if (changed) this.recenterFocus(nodeId, command);
  }

  private transitionFocus(
    command: Extract<GraphRuntimeCommandV1, { type: 'transition-focus' }>,
  ): void {
    if (!this.options.getAttention().nodeIds.has(command.nodeId)) return;
    this.cancelElasticReturn();
    if (!this.focusTransition || this.focusTransition.nodeId !== command.nodeId) {
      const positionsById = this.options.getInteractivePositions();
      const center = positionsById[command.nodeId];
      if (!center) return;
      const targetVision = new Vision(this.options.vision.getState(), this.options.dimensions);
      targetVision.translateBy(subtract(center, targetVision.getState().target));
      this.focusTransition = {
        nodeId: command.nodeId,
        start: this.options.vision.getState(),
        target: targetVision.getState(),
      };
    }
    this.setFocus(command.nodeId, command);
    const progress = smoothStep(clamp01(command.progress));
    this.options.vision.setState(interpolateCamera(
      this.focusTransition.start,
      this.focusTransition.target,
      progress,
    ));
    this.commitCamera();
    this.options.onViewStateChanged('camera');
    this.emitViewportIntent(command);
    if (command.complete) this.focusTransition = undefined;
  }

  cancelCameraTransition(): void {
    this.cancelElasticReturn();
    this.focusTransition = undefined;
  }

  /** Programmatic navigation is realized before its public promise completes. */
  recenterSubject(nodeId: string): void {
    this.cancelElasticReturn();
    const point = this.options.getInteractivePositions()[nodeId];
    if (!point) return;
    this.options.vision.translateBy(subtract(point, this.options.vision.getState().target));
    this.commitCamera();
    this.options.onViewStateChanged('camera');
  }

  private cancelElasticReturn(): void {
    if (this.elasticReturnTimer !== undefined) this.options.platform.clearTimeout(this.elasticReturnTimer);
    this.elasticReturnTimer = undefined;
  }

  private recenterFocus(nodeId: string, command: GraphRuntimeCommandV1): void {
    this.cancelCameraTransition();
    const point = this.options.getInteractivePositions()[nodeId];
    if (!point) return;
    // Ordinary Focus changes commit their framing in the same input frame.
    this.options.vision.translateBy(subtract(point, this.options.vision.getState().target));
    this.cameraChanged(command);
  }

  private cameraChanged(command: GraphRuntimeCommandV1): void {
    this.commitCamera();
    this.options.onViewStateChanged('camera');
    this.emitViewportIntent(command);
  }

  private commitCamera(): void {
    this.commit({ ...this.options.getViewState(), camera: this.options.vision.getState() });
  }

  private fitVisibleNodes(
    nodeIds?: readonly string[],
    centerNodeId?: string,
    squareFrame = false,
    modality?: 'mouse' | 'touch' | 'pen',
  ): number | undefined {
    const positionsById = this.options.getInteractivePositions();
    const candidates = nodeIds ?? [...this.options.getRenderSelection().nodeIds];
    const positions = [...new Set(candidates)]
      .map((id) => positionsById[id])
      .filter(isVec3);
    if (!positions.length) return undefined;
    const center = centerNodeId === undefined
      ? selectionCentroid(candidates, positionsById)
      : positionsById[centerNodeId];
    const maximumProjectedScale = positions.length === 1
      ? singleNodeFitMaxProjectedScale(this.options.vision.getViewport(), modality)
      : undefined;
    this.options.vision.fit(
      positions,
      squareFrame ? FOCUS_FIT_PADDING_PX : 48,
      center,
      0,
      squareFrame ? 'square' : 'viewport',
      maximumProjectedScale,
    );
    this.commitCamera();
    this.options.onViewStateChanged('camera');
    return maximumProjectedScale;
  }

  private centerCamera(): void {
    const navigation = this.getNavigationState();
    if (this.navigationPeek) {
      this.navigationPeek.navigated = true;
      const center = this.options.vision.deriveCentroid(navigation.viewId === 'focus' && navigation.focusedNodeId
        ? [navigation.focusedNodeId] : navigation.attentionNodeIds, this.options.getInteractivePositions());
      if (center) this.options.vision.setTarget(center, true);
      return;
    }
    const positionsById = this.options.getInteractivePositions();
    const candidates = graphInteractionPolicyV1(this.options.getViewState()).cameraTracking === 'none'
      ? [...this.options.getRenderSelection().nodeIds]
      : this.getCameraTrackingNodeIds();
    const centroid = selectionCentroid(candidates, positionsById);
    if (!centroid) return;
    this.options.vision.translateBy(subtract(centroid, this.options.vision.getState().target));
  }

  private setAttention(
    nodeIds: readonly string[],
    command: GraphRuntimeCommandV1,
    clearFocus = false,
    focusNodeId?: string,
  ): void {
    const context = this.planningContext();
    const directive = { ...command, type: 'direct-attention' as const, nodeIds, clearFocus, focusNodeId,
      viewMode: command.type === 'direct-attention' ? command.viewMode : undefined };
    const next = realizeEgoViewDirectiveV1(directive, context.state, context.availableNodeIds, context.experience);
    const focusChanged = next.focusedNodeId !== context.state.focusedNodeId;
    this.setInteractionState(next.attentionNodeIds, next.focusedNodeId, command, focusChanged, next.viewId);
    if (focusChanged && next.focusedNodeId !== undefined) this.recenterFocus(next.focusedNodeId, command);
  }

  private setFocus(nodeId: string | undefined, command: GraphRuntimeCommandV1): void {
    const document = this.options.getDocument();
    if (nodeId !== undefined && !document.nodes.some((node) => node.id === nodeId)) return;
    const currentMode = resolveGraphUxStateV1(this.options.getViewState());
    this.setInteractionState(
      this.attentionNodeIds(),
      nodeId,
      command,
      true,
      nodeId === undefined && currentMode === 'focus' ? 'explore' : nodeId === undefined ? currentMode : 'focus',
    );
  }

  private setInteractionState(
    attentionNodeIds: readonly string[],
    focusedNodeId: string | undefined,
    command: GraphRuntimeCommandV1,
    clearPresentation = false,
    viewMode = focusedNodeId === undefined ? resolveGraphUxStateV1(this.options.getViewState()) : 'focus',
  ): void {
    const state = this.options.getViewState();
    const currentAttentionNodeIds = this.attentionNodeIds();
    const attentionChanged = !sameIds(attentionNodeIds, currentAttentionNodeIds);
    const realizedAttentionNodeIds = attentionChanged
      ? this.options.setAttention(attentionNodeIds)
      : currentAttentionNodeIds;
    const focusChanged = state.focusedNodeId !== focusedNodeId;
    const modeChanged = resolveGraphUxStateV1(state) !== viewMode || state.viewMode !== viewMode;
    const presentationChanged = clearPresentation ? this.clearNodePresentation(command) : false;
    if (!attentionChanged && !focusChanged && !modeChanged && !presentationChanged) return;
    if (attentionChanged || focusChanged || modeChanged) {
      const { focusedNodeId: _focusedNodeId, ...withoutFocus } = this.options.getViewState();
      this.commit(focusedNodeId === undefined
        ? { ...withoutFocus, selectedNodeIds: realizedAttentionNodeIds, viewMode }
        : { ...withoutFocus, selectedNodeIds: realizedAttentionNodeIds, focusedNodeId, viewMode });
    }
    this.options.onViewStateChanged('interaction');
    if (attentionChanged) this.options.onIntent({
      ...this.intentBase(command),
      type: 'selection-changed',
      selectedNodeIds: [...realizedAttentionNodeIds],
    });
    if (focusChanged) this.options.onIntent({
      ...this.intentBase(command),
      type: 'focus-changed',
      ...(focusedNodeId === undefined ? {} : { focusedNodeId }),
    });
  }

  private clearNodePresentation(command: GraphRuntimeCommandV1): boolean {
    this.endNavigationPeek();
    this.cancelPreviewRelease();
    this.consumedHoverNodeId = undefined;
    this.consumedHoverPreview = undefined;
    this.presentedHoverNodeId = undefined;
    this.presentedHoverPreview = undefined;
    this.dragHoverPreview = undefined;
    this.hoverInput = undefined;
    this.options.ego.clearWill();
    const hoverChanged = this.hoveredNodeId !== undefined || this.previewedNodeId !== undefined;
    const previewChanged = this.previewedNodeId !== undefined;
    if (!hoverChanged) return false;
    this.hoveredNodeId = undefined;
    this.previewedNodeId = undefined;
    this.previewPoint = undefined;
    this.previewSurfaceActive = false;
    this.hoverMod = false;
    this.hoverCtrl = false;
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
    return true;
  }

  private beginNodeDrag(
    nodeId: string,
    point: GraphScreenPointV1,
    hoverPreview: GraphInteractionPreviewV1 | undefined,
  ): void {
    if (!this.options.getRenderSelection().nodeIds.has(nodeId)) return;
    if (!canDragGraphNodeV1(nodeId, this.options.getViewState())) return;
    if (!this.options.isNodeDraggable(nodeId)) return;
    const position = this.options.getInteractivePositions()[nodeId];
    if (!position) return;
    const projected = this.options.vision.worldToScreen(position);
    const underPointer = this.options.vision.screenToWorld(point.x, point.y, projected.depth);
    const state = this.options.getViewState();
    const wasPinned = state.pinnedNodeIds.includes(nodeId);
    this.dragContext = {
      nodeId,
      depth: projected.depth,
      offset: subtract(position, underPointer),
      wasPinned,
    };
    this.dragHoverPreview = hoverPreview;
    if (!wasPinned && this.options.getDragConstraintPolicy?.() !== 'transient') {
      this.commit({ ...state, pinnedNodeIds: [...state.pinnedNodeIds, nodeId] });
      this.options.onViewStateChanged('layout');
    }
    this.updateCursor();
  }

  private updateNodeDrag(nodeId: string, point: GraphScreenPointV1): void {
    if (!this.dragContext || this.dragContext.nodeId !== nodeId) return;
    const state = this.options.getViewState();
    const trackingNodeIds = this.getCameraTrackingNodeIds();
    const underPointer = this.options.vision.screenToWorld(point.x, point.y, this.dragContext.depth);
    const position = add(underPointer, this.dragContext.offset);
    const previousCentroid = selectionCentroid(trackingNodeIds, state.positions);
    const positions = { ...state.positions, [nodeId]: position };
    const nextCentroid = selectionCentroid(trackingNodeIds, positions);
    this.commit({ ...state, positions });
    if (previousCentroid && nextCentroid) {
      this.options.vision.translateBy(subtract(nextCentroid, previousCentroid));
    }
    this.commitCamera();
    this.options.onViewStateChanged('positions');
  }

  private endNodeDrag(command: Extract<GraphRuntimeCommandV1, { type: 'drag-end' }>): void {
    if (!this.dragContext || this.dragContext.nodeId !== command.nodeId) return;
    const position = this.options.getViewState().positions[command.nodeId];
    const wasPinned = this.dragContext.wasPinned;
    this.dragContext = null;
    this.dragHoverPreview = undefined;
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
    this.options.surface.setCursor(this.dragContext || this.interpreter.isCameraGestureActive()
      ? 'grabbing'
      : this.previewedNodeId ?? this.hoveredNodeId
        ? 'pointer'
        : 'default');
  }

  private resetTransientState(): void {
    this.endNavigationPeek();
    this.consumedHoverNodeId = undefined;
    this.consumedHoverPreview = undefined;
    this.presentedHoverNodeId = undefined;
    this.presentedHoverPreview = undefined;
    this.dragHoverPreview = undefined;
    this.hoverInput = undefined;
    this.options.ego.clearWill();
    this.cancelPreviewRelease();
    if (this.elasticReturnTimer !== undefined) this.options.platform.clearTimeout(this.elasticReturnTimer);
    this.elasticReturnTimer = undefined;
    this.focusTransition = undefined;
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
    this.hoverCtrl = false;
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
      camera: this.options.vision.getState(),
    });
  }

  private attentionNodeIds(): string[] {
    return [...this.options.getAttention().nodeIds];
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

function vectorDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function interpolateCamera(
  start: GraphCameraStateV1,
  target: GraphCameraStateV1,
  progress: number,
): GraphCameraStateV1 {
  return {
    position: interpolateVector(start.position, target.position, progress),
    target: interpolateVector(start.target, target.target, progress),
    up: normalizeVector(interpolateVector(start.up, target.up, progress)),
    zoom: start.zoom + (target.zoom - start.zoom) * progress,
    projection: start.projection,
  };
}

function interpolateVector(start: Vec3, target: Vec3, progress: number): Vec3 {
  return {
    x: start.x + (target.x - start.x) * progress,
    y: start.y + (target.y - start.y) * progress,
    z: start.z + (target.z - start.z) * progress,
  };
}

function normalizeVector(value: Vec3): Vec3 {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  return magnitude > 0
    ? { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
    : { x: 0, y: 1, z: 0 };
}

function selectionCentroid(
  selectedNodeIds: readonly string[],
  positions: Readonly<Record<string, Vec3>>,
): Vec3 | undefined {
  const selectedPositions = selectedNodeIds.flatMap((nodeId) => {
    const position = positions[nodeId];
    return position ? [position] : [];
  });
  if (!selectedPositions.length) return undefined;
  const total = selectedPositions.reduce((sum, position) => add(sum, position), { x: 0, y: 0, z: 0 });
  return { x: total.x / selectedPositions.length, y: total.y / selectedPositions.length, z: total.z / selectedPositions.length };
}
