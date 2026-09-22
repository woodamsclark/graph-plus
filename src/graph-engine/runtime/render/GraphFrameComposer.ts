import type { GraphDocumentV1, GraphViewStateV1, Vec3 } from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import { compileAnimaSceneV1 } from '../anima/AnimaSceneCompiler.ts';
import { createAnimusSnapshotV1 } from '../animus/AnimusSnapshot.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';
import type {
  GraphEdgeRenderContributionV1,
  GraphNodeRenderContributionV1,
  GraphPresentationPolicyV2,
  GraphRegionRenderContributionV1,
  GraphRenderFrameV1,
} from './GraphRenderTypes.ts';

/**
 * @deprecated Compatibility wrapper. New runtime composition must cross the explicit
 * Animus snapshot -> Anima scene compiler boundary.
 */
export function composeGraphRenderFrameV1(options: {
  readonly document: GraphDocumentV1;
  readonly viewState: GraphViewStateV1;
  readonly selection: GraphFilterSelectionV1;
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly nodeContributions?: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions?: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionContributions?: readonly GraphRegionRenderContributionV1[];
  readonly theme?: GraphVisualThemeV2;
  readonly presentationPolicy?: GraphPresentationPolicyV2;
  readonly hoveredNodeId?: string;
  readonly geometryRevision?: number;
}): GraphRenderFrameV1 {
  return compileAnimaSceneV1({
    snapshot: createAnimusSnapshotV1({
      document: options.document,
      viewState: options.viewState,
      displaySelection: options.selection,
      positions: options.positions ?? options.viewState.positions,
      hoveredNodeId: options.hoveredNodeId,
    }),
    nodeContributions: options.nodeContributions,
    edgeContributions: options.edgeContributions,
    regionContributions: options.regionContributions,
    theme: options.theme,
    presentationPolicy: options.presentationPolicy,
    geometryRevision: options.geometryRevision,
  });
}
