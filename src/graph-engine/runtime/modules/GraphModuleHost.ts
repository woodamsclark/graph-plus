import type {
  GraphDocumentV1,
  GraphViewStateV1,
  JsonValue,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { EffectiveConsumerProfileV1 } from '../../core/profile/index.ts';
import type { GraphRenderThemeV1 } from '../render/index.ts';
import type {
  GraphEdgeRenderContributionV1,
  GraphNodeRenderContributionV1,
} from '../render/index.ts';
import type { GraphModuleRegistry } from './GraphModuleRegistry.ts';
import type {
  ActiveGraphModuleV1,
  GraphModuleFailureV1,
  GraphModuleHookV1,
  GraphModulePipelineStateV1,
  GraphModuleProjectionPatchV1,
} from './GraphModuleTypes.ts';

export class GraphRequiredModuleErrorV1 extends Error {
  readonly code = 'required-module-failed' as const;

  constructor(readonly moduleId: string, readonly hook: GraphModuleHookV1, cause: unknown) {
    super(`Required graph module "${moduleId}" failed during ${hook}: ${errorMessage(cause)}`);
    this.name = 'GraphRequiredModuleErrorV1';
  }
}

export class GraphModuleHost {
  private readonly active: ActiveGraphModuleV1[] = [];
  private fatal = false;
  private disposed = false;

  constructor(options: {
    readonly registry: GraphModuleRegistry;
    readonly profile: EffectiveConsumerProfileV1;
    readonly sessionId: string;
    readonly themePalette: GraphRenderThemeV1;
    readonly initialModuleState: Readonly<Record<string, JsonValue>>;
    readonly getDocument: () => GraphDocumentV1;
    readonly getViewState: () => GraphViewStateV1;
    readonly onFailure: (failure: GraphModuleFailureV1) => void;
  }) {
    this.failureListener = options.onFailure;
    const definitions = options.registry.resolve(options.profile);
    const enabled = Object.values(options.profile.modules).filter((module) => module.enabled);
    const byId = new Map(definitions.map((definition) => [definition.descriptor.id, definition]));
    for (const module of enabled) {
      if (byId.has(module.id)) continue;
      const failure: GraphModuleFailureV1 = {
        moduleId: module.id,
        policy: module.policy,
        hook: 'setup',
        error: new Error(`No shipped implementation is registered for graph module "${module.id}".`),
      };
      options.onFailure(failure);
      if (module.policy === 'required') {
        this.disposeActivated(options.onFailure);
        throw new GraphRequiredModuleErrorV1(module.id, 'setup', failure.error);
      }
    }

    for (const definition of definitions) {
      const module = options.profile.modules[definition.descriptor.id];
      if (!module?.enabled) continue;
      let instance;
      try {
        instance = definition.create({
          sessionId: options.sessionId,
          dimensions: options.profile.dimensions,
          settings: module.settings,
          themePalette: options.themePalette,
          getDocument: options.getDocument,
          getViewState: options.getViewState,
        });
        instance.setup?.();
      } catch (error) {
        try { instance?.dispose?.(); } catch (disposeError) {
          options.onFailure({ moduleId: module.id, policy: module.policy, hook: 'dispose', error: disposeError });
        }
        const failure = { moduleId: module.id, policy: module.policy, hook: 'setup' as const, error };
        options.onFailure(failure);
        if (module.policy === 'required') {
          this.disposeActivated(options.onFailure);
          throw new GraphRequiredModuleErrorV1(module.id, 'setup', error);
        }
        continue;
      }
      try {
        if (Object.prototype.hasOwnProperty.call(options.initialModuleState, module.id)) {
          instance.restoreState?.(options.initialModuleState[module.id]);
        }
        this.active.push({ id: module.id, policy: module.policy, order: definition.order, definition, instance });
      } catch (error) {
        try { instance.dispose?.(); } catch (disposeError) {
          options.onFailure({ moduleId: module.id, policy: module.policy, hook: 'dispose', error: disposeError });
        }
        const failure = { moduleId: module.id, policy: module.policy, hook: 'restore-state' as const, error };
        options.onFailure(failure);
        if (module.policy === 'required') {
          this.disposeActivated(options.onFailure);
          throw new GraphRequiredModuleErrorV1(module.id, 'restore-state', error);
        }
      }
    }
  }

  has(moduleId: string): boolean {
    return this.active.some((module) => module.id === moduleId);
  }

  project(initial: GraphModulePipelineStateV1): GraphModulePipelineStateV1 {
    let state = initial;
    state = this.runProjectionHook(state, 'projectSource', 'project-source');
    state = { ...state, renderSelection: allOf(state.document) };
    state = this.runProjectionHook(state, 'projectTopology', 'project-topology');
    state = { ...state, renderSelection: allOf(state.document) };
    state = this.runProjectionHook(state, 'selectRender', 'select-render');
    state = this.runProjectionHook(state, 'contributeFrame', 'contribute-frame');
    return state;
  }

  tick(state: GraphModulePipelineStateV1, deltaSeconds: number): Readonly<Record<string, Vec3>> | undefined {
    if (this.fatal || this.disposed) return undefined;
    let positions = state.positions;
    let changed = false;
    for (const module of [...this.active]) {
      if (!module.instance.tick) continue;
      try {
        const result = module.instance.tick({ ...state, positions }, deltaSeconds);
        if (result?.positions) {
          positions = result.positions;
          changed = true;
        }
      } catch (error) {
        this.failActiveModule(module, 'tick', error);
        if (this.fatal) break;
      }
    }
    return changed ? positions : undefined;
  }

  documentChanged(document: GraphDocumentV1): void {
    this.invokeLifecycle('onDocumentChanged', 'document-changed', document);
  }

  viewChanged(state: GraphViewStateV1): void {
    this.invokeLifecycle('onViewChanged', 'view-changed', state);
  }

  restoreState(state: Readonly<Record<string, JsonValue>>): void {
    if (this.fatal || this.disposed) return;
    for (const module of [...this.active]) {
      if (!module.instance.restoreState || !Object.prototype.hasOwnProperty.call(state, module.id)) continue;
      try {
        module.instance.restoreState(cloneJson(state[module.id]));
      } catch (error) {
        this.failActiveModule(module, 'restore-state', error);
        if (this.fatal) break;
      }
    }
  }

  setSuspended(suspended: boolean): void {
    this.invokeLifecycle('setSuspended', 'suspend', suspended);
  }

  exportState(base: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
    const result: Record<string, JsonValue> = JSON.parse(JSON.stringify(base)) as Record<string, JsonValue>;
    for (const module of [...this.active]) {
      if (!module.instance.exportState) continue;
      try {
        result[module.id] = cloneJson(module.instance.exportState());
      } catch (error) {
        this.failActiveModule(module, 'export-state', error);
        if (this.fatal) break;
      }
    }
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeActivated((failure) => this.onFailure(failure));
  }

  private readonly onFailure = (failure: GraphModuleFailureV1): void => {
    this.failureListener?.(failure);
  };

  private failureListener: ((failure: GraphModuleFailureV1) => void) | undefined;

  private runProjectionHook(
    initial: GraphModulePipelineStateV1,
    method: 'projectSource' | 'projectTopology' | 'selectRender' | 'contributeFrame',
    hook: GraphModuleHookV1,
  ): GraphModulePipelineStateV1 {
    if (this.fatal || this.disposed) return initial;
    let state = initial;
    for (const module of [...this.active]) {
      const callback = module.instance[method];
      if (!callback) continue;
      try {
        const patch = callback.call(module.instance, state);
        if (patch) state = applyProjectionPatch(state, patch);
      } catch (error) {
        this.failActiveModule(module, hook, error);
        if (this.fatal) break;
      }
    }
    return state;
  }

  private invokeLifecycle(
    method: 'onDocumentChanged' | 'onViewChanged' | 'setSuspended',
    hook: GraphModuleHookV1,
    value: GraphDocumentV1 | GraphViewStateV1 | boolean,
  ): void {
    if (this.fatal || this.disposed) return;
    for (const module of [...this.active]) {
      const callback = module.instance[method] as ((argument: unknown) => void) | undefined;
      if (!callback) continue;
      try {
        callback.call(module.instance, value);
      } catch (error) {
        this.failActiveModule(module, hook, error);
        if (this.fatal) break;
      }
    }
  }

  private failActiveModule(module: ActiveGraphModuleV1, hook: GraphModuleHookV1, error: unknown): void {
    const index = this.active.indexOf(module);
    if (index >= 0) this.active.splice(index, 1);
    try { module.instance.dispose?.(); } catch (disposeError) {
      this.onFailure({ moduleId: module.id, policy: module.policy, hook: 'dispose', error: disposeError });
    }
    this.onFailure({ moduleId: module.id, policy: module.policy, hook, error });
    if (module.policy === 'required') this.fatal = true;
  }

  private disposeActivated(onFailure: (failure: GraphModuleFailureV1) => void): void {
    for (const module of [...this.active].reverse()) {
      try {
        module.instance.dispose?.();
      } catch (error) {
        onFailure({ moduleId: module.id, policy: module.policy, hook: 'dispose', error });
      }
    }
    this.active.length = 0;
  }
}

function applyProjectionPatch(
  state: GraphModulePipelineStateV1,
  patch: GraphModuleProjectionPatchV1,
): GraphModulePipelineStateV1 {
  return {
    ...state,
    ...patch,
    nodeContributions: patch.nodeContributions
      ? mergeContributions(state.nodeContributions, patch.nodeContributions)
      : state.nodeContributions,
    edgeContributions: patch.edgeContributions
      ? mergeContributions(state.edgeContributions, patch.edgeContributions)
      : state.edgeContributions,
  };
}

function mergeContributions<T extends GraphNodeRenderContributionV1 | GraphEdgeRenderContributionV1>(
  base: Readonly<Record<string, T>>,
  addition: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  const result: Record<string, T> = { ...base };
  for (const [id, contribution] of Object.entries(addition) as Array<[string, T]>) {
    result[id] = { ...base[id], ...contribution } as T;
  }
  return result;
}

function allOf(document: GraphDocumentV1) {
  return {
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    edgeIds: new Set(document.edges.map((edge) => edge.id)),
  };
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
