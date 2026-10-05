import type { GraphInteractionPreviewV1 } from '../anima/AnimaInteractionPreview.ts';
import type {
  EngineModuleDescriptorV1,
  EngineModulePolicyV1,
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphExperienceContractV1,
  GraphViewStateV1,
  JsonValue,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import type { AnimusEdgeRoleV1, AnimusNodeRoleV1, AnimusRegionV1 } from '../animus/index.ts';
import type { ConsciousnessSnapshot } from '../consciousness/index.ts';
import type {
  GraphEdgeRenderContributionV1,
  GraphNodeRenderContributionV1,
  GraphPresentationPolicyV2,
  GraphRegionRenderContributionV1,
} from '../render/index.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';

export type GraphModuleHookV1 =
  | 'setup'
  | 'restore-state'
  | 'settings-changed'
  | 'document-changed'
  | 'view-changed'
  | 'theme-changed'
  | 'project-source'
  | 'project-topology'
  | 'select-render'
  | 'tick'
  | 'contribute-frame'
  | 'choreograph'
  | 'export-state'
  | 'suspend'
  | 'dispose';

export interface GraphModuleFailureV1 {
  readonly moduleId: string;
  readonly policy: EngineModulePolicyV1;
  readonly hook: GraphModuleHookV1;
  readonly error: unknown;
}

export interface GraphModulePipelineStateV1 {
  readonly sourceDocument: GraphDocumentV1;
  readonly document: GraphDocumentV1;
  readonly viewState: GraphViewStateV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly projectionSelection: GraphFilterSelectionV1;
  readonly renderSelection: GraphFilterSelectionV1;
  readonly formActive: boolean;
  /** Presentation-scoped Attention and Awareness, installed for frame composition. */
  readonly consciousness?: ConsciousnessSnapshot;
  /** Admission policy for noncommitting previews of View interactions. */
  readonly experience?: GraphExperienceContractV1;
  readonly objectActivationPreview?: GraphInteractionPreviewV1 | null;
  /** Runtime-only interaction state. It is never persisted or exported as graph data. */
  readonly draggedNodeId?: string;
  /** Transient per-step cursor displacement, resolved in screen space by the session. */
  readonly cursorAttractionSteps?: Readonly<Record<string, Vec3>>;
  /** Runtime-only hover state supplied to presentation modules. */
  readonly hoveredNodeId?: string;
  /** Runtime-only held-key dimming suspension; durable selection remains unchanged. */
  readonly selectionPresentationSuspended?: boolean;
  /** Runtime-only Ctrl reveal of direct neighbors for the current selection. */
  readonly selectionNeighborRevealActive?: boolean;
  /** Runtime-only semantic preview state supplied independently from pointer hover. */
  readonly previewedNodeId?: string;
  readonly nodeRoles: Readonly<Record<string, AnimusNodeRoleV1>>;
  readonly edgeRoles: Readonly<Record<string, AnimusEdgeRoleV1>>;
  readonly regions: readonly AnimusRegionV1[];
  readonly nodeContributions: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionLayouts: readonly GraphNodeRegionLayoutV1[];
  readonly regionContributions: readonly GraphRegionRenderContributionV1[];
  readonly theme: GraphVisualThemeV2;
  readonly presentationPolicy?: GraphPresentationPolicyV2;
  /** Declarative Anima/layout/camera targets; mechanisms remain owned by their runtimes. */
  readonly motionTargets?: GraphMotionTargetsV1;
  /** Internal signal that a derived position set should become the session's editable position state. */
  readonly commitPositions?: boolean;
}

/** Structural input visible before Consciousness reconciliation or Anima styling. */
export type GraphModuleProjectionStateV1 = Pick<GraphModulePipelineStateV1,
  | 'sourceDocument'
  | 'document'
  | 'viewState'
  | 'positions'
  | 'projectionSelection'
  | 'renderSelection'
  | 'formActive'
  | 'nodeRoles'
  | 'edgeRoles'
  | 'regions'
  | 'regionLayouts'
  | 'commitPositions'
>;

/** Downstream frame input after projection and Consciousness reconciliation. */
export type GraphModulePresentationStateV1 = GraphModulePipelineStateV1 & {
  readonly consciousness: ConsciousnessSnapshot;
};

export interface GraphModuleProjectionPatchV1 {
  readonly document?: GraphDocumentV1;
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly projectionSelection?: GraphFilterSelectionV1;
  readonly renderSelection?: GraphFilterSelectionV1;
  readonly formActive?: boolean;
  readonly nodeRoles?: Readonly<Record<string, AnimusNodeRoleV1>>;
  readonly edgeRoles?: Readonly<Record<string, AnimusEdgeRoleV1>>;
  readonly regions?: readonly AnimusRegionV1[];
  readonly regionLayouts?: readonly GraphNodeRegionLayoutV1[];
  readonly commitPositions?: boolean;
}

export interface GraphModulePresentationPatchV1 {
  readonly nodeContributions?: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions?: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionContributions?: readonly GraphRegionRenderContributionV1[];
  readonly theme?: GraphVisualThemeV2;
  readonly presentationPolicy?: GraphPresentationPolicyV2;
}

export interface GraphModuleChoreographyPatchV1 {
  readonly motionTargets?: GraphMotionTargetsV1;
}

export interface GraphNodeRegionLayoutV1 {
  readonly regionNodeId: string;
  readonly directMemberNodeIds: readonly string[];
  readonly membershipStrength: number;
  readonly membershipDistance: number;
}

export interface GraphModuleTickResultV1 {
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly camera?: import('../../contracts/v1/index.ts').GraphCameraStateV1;
  /** Keeps the session awake for another eligible pipeline frame. */
  readonly requestNextFrame?: boolean;
  /** Optional minimum delay before continuous module work needs another frame. */
  readonly nextFrameDelayMs?: number;
}

export interface GraphMotionTargetsV1 {
  readonly nodePositions?: Readonly<Record<string, Vec3>>;
  readonly nodePositionOffsets?: Readonly<Record<string, Vec3>>;
  readonly nodePositionStrength?: number;
  readonly edgeLengths?: Readonly<Record<string, number>>;
  readonly linkLengthScale?: number;
  readonly edgeStrengthScales?: Readonly<Record<string, number>>;
  readonly linkStrengthScale?: number;
  readonly camera?: import('../../contracts/v1/index.ts').GraphCameraStateV1;
}

export interface GraphModuleFactoryContextV1 {
  readonly sessionId: string;
  readonly dimensions: GraphDimensionsV1;
  readonly settings: Readonly<Record<string, JsonValue>>;
  readonly profileSettings: Readonly<Record<string, JsonValue>>;
  readonly themePalette: GraphVisualThemeV2;
  readonly getDocument: () => GraphDocumentV1;
  readonly getViewState: () => GraphViewStateV1;
}

export interface GraphModuleInstanceV1 {
  setup?(): void;
  updateSettings?(settings: Readonly<Record<string, JsonValue>>): void;
  updateProfileSettings?(settings: Readonly<Record<string, JsonValue>>): void;
  restoreState?(state: JsonValue): void;
  onDocumentChanged?(document: GraphDocumentV1): void;
  onViewChanged?(state: GraphViewStateV1): void;
  onThemeChanged?(theme: GraphVisualThemeV2): void;
  projectSource?(state: GraphModuleProjectionStateV1): GraphModuleProjectionPatchV1 | void;
  projectTopology?(state: GraphModuleProjectionStateV1): GraphModuleProjectionPatchV1 | void;
  selectRender?(state: GraphModuleProjectionStateV1): GraphModuleProjectionPatchV1 | void;
  choreograph?(state: GraphModulePipelineStateV1): GraphModuleChoreographyPatchV1 | void;
  /** `null` means idle; a number throttles continuous ticks; `undefined` is unthrottled. */
  preferredTickIntervalMs?(state: GraphModulePipelineStateV1): number | null | undefined;
  tick?(state: GraphModulePipelineStateV1, deltaSeconds: number): GraphModuleTickResultV1 | void;
  contributeFrame?(state: GraphModulePresentationStateV1): GraphModulePresentationPatchV1 | void;
  exportState?(): JsonValue;
  /** Compact, read-only runtime evidence for lifecycle and performance diagnosis. */
  getDiagnostics?(): unknown;
  setSuspended?(suspended: boolean): void;
  dispose?(): void;
}

export interface GraphModuleDefinitionV1 {
  readonly descriptor: EngineModuleDescriptorV1;
  readonly order: number;
  readonly create: (context: GraphModuleFactoryContextV1) => GraphModuleInstanceV1;
}

export interface ActiveGraphModuleV1 {
  readonly id: string;
  readonly policy: EngineModulePolicyV1;
  readonly order: number;
  readonly definition: GraphModuleDefinitionV1;
  readonly instance: GraphModuleInstanceV1;
  readonly settings: Readonly<Record<string, JsonValue>>;
}
