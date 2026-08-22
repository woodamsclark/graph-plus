import { Plugin } from 'obsidian';
import { GraphView, GRAPH_PLUS_TYPE } from './GraphView.ts';
import { initSettings, getSettings } from './settings/settingsStore.ts';
import { GraphPlusSettingTab } from './settings/SettingsTab.ts';
import { GraphPlusSettings } from '../graph+/types/settings/appSettings.ts';
import type { ConsumerRegistrationV1, GraphEngineLeaseV1 } from '../graph-engine/contracts/v1/index.ts';
import { ConsumerProfileRegistry } from '../graph-engine/core/profile/index.ts';
import { SessionFactory } from '../graph-engine/runtime/index.ts';
import {
  createShippedGraphModuleRegistryV1,
  SHIPPED_GRAPH_MODULE_IDS_V1,
} from '../graph-engine/runtime/modules/index.ts';
import {
  GraphEngineProviderCoreV1,
  GraphEngineWorkspaceProviderV1,
} from '../graph-engine/service/index.ts';
import {
  asObsidianWorkspaceEventsV1,
  ObsidianWorkspaceEventBusV1,
} from './ObsidianWorkspaceEventBus.ts';
import { GraphEngineSettingsControllerV1 } from './settings/GraphEngineSettingsController.ts';
import {
  migrateGraphPlusPluginDataV1,
  withEngineSettingsV1,
  withGraphPlusSettingsV1,
  type GraphPlusPluginDataV1,
} from './settings/GraphPlusPluginDataStore.ts';


export default class GraphPlus extends Plugin {
  settings!: GraphPlusSettings;
  engineSettings!: GraphEngineSettingsControllerV1;
  private pluginData!: GraphPlusPluginDataV1;
  private profiles?: ConsumerProfileRegistry;
  private graphEngineProvider?: GraphEngineWorkspaceProviderV1;
  private graphPlusLease?: GraphEngineLeaseV1;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload() {
    const migration = migrateGraphPlusPluginDataV1(await this.loadData());
    this.pluginData = migration.data;
    initSettings(this.pluginData.consumers.graphPlus.consumerSettings);
    this.settings = getSettings();

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
      profiles,
      modules,
      getGlobalOverrides: () => this.pluginData.engine.globalSettings,
    });
    const capabilities = [...new Set(modules.descriptors().flatMap((module) => module.capabilities))];
    const providerCore = new GraphEngineProviderCoreV1({
      engineVersion: this.manifest.version,
      engineInstanceId,
      capabilities,
      profiles,
      sessions: sessionFactory,
      onProfilesChanged: () => this.persistEngineSettings(),
    });
    this.engineSettings = new GraphEngineSettingsControllerV1(
      profiles,
      this.pluginData.engine.globalSettings,
      () => this.persistEngineSettings(),
    );

    const localLease = providerCore.connectLocal({
      consumerId: 'graph-plus',
      supportedProtocolVersions: [1],
      requestedCapabilities: GRAPH_PLUS_CONSUMER_REGISTRATION_V1.profiles
        .flatMap((profile) => profile.requestedCapabilities),
    });
    if (localLease.ok) {
      this.graphPlusLease = localLease.lease;
      await localLease.lease.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
    }
    const eventBus = new ObsidianWorkspaceEventBusV1(asObsidianWorkspaceEventsV1(this.app.workspace));
    this.graphEngineProvider = new GraphEngineWorkspaceProviderV1(eventBus, providerCore);
    this.graphEngineProvider.start();

    this.registerView(GRAPH_PLUS_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id  : 'open-graph+',
      name: 'open graph+',
      callback: () => this.activateView(),
    });

    this.addSettingTab(new GraphPlusSettingTab(this.app, this));
  }

  async activateView() {
    // Change this to open as a tab
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE);
    if (leaves.length === 0) {
      // open in the main area as a new tab/leaf
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: GRAPH_PLUS_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  onunload() {
    void this.graphPlusLease?.release();
    void this.graphEngineProvider?.stop();
    this.graphPlusLease = undefined;
    this.graphEngineProvider = undefined;
  }

  async saveSettings() {
    this.pluginData = withGraphPlusSettingsV1(this.pluginData, getSettings());
    await this.persistPluginData();
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
    const snapshot = this.pluginData;
    this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(snapshot));
    return this.saveQueue;
  }
}

const GRAPH_PLUS_CONSUMER_REGISTRATION_V1: ConsumerRegistrationV1 = {
  consumerId: 'graph-plus',
  displayName: 'Graph+',
  consumerVersion: '1.0.0',
  supportedProtocolVersions: [1],
  profiles: [
    createGraphPlusProfile('default-3d', 'Default 3D', '3d'),
    createGraphPlusProfile('default-2d', 'Default 2D', '2d'),
  ],
};

function createGraphPlusProfile(profileId: string, displayName: string, dimensions: '2d' | '3d') {
  return {
    profileId,
    displayName,
    descriptorVersion: 1,
    dimensions,
    requestedCapabilities: ['render', 'camera', 'input', 'filter', 'projection', 'form', 'layout', 'force-layout', 'animation'],
    modules: {
      [SHIPPED_GRAPH_MODULE_IDS_V1.rendering]: { policy: 'required' as const },
      [SHIPPED_GRAPH_MODULE_IDS_V1.filtering]: { policy: 'required' as const },
      [SHIPPED_GRAPH_MODULE_IDS_V1.form]: { policy: 'optional' as const, defaultEnabled: false },
      [SHIPPED_GRAPH_MODULE_IDS_V1.forceLayout]: { policy: 'optional' as const, defaultEnabled: true },
      [SHIPPED_GRAPH_MODULE_IDS_V1.anima]: { policy: 'optional' as const, defaultEnabled: false },
    },
  };
}

function createEngineInstanceId(): string {
  return `graph-plus:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
