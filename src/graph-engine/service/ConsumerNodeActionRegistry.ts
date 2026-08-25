import type {
  Disposable,
  GraphNodeActionContextV1,
  GraphNodeActionRegistrationV1,
} from '../contracts/v1/index.ts';
import type {
  GraphNodeActionFailureV1,
  GraphNodeActionRuntimeV1,
  GraphResolvedNodeActionV1,
} from '../runtime/actions/index.ts';

interface StoredNodeAction {
  readonly owner: object;
  readonly action: GraphNodeActionRegistrationV1;
}

export class ConsumerNodeActionRegistryV1 {
  private readonly consumers = new Map<string, Map<string, StoredNodeAction>>();
  private readonly busy = new Set<string>();
  private active = true;

  register(
    consumerId: string,
    owner: object,
    actions: readonly GraphNodeActionRegistrationV1[],
  ): Disposable {
    this.requireActive();
    requireId(consumerId, 'consumer ID');
    const checked = validateNodeActions(actions);
    const consumer = this.consumers.get(consumerId) ?? new Map<string, StoredNodeAction>();
    for (const action of checked) {
      if (consumer.has(action.id)) {
        throw new Error(`Duplicate node action "${action.id}" for consumer "${consumerId}".`);
      }
    }
    for (const action of checked) consumer.set(action.id, { owner, action });
    this.consumers.set(consumerId, consumer);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const current = this.consumers.get(consumerId);
        if (!current) return;
        for (const action of checked) {
          if (current.get(action.id)?.owner === owner) current.delete(action.id);
        }
        if (current.size === 0) this.consumers.delete(consumerId);
      },
    };
  }

  runtimeFor(consumerId: string): GraphNodeActionRuntimeV1 {
    return {
      resolve: (actionIds, context, onFailure) => this.resolve(consumerId, actionIds, context, onFailure),
      invoke: (actionId, context, onFailure) => this.invoke(consumerId, actionId, context, onFailure),
      invokeFirst: (actionIds, context, onFailure) => {
        for (const action of this.resolve(consumerId, actionIds, context, onFailure)) {
          if (this.invoke(consumerId, action.id, context, onFailure)) return true;
        }
        return false;
      },
    };
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.consumers.clear();
    this.busy.clear();
  }

  private resolve(
    consumerId: string,
    actionIds: readonly string[],
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
  ): readonly GraphResolvedNodeActionV1[] {
    if (!this.active || context.consumerId !== consumerId) return [];
    const consumer = this.consumers.get(consumerId);
    if (!consumer) return [];
    const result: GraphResolvedNodeActionV1[] = [];
    const seen = new Set<string>();
    for (const id of actionIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const stored = consumer.get(id);
      if (!stored) continue;
      try {
        if (stored.action.isAvailable && !stored.action.isAvailable(cloneContext(context))) continue;
      } catch (error) {
        onFailure({ actionId: id, phase: 'availability', error });
        continue;
      }
      let label: string;
      try {
        label = typeof stored.action.label === 'function'
          ? stored.action.label(cloneContext(context))
          : stored.action.label;
        requireId(label, `label for node action "${id}"`);
      } catch (error) {
        onFailure({ actionId: id, phase: 'label', error });
        continue;
      }
      result.push({ id, label, ...(stored.action.icon ? { icon: stored.action.icon } : {}) });
    }
    return result;
  }

  private invoke(
    consumerId: string,
    actionId: string,
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
  ): boolean {
    if (!this.active || context.consumerId !== consumerId) return false;
    const stored = this.consumers.get(consumerId)?.get(actionId);
    if (!stored) return false;
    try {
      if (stored.action.isAvailable && !stored.action.isAvailable(cloneContext(context))) return false;
    } catch (error) {
      onFailure({ actionId, phase: 'availability', error });
      return false;
    }
    const busyKey = JSON.stringify([consumerId, context.session.sessionId, actionId]);
    if (this.busy.has(busyKey)) return false;
    this.busy.add(busyKey);
    try {
      const result = stored.action.run(cloneContext(context));
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((error) => {
          if (this.active) onFailure({ actionId, phase: 'run', error });
        }).finally(() => this.busy.delete(busyKey));
      } else {
        this.busy.delete(busyKey);
      }
      return true;
    } catch (error) {
      this.busy.delete(busyKey);
      onFailure({ actionId, phase: 'run', error });
      return false;
    }
  }

  private requireActive(): void {
    if (!this.active) throw new Error('The node action registry has been disposed.');
  }
}

function validateNodeActions(
  actions: readonly GraphNodeActionRegistrationV1[],
): readonly GraphNodeActionRegistrationV1[] {
  if (!Array.isArray(actions)) throw new Error('Node actions must be an array.');
  const checked = actions.map((action) => {
    requireId(action.id, 'node action ID');
    if (typeof action.label !== 'function') requireId(action.label, 'node action label');
    if (action.icon !== undefined) requireId(action.icon, 'node action icon');
    if (action.isAvailable !== undefined && typeof action.isAvailable !== 'function') {
      throw new Error(`Availability for node action "${action.id}" must be a function.`);
    }
    if (typeof action.run !== 'function') throw new Error(`Node action "${action.id}" must provide run().`);
    return { ...action };
  });
  if (new Set(checked.map((action) => action.id)).size !== checked.length) {
    throw new Error('Node action IDs must be unique within one registration.');
  }
  return checked;
}

function cloneContext(context: GraphNodeActionContextV1): GraphNodeActionContextV1 {
  return { ...context, selectedNodeIds: [...context.selectedNodeIds] };
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return value !== null && typeof value === 'object' && typeof (value as PromiseLike<void>).then === 'function';
}
