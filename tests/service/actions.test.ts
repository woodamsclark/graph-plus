import type {
  GraphNodeActionContextV1,
  GraphSessionV1,
} from '../../src/graph-engine/contracts/v1/index.ts';
import { ConsumerNodeActionRegistryV1 } from '../../src/graph-engine/service/index.ts';
import { deepEqual, equal, test } from '../support/harness.ts';

function context(consumerId: string, nodeId: string): GraphNodeActionContextV1 {
  return {
    consumerId,
    profileId: 'default',
    session: { sessionId: `${consumerId}:session` } as GraphSessionV1,
    documentId: 'fixture',
    documentRevision: 4,
    nodeId,
    selectedNodeIds: [nodeId],
    focusedNodeId: nodeId,
  };
}

test('R-INPUT-13 resolves dynamic labels and availability in declared order', () => {
  const registry = new ConsumerNodeActionRegistryV1();
  const owner = {};
  const runs: string[] = [];
  registry.register('xyz', owner, [
    {
      id: 'conditional',
      label: ({ nodeId }) => `Use ${nodeId}`,
      isAvailable: ({ nodeId }) => nodeId === 'a',
      run: ({ nodeId }) => { runs.push(`conditional:${nodeId}`); },
    },
    { id: 'always', label: 'Always', run: ({ nodeId }) => { runs.push(`always:${nodeId}`); } },
  ]);
  const runtime = registry.runtimeFor('xyz');
  deepEqual(runtime.resolve(['conditional', 'always'], context('xyz', 'a'), () => undefined).map((action) => action.label), ['Use a', 'Always'], 'available actions should retain profile order and current labels');
  deepEqual(runtime.resolve(['conditional', 'always'], context('xyz', 'b'), () => undefined).map((action) => action.id), ['always'], 'unavailable actions should be omitted per node');
  equal(runtime.invokeFirst(['conditional', 'always'], context('xyz', 'b'), () => undefined), true, 'first currently available action should invoke');
  deepEqual(runs, ['always:b'], 'engine should pass neutral current-node context');
});

test('R-INPUT-15 namespaces identical local action IDs and disposes only their owner', () => {
  const registry = new ConsumerNodeActionRegistryV1();
  const runs: string[] = [];
  const first = registry.register('first', {}, [{ id: 'primary', label: 'First', run: () => { runs.push('first'); } }]);
  registry.register('second', {}, [{ id: 'primary', label: 'Second', run: () => { runs.push('second'); } }]);
  registry.runtimeFor('first').invokeFirst(['primary'], context('first', 'a'), () => undefined);
  registry.runtimeFor('second').invokeFirst(['primary'], context('second', 'a'), () => undefined);
  first.dispose();
  equal(registry.runtimeFor('first').invokeFirst(['primary'], context('first', 'a'), () => undefined), false, 'disposed owner should have no stale callback');
  registry.runtimeFor('second').invokeFirst(['primary'], context('second', 'a'), () => undefined);
  deepEqual(runs, ['first', 'second', 'second'], 'disposing one namespace must not affect another consumer');
});
