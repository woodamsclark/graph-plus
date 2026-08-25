import type {
  ConsumerRegistrationV1,
  Disposable,
  GraphEngineConnectionErrorV1,
  GraphEngineLeaseResultV1,
  GraphEngineLeaseV1,
  GraphEngineRequestV1,
  GraphNodeActionRegistrationV1,
  GraphSessionOptionsV1,
  GraphSessionV1,
} from '../contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../core/profile/index.ts';
import { SessionFactory } from '../runtime/index.ts';

export interface GraphEngineProviderCoreOptionsV1 {
  readonly engineVersion: string;
  readonly engineInstanceId: string;
  readonly capabilities: readonly string[];
  readonly profiles: ConsumerProfileRegistry;
  readonly sessions: SessionFactory;
  readonly onProfilesChanged?: () => void | Promise<void>;
}

interface LeaseRecord {
  readonly id: number;
  readonly consumerId: string;
  readonly sessions: Set<GraphSessionV1>;
  readonly actionIds: Set<string>;
  readonly actionRegistrations: Set<Disposable>;
  released: boolean;
}

export class GraphEngineServiceErrorV1 extends Error {
  readonly code: GraphEngineConnectionErrorV1['code'];

  constructor(error: GraphEngineConnectionErrorV1) {
    super(error.message);
    this.name = 'GraphEngineServiceErrorV1';
    this.code = error.code;
  }
}

export class GraphEngineProviderCoreV1 {
  readonly engineVersion: string;
  readonly engineInstanceId: string;
  readonly capabilities: readonly string[];

  private readonly profiles: ConsumerProfileRegistry;
  private readonly sessions: SessionFactory;
  private readonly onProfilesChanged: () => void | Promise<void>;
  private readonly leases = new Set<LeaseRecord>();
  private active = true;
  private nextLeaseId = 1;

  constructor(options: GraphEngineProviderCoreOptionsV1) {
    this.engineVersion = requireId(options.engineVersion, 'engine version');
    this.engineInstanceId = requireId(options.engineInstanceId, 'engine instance ID');
    this.capabilities = uniqueIds(options.capabilities, 'engine capabilities');
    this.profiles = options.profiles;
    this.sessions = options.sessions;
    this.onProfilesChanged = options.onProfilesChanged ?? (() => undefined);
  }

  answerRequest(request: GraphEngineRequestV1): void {
    let replied = false;
    const reply = (result: GraphEngineLeaseResultV1): void => {
      if (replied) return;
      replied = true;
      request.reply(result);
    };
    try {
      reply(this.requestLease({
        consumerId: request.consumerId,
        supportedProtocolVersions: request.supportedProtocolVersions,
        requestedCapabilities: request.requestedCapabilities,
      }));
    } catch (error) {
      reply(failure('initialization-failed', errorMessage(error)));
    }
  }

  connectLocal(options: {
    readonly consumerId: string;
    readonly supportedProtocolVersions: readonly number[];
    readonly requestedCapabilities: readonly string[];
  }): GraphEngineLeaseResultV1 {
    try {
      return this.requestLease(options);
    } catch (error) {
      return failure('initialization-failed', errorMessage(error));
    }
  }

  async dispose(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    const leases = [...this.leases];
    await Promise.all(leases.map((lease) => this.releaseLease(lease)));
    this.leases.clear();
  }

  private requestLease(options: {
    readonly consumerId: string;
    readonly supportedProtocolVersions: readonly number[];
    readonly requestedCapabilities: readonly string[];
  }): GraphEngineLeaseResultV1 {
    if (!this.active) return failure('engine-unavailable', 'Graph Engine is unavailable.');
    requireId(options.consumerId, 'consumer ID');
    if (!options.supportedProtocolVersions.includes(1)) {
      return failure('protocol-incompatible', 'Graph Engine protocol v1 is not supported by this consumer.');
    }
    const missing = uniqueIds(options.requestedCapabilities, 'requested capabilities')
      .filter((capability) => !this.capabilities.includes(capability));
    if (missing.length > 0) {
      return failure('capability-unavailable', `Graph Engine does not provide: ${missing.join(', ')}.`);
    }
    const record: LeaseRecord = {
      id: this.nextLeaseId++,
      consumerId: options.consumerId,
      sessions: new Set(),
      actionIds: new Set(),
      actionRegistrations: new Set(),
      released: false,
    };
    this.leases.add(record);
    return { ok: true, lease: this.createLease(record) };
  }

  private createLease(record: LeaseRecord): GraphEngineLeaseV1 {
    return {
      protocolVersion: 1,
      engineVersion: this.engineVersion,
      engineInstanceId: this.engineInstanceId,
      capabilities: [...this.capabilities],
      registerConsumer: async (registration: ConsumerRegistrationV1): Promise<void> => {
        this.assertLease(record);
        if (registration.consumerId !== record.consumerId) {
          throw new GraphEngineServiceErrorV1({
            code: 'initialization-failed',
            message: `Lease for "${record.consumerId}" cannot register "${registration.consumerId}".`,
          });
        }
        this.profiles.registerConsumer(registration);
        await this.onProfilesChanged();
      },
      registerNodeActions: (actions: readonly GraphNodeActionRegistrationV1[]): Disposable => {
        this.assertLease(record);
        const ids = validateNodeActions(actions);
        for (const id of ids) {
          if (record.actionIds.has(id)) {
            throw new Error(`Duplicate node action "${id}" for consumer "${record.consumerId}".`);
          }
        }
        ids.forEach((id) => record.actionIds.add(id));
        let disposed = false;
        const registration: Disposable = {
          dispose: () => {
            if (disposed) return;
            disposed = true;
            ids.forEach((id) => record.actionIds.delete(id));
            record.actionRegistrations.delete(registration);
          },
        };
        record.actionRegistrations.add(registration);
        return registration;
      },
      createSession: async (options: GraphSessionOptionsV1): Promise<GraphSessionV1> => {
        this.assertLease(record);
        if (options.consumerId !== record.consumerId) {
          throw new GraphEngineServiceErrorV1({
            code: 'initialization-failed',
            message: `Lease for "${record.consumerId}" cannot create a session for "${options.consumerId}".`,
          });
        }
        const session = await this.sessions.createSession(options);
        try {
          this.assertLease(record);
        } catch (error) {
          await session.dispose();
          throw error;
        }
        record.sessions.add(session);
        return trackSession(session, () => record.sessions.delete(session));
      },
      release: async (): Promise<void> => this.releaseLease(record),
    };
  }

  private assertLease(record: LeaseRecord): void {
    if (!this.active || record.released || !this.leases.has(record)) {
      throw new GraphEngineServiceErrorV1({
        code: 'engine-unavailable',
        message: 'This Graph Engine lease is no longer available.',
      });
    }
  }

  private async releaseLease(record: LeaseRecord): Promise<void> {
    if (record.released) return;
    record.released = true;
    this.leases.delete(record);
    const sessions = [...record.sessions];
    record.sessions.clear();
    for (const registration of [...record.actionRegistrations]) registration.dispose();
    record.actionRegistrations.clear();
    record.actionIds.clear();
    await Promise.all(sessions.map((session) => session.dispose()));
    if (![...this.leases].some((lease) => !lease.released && lease.consumerId === record.consumerId)) {
      this.profiles.markConsumerInactive(record.consumerId);
    }
  }
}

function trackSession(session: GraphSessionV1, onDispose: () => void): GraphSessionV1 {
  let disposed = false;
  const originalDispose = session.dispose.bind(session);
  session.dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    onDispose();
    await originalDispose();
  };
  return session;
}

function failure(code: GraphEngineConnectionErrorV1['code'], message: string): GraphEngineLeaseResultV1 {
  return { ok: false, error: { code, message } };
}

function uniqueIds(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    throw new Error(`${label} must contain non-empty strings.`);
  }
  return [...new Set(values)];
}

function requireId(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateNodeActions(actions: readonly GraphNodeActionRegistrationV1[]): readonly string[] {
  if (!Array.isArray(actions)) throw new Error('Node actions must be an array.');
  const ids = actions.map((action) => {
    requireId(action.id, 'node action ID');
    if (typeof action.label !== 'function') requireId(action.label, 'node action label');
    if (action.icon !== undefined) requireId(action.icon, 'node action icon');
    if (action.isAvailable !== undefined && typeof action.isAvailable !== 'function') {
      throw new Error(`Availability for node action "${action.id}" must be a function.`);
    }
    if (typeof action.run !== 'function') throw new Error(`Node action "${action.id}" must provide run().`);
    return action.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Node action IDs must be unique within one registration.');
  return ids;
}
