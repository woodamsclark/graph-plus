import type { GraphEdgeV1, GraphNodeV1 } from './document.ts';

export interface GraphPatchV1 {
  readonly schemaVersion: 1;
  readonly patchId: string;
  readonly baseRevision: number;
  readonly operations: readonly GraphPatchOperationV1[];
}

export type GraphPatchOperationV1 =
  | { readonly type: 'add-node'; readonly node: GraphNodeV1 }
  | { readonly type: 'replace-node'; readonly node: GraphNodeV1 }
  | {
      readonly type: 'remove-node';
      readonly nodeId: string;
      readonly removeIncidentEdges: boolean;
    }
  | { readonly type: 'add-edge'; readonly edge: GraphEdgeV1 }
  | { readonly type: 'replace-edge'; readonly edge: GraphEdgeV1 }
  | { readonly type: 'remove-edge'; readonly edgeId: string };

export type ApplyGraphPatchResultV1 =
  | {
      readonly applied: true;
      readonly previousRevision: number;
      readonly revision: number;
      readonly patchId: string;
    }
  | {
      readonly applied: false;
      readonly revision: number;
      readonly patchId: string;
      readonly error: GraphPatchErrorV1;
    };

export interface GraphPatchErrorV1 {
  readonly code:
    | 'stale-revision'
    | 'duplicate-id'
    | 'missing-node'
    | 'missing-edge'
    | 'dangling-edge'
    | 'invalid-value'
    | 'invalid-operation';
  readonly message: string;
  readonly operationIndex?: number;
}
