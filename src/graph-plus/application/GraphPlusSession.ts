import {
  Ego,
  MemoryV1,
  faithfullyRememberExperienceV1,
  type ConsciousObservationV1,
  type EgoExperiencePolicyV1,
} from '../../graph-engine/public.ts';

export const DEFAULT_GRAPH_PLUS_SESSION_NODE_LIMIT_V1 = 3;

export interface GraphPlusSessionSnapshotV1 {
  readonly activeNodeId?: string;
  /** Oldest to newest prior subjects. The active subject is never included. */
  readonly nodeIds: readonly string[];
  readonly revision: number;
}

export interface GraphPlusSessionOptionsV1 {
  readonly maximumNodeCount?: number;
  readonly experiencePolicy?: EgoExperiencePolicyV1;
}

/**
 * Bounded workspace-session experience shared by every Graph+ presentation.
 * The exact working episode retains recent distinct subjects while associative
 * Memory keeps compact lifetime evidence for future Associations and Reactions.
 */
export class GraphPlusSessionV1 {
  readonly ego = new Ego();
  readonly memory = new MemoryV1();
  private readonly maximumNodeCount: number;
  private readonly experiencePolicy: EgoExperiencePolicyV1;
  private nodeIds: string[] = [];
  private activeNodeId?: string;
  private revision = 0;

  constructor(options: GraphPlusSessionOptionsV1 = {}) {
    this.maximumNodeCount = positiveInteger(
      options.maximumNodeCount,
      DEFAULT_GRAPH_PLUS_SESSION_NODE_LIMIT_V1,
    );
    this.experiencePolicy = options.experiencePolicy ?? faithfullyRememberExperienceV1;
  }

  experienceFileActivation(nodeId: string | undefined, timestamp: number): GraphPlusSessionSnapshotV1 {
    if (nodeId === this.activeNodeId) return this.snapshot();
    this.activeNodeId = nodeId;
    if (nodeId === undefined) {
      this.revision += 1;
      return this.snapshot();
    }
    const perceived: ConsciousObservationV1 = {
      type: 'file-activated',
      subjectId: nodeId,
      timestamp,
    };
    const experience = this.ego.experience(perceived, this.experiencePolicy);
    if (experience.status === 'forgotten') return this.snapshot();
    const remembered = experience.observation;
    this.memory.remember(remembered);
    this.nodeIds = [
      ...this.nodeIds.filter((rememberedNodeId) => rememberedNodeId !== remembered.subjectId),
      remembered.subjectId,
    ].slice(-(this.maximumNodeCount + 1));
    this.revision += 1;
    return this.snapshot();
  }

  snapshot(): GraphPlusSessionSnapshotV1 {
    return {
      ...(this.activeNodeId === undefined ? {} : { activeNodeId: this.activeNodeId }),
      nodeIds: this.nodeIds
        .filter((nodeId) => nodeId !== this.activeNodeId)
        .slice(-this.maximumNodeCount),
      revision: this.revision,
    };
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
