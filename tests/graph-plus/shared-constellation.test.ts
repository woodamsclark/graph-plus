import type { GraphSessionV1 } from '../../src/graph-engine/contracts/v1/index.ts';
import type { GraphSessionControlPortV1 } from '../../src/graph-engine/runtime/host/GraphSessionControlPort.ts';
import { GraphEngineProviderCoreV1 } from '../../src/graph-engine/service/index.ts';
import { noteNodeId } from '../../src/graph-plus/adapter/index.ts';
import { GraphPlusApplicationV1, GraphPlusConstellationV1, GraphPlusVaultModelV1 } from '../../src/graph-plus/application/index.ts';
import { GRAPH_PLUS_CONSUMER_REGISTRATION_V1 } from '../../src/graph-plus/consumer/index.ts';
import type { GraphPlusCheckpointStoreV1, GraphPlusCheckpointV1 } from '../../src/graph-plus/persistence/index.ts';
import { assert, deepEqual, equal, test } from '../support/harness.ts';
import { runtimeHarness } from '../support/runtimeHarness.ts';

const id = (name: string) => noteNodeId(`${name}.md`);
const settle = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

function fixture(initialConstellationNodeIds?: readonly string[]) {
  let notes = ['A', 'B', 'C', 'D', 'E', 'F'].map(name => ({
    file: { path: `${name}.md` }, path: `${name}.md`, basename: name, extension: 'md', tags: [], properties: {},
  }));
  const runtime = runtimeHarness({ registration: GRAPH_PLUS_CONSUMER_REGISTRATION_V1 });
  runtime.profiles.setUserOverrides('graph-plus', 'default', { modules: { 'force-layout': { enabled: false } } });
  const controls = new Map<GraphSessionV1, GraphSessionControlPortV1>();
  const errors: Error[] = [];
  const persisted: (readonly string[])[] = [];
  const core = new GraphEngineProviderCoreV1({
    engineVersion: '2.0.5', engineInstanceId: 'shared-constellation', capabilities: ['render'],
    profiles: runtime.profiles, sessions: runtime.factory,
    sessionUiHost: { mount: context => {
      controls.set(context.session, context.controls);
      return { dispose: () => controls.delete(context.session) };
    } },
  });
  const model = new GraphPlusVaultModelV1({ read: () => ({ vaultId: 'Shared', notes, resolvedLinks: {} }) },
    { countDuplicateLinks: true });
  const application = new GraphPlusApplicationV1({
    model, initialConstellationNodeIds,
    navigator: { openNote: async () => undefined, openTag: async () => undefined },
    onError: error => errors.push(error), onConstellationChanged: nodeIds => { persisted.push([...nodeIds]); },
  });
  let checkpoint: GraphPlusCheckpointV1 | undefined;
  const store: GraphPlusCheckpointStoreV1 = {
    load: async () => checkpoint,
    save: async (_vaultId, saved) => { checkpoint = saved; },
  };
  const open = async (mode: 'global' | 'local', checkpointStore = store) => {
    const lease = core.connectLocal({ consumerId: 'graph-plus', supportedProtocolVersions: [1], requestedCapabilities: ['render'] });
    assert(lease.ok, 'presentation gets an independent engine lease');
    const pane = application.createPresentation({
      mode, lease: lease.lease, container: runtime.container, vaultId: 'Shared', checkpointStore,
      initialRootNodeId: mode === 'local' ? application.getSessionSnapshot().activeNodeId : undefined,
      onError: error => errors.push(error instanceof Error ? error : new Error(error.message)),
    });
    await pane.open();
    return pane;
  };
  const activate = async (name: string) => {
    application.receiveHostEvent({ type: 'active-note-changed', nodeId: id(name) });
    await settle();
  };
  const close = async () => {
    await application.dispose(); await core.dispose();
    deepEqual(errors, [], 'sharing should not produce application or presentation errors');
  };
  return { runtime, application, model, controls, persisted, open, activate, close,
    setNotes: (names: string[]) => { notes = notes.filter(note => names.includes(note.basename)); } };
}

test('Local visit trail is shared with later Global panes beyond bounded Memory', async () => {
  const f = fixture();
  await f.activate('A');
  const local = await f.open('local');
  for (const name of ['B', 'C', 'D', 'E', 'F']) await f.activate(name);
  const before = await local.getSession()!.exportViewState();
  const global = await f.open('global');
  const secondGlobal = await f.open('global');
  for (const pane of [local, global, secondGlobal]) {
    deepEqual((await pane.getSession()!.exportViewState()).selectedNodeIds, ['A', 'B', 'C', 'D', 'E', 'F'].map(id),
      'new panes inherit the whole working constellation');
  }
  deepEqual((await local.getSession()!.exportViewState()).camera, before.camera, 'opening Global preserves Local framing');
  equal((await global.getSession()!.exportViewState()).viewMode, 'overview', 'Global retains its own View');
  equal((await local.getSession()!.exportViewState()).focusedNodeId, id('F'), 'Local retains its focused root');
  equal(await global.resetLayoutData(), true, 'Global can regenerate layout independently of membership');
  deepEqual((await global.getSession()!.exportViewState()).selectedNodeIds, ['A', 'B', 'C', 'D', 'E', 'F'].map(id),
    'layout reset does not discard the application constellation');
  await f.close();
});

test('real membership controls share additions, removals and clears while preserving pane Focus and geometry', async () => {
  const f = fixture();
  await f.activate('A');
  const local = await f.open('local');
  const global = await f.open('global');
  const localSession = local.getSession()!; const globalSession = global.getSession()!;
  const localControls = f.controls.get(localSession)!; const globalControls = f.controls.get(globalSession)!;
  await localSession.setNodePinned(id('E'), true); await settle();
  const beforeLocal = await localSession.exportViewState();
  const beforeGlobal = await globalSession.exportViewState();
  const flushControls = async () => { for (let i = 0; i < 8; i++) f.runtime.platform.flushFrame(); await settle(); };
  globalControls.toggleConstellationNode(id('B')); await flushControls();
  deepEqual(f.application.getConstellationNodeIds(), [id('A'), id('B')], 'Global menu addition reaches the application');
  deepEqual((await localSession.exportViewState()).selectedNodeIds, [id('A'), id('B')], 'addition reaches Local');
  globalControls.toggleConstellationNode(id('B')); await flushControls();
  deepEqual((await localSession.exportViewState()).selectedNodeIds, [id('A')], 'Global removal reaches Local');
  localControls.toggleConstellationNode(id('C')); await flushControls();
  deepEqual((await globalSession.exportViewState()).selectedNodeIds, [id('A'), id('C')], 'Local addition reaches Global');
  globalControls.navigateView('clear-constellation'); await flushControls();
  for (const session of [localSession, globalSession]) {
    deepEqual((await session.exportViewState()).selectedNodeIds, [id('A')], 'Global Quick Settings clear retains the required Local root everywhere');
  }
  globalControls.toggleConstellationNode(id('D')); await flushControls();
  equal(localControls.invokeNodeAction('clear-constellation', id('A')), true, 'Local uses the registered clear action');
  await flushControls();
  deepEqual((await globalSession.exportViewState()).selectedNodeIds, [id('A')], 'Local context clear reaches Global');
  const afterLocal = await localSession.exportViewState(); const afterGlobal = await globalSession.exportViewState();
  equal(afterLocal.focusedNodeId, id('A'), 'peer membership changes do not move Local Focus');
  for (const [before, after] of [[beforeLocal, afterLocal], [beforeGlobal, afterGlobal]]) {
    deepEqual(after.camera, before.camera, 'membership synchronization preserves camera');
    deepEqual(after.positions, before.positions, 'membership synchronization preserves geometry');
    deepEqual(after.pinnedNodeIds, before.pinnedNodeIds, 'membership synchronization preserves pins');
  }
  await f.close();
});

test('pane filters cannot erase shared membership and clearing removes hidden and pending members', async () => {
  const f = fixture();
  await f.activate('A'); const global = await f.open('global'); const local = await f.open('local');
  await f.activate('B');
  await global.setLens({ ...global.getLens(), query: 'A' });
  deepEqual((await global.getSession()!.exportViewState()).selectedNodeIds, [id('A')], 'the filtered pane hides other members');
  deepEqual(f.application.getConstellationNodeIds(), [id('A'), id('B')], 'filtering does not mutate application membership');
  deepEqual((await local.getSession()!.exportViewState()).selectedNodeIds, [id('A'), id('B')], 'other panes retain their members');
  await global.setLens({ ...global.getLens(), query: '' });
  deepEqual((await global.getSession()!.exportViewState()).selectedNodeIds, [id('A'), id('B')], 'unfiltering reprojects shared membership');
  await local.setLens({ ...local.getLens(), query: 'No match' });
  await global.clearConstellation();
  deepEqual(f.application.getConstellationNodeIds(), [id('B')], 'a filtered Local root remains required');
  await local.setLens({ ...local.getLens(), query: '' });
  equal((await local.getSession()!.exportViewState()).focusedNodeId, id('B'), 'removing the filter restores the Local root');
  await f.activate('Pending');
  await global.clearConstellation();
  deepEqual(f.application.getConstellationNodeIds(), [id('B')], 'clear discards unavailable pending members and retains Local root');
  await f.close();
});

test('live membership wins over stale Global checkpoints and persists without Global', async () => {
  const f = fixture();
  await f.activate('A'); const global = await f.open('global');
  const stale: GraphPlusCheckpointV1 = { document: global.getDocument()!, viewState: await global.getSession()!.exportViewState(), savedAt: 0 };
  await f.application.closePresentation(global);
  const local = await f.open('local');
  await f.activate('B'); await f.activate('C');
  deepEqual(f.persisted.at(-1), [id('A'), id('B'), id('C')], 'Local-only changes persist application membership');
  const reopened = await f.open('global', { load: async () => stale, save: async () => undefined });
  deepEqual((await reopened.getSession()!.exportViewState()).selectedNodeIds, [id('A'), id('B'), id('C')],
    'restoring an older Global viewport cannot roll back live membership');
  await f.application.closePresentation(local); await f.application.closePresentation(reopened);
  const again = await f.open('global');
  deepEqual((await again.getSession()!.exportViewState()).selectedNodeIds, [id('A'), id('B'), id('C')],
    'closing every pane does not discard the application constellation');
  await f.close();
});

test('application constellation reconciles deletion while retaining unknown arrivals until clear', () => {
  const constellation = new GraphPlusConstellationV1([id('A'), id('B')]);
  constellation.reconcile([id('A'), id('B')]);
  constellation.add([id('New')]);
  constellation.reconcile([id('A')]);
  deepEqual(constellation.snapshot(), [id('A'), id('New')], 'known deleted members leave while new arrivals wait');
  constellation.clear([]);
  constellation.reconcile([id('A'), id('New')]);
  deepEqual(constellation.snapshot(), [], 'canonical arrival after clear cannot resurrect a pending member');
  const restoring = new GraphPlusConstellationV1();
  restoring.edit([id('C')], [id('B')]);
  restoring.restore([id('A'), id('B')]);
  deepEqual(restoring.snapshot(), [id('A'), id('C')], 'edits during a delayed restore remain authoritative');
  const clearing = new GraphPlusConstellationV1();
  clearing.clear([]); clearing.restore([id('A')]);
  deepEqual(clearing.snapshot(), [], 'a delayed restore cannot undo explicit clear');
});

test('canonical deletion removes shared members without disturbing a valid Local root', async () => {
  const f = fixture(); await f.activate('A');
  const local = await f.open('local'); const global = await f.open('global');
  await local.addActiveNodesToConstellation([id('B')]);
  f.setNotes(['A', 'C', 'D', 'E', 'F']); await f.application.reconcile();
  for (const pane of [local, global]) {
    deepEqual((await pane.getSession()!.exportViewState()).selectedNodeIds, [id('A')], 'deleted members leave all panes');
  }
  equal((await local.getSession()!.exportViewState()).focusedNodeId, id('A'), 'a valid root remains focused');
  deepEqual(f.persisted.at(-1), [id('A')], 'deletions update durable application membership');
  await f.close();
});

test('multiple Local roots stay independent and are retained by shared clear', async () => {
  const f = fixture(); await f.activate('A');
  const first = await f.open('local'); const second = await f.open('local'); const global = await f.open('global');
  await first.focusNode(id('B'));
  equal((await second.getSession()!.exportViewState()).focusedNodeId, id('A'), 'a peer admission does not take over Local Focus');
  await global.clearConstellation();
  for (const pane of [first, second, global]) {
    deepEqual([...(await pane.getSession()!.exportViewState()).selectedNodeIds].sort(), [id('A'), id('B')],
      'clear retains every open Local root in the one shared set');
  }
  await f.close();
});

test('Local-first startup migrates legacy Global membership and saved application state takes precedence on reload', async () => {
  const old = fixture();
  await old.activate('A'); const oldGlobal = await old.open('global'); await old.activate('B');
  const legacy: GraphPlusCheckpointV1 = { document: oldGlobal.getDocument()!,
    viewState: await oldGlobal.getSession()!.exportViewState(), savedAt: 0 };
  await old.close();
  const legacyStore = { load: async () => legacy, save: async () => undefined };
  const migrated = fixture();
  await migrated.activate('C');
  const local = await migrated.open('local', legacyStore);
  deepEqual((await local.getSession()!.exportViewState()).selectedNodeIds, ['A', 'B', 'C'].map(id),
    'Local can migrate old saved membership without opening Global');
  await local.clearConstellation();
  const saved = migrated.persisted.at(-1)!;
  deepEqual(saved, [id('C')], 'Local clear saves shared membership with its required root');
  await migrated.close();
  const reloaded = fixture(saved);
  const restoredGlobal = await reloaded.open('global', legacyStore);
  deepEqual((await restoredGlobal.getSession()!.exportViewState()).selectedNodeIds, [id('C')],
    'application state on reload overrides old Global viewport membership');
  await reloaded.close();
  const empty = fixture([]);
  const emptyGlobal = await empty.open('global', legacyStore);
  deepEqual((await emptyGlobal.getSession()!.exportViewState()).selectedNodeIds, [],
    'an explicitly empty saved constellation cannot resurrect legacy members');
  await empty.close();
});

test('concurrent pane edits compose and Local hover never commits shared membership', async () => {
  const f = fixture(); await f.activate('A');
  const local = await f.open('local'); const first = await f.open('global'); const second = await f.open('global');
  f.controls.get(first.getSession()!)!.toggleConstellationNode(id('B'));
  f.controls.get(second.getSession()!)!.toggleConstellationNode(id('C'));
  for (let i = 0; i < 12; i++) f.runtime.platform.flushFrame();
  await settle();
  deepEqual([...f.application.getConstellationNodeIds()].sort(), ['A', 'B', 'C'].map(id).sort(),
    'edits from different panes merge rather than overwrite a stale snapshot');
  await local.hoverDocumentLink(id('D'));
  for (let i = 0; i < 12; i++) f.runtime.platform.flushFrame();
  await settle();
  deepEqual([...f.application.getConstellationNodeIds()].sort(), ['A', 'B', 'C'].map(id).sort(),
    'hover remains transient');
  await local.hoverDocumentLink();
  await f.close();
});

test('clearing during an in-flight Local follow cancels pending admissions before metadata catches up', async () => {
  const f = fixture(); await f.activate('A');
  const local = await f.open('local'); const global = await f.open('global');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const follow = local.followActiveNode.bind(local);
  local.followActiveNode = async (nodeId, admit) => { await gate; return follow(nodeId, admit); };
  f.application.receiveHostEvent({ type: 'active-note-changed', nodeId: id('Pending') });
  await global.clearConstellation();
  release(); await settle();
  deepEqual(f.application.getConstellationNodeIds(), [id('A')], 'the old follow cannot re-admit a cleared pending subject');
  await f.application.closePresentation(global);
  await f.application.closePresentation(local);
  const reopened = await f.open('global');
  // Reopening deliberately seeds the current note, independently of the canceled follow.
  deepEqual(f.application.getConstellationNodeIds(), [id('A'), id('Pending')], 'a later open can seed the current active subject');
  await f.application.clearConstellation();
  await f.application.reconcile();
  deepEqual((await reopened.getSession()!.exportViewState()).selectedNodeIds, [], 'explicit clearing remains authoritative');
  await f.close();
});
