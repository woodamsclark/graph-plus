import type { GraphCameraStateV1, GraphDimensionsV1, Vec3 } from '../../contracts/v1/index.ts';
import type { SessionInvalidationClassV1 } from '../session/index.ts';
import type { GraphVisualThemeV2 } from '../theme/index.ts';
import type { GraphRenderFrameV1 } from './GraphRenderTypes.ts';
import type { GraphRenderTimingV1 } from './CanvasGraphRenderer.ts';

export type GraphRendererBackendIdV2 = 'canvas2d' | 'webgl' | 'webgl2' | 'webgpu';

export interface GraphRenderViewportV2 {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface GraphViewTransformV2 {
  readonly dimensions: GraphDimensionsV1;
  readonly camera: GraphCameraStateV1;
  readonly viewport: GraphRenderViewportV2;
}

export interface GraphRenderSceneV2 extends GraphRenderFrameV1 {
  readonly cursorScreenPoint?: { readonly x: number; readonly y: number };
  readonly revision: number;
  readonly presentationRevision: number;
  readonly view: GraphViewTransformV2;
  readonly labels: readonly GraphRenderLabelV2[];
}

export interface GraphRenderLabelV2 {
  readonly id: string;
  readonly nodeId: string;
  readonly text: string;
  readonly color: import('../theme/index.ts').GraphColorV2;
  readonly opacity: number;
  readonly fontSizePx: number;
  readonly offset: { readonly x: number; readonly y: number };
  readonly visible: boolean;
  readonly priority: number;
  readonly alwaysVisible: boolean;
}

export interface GraphPickRequestV2 {
  readonly point: { readonly x: number; readonly y: number };
  readonly pointerKind?: 'mouse' | 'touch' | 'pen';
}

export interface GraphPickResultV2 {
  readonly nodeId: string;
  readonly position: Vec3;
  readonly depth: number;
}

export interface GraphRendererDiagnosticsV2 {
  readonly backendId: GraphRendererBackendIdV2;
  readonly lifecycle: 'created' | 'initialized' | 'disposed';
  readonly resources: Readonly<Record<string, number>>;
}

export interface GraphRendererV2 {
  readonly backendId: GraphRendererBackendIdV2;
  readonly interactionElement: HTMLElement;
  initialize(): void | Promise<void>;
  resize(viewport: GraphRenderViewportV2): void;
  updateTheme(theme: GraphVisualThemeV2): void;
  updateScene(scene: GraphRenderSceneV2, invalidations: readonly SessionInvalidationClassV1[]): void;
  render(): GraphRenderTimingV1;
  pick(request: GraphPickRequestV2): GraphPickResultV2 | null;
  getRendererDiagnostics(): GraphRendererDiagnosticsV2;
  dispose(): void;
}

export interface GraphRendererFactoryContextV2 {
  readonly createCanvas: () => HTMLCanvasElement;
  readonly now: () => number;
}

export interface GraphRendererFactoryV2 {
  readonly backendId: GraphRendererBackendIdV2;
  readonly priority: number;
  supports(capabilities: GraphRendererCapabilitiesV2): boolean;
  create(context: GraphRendererFactoryContextV2): GraphRendererV2;
}

export interface GraphRendererCapabilitiesV2 {
  readonly canvas2d: { readonly apiAvailable: boolean };
  readonly webgl: { readonly apiAvailable: boolean };
  readonly webgl2: { readonly apiAvailable: boolean };
  readonly webgpu: { readonly apiAvailable: boolean };
}

export interface GraphRendererSelectionV2 {
  readonly renderer: GraphRendererV2;
  readonly capabilities: GraphRendererCapabilitiesV2;
  readonly registeredBackendIds: readonly GraphRendererBackendIdV2[];
  readonly attempts: readonly {
    readonly backendId: GraphRendererBackendIdV2;
    readonly ok: boolean;
    readonly reason?: string;
  }[];
}
