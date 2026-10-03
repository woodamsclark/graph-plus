import type {
  Disposable,
  GraphReactionRegistrationV1,
} from '../contracts/v1/index.ts';
import type { GraphReactionRuntimeV1 } from '../runtime/consciousness/index.ts';

export class ConsumerReactionRegistryV1 {
  private readonly consumers = new Map<string, Map<object, Map<string, GraphReactionRegistrationV1>>>();
  private active = true;

  register(
    consumerId: string,
    owner: object,
    registrations: readonly GraphReactionRegistrationV1[],
  ): Disposable {
    this.requireActive();
    requireId(consumerId, 'consumer ID');
    const checked = registrations.map(validateReaction);
    const consumer = this.consumers.get(consumerId) ?? new Map();
    const owned = consumer.get(owner) ?? new Map();
    for (const registration of checked) {
      if (owned.has(registration.id)) {
        throw new Error(`Duplicate reaction "${registration.id}" for consumer "${consumerId}".`);
      }
      owned.set(registration.id, registration);
    }
    consumer.set(owner, owned);
    this.consumers.set(consumerId, consumer);
    let disposed = false;
    return { dispose: () => {
      if (disposed) return;
      disposed = true;
      const current = this.consumers.get(consumerId);
      const currentOwned = current?.get(owner);
      if (!current || !currentOwned) return;
      for (const registration of checked) currentOwned.delete(registration.id);
      if (currentOwned.size === 0) current.delete(owner);
      if (current.size === 0) this.consumers.delete(consumerId);
    } };
  }

  runtimeFor(consumerId: string, owner: object): GraphReactionRuntimeV1 {
    return {
      registrations: () => [...(this.consumers.get(consumerId)?.get(owner)?.values() ?? [])]
        .map(cloneReaction),
    };
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.consumers.clear();
  }

  private requireActive(): void {
    if (!this.active) throw new Error('Reaction registry is disposed.');
  }
}

function validateReaction(value: GraphReactionRegistrationV1): GraphReactionRegistrationV1 {
  requireId(value?.id, 'reaction ID');
  requireId(value?.reaction?.actionId, 'reaction action ID');
  const occurrences = value?.association?.occurrences;
  if (!Number.isSafeInteger(occurrences) || occurrences < 1) {
    throw new Error(`Reaction "${value.id}" occurrences must be a positive integer.`);
  }
  const withinMs = value.association.withinMs;
  if (withinMs !== undefined && (!Number.isFinite(withinMs) || withinMs <= 0)) {
    throw new Error(`Reaction "${value.id}" withinMs must be a positive finite number.`);
  }
  const observations = new Set(['node-activated', 'node-selected', 'node-focused', 'node-drag-ended']);
  if (!observations.has(value.association.observation)) {
    throw new Error(`Reaction "${value.id}" observation is unsupported.`);
  }
  if (value.reaction.type !== 'invoke-node-action') {
    throw new Error(`Reaction "${value.id}" action is unsupported.`);
  }
  return cloneReaction(value);
}

function cloneReaction(value: GraphReactionRegistrationV1): GraphReactionRegistrationV1 {
  return {
    id: value.id,
    association: { ...value.association },
    reaction: { ...value.reaction },
  };
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}
