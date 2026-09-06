import type { Disposable, GraphEngineConnectionErrorV1 } from '../contracts/v1/index.ts';

export const GRAPH_ENGINE_UNAVAILABLE_COPY_V1 =
  'graph-engine is unavailable or not installed. This feature requires graph-engine.';

export function mountGraphEngineUnavailableSurfaceV1(
  container: HTMLElement,
  error?: GraphEngineConnectionErrorV1,
): Disposable {
  const surface = container.ownerDocument.createElement('div');
  surface.className = 'graph-engine-unavailable';
  surface.dataset.graphEngineError = error?.code ?? 'engine-unavailable';
  surface.setAttribute('role', 'status');
  surface.textContent = GRAPH_ENGINE_UNAVAILABLE_COPY_V1;
  container.appendChild(surface);
  return { dispose: () => surface.remove() };
}
