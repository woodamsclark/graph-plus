import type { GraphDocumentV1 } from './document.ts';
import type { GraphFilterRequestV1, GraphFilterScopeV1 } from './filter.ts';
import type { ApplyGraphPatchResultV1, GraphPatchV1 } from './patch.ts';
import type { GraphCameraStateV1, GraphViewStateV1 } from './view-state.ts';
import type { Disposable, JsonValue, Vec3 } from './values.ts';

export interface GraphSessionOptionsV1 {
  readonly consumerId: string;
  readonly profileId: string;
  readonly container: HTMLElement;
  readonly document: GraphDocumentV1;
  readonly restoreViewState?: GraphViewStateV1;
  readonly sessionOverrides?: Readonly<Record<string, JsonValue>>;
}

export interface GraphSessionV1 {
  readonly sessionId: string;
  readonly engineInstanceId: string;

  replaceDocument(document: GraphDocumentV1): Promise<void>;
  applyPatch(patch: GraphPatchV1): Promise<ApplyGraphPatchResultV1>;
  exportDocument(): Promise<GraphDocumentV1>;

  applyFilter(filter: GraphFilterRequestV1): Promise<void>;
  clearFilter(scope?: GraphFilterScopeV1): Promise<void>;

  setSelection(nodeIds: readonly string[]): Promise<void>;
  focusNode(nodeId: string | null): Promise<void>;
  fitNodes(nodeIds?: readonly string[], options?: TransitionOptionsV1): Promise<void>;
  resetCamera(options?: TransitionOptionsV1): Promise<void>;

  exportViewState(): Promise<GraphViewStateV1>;
  restoreViewState(state: GraphViewStateV1): Promise<void>;

  onIntent(listener: (intent: GraphIntentV1) => void): Disposable;
  onGraphChanged(listener: (event: GraphChangedEventV1) => void): Disposable;
  onError(listener: (error: GraphSessionErrorV1) => void): Disposable;

  setSuspended(suspended: boolean): void;
  dispose(): Promise<void>;
}

export interface TransitionOptionsV1 {
  readonly animate?: boolean;
  readonly durationMs?: number;
  readonly signal?: AbortSignal;
}

export type GraphIntentV1 =
  | GraphNodeActivatedIntentV1
  | GraphSelectionChangedIntentV1
  | GraphFocusChangedIntentV1
  | GraphBackgroundActivatedIntentV1
  | GraphNodeDragEndedIntentV1
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
    | 'required-module-failed'
    | 'session-disposed'
    | 'engine-unavailable'
    | 'incompatible-view-state';
  readonly message: string;
  readonly moduleId?: string;
  readonly recoverable: boolean;
}
