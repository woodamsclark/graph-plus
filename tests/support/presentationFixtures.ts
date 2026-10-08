import { CanvasGraphRenderer, GraphFrameStore } from '../../src/graph-engine/runtime/render/index.ts';
import { Vision } from '../../src/graph-engine/runtime/vision/index.ts';
import type { GraphDocumentV1, GraphViewStateV1, Vec3 } from '../../src/graph-engine/contracts/v1/index.ts';
import type { GraphFilterSelectionV1 } from '../../src/graph-engine/core/filter/index.ts';
import { compileAnimaSceneV1 } from '../../src/graph-engine/runtime/anima/AnimaSceneCompiler.ts';
import { createAnimusSnapshotV1 } from '../../src/graph-engine/runtime/animus/AnimusSnapshot.ts';
import { resolveConsciousness } from '../../src/graph-engine/runtime/consciousness/index.ts';
import type { GraphVisualThemeV2 } from '../../src/graph-engine/runtime/theme/index.ts';
import type {
  GraphEdgeRenderContributionV1,
  GraphNodeRenderContributionV1,
  GraphPresentationPolicyV2,
  GraphRegionRenderContributionV1,
  GraphRenderFrameV1,
} from '../../src/graph-engine/runtime/render/GraphRenderTypes.ts';

/** Test inputs enter through the explicit Animus snapshot and Anima compiler stages. */
export function compileFixtureFrame(options: {
  readonly document: GraphDocumentV1;
  readonly viewState: GraphViewStateV1;
  readonly selection: GraphFilterSelectionV1;
  readonly positions?: Readonly<Record<string, Vec3>>;
  readonly nodeContributions?: Readonly<Record<string, GraphNodeRenderContributionV1>>;
  readonly edgeContributions?: Readonly<Record<string, GraphEdgeRenderContributionV1>>;
  readonly regionContributions?: readonly GraphRegionRenderContributionV1[];
  readonly theme?: GraphVisualThemeV2;
  readonly presentationPolicy?: GraphPresentationPolicyV2;
  readonly hoveredNodeId?: string;
  readonly geometryRevision?: number;
}): GraphRenderFrameV1 {
  const consciousness = resolveConsciousness({
    attentionNodeIds: options.viewState.selectedNodeIds,
    availableNodeIds: options.selection.nodeIds,
  });
  return compileAnimaSceneV1({
    consciousness,
    snapshot: createAnimusSnapshotV1({
      document: options.document,
      viewState: options.viewState,
      displaySelection: options.selection,
      positions: options.positions ?? options.viewState.positions,
      hoveredNodeId: options.hoveredNodeId,
    }),
    nodeContributions: options.nodeContributions,
    edgeContributions: options.edgeContributions,
    regionContributions: options.regionContributions,
    theme: options.theme,
    presentationPolicy: options.presentationPolicy,
    geometryRevision: options.geometryRevision,
  });
}


/** Installs explicit scenes for standalone drawing tests at each observation boundary. */
export function sceneRendererFixture(canvas: HTMLCanvasElement, vision: Vision, frames: GraphFrameStore, now: () => number): CanvasGraphRenderer {
  const renderer = new CanvasGraphRenderer(canvas, now);
  renderer.initialize();
  const install = () => {
    const frame = frames.get();
    if (!frame) return;
    const viewport = vision.getViewport();
    renderer.updateScene({ ...frame, revision: 0, presentationRevision: 0, labels: [],
      view: { camera: vision.getState(), dimensions: vision.getState().projection === 'perspective' ? '3d' : '2d',
        viewport: { ...viewport, devicePixelRatio: 1 } } });
  };
  const render = renderer.render.bind(renderer);
  renderer.render = () => { install(); return render(); };
  const hitTest = renderer.hitTest.bind(renderer);
  renderer.hitTest = (...args) => { install(); return hitTest(...args); };
  return renderer;
}
