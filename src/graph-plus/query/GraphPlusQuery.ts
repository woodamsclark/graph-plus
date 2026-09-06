import type {
  GraphDocumentV1,
  GraphFilterAstV1,
  GraphFilterRequestV1,
  GraphSettingsOverridesV1,
} from '../../graph-engine/contracts/v1/index.ts';
import {
  compileObsidianSearchCompatibilityV1,
  type ObsidianSearchDocumentV1,
  type ObsidianSearchIndexV1,
} from './ObsidianSearchCompatibility.ts';

export interface GraphPlusLensStateV1 {
  readonly query: string;
  readonly showTags: boolean;
  readonly showOrphans: boolean;
  readonly display: {
    readonly labelMode?: 'adaptive' | 'all' | 'off';
    readonly nodeRadiusScale?: number;
    readonly edgeThicknessScale?: number;
  };
  readonly force: {
    readonly repulsionStrength?: number;
    readonly springStrength?: number;
    readonly springLength?: number;
    readonly centeringStrength?: number;
  };
  readonly form: {
    readonly enabled: boolean;
    readonly rootNodeId?: string;
    readonly direction: 'incoming' | 'outgoing' | 'either';
    readonly relation?: string;
    readonly maxDepth?: number;
    readonly showCrossLinks: boolean;
    readonly showDisconnected: boolean;
    readonly colorBranches: boolean;
  };
}

export interface CompiledGraphPlusFilterV1 {
  readonly request: GraphFilterRequestV1;
  readonly visibleNodeIds: readonly string[];
  readonly error?: string;
}

export function createDefaultGraphPlusLensV1(showTags = true): GraphPlusLensStateV1 {
  return {
    query: '',
    showTags,
    showOrphans: true,
    display: {},
    force: {},
    form: {
      enabled: false,
      direction: 'either',
      showCrossLinks: false,
      showDisconnected: false,
      colorBranches: true,
    },
  };
}

export function coerceGraphPlusLensStateV1(value: unknown): GraphPlusLensStateV1 | undefined {
  if (!isRecord(value)) return undefined;
  const fallback = createDefaultGraphPlusLensV1();
  const form = isRecord(value.form) ? value.form : {};
  return {
    query: typeof value.query === 'string' ? value.query : fallback.query,
    showTags: typeof value.showTags === 'boolean' ? value.showTags : fallback.showTags,
    showOrphans: typeof value.showOrphans === 'boolean' ? value.showOrphans : fallback.showOrphans,
    display: isRecord(value.display) ? {
      ...(value.display.labelMode === 'adaptive' || value.display.labelMode === 'all' || value.display.labelMode === 'off'
        ? { labelMode: value.display.labelMode }
        : value.display.showLabels === false ? { labelMode: 'off' as const } : {}),
      ...optionalLegacyNumber(value.display.nodeRadiusScale, 1, true, 'nodeRadiusScale'),
      ...optionalLegacyNumber(value.display.edgeThicknessScale, 1, true, 'edgeThicknessScale'),
    } : fallback.display,
    force: isRecord(value.force) ? {
      ...optionalLegacyNumber(value.force.repulsionStrength, 18000, false, 'repulsionStrength'),
      ...optionalLegacyNumber(value.force.springStrength, 3.5, false, 'springStrength'),
      ...optionalLegacyNumber(value.force.springLength, 80, true, 'springLength'),
      ...optionalLegacyNumber(value.force.centeringStrength, 0.45, false, 'centeringStrength'),
    } : fallback.force,
    form: {
      enabled: typeof form.enabled === 'boolean' ? form.enabled : fallback.form.enabled,
      ...(typeof form.rootNodeId === 'string' && form.rootNodeId ? { rootNodeId: form.rootNodeId } : {}),
      direction: form.direction === 'incoming' || form.direction === 'outgoing' ? form.direction : 'either',
      ...(typeof form.relation === 'string' && form.relation ? { relation: form.relation } : {}),
      ...(typeof form.maxDepth === 'number' && Number.isSafeInteger(form.maxDepth) && form.maxDepth >= 0
        ? { maxDepth: form.maxDepth }
        : {}),
      showCrossLinks: typeof form.showCrossLinks === 'boolean' ? form.showCrossLinks : fallback.form.showCrossLinks,
      showDisconnected: typeof form.showDisconnected === 'boolean' ? form.showDisconnected : fallback.form.showDisconnected,
      colorBranches: typeof form.colorBranches === 'boolean' ? form.colorBranches : fallback.form.colorBranches,
    },
  };
}

export function compileGraphPlusFilterV1(
  document: GraphDocumentV1,
  lens: GraphPlusLensStateV1,
  searchIndex?: ObsidianSearchIndexV1,
): CompiledGraphPlusFilterV1 {
  try {
    const query = compileObsidianSearchCompatibilityV1(lens.query);
    const connected = connectedNodeIds(document);
    const ids = document.nodes
      .filter((node) => lens.showTags || node.attributes?.kind !== 'tag')
      .filter((node) => lens.showOrphans || connected.has(node.id))
      .filter((node) => query === undefined || query.matches(
        searchIndex?.get(node.id) ?? searchDocumentFromNode(node),
      ))
      .map((node) => node.id);
    return {
      request: {
        schemaVersion: 1,
        scope: 'projection',
        node: { op: 'id-in', ids },
      },
      visibleNodeIds: ids,
    };
  } catch (error) {
    return {
      request: { schemaVersion: 1, scope: 'projection', node: { op: 'all' } },
      visibleNodeIds: document.nodes.map((node) => node.id),
      error: error instanceof Error ? error.message : 'Invalid filter.',
    };
  }
}

export function graphPlusSessionOverridesV1(lens: GraphPlusLensStateV1): GraphSettingsOverridesV1 {
  return {
    modules: {
      rendering: {
        settings: { backgroundColor: 'transparent' },
      },
      form: {
        enabled: lens.form.enabled,
        settings: {
          ...(lens.form.rootNodeId ? { rootNodeId: lens.form.rootNodeId } : {}),
          direction: lens.form.direction,
          ...(lens.form.relation ? { edgeToken: `relation:${lens.form.relation}` } : {}),
          ...(lens.form.maxDepth === undefined ? {} : { maxDepth: lens.form.maxDepth }),
          showCrossLinks: lens.form.showCrossLinks,
          showDisconnected: lens.form.showDisconnected,
          colorBranches: lens.form.colorBranches,
        },
      },
    },
  };
}

export function adoptGraphPlusSessionOverridesV1(
  lens: GraphPlusLensStateV1,
  overrides: GraphSettingsOverridesV1,
): GraphPlusLensStateV1 {
  const form = overrides.modules?.form;
  const settings = form?.settings ?? {};
  const direction = settings.direction;
  const edgeToken = settings.edgeToken;
  const maxDepth = settings.maxDepth;
  return {
    ...lens,
    form: {
      enabled: form?.enabled ?? lens.form.enabled,
      ...(typeof settings.rootNodeId === 'string' ? { rootNodeId: settings.rootNodeId } : {}),
      direction: direction === 'incoming' || direction === 'outgoing' ? direction : 'either',
      ...(typeof edgeToken === 'string' && edgeToken.startsWith('relation:')
        ? { relation: edgeToken.slice('relation:'.length) }
        : {}),
      ...(typeof maxDepth === 'number' && Number.isSafeInteger(maxDepth) ? { maxDepth } : {}),
      showCrossLinks: settings.showCrossLinks !== false,
      showDisconnected: settings.showDisconnected === true,
      colorBranches: settings.colorBranches !== false,
    },
  };
}

function connectedNodeIds(document: GraphDocumentV1): Set<string> {
  return new Set(document.edges.flatMap((edge) => [edge.sourceId, edge.targetId]));
}

function searchDocumentFromNode(node: GraphDocumentV1['nodes'][number]): ObsidianSearchDocumentV1 {
  const kind = node.attributes?.kind === 'tag' ? 'tag' : 'note';
  const path = String(node.attributes?.path ?? node.label);
  const properties: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (!key.startsWith('property:')) continue;
    properties[key.slice('property:'.length)] = Array.isArray(value)
      ? value.map(String)
      : [String(value)];
  }
  return {
    nodeId: node.id,
    kind,
    path,
    basename: String(node.label ?? path),
    extension: String(node.attributes?.extension ?? ''),
    content: '',
    tags: Array.isArray(node.attributes?.tags) ? node.attributes.tags.map(String) : [],
    properties,
  };
}

function optionalLegacyNumber(
  value: unknown,
  legacyDefault: number,
  positive: boolean,
  key: string,
): Record<string, number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};
  if (positive ? value <= 0 : value < 0) return {};
  return value === legacyDefault ? {} : { [key]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function graphPlusFilterAstForIdsV1(ids: readonly string[]): GraphFilterAstV1 {
  return { op: 'id-in', ids };
}
