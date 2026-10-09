import {
  resolveEgoInteractionPlanV1, isEgoInteractionPlanCurrentV1, sameEgoInteractionV1, captureEgoInteractionPhaseV1,
  type EgoInteractionInputV1, type EgoInteractionContextV1, type EgoInteractionPlanV1,
} from './EgoInteractionPlan.ts';
import {
  DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
  type GraphExperienceContractV1,
} from '../../contracts/v1/index.ts';
import { constrainAttentionNodeIdsV1 } from '../experience/GraphExperienceContract.ts';
import type { GraphReactionRegistrationV1 } from '../../contracts/v1/index.ts';
import {
  ReactionSystemV1,
  type ConsciousReactionV1,
} from './Reaction.ts';
import type { ConsciousObservationV1, MemorySnapshotV1 } from './Memory.ts';
import { Judgement, type EgoIntent, type EgoIntentOutcome, type EgoIntentPolicy } from './Judgement.ts';
export type { EgoIntent, EgoIntentOutcome, EgoIntentPolicy } from './Judgement.ts';

/** Nodes presently held at the center of conscious activity. */
export interface Attention {
  readonly nodeIds: ReadonlySet<string>;
}

/** Subjects available for deliberate observation, including durable Memory. */
export interface Awareness {
  readonly nodeIds: ReadonlySet<string>;
}

/** The wider conscious field surrounding aware subjects. */
export interface ConsciousField {
  readonly nodeIds: ReadonlySet<string>;
}

/** Subjects retained by Memory independently from present Attention. */
export interface RememberedSubjects {
  readonly nodeIds: ReadonlySet<string>;
}

export interface EgoAttentionIntent {
  readonly type: 'direct-attention';
  readonly nodeIds: readonly string[];
}

export type EgoExperienceOutcomeV1 =
  | { readonly status: 'remembered'; readonly observation: ConsciousObservationV1 }
  | { readonly status: 'altered'; readonly observation: ConsciousObservationV1 }
  | { readonly status: 'forgotten'; readonly reason: string };

export type EgoExperiencePolicyV1 = (
  observation: ConsciousObservationV1,
) => EgoExperienceOutcomeV1;

/** Intended camera interest; world coordinates and the realized pose stay in Vision. */
export type EgoVisionIntentV1 =
  | { readonly kind: 'retain-focal-point' }
  | { readonly kind: 'follow-subject'; readonly nodeId: string }
  | { readonly kind: 'follow-constellation' };

/** Endogenous agency. Ego proposes intent; it does not declare realized truth. */
export class Ego {
  private currentWill?: EgoInteractionPlanV1;
  private currentVisionIntent?: EgoVisionIntentV1;

  constructor(readonly judgement: Judgement = new Judgement()) {}

  /** Session intent survives View changes and is independent of transient hover will. */
  get visionIntent(): EgoVisionIntentV1 | undefined { return this.currentVisionIntent; }

  intendVision(intent: EgoVisionIntentV1): void {
    this.currentVisionIntent = Object.freeze({ ...intent });
  }

  /** Transient proposal, including rejected will. It is never exported as realized state or Memory. */
  get will(): EgoInteractionPlanV1 | undefined { return this.currentWill; }

  resolveWill(input: EgoInteractionInputV1, context: EgoInteractionContextV1): EgoInteractionPlanV1 {
    context = { ...context, judgement: this.judgement };
    const previous = this.currentWill;
    if (previous && sameEgoInteractionV1(previous.input, input) && isEgoInteractionPlanCurrentV1(previous, context)) {
      this.currentWill = previous.input.phase === input.phase ? previous : captureEgoInteractionPhaseV1(previous, input);
    } else {
      this.currentWill = resolveEgoInteractionPlanV1(input, context);
    }
    return this.currentWill;
  }

  clearWill(): void { this.currentWill = undefined; }

  intend<TDirective>(directive: TDirective): EgoIntent<TDirective> {
    return { source: 'endogenous', directive };
  }

  consider<TDirective>(
    intent: EgoIntent<TDirective>,
    constraints?: EgoIntentPolicy<TDirective>,
  ): EgoIntentOutcome<TDirective> {
    return this.judgement.consider(intent, constraints);
  }

  directAttention(nodeIds: readonly string[]): EgoIntent<EgoAttentionIntent> {
    return this.intend({
      type: 'direct-attention',
      nodeIds: [...new Set(nodeIds)],
    });
  }

  /** Admit perceived reality into conscious Memory. The default Ego remembers faithfully. */
  experience(
    observation: ConsciousObservationV1,
    policy: EgoExperiencePolicyV1 = faithfullyRememberExperienceV1,
  ): EgoExperienceOutcomeV1 {
    return policy({ ...observation });
  }
}

export function faithfullyRememberExperienceV1(
  observation: ConsciousObservationV1,
): EgoExperienceOutcomeV1 {
  return { status: 'remembered', observation: { ...observation } };
}

export interface ConsciousnessSnapshot {
  readonly attention: Attention;
  readonly awareness: Awareness;
  readonly consciousField: ConsciousField;
  readonly remembered: RememberedSubjects;
}

export interface ConsciousnessReconciliation {
  readonly attentionNodeIds: Iterable<string>;
  readonly availableNodeIds: ReadonlySet<string>;
  readonly relationships?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly consciousFieldNodeIds?: Iterable<string>;
  /** @deprecated Use consciousFieldNodeIds. Values contribute to ConsciousField, not Awareness. */
  readonly peripheralAwarenessNodeIds?: Iterable<string>;
}

export type ExogenousConsciousnessInput =
  | {
      readonly source: 'exogenous';
      readonly type: 'replace-attention';
      readonly nodeIds: Iterable<string>;
    }
  | {
      readonly source: 'exogenous';
      readonly type: 'replace-remembered-subjects';
      readonly nodeIds: Iterable<string>;
    };

const EMPTY_ATTENTION: Attention = Object.freeze({ nodeIds: new Set<string>() });
const EMPTY_AWARENESS: Awareness = Object.freeze({ nodeIds: new Set<string>() });
const EMPTY_CONSCIOUS_FIELD: ConsciousField = Object.freeze({ nodeIds: new Set<string>() });
const EMPTY_REMEMBERED_SUBJECTS: RememberedSubjects = Object.freeze({ nodeIds: new Set<string>() });

/** A resolved group of canonical subjects, independent of layout and camera. */
export interface Constellation {
  readonly id: string;
  readonly kind: 'ego' | 'memory';
  readonly nodeIds: readonly string[];
}

/** Presentation-scoped aggregate for Ego, Attention, and Awareness. */
export class Consciousness {
  readonly ego = new Ego();
  private constellationCacheKey?: string;
  private readonly constellationsBySubject = new Map<string, Constellation>();
  readonly reactions: ReactionSystemV1;
  private currentAttention: Attention = EMPTY_ATTENTION;
  private currentAwareness: Awareness = EMPTY_AWARENESS;
  private currentConsciousField: ConsciousField = EMPTY_CONSCIOUS_FIELD;
  private currentRemembered: RememberedSubjects = EMPTY_REMEMBERED_SUBJECTS;

  constructor(
    private readonly experience: GraphExperienceContractV1 = DEFAULT_GRAPH_EXPERIENCE_CONTRACT_V1,
    memory?: MemorySnapshotV1,
  ) {
    this.reactions = new ReactionSystemV1(memory);
  }

  get attention(): Attention {
    return this.currentAttention;
  }

  get awareness(): Awareness {
    return this.currentAwareness;
  }

  get consciousField(): ConsciousField {
    return this.currentConsciousField;
  }

  get remembered(): RememberedSubjects {
    return this.currentRemembered;
  }

  observe(
    observation: ConsciousObservationV1,
    registrations: readonly GraphReactionRegistrationV1[],
  ): readonly ConsciousReactionV1[] {
    const experience = this.ego.experience(observation);
    return experience.status === 'forgotten'
      ? []
      : this.reactions.observe(experience.observation, registrations);
  }

  restoreMemory(snapshot: MemorySnapshotV1): void {
    this.reactions.restoreMemory(snapshot);
  }

  /** Receive outside truth directly; exogenous influence never passes through Ego. */
  receiveExogenous(
    input: ExogenousConsciousnessInput,
    context: Omit<ConsciousnessReconciliation, 'attentionNodeIds'>,
  ): ConsciousnessSnapshot {
    if (input.type === 'replace-remembered-subjects') {
      this.currentRemembered = {
        nodeIds: filterAvailable(input.nodeIds, context.availableNodeIds),
      };
      return this.reconcile({
        ...context,
        attentionNodeIds: this.currentAttention.nodeIds,
      });
    }
    return this.reconcile({ ...context, attentionNodeIds: input.nodeIds });
  }

  reconcile(options: ConsciousnessReconciliation): ConsciousnessSnapshot {
    const attentionNodeIds = filterAvailable(
      constrainAttentionNodeIdsV1(options.attentionNodeIds, this.experience.attention),
      options.availableNodeIds,
    );
    this.currentRemembered = {
      nodeIds: filterAvailable(this.currentRemembered.nodeIds, options.availableNodeIds),
    };
    // Awareness is the broader observable field; Attention owns the active composition. The contributing
    // stores stay separate so removing deliberate Attention cannot erase a
    // subject still retained by Memory.
    const awarenessNodeIds = new Set([
      ...attentionNodeIds,
      ...this.currentRemembered.nodeIds,
    ]);
    const consciousFieldNodeIds = new Set(awarenessNodeIds);
    expandNeighborhood(
      awarenessNodeIds,
      this.experience.awareness.attentionNeighborhoodDepth,
      options.relationships,
      options.availableNodeIds,
      consciousFieldNodeIds,
    );
    const legacyField: { readonly peripheralAwarenessNodeIds?: Iterable<string> } = options;
    // Legacy input still feeds ConsciousField, never deliberate Awareness.
    for (const nodeId of [...(options.consciousFieldNodeIds ?? []), ...(legacyField.peripheralAwarenessNodeIds ?? [])]) {
      if (options.availableNodeIds.has(nodeId)) consciousFieldNodeIds.add(nodeId);
    }
    this.currentAttention = { nodeIds: attentionNodeIds };
    this.currentAwareness = { nodeIds: awarenessNodeIds };
    this.currentConsciousField = { nodeIds: consciousFieldNodeIds };
    return this.snapshot();
  }

  /** Resolve the connected highlighted group reached from an Overview hit.
   * Only the seed may be unhighlighted; traversal stops at every other unlit node.
   * The cache stores group objects and expires when membership/topology changes.
   */
  resolveOverviewConstellation(
    nodeId: string,
    availableNodeIds: ReadonlySet<string>,
    relationships: ReadonlyMap<string, ReadonlySet<string>>,
    topologyRevision: string,
  ): Constellation | undefined {
    if (!availableNodeIds.has(nodeId)) return undefined;
    const sources = { attention: filterAvailable(this.attention.nodeIds, availableNodeIds),
      remembered: filterAvailable(this.remembered.nodeIds, availableNodeIds) };
    const { kind, highlighted } = overviewConstellationSource(nodeId, sources, relationships);
    // topologyRevision is owned by the session topology cache and already covers
    // the available-node and relationship membership of this projection.
    const key = JSON.stringify([topologyRevision, [...sources.attention].sort(),
      [...sources.remembered].sort()]);
    if (key !== this.constellationCacheKey) {
      this.constellationCacheKey = key;
      this.constellationsBySubject.clear();
    }
    const cached = this.constellationsBySubject.get(nodeId);
    if (cached) return cached;
    const group = resolveOverviewConstellationV1(nodeId, availableNodeIds, highlighted, relationships, kind)!;
    const nodeIds = group.nodeIds;
    this.constellationsBySubject.set(nodeId, group);
    // An unlit seed may join multiple groups, so only an entirely highlighted
    // component can safely share the same lookup object through every member.
    if (highlighted.has(nodeId)) {
      for (const id of nodeIds) {
        if (overviewConstellationSource(id, sources, relationships).kind === kind) {
          this.constellationsBySubject.set(id, group);
        }
      }
    }
    return group;
  }

  snapshot(): ConsciousnessSnapshot {
    return {
      attention: this.currentAttention,
      awareness: this.currentAwareness,
      consciousField: this.currentConsciousField,
      remembered: this.currentRemembered,
    };
  }
}

/** Pure group lookup used by both activation and its visual preview. */
export function resolveOverviewConstellationV1(
  nodeId: string,
  availableNodeIds: ReadonlySet<string>,
  highlighted: ReadonlySet<string>,
  relationships: ReadonlyMap<string, ReadonlySet<string>>,
  kind: Constellation['kind'] = 'ego',
): Constellation | undefined {
  if (!availableNodeIds.has(nodeId)) return undefined;
  const members = new Set([nodeId]);
  const frontier = [nodeId];
  for (let i = 0; i < frontier.length; i += 1) {
    for (const neighbor of relationships.get(frontier[i]) ?? []) {
      if (!availableNodeIds.has(neighbor) || !highlighted.has(neighbor) || members.has(neighbor)) continue;
      members.add(neighbor);
      frontier.push(neighbor);
    }
  }
  const nodeIds = Object.freeze([...members].sort());
  return Object.freeze({ id: JSON.stringify([kind, nodeIds]), kind, nodeIds });
}

/** Memory and deliberate composition are distinct sources, even when their subjects touch. */
export function resolveOverviewConstellationFromSourcesV1(
  nodeId: string,
  availableNodeIds: ReadonlySet<string>,
  sources: { readonly attention: ReadonlySet<string>; readonly remembered: ReadonlySet<string> },
  relationships: ReadonlyMap<string, ReadonlySet<string>>,
): Constellation | undefined {
  const { kind, highlighted } = overviewConstellationSource(nodeId, {
    attention: filterAvailable(sources.attention, availableNodeIds),
    remembered: filterAvailable(sources.remembered, availableNodeIds),
  }, relationships);
  return resolveOverviewConstellationV1(nodeId, availableNodeIds, highlighted, relationships, kind);
}

function overviewConstellationSource(
  nodeId: string,
  sources: { readonly attention: ReadonlySet<string>; readonly remembered: ReadonlySet<string> },
  relationships: ReadonlyMap<string, ReadonlySet<string>>,
): { readonly kind: Constellation['kind']; readonly highlighted: ReadonlySet<string> } {
  // A subject in both stores is presented deliberately. An unlit entry point can join
  // adjacent groups of one source; deliberate interest takes priority on a mixed boundary.
  const neighbors = [...(relationships.get(nodeId) ?? [])];
  const kind = sources.attention.has(nodeId) ? 'ego'
    : sources.remembered.has(nodeId) ? 'memory'
    : neighbors.some((id) => sources.attention.has(id)) ? 'ego'
    : neighbors.some((id) => sources.remembered.has(id)) ? 'memory' : 'ego';
  return { kind, highlighted: kind === 'ego' ? sources.attention : sources.remembered };
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
