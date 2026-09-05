import type { GraphDimensionsV1, JsonValue } from '../../../contracts/v1/index.ts';
import { GraphNodeRegionIndexV1 } from '../../../core/regions/index.ts';
import type { GraphRenderRegionV1 } from '../../render/index.ts';
import type {
  GraphModuleInstanceV1,
  GraphModulePipelineStateV1,
  GraphModuleProjectionPatchV1,
} from '../GraphModuleTypes.ts';

interface NodeRegionSettingsV1 {
  readonly boundariesVisible: boolean;
  readonly membershipStrength: number;
  readonly membershipDistance: number;
  readonly boundaryPadding: number;
}

export class NodeRegionsModule implements GraphModuleInstanceV1 {
  private rawSettings: Readonly<Record<string, JsonValue>>;
  private graphSystem: 'new' | 'legacy';
  constructor(
    private readonly dimensions: GraphDimensionsV1,
    settings: Readonly<Record<string, JsonValue>>,
    profileSettings: Readonly<Record<string, JsonValue>> = {},
  ) {
    this.rawSettings = settings;
    this.graphSystem = profileSettings.graphSystem === 'new' ? 'new' : 'legacy';
    this.settings = readNodeRegionSettingsV1(modeSettings(settings, this.graphSystem));
  }

  private settings: NodeRegionSettingsV1;

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.rawSettings = settings;
    this.settings = readNodeRegionSettingsV1(modeSettings(settings, this.graphSystem));
  }

  updateProfileSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.graphSystem = settings.graphSystem === 'new' ? 'new' : 'legacy';
    this.settings = readNodeRegionSettingsV1(modeSettings(this.rawSettings, this.graphSystem));
  }

  selectRender(state: GraphModulePipelineStateV1): GraphModuleProjectionPatchV1 {
    if (this.dimensions !== '2d' || !state.document.nodeRegions) {
      return { regionContributions: [] };
    }
    const index = new GraphNodeRegionIndexV1(state.document);
    const projected = index.project(state.renderSelection.nodeIds);
    const regionLayouts = projected.map((region) => ({
      regionNodeId: region.regionNodeId,
      directMemberNodeIds: [...region.directMemberNodeIds],
      membershipStrength: this.settings.membershipStrength,
      membershipDistance: this.settings.membershipDistance,
    }));
    const regionContributions: GraphRenderRegionV1[] = projected.map((region) => ({
      id: `node-region:${region.regionNodeId}`,
      regionNodeId: region.regionNodeId,
      memberNodeIds: [...region.memberNodeIds],
      directMemberNodeIds: [...region.directMemberNodeIds],
      connections: region.connections.map((connection) => ({ ...connection })),
      color: regionColor(region.regionNodeId),
      padding: this.settings.boundaryPadding,
    }));
    return {
      regionLayouts,
      regionContributions: this.settings.boundariesVisible ? regionContributions : [],
    };
  }
}

function modeSettings(settings: Readonly<Record<string, JsonValue>>, mode: 'new' | 'legacy') {
  const value = settings[`${mode}Settings`];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : settings;
}

export function readNodeRegionSettingsV1(
  settings: Readonly<Record<string, JsonValue>>,
): NodeRegionSettingsV1 {
  return {
    boundariesVisible: settings.boundariesVisible !== false,
    membershipStrength: finiteNonNegative(settings.membershipStrength, 0.18),
    membershipDistance: finitePositive(settings.membershipDistance, 64),
    boundaryPadding: finitePositive(settings.boundaryPadding, 28),
  };
}

function regionColor(id: string): string {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `hsl(${(hash >>> 0) % 360} 72% 64%)`;
}

function finitePositive(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
