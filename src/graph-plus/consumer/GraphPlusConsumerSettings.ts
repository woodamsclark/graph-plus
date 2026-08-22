export interface GraphPlusConsumerSettingsV1 {
  readonly enabled: boolean;
  readonly showTags: boolean;
  readonly countDuplicateLinks: boolean;
}

export const DEFAULT_GRAPH_PLUS_CONSUMER_SETTINGS_V1: GraphPlusConsumerSettingsV1 = {
  enabled: true,
  showTags: true,
  countDuplicateLinks: true,
};

export function coerceGraphPlusConsumerSettingsV1(value: unknown): GraphPlusConsumerSettingsV1 {
  const source = isRecord(value) ? value : {};
  const legacyBase = isRecord(source.base) ? source.base : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    showTags: typeof source.showTags === 'boolean'
      ? source.showTags
      : typeof legacyBase.showTags === 'boolean' ? legacyBase.showTags : true,
    countDuplicateLinks: typeof source.countDuplicateLinks === 'boolean'
      ? source.countDuplicateLinks
      : typeof legacyBase.countDuplicateLinks === 'boolean' ? legacyBase.countDuplicateLinks : true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
