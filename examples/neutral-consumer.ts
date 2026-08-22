import type {
  ConsumerRegistrationV1,
  GraphDocumentV1,
  GraphEngineLeaseV1,
  GraphIntentV1,
} from '../src/graph-engine/public.ts';

export const NEUTRAL_SAMPLE_REGISTRATION_V1: ConsumerRegistrationV1 = {
  consumerId: 'neutral-sample',
  displayName: 'Neutral sample',
  consumerVersion: '1.0.0',
  supportedProtocolVersions: [1],
  profiles: [{
    profileId: 'default',
    displayName: 'Default',
    descriptorVersion: 1,
    dimensions: '2d',
    requestedCapabilities: ['render', 'filter'],
    modules: {
      rendering: { policy: 'required' },
      filtering: { policy: 'required' },
      form: { policy: 'optional', defaultEnabled: false },
      'force-layout': { policy: 'optional', defaultEnabled: false },
      anima: { policy: 'forbidden' },
    },
  }],
};

export async function runNeutralConsumerSampleV1(
  lease: GraphEngineLeaseV1,
  container: HTMLElement,
): Promise<{ readonly document: GraphDocumentV1; readonly intents: readonly GraphIntentV1[] }> {
  await lease.registerConsumer(NEUTRAL_SAMPLE_REGISTRATION_V1);
  const document: GraphDocumentV1 = {
    schemaVersion: 1,
    documentId: 'neutral-sample:document',
    revision: 0,
    nodes: [
      { id: 'alpha', label: 'Alpha', tokens: ['visible'] },
      { id: 'beta', label: 'Beta', tokens: ['visible'] },
    ],
    edges: [{ id: 'alpha-beta', sourceId: 'alpha', targetId: 'beta', directed: true, tokens: ['relation:sample'] }],
  };
  const session = await lease.createSession({
    consumerId: 'neutral-sample',
    profileId: 'default',
    container,
    document,
  });
  const intents: GraphIntentV1[] = [];
  const intentSubscription = session.onIntent((intent) => intents.push(intent));
  try {
    await session.applyPatch({
      schemaVersion: 1,
      patchId: 'add-gamma',
      baseRevision: 0,
      operations: [{ type: 'add-node', node: { id: 'gamma', label: 'Gamma', tokens: ['hidden'] } }],
    });
    await session.applyFilter({
      schemaVersion: 1,
      scope: 'projection',
      node: { op: 'has-token', token: 'visible' },
    });
    await session.applyFilter({
      schemaVersion: 1,
      scope: 'render',
      edge: { op: 'has-token', token: 'relation:sample' },
    });
    await session.focusNode('alpha');
    await session.setSelection(['alpha']);
    const viewState = await session.exportViewState();
    await session.restoreViewState(viewState);
    return { document: await session.exportDocument(), intents };
  } finally {
    intentSubscription.dispose();
    await session.dispose();
    await lease.release();
  }
}
