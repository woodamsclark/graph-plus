import { Plugin } from 'obsidian';
import { GraphPlusView, GRAPH_PLUS_TYPE } from './GraphView.ts';
import { GraphPlusSettingTab } from './settings/SettingsTab.ts';
import type { GraphEngineLeaseV1 } from '../graph-engine/contracts/v1/index.ts';
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
  type GraphPlusConsumerSettingsV1,
} from '../graph-plus/consumer/index.ts';
import type { GraphPlusCheckpointStoreV1 } from '../graph-plus/persistence/index.ts';
import {
  asObsidianWorkspaceEventsV1,
  ObsidianWorkspaceEventBusV1,
} from './ObsidianWorkspaceEventBus.ts';
import { GraphEngineSettingsControllerV1 } from './settings/GraphEngineSettingsController.ts';
import { ThemeStyleResolver } from './themeStyleResolver.ts';
import { ObsidianGraphEngineSessionUiHostV1 } from './graph-engine-ui/index.ts';
import {
  migrateGraphPlusPluginDataV1,
  readGraphPlusCheckpointV1,
  withEngineSettingsV1,
  withGraphPlusCheckpointV1,
  withGraphPlusSettingsV1,
  type GraphPlusPluginDataV1,
} from './settings/GraphPlusPluginDataStore.ts';


export default class GraphPlus extends Plugin {
  settings!: GraphPlusConsumerSettingsV1;
  engineSettings!: GraphEngineSettingsControllerV1;
  private pluginData!: GraphPlusPluginDataV1;
  private profiles?: ConsumerProfileRegistry;
  private graphEngineCore?: GraphEngineProviderCoreV1;
  private graphEngineProvider?: GraphEngineWorkspaceProviderV1;
  private graphPlusLease?: GraphEngineLeaseV1;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload() {
    const migration = migrateGraphPlusPluginDataV1(await this.loadData());
    this.pluginData = migration.data;
    this.settings = this.pluginData.consumers.graphPlus.consumerSettings;

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
      resolveThemePalette: (container) => {
        const palette = new ThemeStyleResolver(() => container.ownerDocument.body).getPalette();
        return {
          backgroundColor: palette.backgroundColor,
          nodeColor: palette.nodeColor,
          selectedNodeColor: palette.tagColor,
          focusedNodeColor: palette.tagColor,
          edgeColor: palette.linkColor,
          labelColor: palette.labelColor,
          labelFont: container.ownerDocument.defaultView?.getComputedStyle(container).font || '12px sans-serif',
        };
      },
    });
    const capabilities = [...new Set(modules.descriptors().flatMap((module) => module.capabilities))];
    const providerCore = new GraphEngineProviderCoreV1({
      engineVersion: this.manifest.version,
      engineInstanceId,
      capabilities,
      profiles,
      sessions: sessionFactory,
      sessionUiHost: new ObsidianGraphEngineSessionUiHostV1(),
      onProfilesChanged: () => {
        sessionFactory.refreshActiveProfiles();
        return this.persistEngineSettings();
      },
    });
    this.graphEngineCore = providerCore;
    this.engineSettings = new GraphEngineSettingsControllerV1(
      profiles,
      this.pluginData.engine.globalSettings,
      () => {
        sessionFactory.refreshActiveProfiles();
        return this.persistEngineSettings();
      },
    );

    const localLease = providerCore.connectLocal({
      consumerId: 'graph-plus',
      supportedProtocolVersions: [1],
      requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    });
    if (localLease.ok) {
      this.graphPlusLease = localLease.lease;
      await localLease.lease.registerConsumer(GRAPH_PLUS_CONSUMER_REGISTRATION_V1);
    }
    const eventBus = new ObsidianWorkspaceEventBusV1(asObsidianWorkspaceEventsV1(this.app.workspace));
    this.graphEngineProvider = new GraphEngineWorkspaceProviderV1(eventBus, providerCore);
    this.graphEngineProvider.start();

    this.registerView(GRAPH_PLUS_TYPE, (leaf) => new GraphPlusView(leaf, this));
    this.addCommand({
      id  : 'open-graph+',
      name: 'open graph+',
      callback: () => this.activateView(),
    });

    this.addSettingTab(new GraphPlusSettingTab(this.app, this));
  }

  async activateView() {
    if (!this.settings.enabled) return;
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE);
    if (leaves.length === 0) {
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
    this.graphEngineCore = undefined;
  }

  async updateGraphPlusSettings(settings: GraphPlusConsumerSettingsV1) {
    this.settings = { ...settings };
    this.pluginData = withGraphPlusSettingsV1(this.pluginData, this.settings);
    await this.persistPluginData();
    if (!settings.enabled) this.app.workspace.detachLeavesOfType(GRAPH_PLUS_TYPE);
  }

  acquireGraphPlusLease(): GraphEngineLeaseV1 {
    if (!this.settings.enabled) {
      throw new GraphEngineServiceErrorV1({ code: 'engine-unavailable', message: 'The bundled Graph+ consumer is disabled.' });
    }
    const result = this.graphEngineCore?.connectLocal({
      consumerId: 'graph-plus',
      supportedProtocolVersions: [1],
      requestedCapabilities: GRAPH_PLUS_REQUESTED_CAPABILITIES_V1,
    }) ?? {
      ok: false as const,
      error: { code: 'engine-unavailable' as const, message: 'Graph Engine is unavailable.' },
    };
    if (!result.ok) throw new GraphEngineServiceErrorV1(result.error);
    return result.lease;
  }

  readonly graphPlusCheckpointStore: GraphPlusCheckpointStoreV1 = {
    load: async (vaultId) => readGraphPlusCheckpointV1(this.pluginData, vaultId),
    save: async (vaultId, checkpoint) => {
      this.pluginData = withGraphPlusCheckpointV1(this.pluginData, vaultId, checkpoint);
      await this.persistPluginData();
    },
  };

  getLegacyGraphState(vaultId: string): unknown {
    const legacy = this.pluginData.graphStateByVault;
    return legacy !== null && typeof legacy === 'object' && !Array.isArray(legacy)
      ? (legacy as Record<string, unknown>)[vaultId]
      : undefined;
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

function createEngineInstanceId(): string {
  return `graph-plus:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
