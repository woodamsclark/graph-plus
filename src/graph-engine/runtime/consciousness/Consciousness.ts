import {
  DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
  type GraphExperienceContractV1,
} from '../../contracts/v1/index.ts';
import { constrainAttentionNodeIdsV1 } from '../experience/GraphExperienceContract.ts';

/** Nodes presently held at the center of conscious activity. */
export interface Attention {
  readonly nodeIds: ReadonlySet<string>;
}

/** Binary node membership in the current conscious field. */
export interface Awareness {
  readonly nodeIds: ReadonlySet<string>;
}

export interface EgoAttentionIntent {
  readonly type: 'direct-attention';
  readonly nodeIds: readonly string[];
}

export interface EgoIntent<TDirective> {
  readonly source: 'endogenous';
  readonly directive: TDirective;
}

export type EgoIntentOutcome<TDirective> =
  | { readonly status: 'accepted'; readonly directive: TDirective }
  | { readonly status: 'adjusted'; readonly directive: TDirective }
  | { readonly status: 'rejected'; readonly reason: string };

export type EgoIntentPolicy<TDirective> = (
  intent: EgoIntent<TDirective>,
) => EgoIntentOutcome<TDirective>;

/** Endogenous agency. Ego proposes intent; it does not declare realized truth. */
export class Ego {
  intend<TDirective>(directive: TDirective): EgoIntent<TDirective> {
    return { source: 'endogenous', directive };
  }

  consider<TDirective>(
    intent: EgoIntent<TDirective>,
    policy: EgoIntentPolicy<TDirective>,
  ): EgoIntentOutcome<TDirective> {
    return policy(intent);
  }

  directAttention(nodeIds: readonly string[]): EgoIntent<EgoAttentionIntent> {
    return this.intend({
      type: 'direct-attention',
      nodeIds: [...new Set(nodeIds)],
    });
  }
}

export interface ConsciousnessSnapshot {
  readonly attention: Attention;
  readonly awareness: Awareness;
}

export interface ConsciousnessReconciliation {
  readonly attentionNodeIds: Iterable<string>;
  readonly availableNodeIds: ReadonlySet<string>;
  readonly relationships?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly peripheralAwarenessNodeIds?: Iterable<string>;
}

export interface ExogenousConsciousnessInput {
  readonly source: 'exogenous';
  readonly type: 'replace-attention';
  readonly nodeIds: Iterable<string>;
}

const EMPTY_ATTENTION: Attention = Object.freeze({ nodeIds: new Set<string>() });
const EMPTY_AWARENESS: Awareness = Object.freeze({ nodeIds: new Set<string>() });

/** Presentation-scoped aggregate for Ego, Attention, and Awareness. */
export class Consciousness {
  readonly ego = new Ego();
  private currentAttention: Attention = EMPTY_ATTENTION;
  private currentAwareness: Awareness = EMPTY_AWARENESS;

  constructor(
    private readonly experience: GraphExperienceContractV1 = DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
  ) {}

  get attention(): Attention {
    return this.currentAttention;
  }

  get awareness(): Awareness {
    return this.currentAwareness;
  }

  /** Receive outside truth directly; exogenous influence never passes through Ego. */
  receiveExogenous(
    input: ExogenousConsciousnessInput,
    context: Omit<ConsciousnessReconciliation, 'attentionNodeIds'>,
  ): ConsciousnessSnapshot {
    return this.reconcile({ ...context, attentionNodeIds: input.nodeIds });
  }

  reconcile(options: ConsciousnessReconciliation): ConsciousnessSnapshot {
    const attentionNodeIds = filterAvailable(
      constrainAttentionNodeIdsV1(options.attentionNodeIds, this.experience.attention),
      options.availableNodeIds,
    );
    const awarenessNodeIds = new Set(attentionNodeIds);
    expandNeighborhood(
      attentionNodeIds,
      this.experience.awareness.attentionNeighborhoodDepth,
      options.relationships,
      options.availableNodeIds,
      awarenessNodeIds,
    );
    for (const nodeId of options.peripheralAwarenessNodeIds ?? []) {
      if (options.availableNodeIds.has(nodeId)) awarenessNodeIds.add(nodeId);
    }
    this.currentAttention = { nodeIds: attentionNodeIds };
    this.currentAwareness = { nodeIds: awarenessNodeIds };
    return this.snapshot();
  }

  snapshot(): ConsciousnessSnapshot {
    return {
      attention: this.currentAttention,
      awareness: this.currentAwareness,
    };
  }
}

export function resolveConsciousness(options: ConsciousnessReconciliation): ConsciousnessSnapshot {
  return new Consciousness().reconcile(options);
}

function filterAvailable(
  nodeIds: Iterable<string>,
  availableNodeIds: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...nodeIds].filter((nodeId) => availableNodeIds.has(nodeId)));
}

function expandNeighborhood(
  seeds: ReadonlySet<string>,
  depth: number,
  relationships: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  availableNodeIds: ReadonlySet<string>,
  target: Set<string>,
): void {
  if (!relationships || depth === 0) return;
  let frontier = new Set(seeds);
  for (let step = 0; step < depth; step += 1) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      for (const neighborId of relationships.get(nodeId) ?? []) {
        if (!availableNodeIds.has(neighborId) || target.has(neighborId)) continue;
        target.add(neighborId);
        next.add(neighborId);
      }
    }
    frontier = next;
    if (frontier.size === 0) return;
  }
}
