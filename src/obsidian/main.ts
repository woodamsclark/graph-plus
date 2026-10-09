import { createSessionRuntimePlatformV1 } from '../graph-engine/runtime/platform/index.ts';
import { LatestStatePersistenceV1 } from './settings/LatestStatePersistence.ts';
import { Notice, Platform, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { GraphPlusView, GRAPH_PLUS_TYPE } from './GraphView.ts';
import { LocalGraphPlusView, LOCAL_GRAPH_PLUS_TYPE } from './LocalGraphView.ts';
import { GraphEngineSettingTab } from './settings/SettingsTab.ts';
import type { Disposable, GraphEngineLeaseV1 } from '../graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../graph-engine/core/profile/index.ts';
import { SessionFactory } from '../graph-engine/runtime/index.ts';
import { createShippedGraphModuleRegistryV1 } from '../graph-engine/runtime/modules/index.ts';
import {
  GraphEngineProviderCoreV1,
  GraphEngineServiceErrorV1,
  GraphEngineWorkspaceProviderV1,
} from '../graph-engine/service/index.ts';
import {
  GRAPH_PLUS_CONSUMER_REGISTRATION_V1,
  GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
  migrateGraphPlusProfileOverridesV17,
  type GraphPlusConsumerSettingsV1,
} from '../graph-plus/consumer/index.ts';
import type { GraphPlusCheckpointStoreV1 } from '../graph-plus/persistence/index.ts';
import type { GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';
import { ObsidianVaultGraphSourceV1 } from '../graph-plus/adapter/index.ts';
import { GraphPlusApplicationV1, GraphPlusVaultModelV1 } from '../graph-plus/application/index.ts';
import {
  asObsidianWorkspaceEventsV1,
  ObsidianWorkspaceEventBusV1,
} from './ObsidianWorkspaceEventBus.ts';
import { GraphEngineSettingsControllerV1 } from './settings/GraphEngineSettingsController.ts';
import { GraphEngineSettingsUpdatesV1 } from './settings/GraphEngineSettingsUpdates.ts';
import { ThemeStyleResolver } from './themeStyleResolver.ts';
import type { GraphVisualThemeV2 } from '../graph-engine/runtime/theme/index.ts';
import { ObsidianGraphEngineSessionUiHostV1 } from './graph-engine-ui/index.ts';
import {
  migrateGraphPlusPluginDataV1,
  withEngineSettingsV1,
  withGraphPlusGenericLensMigratedV1,
  withGraphPlusSettingsV1,
  type GraphPlusPluginDataV1,
} from './settings/GraphPlusPluginDataStore.ts';
import { GraphPlusCheckpointFileStoreV1 } from './settings/GraphPlusCheckpointFileStore.ts';
import { ObsidianGraphBridgeV1 } from './ObsidianGraphBridge.ts';
import { startGraphPlusShutdownV1, waitForGraphPlusShutdownV1 } from './GraphPlusShutdown.ts';


export default class GraphEnginePlugin extends Plugin {
  settings!: GraphPlusConsumerSettingsV1;
  engineSettings!: GraphEngineSettingsControllerV1;
  private pluginData!: GraphPlusPluginDataV1;
  private profiles?: ConsumerProfileRegistry;
  private settingsUpdates?: GraphEngineSettingsUpdatesV1;
  private graphEngineCore?: GraphEngineProviderCoreV1;
  private graphEngineProvider?: GraphEngineWorkspaceProviderV1;
  private graphPlusLease?: GraphEngineLeaseV1;
  private checkpointFileStore?: GraphPlusCheckpointFileStoreV1;
  private vaultGraphSource?: ObsidianVaultGraphSourceV1;
  private vaultGraphModel?: GraphPlusVaultModelV1<TFile>;
  private sharedGraphPlusApplication?: GraphPlusApplicationV1<TFile>;
  private graphBridge?: ObsidianGraphBridgeV1;
  private graphBridgeConnection?: Disposable;
  private refreshActiveThemes?: () => void;
  private readonly dataPersistence = new LatestStatePersistenceV1<void>(() => this.saveData(this.pluginData));
  private unloading = false;
  private shutdown?: Promise<void>;
  private recovery?: Promise<void>;

  async onload() {
    await waitForGraphPlusShutdownV1(this.shutdownKey);
    if (this.unloading) return;
    const migration = migrateGraphPlusPluginDataV1(await this.loadData());
    this.pluginData = migration.data;
    this.settings = this.pluginData.consumers.graphPlus.consumerSettings;
    this.vaultGraphSource = new ObsidianVaultGraphSourceV1(this.app);
    this.vaultGraphModel = new GraphPlusVaultModelV1(this.vaultGraphSource, {
      countDuplicateLinks: this.settings.countDuplicateLinks,
    });
    this.graphBridge = new ObsidianGraphBridgeV1(this.app);
    this.sharedGraphPlusApplication = this.createGraphPlusApplication();
    this.graphBridgeConnection = this.graphBridge.start(
      (event) => this.sharedGraphPlusApplication?.receiveUnconsciousActivity(event),
    );
    const pluginDirectory = this.manifest.dir
      ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.checkpointFileStore = new GraphPlusCheckpointFileStoreV1({
      adapter: this.app.vault.adapter,
      directory: `${pluginDirectory}/graph-plus-checkpoints`,
      getData: () => this.pluginData,
      setData: (data) => { this.pluginData = data; },
      persistData: () => this.persistPluginData(),
    });

    const profiles = new ConsumerProfileRegistry();
    this.profiles = profiles;
    try {
      profiles.restoreSnapshot(this.pluginData.engine.profileOverrides);
    } catch {
      profiles.restoreSnapshot({ schemaVersion: 1, consumers: [] });
      this.pluginData = withEngineSettingsV1(this.pluginData, this.pluginData.engine.globalSettings, profiles.exportSnapshot());
    }
    const modules = createShippedGraphModuleRegistryV1();
    const engineInstanceId = createEngineInstanceId();
    const sessionFactory = new SessionFactory({
      engineInstanceId,
      createPlatform: container => createSessionRuntimePlatformV1(container, Platform.isMacOS || Platform.isIosApp),
      profiles,
      modules,
      getGlobalOverrides: () => this.pluginData.engine.globalSettings,
      resolveThemePalette: (container) => this.resolveGraphPlusThemePalette(container),
    });
    this.refreshActiveThemes = () => sessionFactory.refreshActiveThemes();
    this.registerEvent(this.app.workspace.on('css-change', () => sessionFactory.refreshActiveThemes()));
    const capabilities = [...new Set(modules.descriptors().flatMap((module) => module.capabilities))];
    this.settingsUpdates = new GraphEngineSettingsUpdatesV1(
      window,
      () => sessionFactory.refreshActiveProfiles(),
      () => this.persistEngineSettings(),
      error => {
        console.error('[graph+] settings update error', error);
        new Notice('Graph+ could not apply or save graph settings.');
      },
    );
    const providerCore = new GraphEngineProviderCoreV1({
      engineVersion: this.manifest.version,
      engineInstanceId,
      capabilities,
      profiles,
      sessions: sessionFactory,
      sessionUiHost: new ObsidianGraphEngineSessionUiHostV1(),
      onProfilesChanged: (mode) => this.settingsUpdates!.update(mode),
    });
    this.graphEngineCore = providerCore;
    this.engineSettings = new GraphEngineSettingsControllerV1(
      profiles,
      this.pluginData.engine.globalSettings,
      () => this.settingsUpdates!.update(),
      true,
    );

    const localLease = providerCore.connectLocal({
      consumerId: 'graph-plus',
      supportedProtocolVersions: [1],
      requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    });
    if (localLease.ok) {
      this.graphPlusLease = localLease.lease;
      await localLease.lease.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
      const previous = profiles.getUserOverrides('graph-plus', 'default');
      const migrated = migrateGraphPlusProfileOverridesV17(previous);
      if (JSON.stringify(previous) !== JSON.stringify(migrated)) {
        profiles.setUserOverrides('graph-plus', 'default', migrated);
        await this.persistEngineSettings();
      }
    }
    const eventBus = new ObsidianWorkspaceEventBusV1(asObsidianWorkspaceEventsV1(this.app.workspace));
    this.graphEngineProvider = new GraphEngineWorkspaceProviderV1(eventBus, providerCore);
    this.graphEngineProvider.start();

    this.registerView(GRAPH_PLUS_TYPE, (leaf) => new GraphPlusView(leaf, this));
    this.registerView(LOCAL_GRAPH_PLUS_TYPE, (leaf) => new LocalGraphPlusView(leaf, this));
    this.registerHoverLinkSource(GRAPH_PLUS_TYPE, { display: 'graph+', defaultMod: true });
    this.registerHoverLinkSource(LOCAL_GRAPH_PLUS_TYPE, { display: 'local graph+', defaultMod: true });
    this.addRibbonIcon('network', 'open graph+', () => {
      void this.activateView().then((leaf) => {
        if (!leaf) new Notice('graph+ is disabled in settings.');
      });
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!this.settings.enabled || !(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem((item) => item
        .setTitle('show in graph+')
        .setIcon('dot-network')
        .onClick(() => void this.showInGraphPlus(file)));
    }));
    this.addCommand({
      id  : 'open-graph+',
      name: 'Open global graph',
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: 'open-local-graph+',
      name: 'Open local graph',
      callback: () => this.activateLocalView(),
    });

    this.addSettingTab(new GraphEngineSettingTab(this.app, this));
  }

  async activateView(): Promise<WorkspaceLeaf | undefined> {
    if (!this.settings.enabled) return undefined;
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: GRAPH_PLUS_TYPE,
        active: true,
      });
      await this.app.workspace.revealLeaf(leaf);
      return leaf;
    } else {
      await this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
  }

  async activateLocalView(): Promise<WorkspaceLeaf | undefined> {
    if (!this.settings.enabled) return undefined;
    const leaves = this.app.workspace.getLeavesOfType(LOCAL_GRAPH_PLUS_TYPE);
    if (leaves.length > 0) {
      await this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) return undefined;
    await leaf.setViewState({ type: LOCAL_GRAPH_PLUS_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private async showInGraphPlus(file: TFile): Promise<void> {
    const leaf = await this.activateView();
    if (!leaf) return;
    await leaf.loadIfDeferred();
    const view = leaf.view;
    const shown = view instanceof GraphPlusView && await view.showFile(file);
    if (!shown) new Notice(`graph+ could not find ${file.path}.`);
  }

  canResetGraphLayoutData(): boolean {
    return this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE).length === 1;
  }

  async resetGraphLayoutData(): Promise<boolean> {
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE);
    if (leaves.length !== 1) return false;
    await leaves[0].loadIfDeferred();
    return leaves[0].view instanceof GraphPlusView
      ? leaves[0].view.resetGraphLayoutData()
      : false;
  }

  onunload() {
    if (this.shutdown) return;
    this.unloading = true;
    this.shutdown = startGraphPlusShutdownV1(this.shutdownKey, {
      stopActivity: () => this.graphBridgeConnection?.dispose(),
      closePresentations: async () => {
        await this.recovery?.catch(() => undefined);
        await this.sharedGraphPlusApplication?.dispose();
      },
      drainPersistence: async () => {
        const results = await Promise.allSettled([this.settingsUpdates?.close(), this.checkpointFileStore?.drain(), this.dataPersistence.drain()]);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
      },
      releaseLease: async () => { await this.graphPlusLease?.release(); },
      stopProvider: async () => { await this.graphEngineProvider?.stop(); },
      clearReferences: () => {
        this.graphPlusLease = undefined;
        this.graphEngineProvider = undefined;
        this.graphEngineCore = undefined;
        this.vaultGraphSource = undefined;
        this.vaultGraphModel = undefined;
        this.sharedGraphPlusApplication = undefined;
        this.graphBridge = undefined;
        this.graphBridgeConnection = undefined;
        this.refreshActiveThemes = undefined;
        this.settingsUpdates = undefined;
        this.checkpointFileStore = undefined;
      },
    });
    void this.shutdown.catch(error => {
      console.error('[graph+] shutdown error', error);
      new Notice('Graph+ could not finish saving during shutdown. Check the saved layout when reopening.');
    });
  }

  private get shutdownKey(): string {
    return `${this.app.vault.getName()}:${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}`;
  }

  private createGraphPlusApplication(): GraphPlusApplicationV1<TFile> {
    if (!this.vaultGraphModel || !this.graphBridge) throw new Error('Graph+ is unavailable.');
    return new GraphPlusApplicationV1({
      model: this.vaultGraphModel,
      navigator: this.graphBridge,
      onError: error => console.error('[graph+] application error', error),
    });
  }

  hasPreviousGraphPlusCheckpoint(): boolean {
    return this.checkpointFileStore?.hasPrevious(this.app.vault.getName()) ?? false;
  }

  recoverGraphPlusCheckpoint(action: 'previous' | 'reset'): Promise<void> {
    if (this.unloading) return Promise.reject(new Error('Graph+ is shutting down.'));
    if (this.recovery) return this.recovery;
    const operation = this.recoverGraphPlusCheckpointOnce(action);
    this.recovery = operation;
    const finish = () => { if (this.recovery === operation) this.recovery = undefined; };
    void operation.then(finish, finish);
    return operation;
  }

  private async recoverGraphPlusCheckpointOnce(action: 'previous' | 'reset'): Promise<void> {
    const store = this.requireCheckpointFileStore();
    const leaves = [
      ...this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE),
      ...this.app.workspace.getLeavesOfType(LOCAL_GRAPH_PLUS_TYPE),
    ];
    const views = leaves.map(leaf => leaf.view).filter((view): view is GraphPlusView | LocalGraphPlusView =>
      view instanceof GraphPlusView || view instanceof LocalGraphPlusView);
    // All presentations must stop saving the discarded world before recovery.
    await this.sharedGraphPlusApplication?.dispose().catch(error => console.error('[graph+] recovery close', error));
    await Promise.allSettled(views.map(view => view.onClose()));
    try {
      await store.recover(this.app.vault.getName(), action);
    } finally {
      if (!this.unloading) {
        this.sharedGraphPlusApplication = this.createGraphPlusApplication();
        for (const view of views) await view.onOpen();
      }
    }
  }

  async updateGraphPlusSettings(settings: GraphPlusConsumerSettingsV1) {
    if (this.unloading) throw new Error('Graph+ is shutting down.');
    this.settings = { ...settings };
    this.pluginData = withGraphPlusSettingsV1(this.pluginData, this.settings);
    await this.persistPluginData();
    if (this.sharedGraphPlusApplication) {
      await this.sharedGraphPlusApplication.setCountDuplicateLinks(this.settings.countDuplicateLinks);
    } else {
      this.vaultGraphModel?.setCountDuplicateLinks(this.settings.countDuplicateLinks);
    }
    this.refreshActiveThemes?.();
    if (!settings.enabled) {
      this.app.workspace.detachLeavesOfType(GRAPH_PLUS_TYPE);
      this.app.workspace.detachLeavesOfType(LOCAL_GRAPH_PLUS_TYPE);
    }
  }

  resolveGraphPlusThemePalette(container = this.app.workspace.containerEl): GraphVisualThemeV2 {
    return new ThemeStyleResolver(
      () => container,
      () => this.settings.colors,
      () => this.settings.frankMode,
    ).getPalette();
  }

  acquireGraphPlusLease(): GraphEngineLeaseV1 {
    if (this.unloading || !this.settings.enabled) {
      throw new GraphEngineServiceErrorV1({ code: 'engine-unavailable', message: 'The bundled graph+ consumer is disabled.' });
    }
    const result = this.graphEngineCore?.connectLocal({
      consumerId: 'graph-plus',
      supportedProtocolVersions: [1],
      requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    }) ?? {
      ok: false as const,
      error: { code: 'engine-unavailable' as const, message: 'graph+ is unavailable.' },
    };
    if (!result.ok) throw new GraphEngineServiceErrorV1(result.error);
    return result.lease;
  }

  get graphPlusVaultSource(): ObsidianVaultGraphSourceV1 {
    if (!this.vaultGraphSource) throw new Error('graph+ vault source is unavailable.');
    return this.vaultGraphSource;
  }

  get graphPlusVaultModel(): GraphPlusVaultModelV1<TFile> {
    if (!this.vaultGraphModel) throw new Error('graph+ vault model is unavailable.');
    return this.vaultGraphModel;
  }

  get graphPlusApplication(): GraphPlusApplicationV1<TFile> {
    if (!this.sharedGraphPlusApplication) throw new Error('graph+ application is unavailable.');
    return this.sharedGraphPlusApplication;
  }

  get obsidianGraphBridge(): ObsidianGraphBridgeV1 {
    if (!this.graphBridge) throw new Error('Obsidian graph bridge is unavailable.');
    return this.graphBridge;
  }

  readonly graphPlusCheckpointStore: GraphPlusCheckpointStoreV1 = {
    load: (vaultId) => this.requireCheckpointFileStore().load(vaultId),
    save: (vaultId, checkpoint, options) => this.requireCheckpointFileStore().save(vaultId, checkpoint, options),
  };

  getLegacyGraphState(vaultId: string): unknown {
    const legacy = this.pluginData.graphStateByVault;
    return legacy !== null && typeof legacy === 'object' && !Array.isArray(legacy)
      ? (legacy as Record<string, unknown>)[vaultId]
      : undefined;
  }

  async migrateLegacyLensSettings(lens: GraphPlusLensStateV1): Promise<GraphPlusLensStateV1> {
    if (this.pluginData.consumers.graphPlus.genericLensMigrated !== true) {
      this.pluginData = withGraphPlusGenericLensMigratedV1(this.pluginData);
      await this.persistPluginData();
    }
    return { ...lens, display: {}, force: {} };
  }

  private async persistEngineSettings(): Promise<void> {
    if (!this.profiles) return;
    this.pluginData = withEngineSettingsV1(
      this.pluginData,
      this.engineSettings?.getGlobalOverrides() ?? this.pluginData.engine.globalSettings,
      this.profiles.exportSnapshot(),
    );
    await this.persistPluginData();
  }

  private persistPluginData(): Promise<void> {
    return this.dataPersistence.save(undefined);
  }

  private requireCheckpointFileStore(): GraphPlusCheckpointFileStoreV1 {
    if (!this.checkpointFileStore) throw new Error('graph+ checkpoint storage is unavailable before plugin load.');
    return this.checkpointFileStore;
  }
}

function createEngineInstanceId(): string {
  return `graph-engine:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
