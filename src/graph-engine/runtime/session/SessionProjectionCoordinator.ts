import type { GraphViewStateV1 } from '../../contracts/v1/index.ts';
import { compileAnimaSceneV1 } from '../anima/index.ts';
import { createAnimusSnapshotV1 } from '../animus/index.ts';
import type { Consciousness } from '../consciousness/index.ts';
import type {
  GraphModuleHost,
  GraphModulePresentationStateV1,
  GraphModuleProjectionStateV1,
} from '../modules/index.ts';
import {
  GraphFrameStore,
  type GraphPresentationPolicyV2,
  type GraphRendererV2,
  type GraphRenderTimingV1,
} from '../render/index.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';
import type { SessionInvalidationClassV1 } from './SessionFrameScheduler.ts';

/** Owns the projection-to-frame boundary and its render dirty state for one session. */
export class SessionProjectionCoordinatorV1 {
  readonly frames = new GraphFrameStore();
  private dirty = true;
  private geometryRevision = 0;

  constructor(
    private readonly onProjection: () => void,
    private readonly onComposition: () => void,
  ) {}

  project(host: GraphModuleHost, state: GraphModuleProjectionStateV1): GraphModuleProjectionStateV1 {
    this.onProjection();
    return host.project(state);
  }

  compose(options: {
    readonly host: GraphModuleHost;
    readonly consciousness: Consciousness;
    readonly projectionView: GraphModuleProjectionStateV1;
    readonly viewState: GraphViewStateV1;
    readonly theme: GraphVisualThemeV2;
    readonly presentationPolicy: GraphPresentationPolicyV2;
    readonly draggedNodeId?: string;
    readonly hoveredNodeId?: string;
    readonly selectionPresentationSuspended?: boolean;
    readonly selectionNeighborRevealActive?: boolean;
    readonly previewedNodeId?: string;
    readonly invalidation: SessionInvalidationClassV1;
  }): GraphModulePresentationStateV1 {
    this.onComposition();
    if (options.invalidation === 'geometry' || options.invalidation === 'content') this.geometryRevision += 1;
    const consciousness = options.consciousness.reconcile({
      attentionNodeIds: options.viewState.selectedNodeIds,
      availableNodeIds: new Set(options.projectionView.document.nodes.map((node) => node.id)),
      relationships: documentRelationships(options.projectionView.document),
    });
    const moduleView = options.host.contribute({
      ...options.projectionView,
      viewState: options.viewState,
      consciousness,
      draggedNodeId: options.draggedNodeId,
      hoveredNodeId: options.hoveredNodeId,
      selectionPresentationSuspended: options.selectionPresentationSuspended,
      selectionNeighborRevealActive: options.selectionNeighborRevealActive,
      previewedNodeId: options.previewedNodeId,
      nodeContributions: {},
      edgeContributions: {},
      regionContributions: [],
      theme: options.theme,
      presentationPolicy: options.presentationPolicy,
      motionTargets: {},
    });
    const snapshot = createAnimusSnapshotV1({
      document: moduleView.document,
      viewState: options.viewState,
      displaySelection: moduleView.renderSelection,
      positions: moduleView.positions,
      nodeRoles: moduleView.nodeRoles,
      edgeRoles: moduleView.edgeRoles,
      regions: moduleView.regions,
      draggedNodeId: options.draggedNodeId,
      hoveredNodeId: options.hoveredNodeId,
      previewedNodeId: options.previewedNodeId,
      selectionPresentationSuspended: options.selectionPresentationSuspended,
      selectionNeighborRevealActive: options.selectionNeighborRevealActive,
    });
    this.frames.set(compileAnimaSceneV1({
      snapshot,
      consciousness,
      nodeContributions: moduleView.nodeContributions,
      edgeContributions: moduleView.edgeContributions,
      regionContributions: moduleView.regionContributions,
      theme: moduleView.theme,
      presentationPolicy: moduleView.presentationPolicy,
      geometryRevision: this.geometryRevision,
    }));
    this.dirty = true;
    return moduleView;
  }

  markDirty(): void { this.dirty = true; }

  markGeometryDirty(): void {
    this.geometryRevision += 1;
    const frame = this.frames.get();
    if (frame) this.frames.set({ ...frame, geometryRevision: this.geometryRevision });
    this.dirty = true;
  }

  render(renderer: GraphRendererV2): GraphRenderTimingV1 | undefined {
    if (!this.dirty) return undefined;
    const timing = renderer.render();
    this.dirty = false;
    return timing;
  }

  clear(): void {
    this.frames.set(null);
    this.dirty = false;
  }
}

function documentRelationships(
  document: GraphModuleProjectionStateV1['document'],
): ReadonlyMap<string, ReadonlySet<string>> {
  const relationships = new Map<string, Set<string>>(
    document.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of document.edges) {
    relationships.get(edge.sourceId)?.add(edge.targetId);
    relationships.get(edge.targetId)?.add(edge.sourceId);
  }
  return relationships;
}
