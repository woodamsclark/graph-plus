import {
  DEFAULT_GRAPH_RENDER_THEME_V1,
  GraphRendererRegistryV2,
  detectGraphRendererCapabilitiesV2,
  graphColorToCssV2,
  parseGraphColorV2,
  selectGraphRendererV2,
  type GraphRendererV2,
} from '../../src/graph-engine/runtime/index.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeHarness, runtimeSurface } from '../support/runtimeHarness.ts';

test('V2 theme colors normalize CSS inputs into renderer-neutral sRGB channels', () => {
  deepEqual(parseGraphColorV2('#1234'), {
    r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255, a: 0x44 / 255,
  }, 'short hex alpha should expand predictably');
  deepEqual(parseGraphColorV2('rgb(10% 20% 30% / 40%)'), {
    r: 0.1, g: 0.2, b: 0.3, a: 0.4,
  }, 'space-separated percentage RGB should normalize');
  deepEqual(parseGraphColorV2('hsl(120 100% 25% / 0.5)'), {
    r: 0, g: 0.5, b: 0, a: 0.5,
  }, 'HSL should normalize before reaching a renderer');
  equal(graphColorToCssV2(parseGraphColorV2('#12345680')!), 'rgba(18, 52, 86, 0.502)',
    'Canvas conversion should preserve normalized alpha');
});

test('V2 theme refresh recomposes presentation without rerunning graph projection', async () => {
  let theme = DEFAULT_GRAPH_RENDER_THEME_V1;
  const value = runtimeHarness({ resolveThemePalette: () => theme });
  const session = await value.create();
  value.platform.flushFrame(17);
  const before = value.factory.getDiagnostics().sessions[0];
  theme = {
    ...theme,
    colors: { ...theme.colors, node: parseGraphColorV2('#123456')! },
  };
  value.factory.refreshActiveThemes();
  value.platform.flushFrame(34);
  const after = value.factory.getDiagnostics().sessions[0];
  equal(after.counters?.projectionPasses, before.counters?.projectionPasses,
    'theme refresh must not rerun source, topology, or filter projection');
  equal(after.invalidationCounts.presentation, before.invalidationCounts.presentation + 1,
    'theme refresh should render as one presentation invalidation');
  assert(value.styleAssignments.includes('fillStyle:rgb(18, 52, 86)'),
    'the refreshed normalized token should reach Canvas2D');
  await session.dispose();
});

test('V2 capability detection and selection keep API support separate from registered backends', () => {
  const value = runtimeHarness();
  const capabilities = detectGraphRendererCapabilitiesV2(value.document, value.window as unknown as Window);
  equal(capabilities.canvas2d.apiAvailable, true, 'the current fallback API should be detected');
  equal(capabilities.webgl.apiAvailable, false, 'WebGL should be reported independently');
  equal(capabilities.webgl2.apiAvailable, false, 'WebGL2 should be reported independently');
  equal(capabilities.webgpu.apiAvailable, false, 'WebGPU API presence should be reported independently');

  let failedDisposals = 0;
  const registry = new GraphRendererRegistryV2();
  registry.register({
    backendId: 'webgl2', priority: 10, supports: () => true,
    create: ({ createCanvas }) => fakeRenderer('webgl2', createCanvas(), () => { failedDisposals += 1; }, true),
  });
  registry.register({
    backendId: 'canvas2d', priority: 0, supports: () => true,
    create: ({ createCanvas }) => fakeRenderer('canvas2d', createCanvas()),
  });
  const canvases: HTMLCanvasElement[] = [];
  const selection = selectGraphRendererV2({
    registry,
    capabilities,
    context: {
      createCanvas: () => {
        const canvas = value.document.createElement('canvas');
        canvases.push(canvas);
        return canvas;
      },
      now: () => 0,
    },
  });
  equal(selection.renderer.backendId, 'canvas2d', 'selection should fall back after initialization failure');
  equal(failedDisposals, 1, 'a failed backend should be disposed exactly once');
  equal(canvases.length, 2, 'each backend attempt should receive a fresh canvas');
  deepEqual(selection.attempts.map(({ backendId, ok }) => ({ backendId, ok })), [
    { backendId: 'webgl2', ok: false },
    { backendId: 'canvas2d', ok: true },
  ], 'diagnostics should preserve the attempted fallback chain');
  selection.renderer.dispose();
});

test('V2 mounted sessions expose selected backend diagnostics and DOM state', async () => {
  const value = runtimeHarness();
  const session = await value.create();
  equal(runtimeSurface(value.container).dataset.rendererBackend, 'canvas2d',
    'the session root should expose its selected renderer');
  const diagnostics = value.factory.getDiagnostics().sessions[0].renderer;
  equal(diagnostics.selectedBackendId, 'canvas2d', 'runtime diagnostics should expose the selected renderer');
  deepEqual(diagnostics.registeredBackendIds, ['canvas2d'], 'only implemented backends should be registered');
  await session.dispose();
});

test('V2 session runtime mounts a second renderer without graph or model changes', async () => {
  let sceneUpdates = 0;
  let renders = 0;
  let disposals = 0;
  const registry = new GraphRendererRegistryV2();
  registry.register({
    backendId: 'webgl2', priority: 10, supports: () => true,
    create: ({ createCanvas }) => {
      const renderer = fakeRenderer('webgl2', createCanvas(), () => { disposals += 1; });
      return {
        ...renderer,
        updateScene: () => { sceneUpdates += 1; },
        render: () => {
          renders += 1;
          return renderer.render();
        },
      };
    },
  });
  const value = runtimeHarness({ rendererRegistry: registry });
  const session = await value.create();
  value.platform.flushFrame(17);
  assert(sceneUpdates > 0, 'the alternate renderer should receive renderer-neutral scene updates');
  assert(renders > 0, 'the alternate renderer should own frame rendering');
  equal(value.factory.getDiagnostics().sessions[0].renderer.selectedBackendId, 'webgl2',
    'session diagnostics should identify the alternate renderer');
  await session.dispose();
  equal(disposals, 1, 'the alternate renderer should dispose with its session');
});

function fakeRenderer(
  backendId: 'canvas2d' | 'webgl2',
  interactionElement: HTMLCanvasElement,
  onDispose: () => void = () => undefined,
  fail = false,
): GraphRendererV2 {
  let lifecycle: 'created' | 'initialized' | 'disposed' = 'created';
  return {
    backendId,
    interactionElement,
    initialize: () => {
      if (fail) throw new Error('synthetic initialization failure');
      lifecycle = 'initialized';
    },
    resize: () => undefined,
    updateTheme: () => undefined,
    updateScene: () => undefined,
    render: () => ({
      projectionMs: 0, regionRenderMs: 0, edgeRenderMs: 0, nodeRenderMs: 0,
      labelLayoutMs: 0, labelDrawMs: 0,
    }),
    pick: () => null,
    queryNearest: () => null,
    getRendererDiagnostics: () => ({ backendId, lifecycle, resources: {} }),
    dispose: () => {
      if (lifecycle === 'disposed') return;
      lifecycle = 'disposed';
      interactionElement.remove();
      onDispose();
    },
  };
}
