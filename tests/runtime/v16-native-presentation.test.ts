import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/index.ts';
import {
  CanvasGraphRenderer,
  composeGraphRenderFrameV1,
  DEFAULT_GRAPH_RENDER_THEME_V1,
  DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
  GraphFrameStore,
} from '../../src/graph-engine/runtime/render/index.ts';
import { parseGraphColorV2 } from '../../src/graph-engine/runtime/theme/index.ts';
import { GraphCameraController } from '../../src/graph-engine/runtime/camera/index.ts';
import { AnimaModule } from '../../src/graph-engine/runtime/modules/shipped/AnimaModule.ts';
import {
  ForceLayoutModule,
  readForceSettings,
} from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutModule.ts';
import {
  GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  migrateGraphPlusProfileOverridesV16,
} from '../../src/graph-plus/consumer/index.ts';
import {
  DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2,
  ThemeStyleResolver,
} from '../../src/obsidian/themeStyleResolver.ts';
import { graphDocument, graphEdge, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeCanvas, runtimeHarness } from '../support/runtimeHarness.ts';

test('V1.6 Anima owns the exact visible-degree radius and composable structural scale', () => {
  const nodes = [graphNode('hub'), ...Array.from({ length: 9 }, (_, index) => graphNode(`leaf-${index}`))];
  const edges = Array.from({ length: 9 }, (_, index) => graphEdge(`edge-${index}`, 'hub', `leaf-${index}`, { directed: true }));
  edges.push(graphEdge('duplicate', 'hub', 'leaf-0', { directed: true }));
  const document = graphDocument({ nodes, edges });
  const selection = { nodeIds: new Set(nodes.map((node) => node.id)), edgeIds: new Set(edges.map((edge) => edge.id)) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const patch = anima.contributeFrame({
    ...state,
    nodeContributions: { hub: { baseRadiusScale: 2, radiusScale: 1.35 } },
  });
  assert(patch && patch.nodeContributions, 'new-mode Anima should contribute final geometry');
  const expected = 2 * 1.35 * 3 * Math.sqrt(10);
  assert(Math.abs((patch.nodeContributions.hub.radius ?? 0) - expected) < 1e-10,
    'hub radius should use the exact formula and ignore duplicate ordered relationships');
  equal(patch.nodeContributions['leaf-0'].radius, 8, 'low-degree nodes should use the exact lower clamp');
  equal(patch.presentationPolicy?.nodeScaleMode, 'sqrt-orthographic', 'Anima should request native-style 2d node scaling');
  equal(patch.presentationPolicy?.nodeWorldScaleBlend, 0, 'Anima should default to balanced node scaling');
  equal(patch.presentationPolicy?.labelScaleMode, 'fixed', 'Anima labels should remain screen-readable in both dimensions');
});

test('Anima exposes a clamped continuous blend from balanced to world-space node scaling', () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const state = pipeline(document, { nodeIds: new Set(['a']), edgeIds: new Set() });
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, { nodeWorldScaleBlend: 0.5 });
  equal(anima.contributeFrame(state)?.presentationPolicy?.nodeWorldScaleBlend, 0.5,
    'Anima should publish intermediate scale-space values');
  anima.updateSettings({ nodeWorldScaleBlend: 4 });
  equal(anima.contributeFrame(state)?.presentationPolicy?.nodeWorldScaleBlend, 1,
    'Anima should clamp saved scale-space values to world space');
});

test('Anima separates undimmed overview hover from tagged Explore presentation', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b'), graphNode('c'), graphNode('d')],
    edges: [graphEdge('a-b', 'a', 'b'), graphEdge('b-c', 'b', 'c'), graphEdge('a-d', 'a', 'd')],
  });
  const selection = { nodeIds: new Set(['a', 'b', 'c', 'd']), edgeIds: new Set(['a-b', 'b-c', 'a-d']) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const overviewHover = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'b',
  });
  assert(overviewHover?.nodeContributions && overviewHover.edgeContributions,
    'overview hover should produce node and edge presentation');
  equal(overviewHover.nodeContributions.a.opacity, 1, 'a hovered node neighbor should remain fully visible');
  equal(overviewHover.nodeContributions.d.opacity, 1, 'overview hover must not dim unrelated nodes');
  deepEqual(overviewHover.nodeContributions.a.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'overview hover should light direct neighbors');
  deepEqual(overviewHover.nodeContributions.b.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'overview hover should light the hovered node');
  equal(overviewHover.nodeContributions.b.labelAlwaysVisible, false,
    'overview hover should not promote the hovered node label');
  equal(overviewHover.nodeContributions.c.labelAlwaysVisible, false,
    'overview hover should not promote a neighboring node label');
  equal(overviewHover.edgeContributions['a-d'].opacity, 1, 'overview hover must not dim unrelated links');
  deepEqual(overviewHover.edgeContributions['a-b'].color, DEFAULT_GRAPH_RENDER_THEME_V1.colors.highlightedNode,
    'overview hover should light incident links');

  const taggedA = anima.contributeFrame({
    ...state,
    viewState: { ...state.viewState, selectedNodeIds: ['a'], focusedNodeId: 'a' },
  });
  assert(taggedA?.nodeContributions && taggedA.edgeContributions, 'Explore presentation should resolve tagged nodes');
  equal(taggedA.nodeContributions.a.opacity, 1, 'the tagged node should remain fully visible');
  equal(taggedA.nodeContributions.b.opacity, 0.2, 'tagging must not automatically reveal direct neighbors');
  deepEqual(taggedA.nodeContributions.a.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'the tagged node should light up');
  equal(taggedA.edgeContributions['a-b'].opacity, 0.2, 'a single tag should not light its neighborhood links');

  const taggedStructure = anima.contributeFrame({
    ...state,
    viewState: { ...state.viewState, selectedNodeIds: ['a', 'b'], focusedNodeId: 'b' },
  });
  assert(taggedStructure?.edgeContributions, 'multi-tag presentation should include structural links');
  equal(taggedStructure.edgeContributions['a-b'].opacity, 1, 'a link between tagged nodes should remain bright');
  equal(taggedStructure.edgeContributions['b-c'].opacity, 0.2, 'links outside the tagged structure should dim');

  const exploredHover = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'c',
    viewState: { ...state.viewState, selectedNodeIds: ['a'], focusedNodeId: 'a' },
  });
  assert(exploredHover?.nodeContributions && exploredHover.edgeContributions,
    'Explore hover should temporarily reveal its local neighborhood');
  equal(exploredHover.nodeContributions.b.opacity, 1, 'an immediate neighbor of the hovered node should be revealed');
  equal(exploredHover.nodeContributions.d.opacity, 0.2, 'unrelated untagged nodes should remain dim');
  deepEqual(exploredHover.nodeContributions.c.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'the hovered node should light independently from tagged nodes');
  equal(exploredHover.edgeContributions['b-c'].opacity, 1, 'the hovered node links should be revealed');

  const suspended = anima.contributeFrame({
    ...state,
    selectionPresentationSuspended: true,
    viewState: { ...state.viewState, selectedNodeIds: ['a', 'b'] },
  });
  assert(suspended?.nodeContributions, 'a Shift-held Overview should contribute presentation');
  equal(suspended.nodeContributions.c.opacity, 1, 'Shift should suspend background dimming without clearing tags');
  deepEqual(suspended.nodeContributions.a.finalColor, DEFAULT_GRAPH_RENDER_THEME_V1.colors.animaAccent,
    'tagged nodes should remain lit while selection presentation is suspended');

  const previewedA = anima.contributeFrame({
    ...state,
    previewedNodeId: 'a',
    viewState: { ...state.viewState, selectedNodeIds: ['c'], focusedNodeId: 'c' },
  });
  assert(previewedA?.edgeContributions, 'semantic preview should produce Anima presentation');
  equal(previewedA.edgeContributions['a-b'].opacity, 1,
    'Anima preview should own the active neighborhood independently from focus and ordinary hover');
  equal(previewedA.edgeContributions['b-c'].opacity, 0.2,
    'the tagged structure should yield while a semantic preview target is active');
  equal(previewedA.edgeContributions['a-d'].opacity, 1,
    'semantic preview should preserve its own incident links');

  const cleared = anima.contributeFrame(state);
  assert(cleared?.edgeContributions, 'cleared focus should still resolve baseline edge presentation');
  equal(cleared.edgeContributions['a-b'].opacity, 1, 'clearing focus should restore ordinary link opacity');
  equal(cleared.edgeContributions['b-c'].opacity, 1, 'no prior focus highlight should remain latched');
  equal(cleared.edgeContributions['a-d'].opacity, 1, 'clearing focus should restore every ordinary link');
});

test('V2 adaptive labels stay inside tagged and inspected structures', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b'), graphNode('c')],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const selection = { nodeIds: new Set(['a', 'b', 'c']), edgeIds: new Set(['a-b']) };
  const state = pipeline(document, selection);
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, {});
  const adaptive = anima.contributeFrame({
    ...state,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'adaptive' },
    viewState: { ...state.viewState, selectedNodeIds: ['a'], focusedNodeId: 'a' },
  });
  assert(adaptive?.nodeContributions, 'tagged adaptive presentation should contribute nodes');
  equal(adaptive.nodeContributions.a.showLabel, true, 'the tagged node label should remain eligible');
  equal(adaptive.nodeContributions.b.showLabel, false, 'tagging alone should not reveal a neighbor label');
  equal(adaptive.nodeContributions.c.showLabel, false, 'an unrelated node label should be suppressed');

  const inspected = anima.contributeFrame({
    ...state,
    hoveredNodeId: 'b',
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'adaptive' },
    viewState: { ...state.viewState, selectedNodeIds: ['a'], focusedNodeId: 'a' },
  });
  equal(inspected?.nodeContributions?.b.showLabel, true, 'hover should reveal its node label in Explore mode');

  const all = anima.contributeFrame({
    ...state,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'all' },
    viewState: { ...state.viewState, selectedNodeIds: ['a'], focusedNodeId: 'a' },
  });
  equal(all?.nodeContributions?.c.showLabel, true, 'All labels should remain an explicit override');
});

test('V1.6 Anima owns live above and below label placement', () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const state = pipeline(document, { nodeIds: new Set(['a']), edgeIds: new Set() });
  const anima = new AnimaModule(DEFAULT_GRAPH_RENDER_THEME_V1, { labelPosition: 'above' });
  equal(anima.contributeFrame(state)?.presentationPolicy?.labelPosition, 'above',
    'Anima should publish the configured above placement');
  anima.updateSettings({ labelPosition: 'below' });
  equal(anima.contributeFrame(state)?.presentationPolicy?.labelPosition, 'below',
    'Anima should update label placement without remounting');
});

test('V1.6 Anima labels retain their CSS size across orthographic zoom', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 10 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 0.25,
    projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [{
      id: 'hub', label: 'hub', position: { x: 0, y: 0, z: 0 }, radius: 24,
      selected: false, focused: false, hovered: false, labelFontSize: 20,
    }],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    policy: {
      ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      labelMode: 'all',
      labelScaleMode: 'fixed',
    },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  assert(value.styleAssignments.includes('font:20px sans-serif'),
    'zoomed-out 2D should keep the resolved label font size');

  value.styleAssignments.length = 0;
  camera.setState({ ...camera.getState(), zoom: 4 });
  renderer.render();
  assert(value.styleAssignments.includes('font:20px sans-serif'),
    'zoomed-in 2D should keep the same resolved label font size');
});

test('orthographic node scaling interpolates between balanced and world space', () => {
  const arcRadii: number[] = [];
  const context = recordingContext([], arcRadii);
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 4, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  const node = {
    id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 10,
    selected: false, focused: false, hovered: false,
  };
  const renderAt = (blend: number): number => {
    arcRadii.length = 0;
    frames.set({
      regions: [], edges: [], nodes: [node], theme: DEFAULT_GRAPH_RENDER_THEME_V1,
      policy: {
        ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
        nodeScaleMode: 'sqrt-orthographic',
        nodeWorldScaleBlend: blend,
      },
    });
    renderer.render();
    return arcRadii[0];
  };
  equal(renderAt(0), 20, 'balanced scaling should use the square root of zoom');
  assert(Math.abs(renderAt(0.5) - 10 * Math.pow(4, 0.75)) < 1e-10,
    'the midpoint should interpolate the zoom exponent');
  equal(renderAt(1), 40, 'world-space scaling should use the full zoom factor');
});

test('V1.6 renderer anchors labels above or below the resolved node boundary', () => {
  const fillTextY: number[] = [];
  const context = recordingContext(fillTextY);
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic',
  }, '2d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  const node = {
    id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 8,
    selected: false, focused: false, hovered: false,
  };
  frames.set({
    regions: [], edges: [], nodes: [node],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'all', labelPosition: 'below' },
  });
  renderer.render();
  equal(fillTextY.pop(), 192, 'below should begin four pixels beneath the eight-pixel node');
  frames.set({
    regions: [], edges: [], nodes: [node],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    policy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, labelMode: 'all', labelPosition: 'above' },
  });
  renderer.render();
  equal(fillTextY.pop(), 156, 'above should clear the node and the twelve-pixel label height');
});

test('V1.6 presentation aggregation preserves reciprocal direction without mutating canonical edges', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [
      graphEdge('a-b-1', 'a', 'b', { directed: true }),
      graphEdge('a-b-2', 'a', 'b', { directed: true }),
      graphEdge('b-a', 'b', 'a', { directed: true }),
    ],
  });
  const selection = { nodeIds: new Set(['a', 'b']), edgeIds: new Set(document.edges.map((edge) => edge.id)) };
  const frame = composeGraphRenderFrameV1({
    document,
    viewState: viewState(document),
    selection,
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, edgeAggregation: 'unordered-pair', showArrows: true },
  });
  equal(frame.edges.length, 1, 'parallel and reciprocal canonical edges should render as one shaft');
  equal(frame.edges[0].arrowAtSource, true, 'the shaft should preserve its reverse direction marker');
  equal(frame.edges[0].arrowAtTarget, true, 'the shaft should preserve its forward direction marker');
  equal(document.edges.length, 3, 'presentation aggregation must not change canonical edge records');
});

test('V1.6 frame composition carries future Anima label and arrow targets to rendering', () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('a-b', 'a', 'b', { directed: true })],
  });
  const frame = composeGraphRenderFrameV1({
    document,
    viewState: viewState(document),
    selection: { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['a-b']) },
    nodeContributions: {
      a: { finalColor: parseGraphColorV2('#123456'), labelOffset: { x: 3, y: -4 } },
    },
    edgeContributions: {
      'a-b': {
        arrowAtSource: true, arrowAtTarget: false,
        arrowColor: parseGraphColorV2('#abcdef'), arrowOpacity: 0.4,
      },
    },
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    presentationPolicy: { ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2, showArrows: true },
  });
  deepEqual(frame.nodes[0].finalColor, parseGraphColorV2('#123456'), 'Anima final fill should reach the render frame');
  deepEqual(frame.nodes[0].labelOffset, { x: 3, y: -4 }, 'label offsets should survive composition');
  equal(frame.edges[0].arrowAtSource, true, 'Anima should be able to show a source arrow');
  equal(frame.edges[0].arrowAtTarget, false, 'Anima should be able to suppress a canonical target arrow');
  deepEqual(frame.edges[0].arrowColor, parseGraphColorV2('#abcdef'), 'arrow color should be independent from shaft color');
  equal(frame.edges[0].arrowOpacity, 0.4, 'arrow opacity should be independent from shaft opacity');
});

test('V1.6 host theme probes resolve native graph roles, opacity, and CSS-variable fallbacks', () => {
  const value = runtimeHarness();
  const style = value.document.createElement('style');
  style.textContent = [
    '.graph-view.color-fill { color: rgb(10, 20, 30); opacity: 0.5; }',
    '.graph-view.color-line { color: rgb(40, 50, 60); }',
    '.graph-view.color-text { color: rgb(70, 80, 90); }',
    '.graph-view.color-arrow { color: rgb(100, 110, 120); }',
    '.graph-view.color-fill-focused { color: rgb(130, 140, 150); }',
    '.graph-view.color-circle { color: rgb(160, 170, 180); }',
  ].join('\n');
  value.document.head.append(style);
  value.document.body.style.setProperty('--native-tag', 'rgb(190, 200, 210)');
  value.document.body.style.setProperty('--graph-node-tag', 'var(--native-tag)');
  const palette = new ThemeStyleResolver(() => value.document.body).getPalette();
  deepEqual(palette.colors.node, parseGraphColorV2('rgba(10, 20, 30, 0.5)'), 'native node opacity should be folded into its resolved color');
  deepEqual(palette.colors.tagNode, parseGraphColorV2('rgb(190, 200, 210)'), 'nested graph CSS variables should resolve before reaching Anima');
  deepEqual(palette.colors.edge, parseGraphColorV2('rgb(40, 50, 60)'), 'native line role should outrank generic fallbacks');
  deepEqual(palette.colors.label, parseGraphColorV2('rgb(70, 80, 90)'), 'native text role should be sampled');
  deepEqual(palette.colors.arrow, parseGraphColorV2('rgb(100, 110, 120)'), 'native arrow role should be sampled separately');
  deepEqual(palette.colors.highlightedNode, parseGraphColorV2('rgb(130, 140, 150)'), 'native focus role should drive interaction highlighting');
  deepEqual(palette.colors.nodeOutline, parseGraphColorV2('rgb(160, 170, 180)'), 'native circle role should drive outlines');
});

test('V2 default Obsidian theme uses the Graph+ kosmos palette without affecting community themes', () => {
  const value = runtimeHarness();
  value.document.body.style.color = 'rgb(220, 220, 220)';
  value.document.body.style.backgroundColor = 'rgb(30, 30, 30)';

  const defaultPalette = new ThemeStyleResolver(() => value.document.body, () => true).getPalette(7);
  equal(defaultPalette.revision, 7, 'the hard-coded default-theme palette should retain the requested revision');
  deepEqual(defaultPalette.colors, DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2.colors,
    'the stock Obsidian theme should use the restrained Graph+ kosmos colors');
  deepEqual(defaultPalette.colors.background, parseGraphColorV2('#0b0810'), 'the default graph field should be near-black');
  deepEqual(defaultPalette.colors.node, parseGraphColorV2('#4b3562'), 'ordinary nodes should be dark plum');
  deepEqual(defaultPalette.colors.tagNode, parseGraphColorV2('#e1d7eb'), 'tag nodes should be pale lavender-white');

  const style = value.document.createElement('style');
  style.textContent = '.graph-view.color-fill { color: rgb(12, 34, 56); }';
  value.document.head.append(style);
  const communityPalette = new ThemeStyleResolver(() => value.document.body, () => false).getPalette();
  deepEqual(communityPalette.colors.node, parseGraphColorV2('rgb(12, 34, 56)'),
    'a selected community theme should continue to own its graph node color');
});

test('Graph+ color overrides layer over the active Obsidian palette', () => {
  const value = runtimeHarness();
  value.document.body.style.backgroundColor = 'rgb(30, 30, 30)';
  const palette = new ThemeStyleResolver(
    () => value.document.body,
    () => true,
    () => ({ background: '#102030', noteNode: '#405060', tagNode: '#708090' }),
  ).getPalette();
  deepEqual(palette.colors.background, parseGraphColorV2('#102030'), 'background override should replace the resolved theme field');
  deepEqual(palette.colors.node, parseGraphColorV2('#405060'), 'note override should replace the ordinary node role');
  deepEqual(palette.colors.tagNode, parseGraphColorV2('#708090'), 'tag override should replace the tag node role');
  deepEqual(palette.colors.edge, DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2.colors.edge,
    'unoverridden theme roles should retain their resolved palette values');
});

test('V1.6 new-mode 3D preserves depth while keeping nodes visible and finger-selectable', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 5000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  }, '3d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [
      {
        id: 'a', label: 'a', position: { x: 0, y: 0, z: 0 }, radius: 8,
        selected: false, focused: false, hovered: false,
      },
      {
        id: 'hub', label: 'hub', position: { x: 1_000, y: 0, z: 0 }, radius: 24,
        selected: false, focused: false, hovered: false,
      },
    ],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    policy: {
      ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      minimumPerspectiveNodeRadius: 4,
      minimumPerspectiveNodeScale: 0.5,
      minimumPerspectiveTouchHitRadius: 22,
    },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  equal(renderer.hitTest({ x: 324, y: 180 })?.nodeId, 'a',
    'the visible perspective disc should retain a four-pixel radius at long range');
  equal(renderer.hitTest({ x: 335, y: 180 }), null,
    'mouse hit testing should still follow the visible node geometry');
  equal(renderer.hitTest({ x: 335, y: 180 }, 'touch')?.nodeId, 'a',
    'perspective touch should receive a 44-pixel finger target without enlarging the disc');
  const radii = value.drawArguments
    .filter((call) => call.method === 'arc')
    .map((call) => call.args[2]);
  assert(radii.includes(4), 'a minimum-size node should retain the four-pixel base floor');
  assert(radii.includes(12), 'a hub should retain its degree-relative radius at long range');
});

test('V1.6 adaptive labels reserve overlap space for structural hubs before nearer leaves', () => {
  const value = runtimeHarness();
  const canvas = value.document.createElement('canvas');
  const camera = new GraphCameraController({
    position: { x: 0, y: 0, z: 5_000 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 50 / 24,
    projection: 'perspective',
  }, '3d');
  camera.setViewport(640, 360);
  const frames = new GraphFrameStore();
  frames.set({
    regions: [], edges: [],
    nodes: [
      {
        id: 'z-hub', label: 'hub', position: { x: 0, y: 0, z: 0 }, radius: 24,
        selected: false, focused: false, hovered: false, labelFontSize: 14,
        labelOffset: { x: 0, y: -8 },
      },
      {
        id: 'a-leaf', label: 'leaf', position: { x: 0, y: 0, z: 4_500 }, radius: 8,
        selected: false, focused: false, hovered: false, labelFontSize: 14,
      },
    ],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
    policy: {
      ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
      labelMode: 'adaptive',
      labelPosition: 'below',
      minimumPerspectiveNodeRadius: 4,
      minimumPerspectiveNodeScale: 0.5,
    },
  });
  const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
  renderer.resize(640, 360, 1);
  renderer.render();
  deepEqual(value.drawArguments
    .filter((call) => call.method === 'fillText')
    .map((call) => call.args[0]), ['hub'],
  'world-space node prominence should win label collisions before perspective proximity');
});

test('V1.6 adaptive label budget follows perspective distance and the active threshold', () => {
  const renderAtDistance = (distance: number, threshold = 50): number => {
    const value = runtimeHarness();
    const canvas = value.document.createElement('canvas');
    const camera = new GraphCameraController({
      position: { x: 0, y: 0, z: distance },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 50 / 24,
      projection: 'perspective',
    }, '3d');
    camera.setViewport(640, 360);
    const coordinateScale = 360 * (50 / 24) / distance;
    const frames = new GraphFrameStore();
    frames.set({
      regions: [], edges: [],
      nodes: Array.from({ length: 30 }, (_, index) => ({
        id: `node-${index}`,
        label: `${index}`,
        position: {
          x: ((index % 5) - 2) * 50 / coordinateScale,
          y: (Math.floor(index / 5) - 2.5) * 40 / coordinateScale,
          z: 0,
        },
        radius: 8,
        selected: false,
        focused: false,
        hovered: false,
        labelFontSize: 10,
      })),
      theme: DEFAULT_GRAPH_RENDER_THEME_V1,
      policy: {
        ...DEFAULT_GRAPH_PRESENTATION_POLICY_V2,
        labelMode: 'adaptive',
        labelPosition: 'below',
        adaptiveLabelThreshold: threshold,
        minimumPerspectiveNodeRadius: 4,
        minimumPerspectiveNodeScale: 0.5,
      },
    });
    const renderer = new CanvasGraphRenderer(canvas, camera, frames, () => 0);
    renderer.resize(640, 360, 1);
    renderer.render();
    return value.drawArguments.filter((call) => call.method === 'fillText').length;
  };

  const far = renderAtDistance(5_000);
  const near = renderAtDistance(100);
  const stricter = renderAtDistance(100, 100);
  equal(far, 12, 'a distant perspective overview should begin at the minimum label budget');
  assert(near > far, 'dollying closer should reveal additional adaptive labels');
  assert(stricter < near, 'raising the active label threshold should reduce ordinary labels at the same zoom');
});

test('V1.7 D3-compatible integration advances at most once after a delayed frame', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const settings = readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0,
    centeringStrength: 0, collisionRadius: 0, springStrength: 1, springLength: 250,
  });
  const one = new ForceLayoutModule('2d', settings);
  const two = new ForceLayoutModule('2d', settings);
  const initial = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const delayed = one.tick(initial, 1 / 30);
  assert(delayed?.positions, 'a delayed frame should still advance one fixed simulation step');
  const ordinary = two.tick(initial, 1 / 60);
  assert(ordinary?.positions, 'an ordinary 60Hz frame should advance one fixed simulation step');
  deepEqual(delayed.positions, ordinary.positions,
    'a delayed callback must discard catch-up backlog instead of bursting through multiple simulation steps');
});

test('V1.6 D3-compatible link integration matches the reviewed one-tick equation', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const alphaDecay = 1 - Math.pow(0.001, 1 / 300);
  const force = new ForceLayoutModule('2d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0,
    centeringStrength: 0, collisionRadius: 0, springStrength: 1, springLength: 250,
    velocityDecay: 0.4, alphaDecay,
  }));
  const initial = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const result = force.tick(initial, 1 / 60);
  assert(result?.positions, 'one fixed tick should move the linked nodes');
  const alpha = 1 - alphaDecay;
  const expectedMovement = ((400 - 250) * alpha * 0.5) * 0.6;
  assert(Math.abs(result.positions.left.x - (-200 + expectedMovement)) < 1e-10,
    'source movement should match D3 link bias followed by velocity decay');
  assert(Math.abs(result.positions.right.x - (200 - expectedMovement)) < 1e-10,
    'target movement should mirror the D3 link step');
});

test('high link strength converges without crossing its target in one integration step', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, centeringStrength: 0, collisionRadius: 0,
    springStrength: 4, springLength: 250, velocityDecay: 0.4,
  }));
  const result = force.tick(pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  }), 1 / 60);
  assert(result?.positions, 'a high-strength spring should still advance the layout');
  const distance = Math.abs(result.positions.right.x - result.positions.left.x);
  assert(distance >= 250,
    'a high-strength spring must not overshoot through its target distance in one step');
  assert(distance < 400, 'a high-strength spring should still move monotonically toward its target');
});

test('active drag scales heat down when its incident link strength is high', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const state = {
    ...pipeline(document, {
      nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
    }),
    draggedNodeId: 'left',
  };
  const baseSettings = {
    repulsionStrength: 0, centeringStrength: 0, collisionRadius: 0,
    springLength: 250, velocityDecay: 0.4,
  };
  const ordinary = new ForceLayoutModule('2d', readForceSettings({ ...baseSettings, springStrength: 1 }));
  const strong = new ForceLayoutModule('2d', readForceSettings({ ...baseSettings, springStrength: 5 }));
  ordinary.tick(state, 1 / 60);
  strong.tick(state, 1 / 60);
  const ordinaryAlpha = ordinary.getDiagnostics().alpha;
  const strongAlpha = strong.getDiagnostics().alpha;
  assert(Math.abs(ordinaryAlpha - 0.3) < 1e-12,
    'ordinary incident links should retain the familiar active-drag heat');
  assert(strongAlpha < ordinaryAlpha,
    'strong incident links should reduce active-drag heat immediately, even from startup alpha 1');
  assert(strongAlpha <= ordinaryAlpha / 2,
    'high-strength drag heat should be materially lower than ordinary drag heat');
});

test('link distance does not change disconnected-component packing', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -100, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 100, y: 0, z: 0 } }),
      graphNode('orphan', { positionHint: { x: 0, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right', 'orphan']), edgeIds: new Set(['join']),
  });
  const settings = {
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0.1,
    collisionRadius: 0, velocityDecay: 0.4,
  };
  const compact = new ForceLayoutModule('2d', readForceSettings({ ...settings, springLength: 20 }));
  const spacious = new ForceLayoutModule('2d', readForceSettings({ ...settings, springLength: 500 }));
  const compactResult = compact.tick(state, 1 / 60);
  const spaciousResult = spacious.tick(state, 1 / 60);
  assert(compactResult?.positions && spaciousResult?.positions,
    'component packing should move the disconnected orphan in both layouts');
  deepEqual(compactResult.positions.orphan, spaciousResult.positions.orphan,
    'an orphan packing target must be independent of linked-node distance');
});

test('V1.6 D3-compatible mechanics remain finite and spatial in 3D', () => {
  const document = graphDocument({
    nodes: [
      graphNode('a', { positionHint: { x: 0, y: 0, z: -100 } }),
      graphNode('b', { positionHint: { x: 0, y: 0, z: 100 } }),
    ],
    edges: [graphEdge('a-b', 'a', 'b')],
  });
  const force = new ForceLayoutModule('3d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 1000,
    centeringStrength: 0.1, collisionRadius: 60, collisionStrength: 0.5,
    springStrength: 1, springLength: 250, velocityDecay: 0.4,
    alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  }));
  let state = pipeline(document, {
    nodeIds: new Set(['a', 'b']), edgeIds: new Set(['a-b']),
  });
  state = { ...state, positions: viewState(document).positions, viewState: {
    ...state.viewState, dimensions: '3d', positions: viewState(document).positions,
    camera: { ...state.viewState.camera, projection: 'perspective' },
  } };
  const result = force.tick(state, 1 / 60);
  assert(result?.positions, '3D forces should advance nonzero depth positions');
  assert(Object.values(result.positions).every((position) =>
    Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)),
  '3D force integration should remain finite');
  assert(result.positions.a.z !== -100 || result.positions.b.z !== 100, 'Z should participate in native force integration');
});

test('V1.6 force integration rejects hostile restored motion and enforces maxSpeed', () => {
  const document = graphDocument({
    nodes: [
      graphNode('left', { positionHint: { x: -200, y: 0, z: 0 } }),
      graphNode('right', { positionHint: { x: 200, y: 0, z: 0 } }),
    ],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const maxSpeed = 10;
  const force = new ForceLayoutModule('2d', readForceSettings({
    weightingMode: 'uniform', repulsionStrength: 0, centeringStrength: 0,
    collisionRadius: 0, springStrength: 1000, springLength: 1, maxSpeed,
  }));
  force.restoreState({
    schemaVersion: 1,
    alpha: 0,
    alphaTarget: 0,
    running: false,
    velocities: {
      left: { x: 1e42, y: 0, z: 0 },
      right: { x: -1e42, y: 0, z: 0 },
    },
  });
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  const result = force.tick(state, 1 / 60);
  assert(result?.positions, 'rejected hostile motion should reheat from safe positions');
  const leftMovement = Math.hypot(
    result.positions.left.x - state.positions.left.x,
    result.positions.left.y - state.positions.left.y,
    result.positions.left.z - state.positions.left.z,
  );
  const rightMovement = Math.hypot(
    result.positions.right.x - state.positions.right.x,
    result.positions.right.y - state.positions.right.y,
    result.positions.right.z - state.positions.right.z,
  );
  assert(leftMovement <= maxSpeed + 1e-10 && rightMovement <= maxSpeed + 1e-10,
    'every integrated node movement should obey the configured maximum speed');
});

test('force cooling clears residual velocity before a later reheat', () => {
  const document = graphDocument({
    nodes: [graphNode('left'), graphNode('right')],
    edges: [],
  });
  const force = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0, alphaDecay: 1, alphaMin: 0.001,
  }));
  force.restoreState({
    schemaVersion: 1,
    alpha: 0.0005,
    alphaTarget: 0,
    running: true,
    velocities: {
      left: { x: 100, y: 0, z: 0 },
      right: { x: -100, y: 0, z: 0 },
    },
  });
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(),
  });
  force.tick(state, 1 / 60);
  const settled = force.exportState() as { readonly alpha: number; readonly running: boolean; readonly velocities: Record<string, unknown> };
  equal(settled.alpha, 0, 'cooling should end at zero alpha');
  equal(settled.running, false, 'cooling should stop the layout');
  deepEqual(settled.velocities, {}, 'a settled layout must not retain replayable momentum');

  force.onDocumentChanged();
  const reheated = force.tick(state, 1 / 60);
  assert(!reheated?.positions, 'a later reheat should start from rest instead of replaying old motion');
});

test('velocity-decay-only changes preserve a settled topology and do not reheat it', () => {
  const document = graphDocument({
    nodes: [graphNode('left'), graphNode('right')],
    edges: [graphEdge('join', 'left', 'right')],
  });
  const settings = {
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0.4, alphaDecay: 1, alphaMin: 0.001,
  };
  const force = new ForceLayoutModule('2d', readForceSettings(settings));
  const state = pipeline(document, {
    nodeIds: new Set(['left', 'right']), edgeIds: new Set(['join']),
  });
  force.tick(state, 1 / 60);
  const topologyAnalysisCount = force.getDiagnostics().topologyAnalysisCount;
  force.updateSettings({ ...settings, velocityDecay: 0.8 });
  const afterUpdate = force.exportState() as { readonly alpha: number; readonly running: boolean };
  equal(afterUpdate.alpha, 0, 'changing velocity decay must not reheat a settled layout');
  equal(afterUpdate.running, false, 'changing velocity decay must keep a settled layout stopped');
  force.tick(state, 1 / 60);
  equal(force.getDiagnostics().topologyAnalysisCount, topologyAnalysisCount,
    'velocity decay must not invalidate topology-derived springs');
});

test('V1.7 axial spring flattens only the selected 3D coordinate and respects pins', () => {
  const document = graphDocument({
    nodes: [
      graphNode('pinned', { positionHint: { x: -40, y: 100, z: -30 } }),
      graphNode('free', { positionHint: { x: 50, y: 100, z: 40 } }),
    ],
    edges: [],
  });
  const baseState = pipeline(document, {
    nodeIds: new Set(['pinned', 'free']), edgeIds: new Set(),
  });
  const state = { ...baseState, viewState: { ...baseState.viewState, pinnedNodeIds: ['pinned'] } };
  const force = new ForceLayoutModule('3d', readForceSettings({
    repulsionStrength: 0,
    springStrength: 0,
    centeringStrength: 0,
    collisionRadius: 0,
    velocityDecay: 0,
    alphaDecay: 0,
    axialSpringAxis: 'y',
    axialSpringStiffness: 0.9,
  }));
  const result = force.tick(state, 1 / 60);
  assert(result?.positions, 'active axial spring should advance layout');
  equal(result.positions.pinned.y, 100, 'explicit pins should remain authoritative');
  assert(Math.abs(result.positions.free.y) < 100, 'the selected coordinate should move toward zero');
  equal(result.positions.free.x, 50, 'flattening Y should preserve X without another force');
  equal(result.positions.free.z, 40, 'flattening Y should preserve Z without another force');

  const planar = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0, alphaDecay: 0, axialSpringAxis: 'y', axialSpringStiffness: 0.9,
  }));
  const planarResult = planar.tick(pipeline(document, {
    nodeIds: new Set(['pinned', 'free']), edgeIds: new Set(),
  }), 1 / 60);
  const planarOff = new ForceLayoutModule('2d', readForceSettings({
    repulsionStrength: 0, springStrength: 0, centeringStrength: 0, collisionRadius: 0,
    velocityDecay: 0, alphaDecay: 0, axialSpringAxis: 'off', axialSpringStiffness: 0,
  })).tick(pipeline(document, {
    nodeIds: new Set(['pinned', 'free']), edgeIds: new Set(),
  }), 1 / 60);
  deepEqual(planarResult, planarOff, '2D axial settings should be behaviorally identical to Off');
});

test('V1.6 retirement migration promotes the accepted settings and removes comparison banks', () => {
  const migrated = migrateGraphPlusProfileOverridesV16({
    profileSettings: { graphSystem: 'legacy', graphSystemMigrationVersion: 1 },
    modules: {
      rendering: { settings: {
        nodeRadiusScale: 4,
        newSettings: { nodeRadiusScale: 1.5, edgeThicknessScale: 0.75 },
        legacySettings: { nodeRadiusScale: 8 },
      } },
    },
  });
  equal(migrated.profileSettings?.graphSystem, undefined, 'the retired selector should be removed');
  const rendering = migrated.modules?.rendering?.settings as Record<string, unknown>;
  equal(rendering.nodeRadiusScale, 1.5, 'the accepted bank should override obsolete direct tuning');
  equal(rendering.edgeThicknessScale, 0.75, 'the accepted bank should become directly editable');
  equal(rendering.newSettings, undefined, 'the accepted bank wrapper should be removed');
  equal(rendering.legacySettings, undefined, 'the comparison bank should be removed');
  deepEqual(migrateGraphPlusProfileOverridesV16(migrated), migrated, 'migration should be idempotent');
});

test('V1.6 restore/export discards retired whole-system state-bank metadata', async () => {
  const document = graphDocument({ nodes: [graphNode('a')], edges: [] });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  const restored = {
    ...viewState(document),
    consumerId: 'graph-plus',
    profileId: 'default',
    moduleState: { 'graph-system-states-v1': { schemaVersion: 1, activeMode: 'new', states: {} } },
  };
  const session = await value.create(restored);
  equal((await session.exportViewState()).moduleState['graph-system-states-v1'], undefined,
    'the single-system runtime should not preserve or recreate a comparison state bank');
  await session.dispose();
});

test('V1.6 Graph+ defaults Anima label placement above and accepts a live below override', async () => {
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  });
  const session = await value.create();
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.labelPosition, 'above',
    'Graph+ should begin with mobile-friendly labels above nodes');
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.adaptiveLabelThreshold2d, 65,
    'Graph+ should begin with the quieter 2D adaptive-label threshold');
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.adaptiveLabelThreshold3d, 50,
    'Graph+ should retain the accepted 3D adaptive-label threshold');
  value.profiles.setUserOverrides('graph-plus', 'default', {
    modules: { anima: { settings: { labelPosition: 'below' } } },
  });
  value.factory.refreshActiveProfiles();
  equal((await session.exportEffectiveSettings()).modules.anima?.settings.labelPosition, 'below',
    'the persisted profile setting should update Anima live');
  await session.dispose();
});

test('V1.6 uses generated initial placement instead of adapter position hints', async () => {
  const document = graphDocument({
    nodes: [
      graphNode('a', { positionHint: { x: 910, y: 920, z: 0 } }),
      graphNode('b', { positionHint: { x: 1010, y: 1020, z: 0 } }),
    ],
    edges: [graphEdge('join', 'a', 'b')],
  });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  const session = await value.create();
  const initial = await session.exportViewState();
  assert(initial.positions.a.x !== 910 && initial.positions.b.x !== 1010,
    'the single system should use generated placement instead of adapter hints');
  await session.dispose();
});

test('V1.6 keeps Canvas-like pan, Cmd-scroll zoom, and transient drag separate from explicit pins', async () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('join', 'a', 'b')],
  });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  const session = await value.create();
  const canvas = runtimeCanvas(value.container);
  const initial = await session.exportViewState();
  wheel(value, canvas, { deltaX: 20, deltaY: 10 });
  value.platform.flushFrame(17);
  const panned = await session.exportViewState();
  equal(panned.camera.zoom, initial.camera.zoom, 'unmodified trackpad wheel should pan without zooming');
  assert(JSON.stringify(panned.camera.target) !== JSON.stringify(initial.camera.target), 'unmodified wheel should move the camera target');
  wheel(value, canvas, { deltaY: -30, metaKey: true });
  value.platform.flushFrame(34);
  const zoomed = await session.exportViewState();
  assert(zoomed.camera.zoom > panned.camera.zoom, 'Cmd-scroll should remain a zoom gesture');

  const camera = new GraphCameraController(zoomed.camera, '2d');
  camera.setViewport(640, 360);
  const point = camera.worldToScreen(zoomed.positions.a);
  pointer(value, canvas, 'pointerdown', point.x, point.y, 9);
  pointer(value, canvas, 'pointermove', point.x + 30, point.y + 15, 9);
  value.platform.flushFrame(51);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), false,
    'new-mode drag should use a transient kinematic constraint, not the persistent pin set');
  pointer(value, canvas, 'pointerup', point.x + 30, point.y + 15, 9);
  value.platform.flushFrame(68);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), false,
    'releasing an ordinary drag should return the node to the solver');

  await session.setNodePinned('a', true);
  const pinned = await session.exportViewState();
  const pinnedCamera = new GraphCameraController(pinned.camera, '2d');
  pinnedCamera.setViewport(640, 360);
  const pinnedPoint = pinnedCamera.worldToScreen(pinned.positions.a);
  pointer(value, canvas, 'pointerdown', pinnedPoint.x, pinnedPoint.y, 10);
  pointer(value, canvas, 'pointermove', pinnedPoint.x + 20, pinnedPoint.y, 10);
  pointer(value, canvas, 'pointerup', pinnedPoint.x + 20, pinnedPoint.y, 10);
  value.platform.flushFrame(80);
  equal((await session.exportViewState()).pinnedNodeIds.includes('a'), true,
    'an explicit pin should remain authoritative after drag release');
  await session.dispose();
});

test('V1.6 a background finger tap clears focus in 3D', async () => {
  const document = graphDocument({
    nodes: [graphNode('a'), graphNode('b')],
    edges: [graphEdge('join', 'a', 'b')],
  });
  const value = runtimeHarness({
    consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1, document,
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions: '3d' });
  const session = await value.create();
  await session.focusNode('a');
  equal((await session.exportViewState()).focusedNodeId, 'a', 'the fixture should begin focused');

  const canvas = runtimeCanvas(value.container);
  pointer(value, canvas, 'pointerdown', -100, -100, 31, 'touch');
  pointer(value, canvas, 'pointerup', -100, -100, 31, 'touch');
  value.platform.flushFrame(17);
  value.platform.flushTimer();
  value.platform.flushFrame(34);
  const cleared = await session.exportViewState();
  equal(cleared.focusedNodeId, undefined, 'a 3D background finger tap should release focus');
  deepEqual(cleared.selectedNodeIds, [], 'background release should also clear selection');
  await session.dispose();
});

function pipeline(
  document: ReturnType<typeof graphDocument>,
  selection: { nodeIds: Set<string>; edgeIds: Set<string> },
): GraphModulePipelineStateV1 {
  const state = viewState(document);
  return {
    sourceDocument: document,
    document,
    viewState: state,
    positions: state.positions,
    projectionSelection: selection,
    renderSelection: selection,
    formActive: false,
    nodeContributions: {},
    edgeContributions: {},
    regionLayouts: [],
    regionContributions: [],
    theme: DEFAULT_GRAPH_RENDER_THEME_V1,
  };
}

function viewState(document: ReturnType<typeof graphDocument>) {
  return {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    documentRevision: document.revision,
    consumerId: 'synthetic-consumer',
    profileId: 'two-dimensional',
    dimensions: '2d' as const,
    positions: Object.fromEntries(document.nodes.map((node, index) => [node.id,
      node.positionHint ?? { x: index * 100, y: 0, z: 0 }])),
    pinnedNodeIds: [],
    camera: {
      position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, zoom: 1, projection: 'orthographic' as const,
    },
    selectedNodeIds: [],
    activeFilters: {},
    moduleState: {},
  };
}

function pointer(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  pointerId: number,
  pointerType: 'mouse' | 'touch' = 'mouse',
): void {
  canvas.dispatchEvent(new value.window.PointerEvent(type, {
    clientX: x, clientY: y, pointerId, button: 0, pointerType, bubbles: true, cancelable: true,
  }) as unknown as Event);
}

function wheel(
  value: ReturnType<typeof runtimeHarness>,
  canvas: HTMLCanvasElement,
  options: { deltaX?: number; deltaY: number; metaKey?: boolean },
): void {
  const event = new value.window.WheelEvent('wheel', {
    clientX: 320, clientY: 180, deltaX: options.deltaX ?? 0, deltaY: options.deltaY,
    bubbles: true, cancelable: true,
  } as any);
  Object.defineProperty(event, 'metaKey', { value: options.metaKey ?? false });
  canvas.dispatchEvent(event as unknown as Event);
}

function recordingContext(fillTextY: number[], arcRadii: number[] = []): CanvasRenderingContext2D {
  return {
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    arc: (_x: number, _y: number, radius: number) => { arcRadii.push(radius); },
    fill: () => undefined,
    fillText: (_text: string, _x: number, y: number) => { fillTextY.push(y); },
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}
