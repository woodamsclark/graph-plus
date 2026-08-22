import type {
  Disposable,
  GraphEngineAvailabilityV1,
  GraphEngineRequestV1,
  GraphEngineUnavailabilityV1,
} from '../contracts/v1/index.ts';
import {
  GRAPH_ENGINE_AVAILABLE_EVENT_V1,
  GRAPH_ENGINE_REQUEST_EVENT_V1,
  GRAPH_ENGINE_UNAVAILABLE_EVENT_V1,
} from '../contracts/v1/index.ts';
import { GraphEngineProviderCoreV1 } from './GraphEngineProviderCore.ts';
import type { GraphEngineEventBusV1 } from './GraphEngineWorkspaceClient.ts';

export class GraphEngineWorkspaceProviderV1 {
  private readonly bus: GraphEngineEventBusV1;
  private readonly core: GraphEngineProviderCoreV1;
  private requestSubscription?: Disposable;

  constructor(bus: GraphEngineEventBusV1, core: GraphEngineProviderCoreV1) {
    this.bus = bus;
    this.core = core;
  }

  start(): void {
    if (this.requestSubscription) return;
    this.requestSubscription = this.bus.on(GRAPH_ENGINE_REQUEST_EVENT_V1, (payload) => {
      if (isRequest(payload)) this.core.answerRequest(payload);
    });
    const availability: GraphEngineAvailabilityV1 = {
      protocolVersions: [1],
      engineVersion: this.core.engineVersion,
      engineInstanceId: this.core.engineInstanceId,
      capabilities: [...this.core.capabilities],
    };
    this.bus.trigger(GRAPH_ENGINE_AVAILABLE_EVENT_V1, availability);
  }

  async stop(): Promise<void> {
    if (!this.requestSubscription) return;
    this.requestSubscription.dispose();
    this.requestSubscription = undefined;
    const unavailable: GraphEngineUnavailabilityV1 = { engineInstanceId: this.core.engineInstanceId };
    this.bus.trigger(GRAPH_ENGINE_UNAVAILABLE_EVENT_V1, unavailable);
    await this.core.dispose();
  }
}

function isRequest(value: unknown): value is GraphEngineRequestV1 {
  if (value === null || typeof value !== 'object') return false;
  const request = value as Partial<GraphEngineRequestV1>;
  return typeof request.requestId === 'string'
    && typeof request.consumerId === 'string'
    && Array.isArray(request.supportedProtocolVersions)
    && Array.isArray(request.requestedCapabilities)
    && typeof request.reply === 'function';
}
