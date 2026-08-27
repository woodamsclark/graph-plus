import type {
  GraphDocumentV1,
  GraphNodeRegionDefinitionV1,
} from '../../contracts/v1/index.ts';

export interface ProjectedGraphNodeRegionV1 {
  readonly regionNodeId: string;
  readonly directMemberNodeIds: readonly string[];
  readonly memberNodeIds: readonly string[];
  readonly connections: readonly {
    readonly sourceId: string;
    readonly targetId: string;
  }[];
}

export class GraphNodeRegionIndexV1 {
  private readonly definitions: ReadonlyMap<string, GraphNodeRegionDefinitionV1>;

  constructor(document: GraphDocumentV1) {
    this.definitions = new Map(
      (document.nodeRegions?.definitions ?? []).map((definition) => [definition.regionNodeId, definition]),
    );
  }

  get size(): number {
    return this.definitions.size;
  }

  isRegionNode(nodeId: string): boolean {
    return this.definitions.has(nodeId);
  }

  directMembers(nodeId: string, visibleNodeIds?: ReadonlySet<string>): readonly string[] {
    const members = this.definitions.get(nodeId)?.directMemberNodeIds ?? [];
    return members.filter((memberId) => visibleNodeIds?.has(memberId) ?? true);
  }

  recursiveMembers(nodeId: string, visibleNodeIds?: ReadonlySet<string>): readonly string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const visit = (regionNodeId: string): void => {
      for (const memberId of this.definitions.get(regionNodeId)?.directMemberNodeIds ?? []) {
        if (!(visibleNodeIds?.has(memberId) ?? true)) continue;
        if (seen.has(memberId)) continue;
        seen.add(memberId);
        result.push(memberId);
        if (this.definitions.has(memberId)) visit(memberId);
      }
    };
    visit(nodeId);
    return result;
  }

  project(visibleNodeIds: ReadonlySet<string>): readonly ProjectedGraphNodeRegionV1[] {
    const result: ProjectedGraphNodeRegionV1[] = [];
    for (const regionNodeId of [...this.definitions.keys()].sort()) {
      if (!visibleNodeIds.has(regionNodeId)) continue;
      const memberNodeIds = this.recursiveMembers(regionNodeId, visibleNodeIds);
      if (!memberNodeIds.length) continue;
      const directMemberNodeIds = this.directMembers(regionNodeId, visibleNodeIds);
      const memberSet = new Set(memberNodeIds);
      const connections: Array<{ sourceId: string; targetId: string }> = [];
      const expandedRegionIds = new Set<string>();
      const collectConnections = (ownerId: string): void => {
        if (expandedRegionIds.has(ownerId)) return;
        expandedRegionIds.add(ownerId);
        for (const memberId of this.directMembers(ownerId, visibleNodeIds)) {
          if (!memberSet.has(memberId)) continue;
          connections.push({ sourceId: ownerId, targetId: memberId });
          if (this.definitions.has(memberId)) collectConnections(memberId);
        }
      };
      collectConnections(regionNodeId);
      result.push({ regionNodeId, directMemberNodeIds, memberNodeIds, connections });
    }
    return result;
  }
}
