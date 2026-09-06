import type {
  EngineModuleDescriptorV1,
  EngineModulePolicyV1,
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphViewStateV1,
  JsonValue,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import type {
  GraphEdgeRenderContributionV1,
  GraphNodeRenderContributionV1,
  GraphRenderRegionV1,
  GraphRenderThemeV1,
} from '../render/index.ts';

export type GraphModuleHookV1 =
  | 'setup'
  | 'restore-state'
  | 'settings-changed'
  | 'document-changed'
  | 'view-changed'
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
  /** Runtime-only interaction state. It is never persisted or exported as graph data. */
  readonly draggedNodeId?: string;
  /** Runtime-only hover state supplied to presentation modules. */
  readonly hoveredNodeId?: string;
  readonly nodeContributions: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionLayouts: readonly GraphNodeRegionLayoutV1[];
  readonly regionContributions: readonly GraphRenderRegionV1[];
  readonly theme: GraphRenderThemeV1;
  /** Declarative Anima/layout/camera targets; mechanisms remain owned by their runtimes. */
  readonly motionTargets?: GraphMotionTargetsV1;
  /** Internal signal that a derived position set should become the session's editable position state. */
  readonly commitPositions?: boolean;
}

export interface GraphModuleProjectionPatchV1 {
  readonly document?: GraphDocumentV1;
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly projectionSelection?: GraphFilterSelectionV1;
  readonly renderSelection?: GraphFilterSelectionV1;
  readonly formActive?: boolean;
  readonly nodeContributions?: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions?: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionLayouts?: readonly GraphNodeRegionLayoutV1[];
  readonly regionContributions?: readonly GraphRenderRegionV1[];
  readonly theme?: GraphRenderThemeV1;
  readonly motionTargets?: GraphMotionTargetsV1;
  readonly commitPositions?: boolean;
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
  readonly themePalette: GraphRenderThemeV1;
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
  projectSource?(state: GraphModulePipelineStateV1): GraphModuleProjectionPatchV1 | void;
  projectTopology?(state: GraphModulePipelineStateV1): GraphModuleProjectionPatchV1 | void;
  selectRender?(state: GraphModulePipelineStateV1): GraphModuleProjectionPatchV1 | void;
  choreograph?(state: GraphModulePipelineStateV1): GraphModuleProjectionPatchV1 | void;
  tick?(state: GraphModulePipelineStateV1, deltaSeconds: number): GraphModuleTickResultV1 | void;
  contributeFrame?(state: GraphModulePipelineStateV1): GraphModuleProjectionPatchV1 | void;
  exportState?(): JsonValue;
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
