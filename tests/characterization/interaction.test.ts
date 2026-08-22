import { InputBuffer } from '../../src/graph+/systems/1. User Input/InputBuffer.ts';
import { FocusFollowSystem } from '../../src/graph+/systems/2. UI Interpretation + State/FocusFollowSystem.ts';
import { UIInterpreter } from '../../src/graph+/systems/2. UI Interpretation + State/UIInterpreter.ts';
import { UIStateStore } from '../../src/graph+/systems/2. UI Interpretation + State/UIStateStore.ts';
import { CommandBuffer } from '../../src/graph+/systems/3. Module Commander/CommandBuffer.ts';
import { Anima } from '../../src/graph+/systems/4. Modules/Anima.ts';
import { AnimaStateStore } from '../../src/graph+/systems/4. Modules/AnimaStateStore.ts';
import type { Command } from '../../src/graph+/types/domain/commands.ts';
import { fakeCamera, graph, node, pointer, wheel } from '../support/legacyGraphFixtures.ts';
import { assert, equal, test } from '../support/harness.ts';

function interpreterHarness(focusedNodeId: string | null = null) {
  const input = new InputBuffer();
  const commands = new CommandBuffer();
  const state = new UIStateStore();
  state.setFocusedNode(focusedNodeId);
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
  return { input, commands, state, source, camera, interpreter };
}

test('primary background drag releases focus and applies threshold-crossing movement', () => {
  const { input, commands, interpreter } = interpreterHarness('A.md');
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
  const { input, commands, state, source, camera, interpreter } = interpreterHarness('A.md');
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
  equal(camera.patchCount, 0, 'cleared focus must not retarget camera after reset');
});

test('legacy unmodified wheel path rotates whether focus is active or not', () => {
  for (const focused of [null, 'A.md']) {
    const { input, commands, interpreter } = interpreterHarness(focused);
    input.push(wheel());
    interpreter.tick(0.016);
    const batch = commands.drain();
    assert(batch.some((command) => command.type === 'StartRotateCamera'), 'legacy wheel path should start rotation');
    equal(batch.some((command) => command.type === 'StartPanCamera'), false, 'legacy wheel path does not currently pan');
  }
});

test('modified wheel requests zoom without starting pan or rotation', () => {
  const { input, commands, interpreter } = interpreterHarness();
  input.push(wheel({ ctrl: true, deltaY: -20 }));
  interpreter.tick(0.016);
  const batch = commands.drain();
  const zoom = batch.find((command): command is Extract<Command, { type: 'ZoomCamera' }> => command.type === 'ZoomCamera');
  equal(zoom?.delta, -1, 'negative wheel delta should zoom in');
  equal(batch.some((command) => command.type === 'StartPanCamera'), false, 'zoom should not pan');
  equal(batch.some((command) => command.type === 'StartRotateCamera'), false, 'zoom should not rotate');
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
