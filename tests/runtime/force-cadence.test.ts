import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/GraphPlusRegistration.ts';
import { forceLayoutIntervalMsV1, forceLayoutTargetStepRateHzV1 } from '../../src/graph-engine/runtime/modules/shipped/ForceLayoutCadence.ts';
import type { GraphModulePipelineStateV1 } from '../../src/graph-engine/runtime/modules/GraphModuleTypes.ts';
import type { GraphModuleHost } from '../../src/graph-engine/runtime/modules/GraphModuleHost.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';
import { equal, test } from '../support/harness.ts';

async function cadenceHarness(dimensions: '2d' | '3d') {
  const value = runtimeHarness({ consumerId: 'graph-plus', profileId: 'default',
    registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
    document: graphDocument({ nodes: [graphNode('a'), graphNode('b')], edges: [] }),
  });
  value.profiles.setUserOverrides('graph-plus', 'default', { dimensions, modules: {
    'force-layout': { settings: { repulsionStrength: 0, springStrength: 0, centeringStrength: 0,
      collisionRadius: 0, alphaDecay: 0 } }, anima: { settings: { cursorGravity: 'off' } },
  } });
  const session = await value.create();
  const probe = session as unknown as { moduleHost: GraphModuleHost; moduleView: GraphModulePipelineStateV1;
    interaction: { isPhysicsOverrideHeld(): boolean } };
  probe.interaction.isPhysicsOverrideHeld = () => true;
  const advance = (milliseconds: number) => {
    value.platform.advanceTime(milliseconds); value.platform.flushTimer(); value.platform.flushFrame(value.platform.now());
  };
  advance(1000 / 60);
  const state = { ...probe.moduleView, physicsOverrideHeld: true };
  const steps = () => (value.factory.getDiagnostics().sessions[0].modules['force-layout'] as { integrationStepCount: number }).integrationStepCount;
  return { ...value, session, probe, state, steps, advance };
}

test('force cadence policy matches its requested interval and the module host caps faster callbacks', async () => {
  equal(forceLayoutTargetStepRateHzV1(1, true), 60, 'the current branch keeps its 60 Hz policy');
  equal(forceLayoutIntervalMsV1(1, false), 1000 / 60, 'host admission derives from the same rate');
  equal(forceLayoutIntervalMsV1(0.2, true), 1000 / 60, 'alpha and drag do not create a second clock');
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await cadenceHarness(dimensions);
    try {
      const before = value.steps();
      for (let i = 0; i < 120; i++) value.probe.moduleHost.tick(value.state, 1 / 120);
      equal(value.steps() - before, 60, '120 Hz callbacks admit exactly 60 force integration steps');
    } finally { await value.session.dispose(); }
  }
});

test('exact and near-target force callbacks integrate once without alternating skip/run', async () => {
  for (const dimensions of ['2d', '3d'] as const) for (const milliseconds of [1000 / 60, 16.66]) {
    const value = await cadenceHarness(dimensions);
    try {
      for (let i = 0; i < 60; i++) {
        const before = value.steps();
        value.probe.moduleHost.tick(value.state, milliseconds / 1000);
        equal(value.steps() - before, 1, 'each target-rate callback admits one integration step');
      }
      equal(value.platform.pendingTimers, 0, 'display-rate scheduling avoids an additional interval timer');
    } finally { await value.session.dispose(); }
  }
});

test('delayed force admission discards catch-up debt and waits for the next ordinary interval', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await cadenceHarness(dimensions);
    try {
      const before = value.steps();
      value.probe.moduleHost.tick(value.state, 0.5);
      equal(value.steps() - before, 1, 'a delayed callback performs one step');
      value.probe.moduleHost.tick(value.state, 0);
      value.probe.moduleHost.tick(value.state, 1 / 120);
      equal(value.steps() - before, 1, 'the delayed callback leaves no catch-up credit');
      value.probe.moduleHost.tick(value.state, 1 / 120);
      equal(value.steps() - before, 2, 'a fresh full interval admits the next step');
    } finally { await value.session.dispose(); }
  }
});

test('session display scheduling preserves near-target 60 Hz and settled physics sleeps completely', async () => {
  for (const dimensions of ['2d', '3d'] as const) {
    const value = await cadenceHarness(dimensions);
    try {
      for (let i = 0; i < 60; i++) {
        const before = value.steps(); value.advance(16.66);
        equal(value.steps() - before, 1, 'near-target display callbacks do not halve physics cadence');
        equal(value.platform.pendingFrames, 1, 'the next display frame is ready without a timer');
        equal(value.platform.pendingTimers, 0, 'no extra timer delays the next frame');
      }
      value.probe.interaction.isPhysicsOverrideHeld = () => false;
      for (let i = 0; i < 30 && (value.platform.pendingFrames || value.platform.pendingTimers); i++) value.advance(20);
      const before = value.steps();
      equal(value.platform.pendingFrames, 0, 'a motionless graph releases its frame resource');
      equal(value.platform.pendingTimers, 0, 'a motionless graph releases its wake resource');
      equal(forceLayoutTargetStepRateHzV1(0, false), 0, 'settled policy reports no tick rate');
      value.advance(1000);
      equal(value.steps(), before, 'sleeping physics performs no integration work');
    } finally { await value.session.dispose(); }
  }
});
