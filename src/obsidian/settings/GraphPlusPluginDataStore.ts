import type {
  ConsumerProfileRegistrySnapshotV1,
} from '../../graph-engine/core/profile/index.ts';
import type { GraphSettingsOverridesV1 } from '../../graph-engine/contracts/v1/index.ts';
import type { GraphPlusCheckpointV1 } from '../../graph-plus/persistence/index.ts';
import { validateGraphPlusCheckpointV1 } from '../../graph-plus/persistence/index.ts';
import {
  coerceGraphPlusConsumerSettingsV1,
  type GraphPlusConsumerSettingsV1,
} from '../../graph-plus/consumer/index.ts';

export const GRAPH_ENGINE_SETTINGS_SCHEMA_VERSION = 1;
export const GRAPH_PLUS_CONSUMER_DATA_SCHEMA_VERSION = 1;

export interface GraphPlusPluginDataV1 {
  readonly engine: {
    readonly settingsSchemaVersion: 1;
    readonly globalSettings: GraphSettingsOverridesV1;
    readonly profileOverrides: ConsumerProfileRegistrySnapshotV1;
  };
  readonly consumers: {
    readonly graphPlus: {
      readonly dataSchemaVersion: 1;
      readonly graphDocuments?: Readonly<Record<string, unknown>>;
      readonly viewStates?: Readonly<Record<string, unknown>>;
      readonly checkpoints?: Readonly<Record<string, unknown>>;
      readonly consumerSettings: GraphPlusConsumerSettingsV1;
      readonly legacySettings?: unknown;
    };
    readonly [consumerId: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface GraphPlusPluginDataMigrationV1 {
  readonly data: GraphPlusPluginDataV1;
  readonly engineRecovered: boolean;
  readonly graphPlusRecovered: boolean;
}

export function migrateGraphPlusPluginDataV1(raw: unknown): GraphPlusPluginDataMigrationV1 {
  const root = isRecord(raw) ? raw : {};
  const engine = isRecord(root.engine) ? root.engine : undefined;
  const consumers = isRecord(root.consumers) ? root.consumers : {};
  const graphPlus = isRecord(consumers.graphPlus) ? consumers.graphPlus : undefined;

  const engineValid = engine?.settingsSchemaVersion === GRAPH_ENGINE_SETTINGS_SCHEMA_VERSION
    && isRecord(engine.globalSettings)
    && isProfileSnapshot(engine.profileOverrides);
  const graphPlusValid = graphPlus?.dataSchemaVersion === GRAPH_PLUS_CONSUMER_DATA_SCHEMA_VERSION
    && isRecord(graphPlus.consumerSettings);

  const legacySource = graphPlusValid ? graphPlus.consumerSettings : root;
  const consumerSettings = coerceGraphPlusConsumerSettingsV1(legacySource);
  const profileOverrides: ConsumerProfileRegistrySnapshotV1 = engineValid
    ? cloneJson(engine.profileOverrides) as ConsumerProfileRegistrySnapshotV1
    : { schemaVersion: 1, consumers: [] };
  const globalSettings: GraphSettingsOverridesV1 = engineValid
    ? cloneJson(engine.globalSettings) as GraphSettingsOverridesV1
    : {};

  return {
    data: {
      ...root,
      engine: {
        settingsSchemaVersion: GRAPH_ENGINE_SETTINGS_SCHEMA_VERSION,
        globalSettings,
        profileOverrides,
      },
      consumers: {
        ...consumers,
        graphPlus: {
          ...(graphPlus ?? {}),
          dataSchemaVersion: GRAPH_PLUS_CONSUMER_DATA_SCHEMA_VERSION,
          consumerSettings,
          ...(!graphPlus?.legacySettings && hasLegacySettings(root) ? { legacySettings: cloneJson(root) } : {}),
        },
      },
    },
    engineRecovered: !engineValid,
    graphPlusRecovered: !graphPlusValid && !hasLegacySettings(root),
  };
}

export function withEngineSettingsV1(
  data: GraphPlusPluginDataV1,
  globalSettings: GraphSettingsOverridesV1,
  profileOverrides: ConsumerProfileRegistrySnapshotV1,
): GraphPlusPluginDataV1 {
  return {
    ...data,
    engine: {
      settingsSchemaVersion: GRAPH_ENGINE_SETTINGS_SCHEMA_VERSION,
      globalSettings: cloneJson(globalSettings),
      profileOverrides: cloneJson(profileOverrides),
    },
  };
}

export function withGraphPlusSettingsV1(
  data: GraphPlusPluginDataV1,
  consumerSettings: GraphPlusConsumerSettingsV1,
): GraphPlusPluginDataV1 {
  return {
    ...data,
    consumers: {
      ...data.consumers,
      graphPlus: {
        ...data.consumers.graphPlus,
        dataSchemaVersion: GRAPH_PLUS_CONSUMER_DATA_SCHEMA_VERSION,
        consumerSettings: cloneJson(consumerSettings),
      },
    },
  };
}

export function readGraphPlusCheckpointV1(
  data: GraphPlusPluginDataV1,
  vaultId: string,
): GraphPlusCheckpointV1 | undefined {
  const checkpoint = data.consumers.graphPlus.checkpoints?.[vaultId];
  if (checkpoint !== undefined) return validateGraphPlusCheckpointV1(checkpoint);
  const document = data.consumers.graphPlus.graphDocuments?.[vaultId];
  const viewState = data.consumers.graphPlus.viewStates?.[vaultId];
  return validateGraphPlusCheckpointV1({ document, viewState, savedAt: 0 });
}

export function withGraphPlusCheckpointV1(
  data: GraphPlusPluginDataV1,
  vaultId: string,
  checkpoint: GraphPlusCheckpointV1,
): GraphPlusPluginDataV1 {
  const checked = validateGraphPlusCheckpointV1(checkpoint);
  if (!checked) throw new Error('Cannot persist an invalid Graph+ checkpoint.');
  return {
    ...data,
    consumers: {
      ...data.consumers,
      graphPlus: {
        ...data.consumers.graphPlus,
        checkpoints: {
          ...(data.consumers.graphPlus.checkpoints ?? {}),
          [vaultId]: cloneJson(checked),
        },
        graphDocuments: {
          ...(data.consumers.graphPlus.graphDocuments ?? {}),
          [vaultId]: cloneJson(checked.document),
        },
        viewStates: checked.viewState
          ? { ...(data.consumers.graphPlus.viewStates ?? {}), [vaultId]: cloneJson(checked.viewState) }
          : data.consumers.graphPlus.viewStates,
      },
    },
  };
}

function isProfileSnapshot(value: unknown): value is ConsumerProfileRegistrySnapshotV1 {
  return isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.consumers);
}

function hasLegacySettings(value: Record<string, unknown>): boolean {
  return ['base', 'layout', 'physics', 'camera', 'ui', 'tuning'].some((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
