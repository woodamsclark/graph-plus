import type {
  Disposable,
  GraphEngineLeaseResultV1,
  GraphEngineRequestV1,
} from '../contracts/v1/index.ts';
import {
  GRAPH_ENGINE_AVAILABLE_EVENT_V1,
  GRAPH_ENGINE_REQUEST_EVENT_V1,
  GRAPH_ENGINE_UNAVAILABLE_EVENT_V1,
} from '../contracts/v1/index.ts';

export interface GraphEngineEventBusV1 {
  on(event: string, listener: (payload: unknown) => void): Disposable;
  trigger(event: string, payload: unknown): void;
}

export interface GraphEngineClientClockV1 {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GraphEngineConnectOptionsV1 {
  readonly consumerId: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly requestedCapabilities: readonly string[];
  readonly timeoutMs?: number;
}

export class GraphEngineWorkspaceClientV1 {
  private nextRequestNumber = 1;

  constructor(
    private readonly bus: GraphEngineEventBusV1,
    private readonly clock: GraphEngineClientClockV1 = defaultClock,
  ) {}

  connect(options: GraphEngineConnectOptionsV1): Promise<GraphEngineLeaseResultV1> {
    const timeoutMs = options.timeoutMs ?? 1_500;
    return new Promise((resolve) => {
      let settled = false;
      let activeRequestId = '';
      let settleHandle: unknown;
      const replies: GraphEngineLeaseResultV1[] = [];
      const subscriptions: Disposable[] = [];
      const finish = (result: GraphEngineLeaseResultV1): void => {
        if (settled) return;
        settled = true;
        if (settleHandle !== undefined) this.clock.clearTimeout(settleHandle);
        this.clock.clearTimeout(timeoutHandle);
        subscriptions.forEach((subscription) => subscription.dispose());
        resolve(result);
      };
      const finishReplies = (): void => {
        settleHandle = undefined;
        if (replies.length > 1) {
          for (const reply of replies) if (reply.ok) void reply.lease.release();
          finish({
            ok: false,
            error: { code: 'ambiguous-provider', message: 'Multiple Graph Engine providers answered the same request.' },
          });
          return;
        }
        if (replies.length === 1) finish(replies[0]);
      };
      const request = (): void => {
        if (settled) return;
        activeRequestId = `${options.consumerId}:request:${this.nextRequestNumber++}`;
        replies.length = 0;
        const requestId = activeRequestId;
        const payload: GraphEngineRequestV1 = {
          requestId,
          consumerId: options.consumerId,
          supportedProtocolVersions: [...options.supportedProtocolVersions],
          requestedCapabilities: [...options.requestedCapabilities],
          reply: (result) => {
            if (settled || requestId !== activeRequestId) {
              if (result.ok) void result.lease.release();
              return;
            }
            replies.push(result);
            if (settleHandle === undefined) settleHandle = this.clock.setTimeout(finishReplies, 0);
          },
        };
        this.bus.trigger(GRAPH_ENGINE_REQUEST_EVENT_V1, payload);
      };
      subscriptions.push(this.bus.on(GRAPH_ENGINE_AVAILABLE_EVENT_V1, request));
      subscriptions.push(this.bus.on(GRAPH_ENGINE_UNAVAILABLE_EVENT_V1, () => undefined));
      const timeoutHandle = this.clock.setTimeout(() => finish({
        ok: false,
        error: {
          code: 'engine-unavailable',
          message: 'Graph+ is unavailable or not installed. This feature requires its Graph Engine.',
        },
      }), timeoutMs);
      request();
    });
  }
}

const defaultClock: GraphEngineClientClockV1 = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
