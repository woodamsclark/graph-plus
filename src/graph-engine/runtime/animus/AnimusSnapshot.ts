import type {
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphViewStateV1,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../core/filter/index.ts';
import {
  createGraphInteractionContextV1,
  type GraphInteractionContextV1,
} from '../interaction/GraphInteractionStatePolicy.ts';
import type { AnimusEdgeRoleV1, AnimusNodeRoleV1, AnimusRegionV1 } from './AnimusRoles.ts';

/**
 * The immutable semantic handoff from Animus to Anima.
 *
 * It deliberately contains graph facts and runtime state, but no colors, opacity,
 * strokes, fonts, or other renderer-facing presentation values.
 */
export interface AnimusSnapshotV1 {
  readonly document: GraphDocumentV1;
  readonly displaySelection: GraphFilterSelectionV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly nodeRoles: Readonly<Record<string, AnimusNodeRoleV1>>;
  readonly edgeRoles: Readonly<Record<string, AnimusEdgeRoleV1>>;
  readonly regions: readonly AnimusRegionV1[];
  readonly interaction: GraphInteractionContextV1;
  readonly view: AnimusViewSnapshotV1;
}

export type AnimusInteractionSnapshotV1 = GraphInteractionContextV1;

export interface AnimusViewSnapshotV1 {
  readonly dimensions: GraphDimensionsV1;
  readonly camera: GraphViewStateV1['camera'];
}

export function createAnimusSnapshotV1(options: {
  readonly document: GraphDocumentV1;
  readonly viewState: GraphViewStateV1;
  readonly displaySelection: GraphFilterSelectionV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly nodeRoles?: Readonly<Record<string, AnimusNodeRoleV1>>;
  readonly edgeRoles?: Readonly<Record<string, AnimusEdgeRoleV1>>;
  readonly regions?: readonly AnimusRegionV1[];
  readonly hoveredNodeId?: string;
  readonly draggedNodeId?: string;
  readonly previewedNodeId?: string;
  readonly selectionPresentationSuspended?: boolean;
  readonly selectionNeighborRevealActive?: boolean;
}): AnimusSnapshotV1 {
  const interaction = createGraphInteractionContextV1(options);
  return {
    document: options.document,
    displaySelection: options.displaySelection,
    positions: options.positions,
    nodeRoles: options.nodeRoles ?? {},
    edgeRoles: options.edgeRoles ?? {},
    regions: options.regions ?? [],
    interaction,
    view: {
      dimensions: options.viewState.dimensions,
      camera: options.viewState.camera,
    },
  };
}
