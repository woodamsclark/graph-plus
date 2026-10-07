import { runtimeHarness } from '../support/runtimeHarness.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { equal, assert, test } from '../support/harness.ts';
import type { GraphModuleHost } from '../../src/graph-engine/runtime/modules/GraphModuleHost.ts';
import type { SessionProjectionCoordinatorV1 } from '../../src/graph-engine/runtime/session/SessionProjectionCoordinator.ts';

test('live Anima dressing and scene compilation share one semantic presentation per compiled input', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default', registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
    value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: { 'force-layout': { enabled: false } } });
    const session = await value.create();
    try {
      const probe = session as unknown as { moduleHost: GraphModuleHost; projection: SessionProjectionCoordinatorV1 };
      const contribute = probe.moduleHost.contribute.bind(probe.moduleHost);
      let calls = 0;
      probe.moduleHost.contribute = input => {
        assert(input.animaPresentation, 'dressing receives the resolved semantic result');
        const output = contribute(input);
        equal(output.animaPresentation, input.animaPresentation, 'the same result reaches scene compilation');
        calls += 1; return output;
      };
      const before = probe.projection.getDiagnostics();
      await session.setSelection(['a']);
      value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
      await session.setNodeHover!('b');
      value.platform.advanceTime(20); value.platform.flushFrame(value.platform.now());
      value.platform.advanceTime(720); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
      const after = probe.projection.getDiagnostics();
      assert(after.animaSemanticResolves - before.animaSemanticResolves <= calls, 'unchanged semantics reuse their shared result');
      equal(after.fullSceneCompiles - before.fullSceneCompiles, calls, 'baseline and target scenes each compile once');
    } finally { await session.dispose(); }
  }
});
