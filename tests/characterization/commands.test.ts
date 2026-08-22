import { InputBuffer } from '../../src/graph+/systems/1. User Input/InputBuffer.ts';
import { CommandBuffer } from '../../src/graph+/systems/3. Module Commander/CommandBuffer.ts';
import { Commander, CommandRegistry } from '../../src/graph+/systems/3. Module Commander/Commander.ts';
import type { Command } from '../../src/graph+/types/domain/commands.ts';
import { pointer } from '../support/legacyGraphFixtures.ts';
import { deepEqual, equal, test } from '../support/harness.ts';

test('input and command buffers retain FIFO order and drain exactly once', () => {
  const input = new InputBuffer();
  const first = pointer('POINTER_DOWN', 1, 1);
  const second = pointer('POINTER_MOVE', 2, 2);
  input.push(first);
  input.push(second);
  deepEqual(input.drain(), [first, second], 'input should drain in insertion order');
  deepEqual(input.drain(), [], 'drained input should not be delivered twice');

  const commands = new CommandBuffer();
  commands.push({ type: 'SetPanning', on: true });
  commands.push({ type: 'SetPanning', on: false });
  deepEqual(commands.drain().map((command) => command.type), ['SetPanning', 'SetPanning'], 'commands should drain in insertion order');
  deepEqual(commands.drain(), [], 'drained commands should not be delivered twice');
});

test('commander dispatches each command before notifying observers', () => {
  const queue = new CommandBuffer();
  const registry = new CommandRegistry();
  const order: string[] = [];
  registry.register('SetFocusedNode', (command) => order.push(`handler:${command.nodeId}`));
  const commander = new Commander({
    queue,
    registry,
    observers: [{ afterCommandApplied: (command: Command) => order.push(`observer:${command.type}`) }],
  });
  queue.push({ type: 'SetFocusedNode', nodeId: 'A.md' });
  commander.tick();
  deepEqual(order, ['handler:A.md', 'observer:SetFocusedNode'], 'handler should run before observer');
  commander.tick();
  equal(order.length, 2, 'empty tick should not redispatch commands');
});
