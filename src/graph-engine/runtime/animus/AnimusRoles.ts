export interface AnimusNodeRoleV1 {
  readonly form?: {
    readonly kind: 'root' | 'branch' | 'leaf' | 'disconnected';
    readonly depth: number;
    readonly branchId?: string;
    readonly branchIndex?: number;
    readonly colorBranches: boolean;
  };
}

export interface AnimusEdgeRoleV1 {
  readonly form?: {
    readonly kind: 'tree' | 'cross';
    readonly childDepth: number;
    readonly branchId?: string;
    readonly branchIndex?: number;
    readonly colorBranches: boolean;
  };
}

export interface AnimusRegionV1 {
  readonly id: string;
  readonly regionNodeId: string;
  readonly memberNodeIds: readonly string[];
  readonly directMemberNodeIds: readonly string[];
  readonly connections: readonly {
    readonly sourceId: string;
    readonly targetId: string;
  }[];
  readonly padding: number;
  readonly visible: boolean;
}
