import type { GraphReactionRegistrationV1 } from '../../contracts/v1/index.ts';
import { recognizeAssociationV1 } from './Association.ts';
import { MemoryV1, type ConsciousObservationV1, type MemorySnapshotV1 } from './Memory.ts';

export interface ConsciousReactionV1 {
  readonly registrationId: string;
  readonly subjectId: string;
  readonly actionId: string;
  readonly observation: ConsciousObservationV1;
}

export interface GraphReactionRuntimeV1 {
  registrations(): readonly GraphReactionRegistrationV1[];
}

/** Memory → Association → Reaction. Ego adjudicates returned reactions separately. */
export class ReactionSystemV1 {
  readonly memory: MemoryV1;

  constructor(snapshot?: MemorySnapshotV1) {
    this.memory = new MemoryV1(snapshot);
  }

  restoreMemory(snapshot: MemorySnapshotV1): void {
    this.memory.restoreSnapshot(snapshot);
  }

  observe(
    observation: ConsciousObservationV1,
    registrations: readonly GraphReactionRegistrationV1[],
  ): readonly ConsciousReactionV1[] {
    const candidates = registrations.filter((registration) =>
      registration.association.observation === observation.type);
    const before = new Map(candidates.map((registration) => [
      registration.id,
      this.memory.count(
        observation.type,
        observation.subjectId,
        observation.timestamp,
        registration.association.withinMs,
      ),
    ]));
    this.memory.remember(observation);
    return candidates.flatMap((registration) => {
      const prior = before.get(registration.id) ?? 0;
      const after = this.memory.count(
        observation.type,
        observation.subjectId,
        observation.timestamp,
        registration.association.withinMs,
      );
      const association = recognizeAssociationV1(registration.association, observation, prior, after);
      return association ? [{
        registrationId: registration.id,
        subjectId: observation.subjectId,
        actionId: registration.reaction.actionId,
        observation,
      }] : [];
    });
  }
}
