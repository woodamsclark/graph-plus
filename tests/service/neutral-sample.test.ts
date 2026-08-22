import { runNeutralConsumerSampleV1 } from '../../examples/neutral-consumer.ts';
import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/index.ts';
import { assert, equal, test } from '../support/harness.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';

test('Gate F neutral sample exercises the public consumer lifecycle', async () => {
  const runtime = runtimeHarness();
  const provider = new GraphEngineProviderCoreV1({
    engineVersion: '1.0.0',
    engineInstanceId: 'sample-provider',
    capabilities: ['render', 'filter'],
    profiles: runtime.profiles,
    sessions: runtime.factory,
  });
  const result = provider.connectLocal({
    consumerId: 'neutral-sample',
    supportedProtocolVersions: [1],
    requestedCapabilities: ['render', 'filter'],
  });
  assert(result.ok, 'sample should obtain the same lease an external consumer receives');
  const completed = await runNeutralConsumerSampleV1(result.lease, runtime.container);
  equal(completed.document.revision, 1, 'sample patch should persist in the exported consumer document');
  equal(completed.document.nodes.length, 3, 'sample should export canonical data independently of projection filters');
  equal(runtime.container.querySelector('[data-graph-engine-session]'), null, 'sample should dispose its engine-owned surface');
  await provider.dispose();
});
