import {
  GRAPH_ENGINE_AVAILABLE_EVENT_V1,
  type Disposable,
} from '../../src/graph-engine/contracts/v1/index.ts';
import {
  GraphEngineProviderCoreV1,
  GraphEngineServiceErrorV1,
  GraphEngineWorkspaceClientV1,
  GraphEngineWorkspaceProviderV1,
  type GraphEngineClientClockV1,
  type GraphEngineEventBusV1,
} from '../../src/graph-engine/service/index.ts';
import { assert, equal, test } from '../support/harness.ts';
import { runtimeFixture, runtimeHarness, runtimeRegistration } from '../support/runtimeHarness.ts';

class EventBus implements GraphEngineEventBusV1 {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  on(event: string, listener: (payload: unknown) => void): Disposable {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return { dispose: () => listeners.delete(listener) };
  }

  trigger(event: string, payload: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }
}

class Clock implements GraphEngineClientClockV1 {
  private nextId = 1;
  private readonly timers = new Map<number, { callback: () => void; delay: number }>();

  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++;
    this.timers.set(id, { callback, delay });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  flushNext(): void {
    const next = [...this.timers].sort((left, right) => left[1].delay - right[1].delay || left[0] - right[0])[0];
    if (!next) return;
    this.timers.delete(next[0]);
    next[1].callback();
  }
}

function provider(instanceId = 'provider-one') {
  const runtime = runtimeHarness();
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '1.0.0',
    engineInstanceId: instanceId,
    capabilities: ['render'],
    profiles: runtime.profiles,
    sessions: runtime.factory,
  });
  return { runtime, core };
}

function connect(client: GraphEngineWorkspaceClientV1, clock: Clock, options: Partial<Parameters<typeof client.connect>[0]> = {}) {
  const pending = client.connect({
    consumerId: 'synthetic-consumer',
    supportedProtocolVersions: [1],
    requestedCapabilities: ['render'],
    timeoutMs: 50,
    ...options,
  });
  clock.flushNext();
  return pending;
}

test('S-CONNECT local lease uses the provider core and release owns only its sessions', async () => {
  const first = provider();
  const result = first.core.connectLocal({
    consumerId: 'synthetic-consumer',
    supportedProtocolVersions: [1],
    requestedCapabilities: ['render'],
  });
  assert(result.ok, 'local connection should return a lease');
  await result.lease.registerConsumer(runtimeRegistration());
  const session = await result.lease.createSession({
    consumerId: 'synthetic-consumer',
    profileId: 'two-dimensional',
    container: first.runtime.container,
    document: runtimeFixture(),
  });
  equal(first.runtime.container.querySelectorAll('[data-graph-engine-session]').length, 1, 'lease should create a mounted session');
  await result.lease.release();
  equal(first.runtime.container.querySelectorAll('[data-graph-engine-session]').length, 0, 'release should dispose the lease session');
  let rejected = false;
  try { await result.lease.registerConsumer(runtimeRegistration()); } catch (error) {
    rejected = error instanceof GraphEngineServiceErrorV1 && error.code === 'engine-unavailable';
  }
  equal(rejected, true, 'released lease should reject later operations');
  await session.dispose();
});

test('R-INPUT-15 node action registrations are disposable and lease-scoped', async () => {
  const value = provider();
  const result = value.core.connectLocal({
    consumerId: 'synthetic-consumer',
    supportedProtocolVersions: [1],
    requestedCapabilities: ['render'],
  });
  assert(result.ok, 'local connection should return a lease');
  const actions = [{ id: 'open-node', label: 'Open node', run: () => undefined }];
  const registration = result.lease.registerNodeActions(actions);
  let duplicateRejected = false;
  try { result.lease.registerNodeActions(actions); } catch { duplicateRejected = true; }
  equal(duplicateRejected, true, 'duplicate action IDs on one lease should reject');
  registration.dispose();
  result.lease.registerNodeActions(actions).dispose();
  await result.lease.release();
  let staleRejected = false;
  try { result.lease.registerNodeActions(actions); } catch (error) {
    staleRejected = error instanceof GraphEngineServiceErrorV1 && error.code === 'engine-unavailable';
  }
  equal(staleRejected, true, 'released leases should not retain action registration authority');
});

test('S-CONNECT engine-first event discovery succeeds once and cleans client listeners', async () => {
  const bus = new EventBus();
  const clock = new Clock();
  const value = provider();
  const host = new GraphEngineWorkspaceProviderV1(bus, value.core);
  host.start();
  equal(bus.listenerCount, 1, 'provider should install its request listener before clients connect');
  const result = await connect(new GraphEngineWorkspaceClientV1(bus, clock), clock);
  assert(result.ok, 'event client should receive a lease');
  equal(result.lease.engineInstanceId, 'provider-one', 'lease should identify the responding provider');
  equal(bus.listenerCount, 1, 'settled client should remove availability listeners');
  await result.lease.release();
  await host.stop();
  equal(bus.listenerCount, 0, 'provider stop should restore listener baseline');
});

test('S-CONNECT consumer-first retries when availability is announced', async () => {
  const bus = new EventBus();
  const clock = new Clock();
  const client = new GraphEngineWorkspaceClientV1(bus, clock);
  const pending = client.connect({
    consumerId: 'synthetic-consumer',
    supportedProtocolVersions: [1],
    requestedCapabilities: ['render'],
    timeoutMs: 50,
  });
  const value = provider();
  const host = new GraphEngineWorkspaceProviderV1(bus, value.core);
  host.start();
  clock.flushNext();
  const result = await pending;
  assert(result.ok, 'late provider announcement should trigger a new request');
  await result.lease.release();
  await host.stop();
});

test('S-CONNECT reports missing, incompatible, capability, and ambiguous providers structurally', async () => {
  const missingBus = new EventBus();
  const missingClock = new Clock();
  const missing = await connect(new GraphEngineWorkspaceClientV1(missingBus, missingClock), missingClock);
  assert(!missing.ok && missing.error.code === 'engine-unavailable', 'missing provider should return unavailable');

  const incompatibleBus = new EventBus();
  const incompatibleClock = new Clock();
  const incompatibleHost = new GraphEngineWorkspaceProviderV1(incompatibleBus, provider().core);
  incompatibleHost.start();
  const incompatible = await connect(new GraphEngineWorkspaceClientV1(incompatibleBus, incompatibleClock), incompatibleClock, {
    supportedProtocolVersions: [2],
  });
  assert(!incompatible.ok && incompatible.error.code === 'protocol-incompatible', 'protocol mismatch should be structural');
  await incompatibleHost.stop();

  const capabilityBus = new EventBus();
  const capabilityClock = new Clock();
  const capabilityHost = new GraphEngineWorkspaceProviderV1(capabilityBus, provider().core);
  capabilityHost.start();
  const capability = await connect(new GraphEngineWorkspaceClientV1(capabilityBus, capabilityClock), capabilityClock, {
    requestedCapabilities: ['missing'],
  });
  assert(!capability.ok && capability.error.code === 'capability-unavailable', 'capability mismatch should be structural');
  await capabilityHost.stop();

  const ambiguousBus = new EventBus();
  const ambiguousClock = new Clock();
  const first = new GraphEngineWorkspaceProviderV1(ambiguousBus, provider('first').core);
  const second = new GraphEngineWorkspaceProviderV1(ambiguousBus, provider('second').core);
  first.start();
  second.start();
  const ambiguous = await connect(new GraphEngineWorkspaceClientV1(ambiguousBus, ambiguousClock), ambiguousClock);
  assert(!ambiguous.ok && ambiguous.error.code === 'ambiguous-provider', 'multiple replies should be rejected');
  await first.stop();
  await second.stop();
});

test('S-CONNECT unload invalidates stale leases and a reload has a new instance', async () => {
  const bus = new EventBus();
  const clock = new Clock();
  const firstValue = provider('first');
  const firstHost = new GraphEngineWorkspaceProviderV1(bus, firstValue.core);
  firstHost.start();
  const first = await connect(new GraphEngineWorkspaceClientV1(bus, clock), clock);
  assert(first.ok, 'first provider should lease');
  await firstHost.stop();
  let stale = false;
  try { await first.lease.registerConsumer(runtimeRegistration()); } catch (error) {
    stale = error instanceof GraphEngineServiceErrorV1 && error.code === 'engine-unavailable';
  }
  equal(stale, true, 'unloaded provider lease should reject');

  const nextClock = new Clock();
  const secondValue = provider('second');
  const secondHost = new GraphEngineWorkspaceProviderV1(bus, secondValue.core);
  secondHost.start();
  const second = await connect(new GraphEngineWorkspaceClientV1(bus, nextClock), nextClock);
  assert(second.ok && second.lease.engineInstanceId === 'second', 'reload should expose a fresh engine instance');
  await second.lease.release();
  await secondHost.stop();
});

test('availability is announced only after the provider request listener exists', async () => {
  const bus = new EventBus();
  let listenerCountAtAnnouncement = 0;
  bus.on(GRAPH_ENGINE_AVAILABLE_EVENT_V1, () => { listenerCountAtAnnouncement = bus.listenerCount; });
  const host = new GraphEngineWorkspaceProviderV1(bus, provider().core);
  host.start();
  equal(listenerCountAtAnnouncement, 2, 'announcement observer and request listener should both exist');
  await host.stop();
});
