import type {
  GraphDocumentV1,
  GraphViewStateV1,
  JsonValue,
  Vec3,
} from '../../contracts/v1/index.ts';
import type { EffectiveConsumerProfileV1 } from '../../core/profile/index.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';
import type {
  GraphEdgeRenderContributionV1,
  GraphNodeRenderContributionV1,
} from '../render/index.ts';
import type { GraphModuleRegistry } from './GraphModuleRegistry.ts';
import type {
  ActiveGraphModuleV1,
  GraphModuleChoreographyPatchV1,
  GraphModuleFailureV1,
  GraphModuleHookV1,
  GraphModuleInstanceV1,
  GraphModulePipelineStateV1,
  GraphModulePresentationPatchV1,
  GraphModulePresentationStateV1,
  GraphModuleProjectionPatchV1,
  GraphModuleProjectionStateV1,
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
  private readonly registry: GraphModuleRegistry;
  private readonly sessionId: string;
  private themePalette: GraphVisualThemeV2;
  private readonly getDocument: () => GraphDocumentV1;
  private readonly getViewState: () => GraphViewStateV1;
  private fatal = false;
  private disposed = false;
  private readonly tickElapsedSeconds = new Map<string, number>();
  private readonly tickHasRun = new Set<string>();

  constructor(options: {
    readonly registry: GraphModuleRegistry;
    readonly profile: EffectiveConsumerProfileV1;
    readonly sessionId: string;
    readonly themePalette: GraphVisualThemeV2;
    readonly initialModuleState: Readonly<Record<string, JsonValue>>;
    readonly getDocument: () => GraphDocumentV1;
    readonly getViewState: () => GraphViewStateV1;
    readonly onFailure: (failure: GraphModuleFailureV1) => void;
  }) {
    this.registry = options.registry;
    this.sessionId = options.sessionId;
    this.themePalette = options.themePalette;
    this.getDocument = options.getDocument;
    this.getViewState = options.getViewState;
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
          profileSettings: options.profile.profileSettings,
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
        this.active.push({
          id: module.id,
          policy: module.policy,
          order: definition.order,
          definition,
          instance,
          settings: cloneJsonRecord(module.settings),
        });
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

  updateProfile(profile: EffectiveConsumerProfileV1): void {
    if (this.fatal || this.disposed) return;
    const definitions = this.registry.resolve(profile);
    const desiredIds = new Set(definitions.map((definition) => definition.descriptor.id));
    for (const module of [...this.active]) {
      if (desiredIds.has(module.id)) continue;
      const index = this.active.indexOf(module);
      if (index >= 0) this.active.splice(index, 1);
      this.tickElapsedSeconds.delete(module.id);
      this.tickHasRun.delete(module.id);
      try { module.instance.dispose?.(); } catch (error) {
        this.onFailure({ moduleId: module.id, policy: module.policy, hook: 'dispose', error });
      }
    }
    for (const definition of definitions) {
      const desired = profile.modules[definition.descriptor.id];
      if (!desired?.enabled) continue;
      const currentIndex = this.active.findIndex((module) => module.id === desired.id);
      const current = currentIndex >= 0 ? this.active[currentIndex] : undefined;
      if (current && sameJson(current.settings, desired.settings)) {
        try {
          current.instance.updateProfileSettings?.(cloneJsonRecord(profile.profileSettings));
        } catch (error) {
          this.failActiveModule(current, 'settings-changed', error);
          if (this.fatal) return;
        }
        continue;
      }
      if (current?.instance.updateSettings) {
        try {
          current.instance.updateSettings(cloneJsonRecord(desired.settings));
          current.instance.updateProfileSettings?.(cloneJsonRecord(profile.profileSettings));
          this.active[currentIndex] = { ...current, settings: cloneJsonRecord(desired.settings) };
          this.tickElapsedSeconds.delete(current.id);
          this.tickHasRun.delete(current.id);
        } catch (error) {
          this.failActiveModule(current, 'settings-changed', error);
          if (this.fatal) return;
        }
        continue;
      }
      const previousState = current?.instance.exportState?.();
      let replacement: GraphModuleInstanceV1 | undefined;
      try {
        replacement = definition.create({
          sessionId: this.sessionId,
          dimensions: profile.dimensions,
          settings: desired.settings,
          profileSettings: profile.profileSettings,
          themePalette: this.themePalette,
          getDocument: this.getDocument,
          getViewState: this.getViewState,
        });
        replacement.setup?.();
        if (previousState !== undefined) replacement.restoreState?.(cloneJson(previousState));
      } catch (error) {
        try { replacement?.dispose?.(); } catch (disposeError) {
          this.onFailure({ moduleId: desired.id, policy: desired.policy, hook: 'dispose', error: disposeError });
        }
        if (current) this.failActiveModule(current, 'settings-changed', error);
        else this.onFailure({ moduleId: desired.id, policy: desired.policy, hook: 'settings-changed', error });
        if (desired.policy === 'required') this.fatal = true;
        if (this.fatal) return;
        continue;
      }
      if (current) {
        this.tickElapsedSeconds.delete(current.id);
        this.tickHasRun.delete(current.id);
        try { current.instance.dispose?.(); } catch (error) {
          this.onFailure({ moduleId: current.id, policy: current.policy, hook: 'dispose', error });
        }
      }
      const active: ActiveGraphModuleV1 = {
        id: desired.id,
        policy: desired.policy,
        order: definition.order,
        definition,
        instance: replacement,
        settings: cloneJsonRecord(desired.settings),
      };
      if (currentIndex >= 0) this.active[currentIndex] = active;
      else this.active.push(active);
    }
    this.active.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  project(initial: GraphModuleProjectionStateV1): GraphModuleProjectionStateV1 {
    let state = initial;
    state = this.runProjectionHook(state, 'projectSource', 'project-source');
    state = { ...state, renderSelection: allOf(state.document) };
    state = this.runProjectionHook(state, 'projectTopology', 'project-topology');
    state = { ...state, renderSelection: allOf(state.document) };
    state = this.runProjectionHook(state, 'selectRender', 'select-render');
    return state;
  }

  contribute(state: GraphModulePresentationStateV1): GraphModulePresentationStateV1 {
    return this.runPresentationHook(state);
  }

  tick(state: GraphModulePipelineStateV1, deltaSeconds: number): import('./GraphModuleTypes.ts').GraphModuleTickResultV1 | undefined {
    if (this.fatal || this.disposed) return undefined;
    const choreographed = this.runChoreographyHook(state);
    let positions = choreographed.positions;
    let changed = false;
    let requestNextFrame = false;
    let nextFrameDelayMs: number | undefined;
    for (const module of [...this.active]) {
      if (!module.instance.tick) continue;
      try {
        const moduleState = { ...choreographed, positions };
        const preferredInterval = module.instance.preferredTickIntervalMs?.(moduleState);
        if (preferredInterval === null) {
          this.tickElapsedSeconds.delete(module.id);
          continue;
        }
        const elapsed = (this.tickElapsedSeconds.get(module.id) ?? 0) + Math.max(0, deltaSeconds);
        if (this.tickHasRun.has(module.id)
          && typeof preferredInterval === 'number' && Number.isFinite(preferredInterval)
          && elapsed * 1_000 + 1e-9 < Math.max(0, preferredInterval)) {
          this.tickElapsedSeconds.set(module.id, elapsed);
          requestNextFrame = true;
          const remaining = Math.max(0, preferredInterval - elapsed * 1_000);
          nextFrameDelayMs = nextFrameDelayMs === undefined ? remaining : Math.min(nextFrameDelayMs, remaining);
          continue;
        }
        this.tickElapsedSeconds.delete(module.id);
        const result = module.instance.tick(moduleState, elapsed);
        this.tickHasRun.add(module.id);
        if (result?.positions) {
          positions = result.positions;
          changed = true;
        }
        if (result?.requestNextFrame) {
          requestNextFrame = true;
          const requestedDelay = typeof result.nextFrameDelayMs === 'number' && Number.isFinite(result.nextFrameDelayMs)
            ? Math.max(0, result.nextFrameDelayMs)
            : 0;
          nextFrameDelayMs = nextFrameDelayMs === undefined
            ? requestedDelay
            : Math.min(nextFrameDelayMs, requestedDelay);
        }
      } catch (error) {
        this.failActiveModule(module, 'tick', error);
        if (this.fatal) break;
      }
    }
    const camera = choreographed.motionTargets?.camera;
    return changed || camera || requestNextFrame ? {
      ...(changed ? { positions } : {}),
      ...(camera ? { camera } : {}),
      ...(requestNextFrame || camera ? { requestNextFrame: true } : {}),
      ...(requestNextFrame && nextFrameDelayMs !== undefined ? { nextFrameDelayMs } : {}),
    } : undefined;
  }

  documentChanged(document: GraphDocumentV1): void {
    this.invokeLifecycle('onDocumentChanged', 'document-changed', document);
  }

  viewChanged(state: GraphViewStateV1): void {
    this.invokeLifecycle('onViewChanged', 'view-changed', state);
  }

  themeChanged(theme: GraphVisualThemeV2): void {
    this.themePalette = theme;
    this.invokeLifecycle('onThemeChanged', 'theme-changed', theme);
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

  getDiagnostics(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.active.flatMap((module) => {
      if (!module.instance.getDiagnostics) return [];
      try {
        return [[module.id, module.instance.getDiagnostics()] as const];
      } catch (error) {
        return [[module.id, { error: errorMessage(error) }] as const];
      }
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tickElapsedSeconds.clear();
    this.tickHasRun.clear();
    this.disposeActivated((failure) => this.onFailure(failure));
  }

  private readonly onFailure = (failure: GraphModuleFailureV1): void => {
    this.failureListener?.(failure);
  };

  private failureListener: ((failure: GraphModuleFailureV1) => void) | undefined;

  private runProjectionHook(
    initial: GraphModuleProjectionStateV1,
    method: 'projectSource' | 'projectTopology' | 'selectRender',
    hook: GraphModuleHookV1,
  ): GraphModuleProjectionStateV1 {
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

  private runPresentationHook(
    initial: GraphModulePresentationStateV1,
  ): GraphModulePresentationStateV1 {
    if (this.fatal || this.disposed) return initial;
    let state = initial;
    for (const module of [...this.active]) {
      const callback = module.instance.contributeFrame;
      if (!callback) continue;
      try {
        const patch = callback.call(module.instance, state);
        if (patch) state = applyPresentationPatch(state, patch);
      } catch (error) {
        this.failActiveModule(module, 'contribute-frame', error);
        if (this.fatal) break;
      }
    }
    return state;
  }

  private runChoreographyHook(
    initial: GraphModulePipelineStateV1,
  ): GraphModulePipelineStateV1 {
    if (this.fatal || this.disposed) return initial;
    let state = initial;
    for (const module of [...this.active]) {
      const callback = module.instance.choreograph;
      if (!callback) continue;
      try {
        const patch = callback.call(module.instance, state);
        if (patch) state = applyChoreographyPatch(state, patch);
      } catch (error) {
        this.failActiveModule(module, 'choreograph', error);
        if (this.fatal) break;
      }
    }
    return state;
  }

  private invokeLifecycle(
    method: 'onDocumentChanged' | 'onViewChanged' | 'onThemeChanged' | 'setSuspended',
    hook: GraphModuleHookV1,
    value: GraphDocumentV1 | GraphViewStateV1 | GraphVisualThemeV2 | boolean,
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
  state: GraphModuleProjectionStateV1,
  patch: GraphModuleProjectionPatchV1,
): GraphModuleProjectionStateV1 {
  return {
    ...state,
    document: patch.document ?? state.document,
    positions: patch.positions ?? state.positions,
    projectionSelection: patch.projectionSelection ?? state.projectionSelection,
    renderSelection: patch.renderSelection ?? state.renderSelection,
    formActive: patch.formActive ?? state.formActive,
    nodeRoles: patch.nodeRoles
      ? mergeRecords(state.nodeRoles, patch.nodeRoles)
      : state.nodeRoles,
    edgeRoles: patch.edgeRoles
      ? mergeRecords(state.edgeRoles, patch.edgeRoles)
      : state.edgeRoles,
    regions: patch.regions ?? state.regions,
    regionLayouts: patch.regionLayouts ?? state.regionLayouts,
    commitPositions: patch.commitPositions ?? state.commitPositions,
  };
}

function applyPresentationPatch(
  state: GraphModulePresentationStateV1,
  patch: GraphModulePresentationPatchV1,
): GraphModulePresentationStateV1 {
  return {
    ...state,
    nodeContributions: patch.nodeContributions
      ? mergeContributions(state.nodeContributions, patch.nodeContributions)
      : state.nodeContributions,
    edgeContributions: patch.edgeContributions
      ? mergeContributions(state.edgeContributions, patch.edgeContributions)
      : state.edgeContributions,
    regionContributions: patch.regionContributions ?? state.regionContributions,
    theme: patch.theme ?? state.theme,
    presentationPolicy: patch.presentationPolicy ?? state.presentationPolicy,
  };
}

function applyChoreographyPatch(
  state: GraphModulePipelineStateV1,
  patch: GraphModuleChoreographyPatchV1,
): GraphModulePipelineStateV1 {
  return {
    ...state,
    motionTargets: patch.motionTargets
      ? mergeMotionTargets(state.motionTargets ?? {}, patch.motionTargets)
      : state.motionTargets,
  };
}

function mergeRecords<T extends object>(
  base: Readonly<Record<string, T>>,
  addition: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  const result: Record<string, T> = { ...base };
  for (const [id, value] of Object.entries(addition) as Array<[string, T]>) {
    result[id] = { ...base[id], ...value } as T;
  }
  return result;
}

function mergeMotionTargets(
  base: import('./GraphModuleTypes.ts').GraphMotionTargetsV1,
  override: import('./GraphModuleTypes.ts').GraphMotionTargetsV1,
): import('./GraphModuleTypes.ts').GraphMotionTargetsV1 {
  return {
    ...base,
    ...override,
    nodePositions: override.nodePositions
      ? { ...(base.nodePositions ?? {}), ...override.nodePositions }
      : base.nodePositions,
    nodePositionOffsets: override.nodePositionOffsets
      ? { ...(base.nodePositionOffsets ?? {}), ...override.nodePositionOffsets }
      : base.nodePositionOffsets,
    edgeLengths: override.edgeLengths
      ? { ...(base.edgeLengths ?? {}), ...override.edgeLengths }
      : base.edgeLengths,
    edgeStrengthScales: override.edgeStrengthScales
      ? { ...(base.edgeStrengthScales ?? {}), ...override.edgeStrengthScales }
      : base.edgeStrengthScales,
    linkLengthScale: (base.linkLengthScale ?? 1) * (override.linkLengthScale ?? 1),
    linkStrengthScale: (base.linkStrengthScale ?? 1) * (override.linkStrengthScale ?? 1),
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

function cloneJsonRecord(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, JsonValue>>;
}

function sameJson(a: Readonly<Record<string, JsonValue>>, b: Readonly<Record<string, JsonValue>>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
