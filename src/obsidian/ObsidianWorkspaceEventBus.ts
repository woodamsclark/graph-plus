import type { Disposable } from '../graph-engine/contracts/v1/index.ts';
import type { GraphEngineEventBusV1 } from '../graph-engine/service/index.ts';

interface ObsidianWorkspaceEvents {
  on(event: string, listener: (payload: unknown) => void): unknown;
  offref(reference: unknown): void;
  trigger(event: string, payload: unknown): void;
}

export class ObsidianWorkspaceEventBusV1 implements GraphEngineEventBusV1 {
  constructor(private readonly workspace: ObsidianWorkspaceEvents) {}

  on(event: string, listener: (payload: unknown) => void): Disposable {
    const reference = this.workspace.on(event, listener);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.workspace.offref(reference);
      },
    };
  }

  trigger(event: string, payload: unknown): void {
    this.workspace.trigger(event, payload);
  }
}

export function asObsidianWorkspaceEventsV1(workspace: unknown): ObsidianWorkspaceEvents {
  return workspace as ObsidianWorkspaceEvents;
}
