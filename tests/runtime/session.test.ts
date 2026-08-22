import { Window } from 'happy-dom';
import {
  GraphSessionDisposedErrorV1,
  GraphSessionProfileErrorV1,
  createSessionRuntimePlatformV1,
} from '../../src/graph-engine/runtime/index.ts';
import { graphDocument, graphNode } from '../support/contractFixtures.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import {
  runtimeFixture as fixture,
  runtimeHarness as harness,
  runtimeRegistration as registration,
  runtimeSurface as surface,
} from '../support/runtimeHarness.ts';

test('R-SHELL-01 mounts a deterministic surface in the container owning document', async () => {
  const unrelatedWindow = new Window();
  const value = harness();
  const sentinel = value.document.createElement('p');
  sentinel.textContent = 'consumer-owned';
  value.container.prepend(sentinel);
  const session = await value.create();
  const root = surface(value.container);
  const canvas = root.querySelector('canvas');
  assert(canvas, 'diagnostic canvas should exist');
  equal(root.ownerDocument, value.document, 'root should be created from the container ownerDocument');
  assert(root.ownerDocument !== (unrelatedWindow.document as unknown as Document), 'root must not use another document');
  equal(root.dataset.dimensions, '2d', 'resolved profile dimensions should reach the surface');
  equal(root.dataset.width, '640', 'logical width should be observed');
  equal(root.dataset.height, '360', 'logical height should be observed');
  equal(canvas.width, 1280, 'canvas width should include owning-window DPR');
  equal(canvas.height, 720, 'canvas height should include owning-window DPR');
  equal(value.platform.observedTargets[0], value.container, 'container should be the resize target');
  equal(value.platform.pendingFrames, 1, 'active session should own one scheduled frame');
  equal(session.engineInstanceId, 'engine-test', 'session should expose its engine identity');
  equal(session.sessionId, 'session-test', 'session should expose its session identity');
  value.resize(300, 200, 1.5);
  equal(root.dataset.width, '300', 'resize observation should refresh logical width');
  equal(root.dataset.height, '200', 'resize observation should refresh logical height');
  equal(canvas.width, 450, 'resize should use the owning window current pixel ratio');
  equal(canvas.height, 300, 'resized canvas height should use current pixel ratio');
  await session.dispose();
});
test('neutral platform derives browser services from the supplied container', () => {
  const value = harness();
  const platform = createSessionRuntimePlatformV1(value.container);
  equal(platform.document, value.document, 'default platform should use container ownerDocument');
  equal(platform.window, value.document.defaultView, 'default platform should use ownerDocument defaultView');
  equal(platform.devicePixelRatio, value.document.defaultView?.devicePixelRatio ?? 1, 'default platform should use owning-window DPR');
  const observer = platform.createResizeObserver(() => {});
  observer.observe(value.container);
  observer.disconnect();
});

test('R-SHELL-02 drives documents, events, projection filters, and render filters independently', async () => {
  const value = harness();
  const session = await value.create();
  const changes: string[] = [];
  const patchIds: string[] = [];
  const errors: string[] = [];
  session.onGraphChanged(() => { throw new Error('consumer callback failed'); });
  session.onGraphChanged((event) => {
    changes.push(`${event.cause}:${event.previousRevision}->${event.revision}`);
    if (event.patch) patchIds.push(event.patch.patchId);
  });
  session.onError((error) => errors.push(error.code));

  const applied = await session.applyPatch({
    schemaVersion: 1,
    patchId: 'add-d',
    baseRevision: 0,
    operations: [{ type: 'add-node', node: graphNode('d', { tokens: ['keep'] }) }],
  });
  equal(applied.applied, true, 'valid patch should apply through the session');
  equal((await session.exportDocument()).nodes.length, 4, 'export should contain patched canonical data');
  deepEqual(changes, ['patch:0->1'], 'patch should emit one graph-changed event');
  deepEqual(patchIds, ['add-d'], 'graph event should identify the accepted patch');

  const stale = await session.applyPatch({
    schemaVersion: 1,
    patchId: 'stale',
    baseRevision: 0,
    operations: [{ type: 'replace-node', node: graphNode('a') }],
  });
  equal(stale.applied, false, 'stale patch should be rejected without mutation');
  deepEqual(errors, ['stale-revision'], 'stale patch should emit a recoverable session error');

  let invalidReplacementRejected = false;
  try {
    await session.replaceDocument({ ...fixture(), revision: 99, nodes: [] });
  } catch {
    invalidReplacementRejected = true;
  }
  equal(invalidReplacementRejected, true, 'invalid replacement should reject');
  equal((await session.exportDocument()).revision, 1, 'invalid replacement should leave the active document intact');

  await session.applyFilter({
    schemaVersion: 1,
    scope: 'projection',
    node: { op: 'has-token', token: 'keep' },
  });
  let root = surface(value.container);
  equal(root.dataset.projectedNodeCount, '3', 'projection should structurally select matching nodes');
  equal(root.dataset.projectedEdgeCount, '1', 'projection should retain only edges with selected endpoints');
  equal(root.dataset.renderedNodeCount, '3', 'rendering should initially receive the full projection');
  equal(root.dataset.renderedEdgeCount, '1', 'rendering should initially receive projected edges');

  await session.applyFilter({
    schemaVersion: 1,
    scope: 'render',
    edge: { op: 'none' },
  });
  root = surface(value.container);
  equal(root.dataset.projectedEdgeCount, '1', 'render filter must not mutate projection membership');
  equal(root.dataset.renderedNodeCount, '3', 'edge-only render filtering should preserve nodes');
  equal(root.dataset.renderedEdgeCount, '0', 'edge-only render filtering should hide edges');
  await session.clearFilter('render');
  equal(surface(value.container).dataset.renderedEdgeCount, '1', 'clearing render filter should reveal projected edges');

  await session.replaceDocument(graphDocument({ documentId: 'replacement', revision: 7, nodes: [graphNode('z')], edges: [] }));
  deepEqual(changes, ['patch:0->1', 'replace-document:1->7'], 'replacement should emit its own graph event');
  equal((await session.exportViewState()).documentId, 'replacement', 'new document identity should reset view-state identity');
  await session.dispose();
});

test('R-SHELL-03 round-trips consumer-owned view state and supports camera commands', async () => {
  const first = harness();
  const session = await first.create();
  await session.setSelection(['b', 'missing', 'b']);
  await session.focusNode('a');
  await session.applyFilter({
    schemaVersion: 1,
    scope: 'render',
    node: { op: 'has-token', token: 'keep' },
  });
  await session.fitNodes(['a', 'b']);
  const saved = await session.exportViewState();
  deepEqual(saved.selectedNodeIds, ['b'], 'selection should deduplicate and reconcile unknown IDs');
  equal(saved.focusedNodeId, 'a', 'focus should export by stable node ID');
  deepEqual(saved.camera.target, { x: 20, y: 30, z: 0 }, 'fit command should target known saved positions');
  equal(saved.activeFilters.render?.scope, 'render', 'active filters should belong to exported view state');
  await session.dispose();

  const second = harness();
  const restored = await second.create(JSON.parse(JSON.stringify(saved)));
  const next = await restored.exportViewState();
  deepEqual(next, saved, 'a generic consumer should be able to persist and restore complete view state');
  equal(surface(second.container).dataset.renderedNodeCount, '2', 'restored filter should affect the mounted view');
  await restored.resetCamera();
  deepEqual((await restored.exportViewState()).camera.target, { x: 0, y: 0, z: 0 }, 'reset should restore profile camera defaults');

  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  try {
    await restored.fitNodes(undefined, { signal: controller.signal });
  } catch (error) {
    aborted = error instanceof Error && error.name === 'AbortError';
  }
  equal(aborted, true, 'camera commands should respect an already-aborted transition');
  await restored.dispose();
});

test('R-SHELL-04 suspends animation work and disposes every owned lifecycle resource', async () => {
  const value = harness();
  const sentinel = value.document.createElement('p');
  value.container.append(sentinel);
  const session = await value.create();
  value.platform.flushFrame();
  equal(surface(value.container).dataset.frameCount, '1', 'flushed frame should update deterministic diagnostics');
  equal(value.platform.pendingFrames, 1, 'frame loop should reschedule exactly once');

  session.setSuspended(true);
  equal(value.platform.pendingFrames, 0, 'manual suspension should cancel animation work');
  const suspendedPatch = await session.applyPatch({
    schemaVersion: 1,
    patchId: 'suspended-add',
    baseRevision: 0,
    operations: [{ type: 'add-node', node: graphNode('d') }],
  });
  equal(suspendedPatch.applied, true, 'document operations should remain coherent while rendering is suspended');
  equal(value.platform.pendingFrames, 0, 'document work should not revive a suspended frame loop');
  session.setSuspended(false);
  equal(value.platform.pendingFrames, 1, 'resume should schedule animation work once');

  let hidden = false;
  Object.defineProperty(value.document, 'hidden', { configurable: true, get: () => hidden });
  hidden = true;
  value.document.dispatchEvent(new value.window.Event('visibilitychange') as unknown as Event);
  equal(value.platform.pendingFrames, 0, 'hidden owner document should suspend animation work');
  hidden = false;
  value.document.dispatchEvent(new value.window.Event('visibilitychange') as unknown as Event);
  equal(value.platform.pendingFrames, 1, 'visible owner document should resume animation work');

  await session.dispose();
  await session.dispose();
  equal(value.platform.pendingFrames, 0, 'dispose should cancel the final scheduled frame');
  equal(value.platform.disconnectedObservers, 1, 'dispose should disconnect resize observation exactly once');
  equal(value.platform.visibilityListenerAdds, 1, 'session should install one visibility listener');
  equal(value.platform.visibilityListenerRemoves, 1, 'dispose should remove its visibility listener');
  equal(value.container.children.length, 1, 'dispose should remove only the engine-owned subtree');
  equal(value.container.firstElementChild, sentinel, 'consumer-owned descendants should survive disposal');

  let disposedError = false;
  try {
    await session.exportDocument();
  } catch (error) {
    disposedError = error instanceof GraphSessionDisposedErrorV1;
  }
  equal(disposedError, true, 'disposed session operations should fail structurally');
  let disposedSuspensionError = false;
  try {
    session.setSuspended(false);
  } catch (error) {
    disposedSuspensionError = error instanceof GraphSessionDisposedErrorV1;
  }
  equal(disposedSuspensionError, true, 'disposed suspension requests should fail structurally');
});

test('R-SHELL-05 isolates sessions and leaves no DOM behind when activation fails', async () => {
  const first = harness();
  const second = harness({ profileId: 'three-dimensional' });
  const firstSession = await first.create();
  const secondSession = await second.create();
  equal((await firstSession.exportViewState()).camera.projection, 'orthographic', '2d profile should use an orthographic default');
  equal((await secondSession.exportViewState()).camera.projection, 'perspective', '3d profile should use a perspective default');
  await firstSession.setSelection(['a']);
  deepEqual((await secondSession.exportViewState()).selectedNodeIds, [], 'session state should remain isolated');
  await firstSession.dispose();
  equal(second.container.querySelectorAll('[data-graph-engine-session]').length, 1, 'disposing one session must not affect another');
  await secondSession.dispose();

  const invalidRestore = harness();
  const state = {
    ...(await (async () => {
      const temporary = harness();
      const temporarySession = await temporary.create();
      const exported = await temporarySession.exportViewState();
      await temporarySession.dispose();
      return exported;
    })()),
    documentId: 'wrong-document',
  };
  let rejected = false;
  try {
    await invalidRestore.create(state);
  } catch {
    rejected = true;
  }
  equal(rejected, true, 'incompatible restored state should reject activation');
  equal(invalidRestore.container.children.length, 0, 'failed state restoration should not mount a partial surface');

  const fatal = harness();
  fatal.profiles.registerConsumer({
    ...registration(),
    profiles: [{
      profileId: 'broken',
      displayName: 'Broken',
      descriptorVersion: 1,
      dimensions: '2d',
      requestedCapabilities: [],
      modules: { unavailable: { policy: 'required' } },
    }],
  });
  let profileError = false;
  try {
    await fatal.factory.createSession({
      consumerId: 'synthetic-consumer',
      profileId: 'broken',
      container: fatal.container,
      document: fixture(),
    });
  } catch (error) {
    profileError = error instanceof GraphSessionProfileErrorV1;
  }
  equal(profileError, true, 'fatal profile resolution should reject session activation');
  equal(fatal.container.children.length, 0, 'fatal profile resolution should not touch the consumer container');

  const mountFailure = harness();
  mountFailure.platform.failObservation = true;
  let mountRejected = false;
  try {
    await mountFailure.create();
  } catch {
    mountRejected = true;
  }
  equal(mountRejected, true, 'runtime resource failure should reject activation');
  equal(mountFailure.container.children.length, 0, 'runtime resource failure should roll back mounted DOM');
  equal(mountFailure.platform.disconnectedObservers, 1, 'runtime resource failure should disconnect partial observation');
  equal(mountFailure.platform.pendingFrames, 0, 'runtime resource failure should leave no frame work');
});
