import type { GraphFilterRequestV1, GraphFilterScopeV1 } from './filter.ts';
import type { JsonValue, Vec3 } from './values.ts';

export type GraphDimensionsV1 = '2d' | '3d';
export type GraphViewModeV1 = 'overview' | 'explore' | 'focus';

export interface GraphCameraStateV1 {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly zoom: number;
  readonly projection: 'orthographic' | 'perspective';
}

export interface GraphViewStateV1 {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly consumerId: string;
  readonly profileId: string;
  readonly dimensions: GraphDimensionsV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly pinnedNodeIds: readonly string[];
  readonly camera: GraphCameraStateV1;
  readonly selectedNodeIds: readonly string[];
  /** Explicit visual mode; omitted states retain the legacy selection-derived interpretation. */
  readonly viewMode?: GraphViewModeV1;
  readonly focusedNodeId?: string;
  readonly activeFilters: Partial<Readonly<Record<GraphFilterScopeV1, GraphFilterRequestV1>>>;
  readonly moduleState: Readonly<Record<string, JsonValue>>;
}

/** Application-world geometry shared by any number of independent viewport sessions. */
export interface GraphWorldStateV1 {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly dimensions: GraphDimensionsV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly pinnedNodeIds: readonly string[];
  /** State owned by modules that advance shared world layout, never viewport modules. */
  readonly layoutModuleState: Readonly<Record<string, JsonValue>>;
}
