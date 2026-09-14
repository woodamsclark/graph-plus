export interface GraphPlusConsumerSettingsV1 {
  readonly enabled: boolean;
  readonly showTags: boolean;
  readonly countDuplicateLinks: boolean;
  readonly colors: GraphPlusColorOverridesV1;
}

export interface GraphPlusColorOverridesV1 {
  readonly background?: string;
  readonly noteNode?: string;
  readonly tagNode?: string;
}

export const DEFAULT_GRAPH_PLUS_CONSUMER_SETTINGS_V1: GraphPlusConsumerSettingsV1 = {
  enabled: true,
  showTags: true,
  countDuplicateLinks: true,
  colors: {},
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
    colors: coerceColorOverrides(source.colors),
  };
}

function coerceColorOverrides(value: unknown): GraphPlusColorOverridesV1 {
  if (!isRecord(value)) return {};
  return {
    ...colorOverride(value, 'background'),
    ...colorOverride(value, 'noteNode'),
    ...colorOverride(value, 'tagNode'),
  };
}

function colorOverride(
  value: Record<string, unknown>,
  key: keyof GraphPlusColorOverridesV1,
): Partial<GraphPlusColorOverridesV1> {
  const color = value[key];
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim())
    ? { [key]: color.trim().toLowerCase() }
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
