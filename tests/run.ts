import { compileGraphQuery } from '../src/graph+/lens/GraphQuery.ts';
import { projectGraph } from '../src/graph+/lens/GraphProjector.ts';
import { createDefaultGraphLens } from '../src/graph+/types/domain/lens.ts';
import type { GraphData, Link, Node, NodeType } from '../src/graph+/types/domain/graph.ts';
import { InputBuffer } from '../src/graph+/systems/1. User Input/InputBuffer.ts';
import { CommandBuffer } from '../src/graph+/systems/3. Module Commander/CommandBuffer.ts';
import { UIStateStore } from '../src/graph+/systems/2. UI Interpretation + State/UIStateStore.ts';
import { UIInterpreter } from '../src/graph+/systems/2. UI Interpretation + State/UIInterpreter.ts';
import { FocusFollowSystem } from '../src/graph+/systems/2. UI Interpretation + State/FocusFollowSystem.ts';
import { Anima } from '../src/graph+/systems/4. Modules/Anima.ts';
import { AnimaStateStore } from '../src/graph+/systems/4. Modules/AnimaStateStore.ts';
import type { Command } from '../src/graph+/types/domain/commands.ts';
import type { UserInputEvent } from '../src/graph+/types/domain/ui.ts';

const tests: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function node(
  id: string,
  type: NodeType = 'note',
  options: { tags?: string[]; properties?: Record<string, string[]>; x?: number } = {},
): Node {
  const tags = options.tags ?? [];
  const properties = options.properties ?? {};
  return {
    id,
    label: id.replace(/\.md$/, ''),
    type,
    location: { x: options.x ?? 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 10,
    anima: { level: 0, capacity: 100 },
    facets: {
      path: id,
      extension: type === 'note' ? 'md' : undefined,
      tags,
      properties,
      searchText: [id, ...tags, ...Object.keys(properties), ...Object.values(properties).flat()].join(' ').toLowerCase(),
    },
  };
}

function link(sourceId: string, targetId: string, weight = 1, relations = ['link']): Link {
  return {
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    weight,
    relations,
    length: 100,
    strength: 0.05,
    thickness: 1,
    gate: { state: 'closed', threshold: 0, hysteresis: 0 },
  };
}

function graph(nodes: Node[], links: Link[]): GraphData {
  return {
    nodes,
    links,
    linksOut: {},
    linksIn: {},
    projection: {
      mode: 'free',
      sourceNodeCount: nodes.length,
      sourceLinkCount: links.length,
    },
  };
}

test('filter query supports facets, boolean terms, and negation', () => {
  const candidate = node('projects/Alpha.md', 'note', {
    tags: ['work/active'],
    properties: { status: ['active'], owner: ['woody'] },
  });
  equal(compileGraphQuery('tag:#work AND [status:active]').matches(candidate), true, 'tag and property should match');
  equal(compileGraphQuery('path:archive OR [owner:woody]').matches(candidate), true, 'OR should match second branch');
  equal(compileGraphQuery('tag:work -path:projects').matches(candidate), false, 'negated path should exclude');
  assert(compileGraphQuery('(tag:work').error, 'unclosed query should report an error');
});

test('free projection filters without losing source position identity', () => {
  const a = node('A.md', 'note', { x: 37 });
  const tag = node('topic', 'tag');
  const source = graph([a, tag], [link('A.md', 'topic', 1, ['tag'])]);
  const lens = createDefaultGraphLens(false);
  const projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.nodes.length, 1, 'tag should be filtered');
  equal(projected.nodes[0].location, a.location, 'free projection should share canonical position');
  projected.nodes[0].location.x = 51;
  equal(a.location.x, 51, 'physics movement should flow back to canonical graph');
});

test('mind-map form is deterministic and distinguishes tree links from cross-links', () => {
  const nodes = ['A.md', 'B.md', 'C.md', 'D.md'].map((id) => node(id));
  const source = graph(nodes, [
    link('A.md', 'B.md'),
    link('A.md', 'C.md'),
    link('B.md', 'D.md'),
    link('C.md', 'D.md'),
  ]);
  const lens = createDefaultGraphLens(false);
  lens.form.mode = 'mind-map';
  lens.form.rootId = 'A.md';
  const first = projectGraph(source, lens, { ringSpacing: 120 });
  const second = projectGraph(source, lens, { ringSpacing: 120 });
  equal(first.projection.rootId, 'A.md', 'requested root should be used');
  equal(first.nodes.find((value) => value.id === 'A.md')?.location.x, 0, 'root should be centered');
  equal(
    JSON.stringify(first.nodes.map((value) => value.location)),
    JSON.stringify(second.nodes.map((value) => value.location)),
    'radial placement should be stable',
  );
  equal(first.links.filter((value) => value.view?.role === 'tree').length, 3, 'spanning tree should contain three links');
  equal(first.links.filter((value) => value.view?.role === 'cross').length, 1, 'remaining relation should be a cross-link');
  const bColor = first.nodes.find((value) => value.id === 'B.md')?.view?.color;
  const cColor = first.nodes.find((value) => value.id === 'C.md')?.view?.color;
  assert(bColor && cColor && bColor !== cColor, 'top-level branches should receive distinct colors');

  lens.form.maxDepth = 1;
  const shallow = projectGraph(source, lens, { ringSpacing: 120 });
  equal(shallow.nodes.some((value) => value.id === 'D.md'), false, 'depth constraint should hide deeper descendants');
  equal(nodes[0].location.x, 0, 'form projection should not mutate canonical positions');
});

test('form constraints apply relation, direction, and cross-link visibility', () => {
  const source = graph(
    ['A.md', 'B.md', 'C.md', 'D.md'].map((id) => node(id)),
    [
      link('A.md', 'B.md', 1, ['parent']),
      link('C.md', 'A.md', 1, ['parent']),
      link('A.md', 'D.md', 1, ['reference']),
    ],
  );
  const lens = createDefaultGraphLens(false);
  lens.form.mode = 'mind-map';
  lens.form.rootId = 'A.md';
  lens.form.relation = 'parent';
  lens.form.direction = 'outgoing';
  let projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.nodes.map((value) => value.id).sort().join(','), 'A.md,B.md', 'outgoing relation should select descendants');

  lens.form.direction = 'incoming';
  projected = projectGraph(source, lens, { ringSpacing: 100 });
  equal(projected.nodes.map((value) => value.id).sort().join(','), 'A.md,C.md', 'incoming relation should select ancestors');

  lens.form.direction = 'both';
  lens.form.showCrossLinks = false;
  projected = projectGraph(source, lens, { ringSpacing: 100 });
  assert(projected.links.every((value) => value.view?.role === 'tree'), 'cross-links should be removable without changing source data');
});

test('primary background drag releases focus and applies threshold-crossing movement', () => {
  const input = new InputBuffer();
  const commands = new CommandBuffer();
  const state = new UIStateStore();
  state.setFocusedNode('A.md');
  const source = graph([node('A.md')], []);
  const interpreter = new UIInterpreter({
    ui: { dragThresholdPx: 4, doubleClickMs: 250 },
    tuning: { pinchThresholdPx: 2, rotateThresholdRad: 0.03 },
  } as any, {
    graph: { get: () => source, hasGraph: () => true, destroy: () => undefined },
    camera: fakeCamera(),
    canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
    inputBuffer: input,
    commandBuffer: commands,
    interactionState: state,
    hitTester: {
      getNodeIdLabelAtScreenPoint: () => null,
      getNodeAtScreenPoint: () => null,
    } as any,
  });
  input.push(pointer('POINTER_DOWN', 10, 10));
  input.push(pointer('POINTER_MOVE', 25, 18));
  interpreter.tick(0.016);
  const batch = commands.drain();
  assert(batch.some((command) => command.type === 'SetFocusedNode' && command.nodeId === null), 'drag should clear focus');
  const start = batch.find((command): command is Extract<Command, { type: 'StartPanCamera' }> => command.type === 'StartPanCamera');
  const update = batch.find((command): command is Extract<Command, { type: 'UpdatePanCamera' }> => command.type === 'UpdatePanCamera');
  equal(start?.screen.x, 10, 'pan should start at pointer-down position');
  equal(update?.screen.x, 25, 'first move should be applied immediately');
});

test('right click requests reset and post-command focus follow respects cleared focus', () => {
  const input = new InputBuffer();
  const commands = new CommandBuffer();
  const state = new UIStateStore();
  state.setFocusedNode('A.md');
  const source = graph([node('A.md')], []);
  const camera = fakeCamera();
  const interpreter = new UIInterpreter({
    ui: { dragThresholdPx: 4, doubleClickMs: 250 },
    tuning: { pinchThresholdPx: 2, rotateThresholdRad: 0.03 },
  } as any, {
    graph: { get: () => source, hasGraph: () => true, destroy: () => undefined },
    camera,
    canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
    inputBuffer: input,
    commandBuffer: commands,
    interactionState: state,
    hitTester: {
      getNodeIdLabelAtScreenPoint: () => null,
      getNodeAtScreenPoint: () => null,
    } as any,
  });
  input.push(pointer('POINTER_DOWN', 10, 10, 2));
  input.push(pointer('POINTER_UP', 10, 10, 2));
  interpreter.tick(0.016);
  assert(commands.drain().some((command) => command.type === 'ResetCamera'), 'right click should request a reset');

  state.setFocusedNode(null);
  const follower = new FocusFollowSystem({
    graph: { get: () => source, hasGraph: () => true, destroy: () => undefined },
    camera: camera as any,
    uiStateStore: state,
  });
  follower.tick(0.016);
  equal((camera as any).patchCount, 0, 'cleared focus must not retarget camera after reset');
});

test('reset command releases Anima focus as part of the same command contract', () => {
  const source = graph([node('A.md')], []);
  const anima = new Anima({
    focusBurst: 1,
    focusFeedPerSecond: 1,
    focusBurnPerSecond: 1,
    emissionPerLinkPerSecond: 1,
  } as any, {
    graph: { get: () => source, hasGraph: () => true, destroy: () => undefined },
    animaStore: new AnimaStateStore(),
  });
  anima.afterCommandApplied({ type: 'SetFocusedNode', nodeId: 'A.md' });
  equal((anima as any).focusedNodeId, 'A.md', 'focus setup should reach Anima');
  anima.afterCommandApplied({ type: 'ResetCamera' });
  equal((anima as any).focusedNodeId, null, 'reset should release Anima focus');
});

function pointer(type: 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP', x: number, y: number, button = 0): UserInputEvent {
  const common = {
    type,
    pointerId: 1,
    kind: 'mouse' as const,
    screen: { x, y },
    client: { x, y },
    timeMs: type === 'POINTER_UP' ? 20 : type === 'POINTER_MOVE' ? 10 : 0,
  };
  if (type === 'POINTER_MOVE') return common as Extract<UserInputEvent, { type: 'POINTER_MOVE' }>;
  return { ...common, button: button as 0 | 1 | 2, ctrl: false, meta: false, shift: false } as UserInputEvent;
}

function fakeCamera(): any {
  return {
    patchCount: 0,
    patchState() { this.patchCount += 1; },
    worldToScreen: () => ({ x: 0, y: 0, depth: 1, scale: 1, viewZ: 0 }),
    screenToWorld: (x: number, y: number) => ({ x, y, z: 0 }),
  };
}

let failures = 0;
for (const entry of tests) {
  try {
    entry.run();
    console.log(`✓ ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${entry.name}`);
    console.error(error);
  }
}

if (failures) {
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} tests passed.`);
}
