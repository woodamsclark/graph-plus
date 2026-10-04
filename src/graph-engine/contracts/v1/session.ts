import type { GraphActiveViewV1, GraphViewIdV1, GraphViewUiStateV1 } from './view.ts';
import type { GraphDocumentV1 } from './document.ts';
import type { GraphExperienceContractV1 } from './experience.ts';
import type { GraphFilterRequestV1, GraphFilterScopeV1 } from './filter.ts';
import type { ApplyGraphPatchResultV1, GraphPatchV1 } from './patch.ts';
import type { GraphEffectiveSettingsV1, GraphSettingsOverridesV1 } from './profile.ts';
import type { GraphCameraStateV1, GraphViewStateV1, GraphWorldStateV1 } from './view-state.ts';
import type { Disposable, Vec3 } from './values.ts';
import type { GraphSessionUiOptionsV1 } from './ui.ts';

export interface GraphSessionOptionsV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly document: GraphDocumentV1;
  /** Optional host-neutral experience constraints; defaults to the unrestricted engine experience. */
  readonly experience?: GraphExperienceContractV1;
  readonly restoreViewState?: GraphViewStateV1;
  readonly sessionOverrides?: GraphSettingsOverridesV1;
  readonly ui?: GraphSessionUiOptionsV1;
  /** Only one surface attached to a shared application world should advance layout. */
  readonly layoutAuthority?: boolean;
  readonly onSessionOverridesChanged?: (
    overrides: GraphSettingsOverridesV1,
  ) => void | Promise<void>;
}

export interface GraphSessionV1 {
  readonly sessionId: string;
  readonly engineInstanceId: string;

  replaceDocument(document: GraphDocumentV1): Promise<void>;
  applyPatch(patch: GraphPatchV1): Promise<ApplyGraphPatchResultV1>;
  exportDocument(): Promise<GraphDocumentV1>;

  applyFilter(filter: GraphFilterRequestV1): Promise<void>;
  clearFilter(scope?: GraphFilterScopeV1): Promise<void>;

  getActiveView(): GraphActiveViewV1;
  getAvailableViews(): readonly GraphViewIdV1[];
  /** State installation for consumers; interactive controls use the Ego control port. */
  setView(viewId: GraphViewIdV1): Promise<void>;
  getViewUiState(viewId: GraphViewIdV1): GraphViewUiStateV1 | undefined;
  setViewUiState(viewId: GraphViewIdV1, state: GraphViewUiStateV1): void;

  /** Compatibility state setters; do not represent user intentions or emit their observations. */
  setSelection(nodeIds: readonly string[]): Promise<void>;
  focusNode(nodeId: string | null): Promise<void>;
  /** Apply host-translated truth without representing it as endogenous Ego intent. */
  applyExternalInfluence(
    influence: GraphExternalInfluenceV1,
  ): Promise<GraphExternalInfluenceResultV1>;
  /** Retain semantic preview while the pointer is inside a consumer preview surface. */
  setPreviewSurfaceActive(active: boolean): Promise<void>;
  /** Dismiss transient semantic preview without changing hover, focus, or selection. */
  clearPreview(): Promise<void>;
  setNodePinned(nodeId: string, pinned: boolean): Promise<void>;
  fitNodes(nodeIds?: readonly string[], options?: FitNodesOptionsV1): Promise<void>;
  resetCamera(options?: TransitionOptionsV1): Promise<void>;
  exportViewState(): Promise<GraphViewStateV1>;
  restoreViewState(state: GraphViewStateV1): Promise<void>;
  /** World layout is independent from this surface's camera, filters, and conscious View state. */
  exportWorldState(): Promise<GraphWorldStateV1>;
  applyWorldState(state: GraphWorldStateV1): Promise<void>;
  setLayoutAuthority(authority: boolean): void;

  setSessionOverrides(overrides: GraphSettingsOverridesV1): Promise<void>;
  exportEffectiveSettings(): Promise<GraphEffectiveSettingsV1>;
  exportPerformanceSnapshot(): Promise<GraphPerformanceSnapshotV1>;
  resetPerformanceMeasurements(): Promise<void>;

  onViewChanged(listener: (view: GraphActiveViewV1) => void): Disposable;
  onIntent(listener: (intent: GraphIntentV1) => void): Disposable;
  onGraphChanged(listener: (event: GraphChangedEventV1) => void): Disposable;
  onWorldChanged(listener: (event: GraphWorldChangedEventV1) => void): Disposable;
  onError(listener: (error: GraphSessionErrorV1) => void): Disposable;

  setSuspended(suspended: boolean): void;
  dispose(): Promise<void>;
}

export interface GraphWorldChangedEventV1 {
  readonly sessionId: string;
  readonly cause: 'layout' | 'interaction' | 'pin' | 'document' | 'restore';
  readonly state: GraphWorldStateV1;
}

export interface GraphReplaceAttentionExternalInfluenceV1 {
  readonly schemaVersion: 1;
  readonly type: 'replace-attention';
  readonly nodeIds: readonly string[];
  readonly focusNodeId?: string;
  readonly framing?: 'preserve' | 'fit-state' | 'recenter-focus';
}

export interface GraphReplaceRememberedSubjectsExternalInfluenceV1 {
  readonly schemaVersion: 1;
  readonly type: 'replace-remembered-subjects';
  readonly nodeIds: readonly string[];
}

export type GraphExternalInfluenceV1 =
  | GraphReplaceAttentionExternalInfluenceV1
  | GraphReplaceRememberedSubjectsExternalInfluenceV1;

export type GraphExternalInfluenceResultV1 =
  | {
      readonly status: 'accepted' | 'adjusted';
      readonly attentionNodeIds: readonly string[];
      readonly focusedNodeId?: string;
    }
  | {
      readonly status: 'accepted' | 'adjusted';
      readonly rememberedNodeIds: readonly string[];
    }
  | { readonly status: 'rejected'; readonly reason: string };

export interface GraphFramePerformanceV1 {
  readonly interactionMs: number;
  readonly hitTestMs: number;
  readonly moduleTickMs: number;
  readonly compositionMs: number;
  readonly projectionMs: number;
  readonly regionRenderMs?: number;
  readonly edgeRenderMs: number;
  readonly nodeRenderMs: number;
  readonly labelLayoutMs: number;
  readonly labelDrawMs: number;
  readonly totalMs: number;
}

export interface GraphPerformanceSnapshotV1 {
  readonly frameCount: number;
  readonly latestFrame: GraphFramePerformanceV1;
  readonly window?: GraphPerformanceWindowV1;
  readonly counters?: GraphPerformanceCountersV1;
}

export interface GraphPerformanceDistributionV1 {
  readonly sampleCount: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export type GraphPerformanceWindowV1 = Readonly<Record<keyof GraphFramePerformanceV1, GraphPerformanceDistributionV1>>;

export interface GraphPerformanceCountersV1 {
  readonly documentExports: number;
  readonly viewExports: number;
  readonly projectionPasses: number;
  readonly hitTests: number;
  readonly moduleTicks: number;
  readonly frameCompositions: number;
  readonly renderedFrames: number;
  readonly scheduledFrames: number;
}

export interface TransitionOptionsV1 {
  readonly animate?: boolean;
  readonly durationMs?: number;
  readonly signal?: AbortSignal;
}

export interface FitNodesOptionsV1 extends TransitionOptionsV1 {
  /** Keep this node at the viewport center while sizing the camera for all fitted nodes. */
  readonly centerNodeId?: string;
  /** Reserve at least this much world-space radius around the fit center. */
  readonly minimumRadius?: number;
}

export type GraphIntentV1 =
  | GraphNodeActivatedIntentV1
  | GraphSelectionChangedIntentV1
  | GraphFocusChangedIntentV1
  | GraphBackgroundActivatedIntentV1
  | GraphNodeDragEndedIntentV1
  | GraphNodeContextRequestedIntentV1
  | GraphNodeHoverChangedIntentV1
  | GraphPreviewChangedIntentV1
  | GraphCameraResetIntentV1
  | GraphViewportChangedIntentV1;

export interface GraphIntentBaseV1 {
  readonly sessionId: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly timestamp: number;
}

export interface GraphNodeActivatedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'node-activated';
  readonly nodeId: string;
  readonly activation: 'primary' | 'secondary' | 'keyboard';
}

export interface GraphSelectionChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'selection-changed';
  readonly selectedNodeIds: readonly string[];
}

export interface GraphFocusChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'focus-changed';
  readonly focusedNodeId?: string;
}

export interface GraphBackgroundActivatedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'background-activated';
}

export interface GraphNodeDragEndedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'node-drag-ended';
  readonly nodeId: string;
  readonly position: Vec3;
}

export interface GraphNodeContextRequestedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'node-context-requested';
  readonly nodeId: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly modality: 'mouse' | 'touch' | 'pen';
}

export interface GraphNodeHoverChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'node-hover-changed';
  readonly nodeId?: string;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly mod: boolean;
}

export interface GraphPreviewChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'preview-changed';
  /** Target eligibility ended; allow bounded pointer handoff before final dismissal. */
  readonly closing?: boolean;
  readonly nodeId?: string;
  readonly anchor?: { readonly x: number; readonly y: number };
}

export interface GraphCameraResetIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'camera-reset';
  readonly focusedNodeId?: string;
}

export interface GraphViewportChangedIntentV1 extends GraphIntentBaseV1 {
  readonly type: 'viewport-changed';
  readonly camera: GraphCameraStateV1;
}

export interface GraphChangedEventV1 {
  readonly sessionId: string;
  readonly documentId: string;
  readonly previousRevision: number;
  readonly revision: number;
  readonly patch?: GraphPatchV1;
  readonly cause: 'patch' | 'replace-document';
}

export interface GraphSessionErrorV1 {
  readonly code:
    | 'invalid-document'
    | 'stale-revision'
    | 'module-failed'
    | 'consumer-action-failed'
    | 'required-module-failed'
    | 'session-disposed'
    | 'engine-unavailable'
    | 'incompatible-view-state';
  readonly message: string;
  readonly moduleId?: string;
  readonly actionId?: string;
  readonly recoverable: boolean;
}
