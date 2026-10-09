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

export class ConsumerNodeActionRegistryV1 {
  private readonly consumers = new Map<string, Map<object, Map<string, GraphNodeActionRegistrationV1>>>();
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
    const consumer = this.consumers.get(consumerId) ?? new Map<object, Map<string, GraphNodeActionRegistrationV1>>();
    const owned = consumer.get(owner) ?? new Map<string, GraphNodeActionRegistrationV1>();
    for (const action of checked) {
      if (owned.has(action.id)) {
        throw new Error(`Duplicate node action "${action.id}" for consumer "${consumerId}".`);
      }
    }
    for (const action of checked) owned.set(action.id, action);
    consumer.set(owner, owned);
    this.consumers.set(consumerId, consumer);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const current = this.consumers.get(consumerId);
        if (!current) return;
        const currentOwned = current.get(owner);
        if (!currentOwned) return;
        for (const action of checked) currentOwned.delete(action.id);
        if (currentOwned.size === 0) current.delete(owner);
        if (current.size === 0) this.consumers.delete(consumerId);
      },
    };
  }

  runtimeFor(consumerId: string, owner?: object): GraphNodeActionRuntimeV1 {
    return {
      resolve: (actionIds, context, onFailure) => this.resolve(consumerId, owner, actionIds, context, onFailure),
      invoke: (actionId, context, onFailure) => this.invoke(consumerId, actionId, context, onFailure, owner),
      invokeFirst: (actionIds, context, onFailure) => {
        for (const action of this.resolve(consumerId, owner, actionIds, context, onFailure)) {
          if (this.invoke(consumerId, action.id, context, onFailure, owner)) return true;
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
    owner: object | undefined,
    actionIds: readonly string[],
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
  ): readonly GraphResolvedNodeActionV1[] {
    if (!this.active || context.consumerId !== consumerId) return [];
    const actions = this.actionsFor(consumerId, owner);
    if (!actions) return [];
    const result: GraphResolvedNodeActionV1[] = [];
    const seen = new Set<string>();
    for (const id of actionIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const action = actions.get(id);
      if (!action) continue;
      try {
        if (action.isAvailable && !action.isAvailable(cloneContext(context))) continue;
      } catch (error) {
        onFailure({ actionId: id, phase: 'availability', error });
        continue;
      }
      let label: string;
      try {
        label = typeof action.label === 'function'
          ? action.label(cloneContext(context))
          : action.label;
        requireId(label, `label for node action "${id}"`);
      } catch (error) {
        onFailure({ actionId: id, phase: 'label', error });
        continue;
      }
      result.push({ id, label, ...(action.icon ? { icon: action.icon } : {}) });
    }
    return result;
  }

  private invoke(
    consumerId: string,
    actionId: string,
    context: GraphNodeActionContextV1,
    onFailure: (failure: GraphNodeActionFailureV1) => void,
    owner?: object,
  ): boolean {
    if (!this.active || context.consumerId !== consumerId) return false;
    const action = this.actionsFor(consumerId, owner)?.get(actionId);
    if (!action) return false;
    try {
      if (action.isAvailable && !action.isAvailable(cloneContext(context))) return false;
    } catch (error) {
      onFailure({ actionId, phase: 'availability', error });
      return false;
    }
    const busyKey = JSON.stringify([consumerId, context.session.sessionId, actionId]);
    if (this.busy.has(busyKey)) return false;
    this.busy.add(busyKey);
    try {
      const result = action.run(cloneContext(context));
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

  private actionsFor(
    consumerId: string,
    owner: object | undefined,
  ): Map<string, GraphNodeActionRegistrationV1> | undefined {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) return undefined;
    if (owner) return consumer.get(owner);
    if (consumer.size !== 1) return undefined;
    return consumer.values().next().value;
  }

  private requireActive(): void {
    if (!this.active) throw new Error('The node action registry has been disposed.');
  }
}

function validateNodeActions(
  actions: readonly GraphNodeActionRegistrationV1[],
): readonly GraphNodeActionRegistrationV1[] {
  if (!isUnknownArray(actions)) throw new Error('Node actions must be an array.');
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

/** Preserve unknown element types instead of the built-in any[] narrowing. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
