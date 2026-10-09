import type { ConsumerRegistrationV1 } from './profile.ts';
import type { GraphSessionOptionsV1, GraphSessionV1 } from './session.ts';
import type { GraphNodeActionRegistrationV1 } from './action.ts';
import type { GraphReactionRegistrationV1 } from './reaction.ts';
import type { Disposable } from './values.ts';

export interface GraphEngineRequestV1 {
  readonly requestId: string;
  readonly consumerId: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly requestedCapabilities: readonly string[];
  readonly reply: (result: GraphEngineLeaseResultV1) => void;
}

export type GraphEngineLeaseResultV1 =
  | { readonly ok: true; readonly lease: GraphEngineLeaseV1 }
  | { readonly ok: false; readonly error: GraphEngineConnectionErrorV1 };

export interface GraphEngineLeaseV1 {
  readonly protocolVersion: 1;
  readonly engineVersion: string;
  readonly engineInstanceId: string;
  readonly capabilities: readonly string[];

  registerConsumer(registration: ConsumerRegistrationV1): Promise<void>;
  registerNodeActions(actions: readonly GraphNodeActionRegistrationV1[]): Disposable;
  /** Available when capabilities contains conscious-reactions. */
  registerReactions?(reactions: readonly GraphReactionRegistrationV1[]): Disposable;
  createSession(options: GraphSessionOptionsV1): Promise<GraphSessionV1>;
  release(): Promise<void>;
}

export interface GraphEngineConnectionErrorV1 {
  readonly code:
    | 'engine-unavailable'
    | 'protocol-incompatible'
    | 'capability-unavailable'
    | 'ambiguous-provider'
    | 'initialization-failed';
  readonly message: string;
}

export interface GraphEngineAvailabilityV1 {
  readonly protocolVersions: readonly number[];
  readonly engineVersion: string;
  readonly engineInstanceId: string;
  readonly capabilities: readonly string[];
}

export interface GraphEngineUnavailabilityV1 {
  readonly engineInstanceId: string;
}

export const GRAPH_ENGINE_REQUEST_EVENT_V1 = 'graph-engine:request:v1';
export const GRAPH_ENGINE_AVAILABLE_EVENT_V1 = 'graph-engine:available:v1';
export const GRAPH_ENGINE_UNAVAILABLE_EVENT_V1 = 'graph-engine:unavailable:v1';
