import type { JsonValue } from '../../contracts/v1/index.ts';
import type { AnimusEdgeRoleV1, AnimusNodeRoleV1 } from '../animus/index.ts';
import type { GraphPresentationPolicyV2, GraphRegionRenderContributionV1 } from '../render/index.ts';
import {
  freezeGraphVisualThemeV2,
  parseGraphColorV2,
  type GraphColorV2,
  type GraphVisualThemeV2,
} from '../theme/index.ts';
import type { GraphModuleInstanceV1 } from '../modules/GraphModuleTypes.ts';

const FORM_BRANCH_COLORS: readonly GraphColorV2[] = [
  '#e57373', '#ffb74d', '#ffd54f', '#81c784', '#4db6ac', '#4fc3f7',
  '#64b5f6', '#7986cb', '#9575cd', '#ba68c8', '#f06292', '#a1887f',
].map((value) => parseGraphColorV2(value)!);

/**
 * Anima's baseline dressing pass. The persisted module ID remains `rendering` for
 * compatibility, but semantic graph modules no longer emit visual properties.
 */
export class AnimaBaselineModule implements GraphModuleInstanceV1 {
  private baseTheme: GraphVisualThemeV2;
  private theme: GraphVisualThemeV2;
  private settings: Readonly<Record<string, JsonValue>> = {};
  private policy: GraphPresentationPolicyV2 = {};
  private labelMode: 'adaptive' | 'all' | 'off' = 'adaptive';
  private nodeRadiusScale = 1;
  private edgeThicknessScale = 0.1;

  constructor(
    palette: GraphVisualThemeV2,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.baseTheme = palette;
    this.theme = palette;
    this.updateSettings(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.settings = { ...settings };
    const colors = this.baseTheme.colors;
    this.theme = freezeGraphVisualThemeV2({
      ...this.baseTheme,
      colors: {
        ...colors,
        background: color(settings.backgroundColor, colors.background),
        node: color(settings.nodeColor, colors.node),
        selectedNode: color(settings.selectedNodeColor, colors.selectedNode),
        focusedNode: color(settings.focusedNodeColor, colors.focusedNode),
        edge: color(settings.edgeColor, colors.edge),
        arrow: color(settings.arrowColor, colors.arrow),
        label: color(settings.labelColor, colors.label),
      },
      labelFont: font(settings.labelFont, this.baseTheme.labelFont),
    });
    this.labelMode = labelMode(settings.labelMode);
    this.policy = {
      labelMode: this.labelMode,
      showArrows: settings.showArrows === true,
    };
    this.nodeRadiusScale = positive(settings.nodeRadiusScale, 1);
    this.edgeThicknessScale = positive(settings.edgeThicknessScale, 0.1);
  }

  contributeFrame(state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]) {
    return {
      theme: this.theme,
      presentationPolicy: this.policy,
      nodeContributions: Object.fromEntries(state.document.nodes.map((node) => [node.id, {
        showLabel: this.labelMode !== 'off',
        baseRadiusScale: this.nodeRadiusScale,
        ...formNodePresentation(state.nodeRoles[node.id]),
      }])),
      edgeContributions: Object.fromEntries(state.document.edges.map((edge) => [edge.id, {
        baseThicknessScale: this.edgeThicknessScale,
        ...formEdgePresentation(state.edgeRoles[edge.id]),
      }])),
      regionContributions: state.regions
        .filter((region) => region.visible)
        .map((region): GraphRegionRenderContributionV1 => ({
          id: region.id,
          regionNodeId: region.regionNodeId,
          memberNodeIds: region.memberNodeIds,
          directMemberNodeIds: region.directMemberNodeIds,
          connections: region.connections,
          padding: region.padding,
          color: regionColor(region.regionNodeId),
        })),
    };
  }

  onThemeChanged(theme: GraphVisualThemeV2): void {
    this.baseTheme = theme;
    this.updateSettings(this.settings);
  }
}

function formNodePresentation(role: AnimusNodeRoleV1 | undefined) {
  const form = role?.form;
  if (!form) return {};
  return {
    radiusScale: form.kind === 'root' ? 1.35 : form.kind === 'branch' ? 1.12 : 1,
    labelPriority: form.kind === 'root' ? 1000 : Math.max(0, 100 - form.depth * 10),
    labelAlwaysVisible: form.kind === 'root',
    ...(form.colorBranches && form.branchIndex !== undefined
      ? { color: FORM_BRANCH_COLORS[form.branchIndex % FORM_BRANCH_COLORS.length] }
      : {}),
  };
}

function formEdgePresentation(role: AnimusEdgeRoleV1 | undefined) {
  const form = role?.form;
  if (!form) return {};
  return {
    thicknessScale: form.kind === 'tree' ? Math.max(1.15, 2.4 - form.childDepth * 0.22) : 0.65,
    dashed: form.kind === 'cross',
    ...(form.colorBranches && form.branchIndex !== undefined
      ? { color: FORM_BRANCH_COLORS[form.branchIndex % FORM_BRANCH_COLORS.length] }
      : {}),
  };
}

function regionColor(id: string): GraphColorV2 {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return parseGraphColorV2(`hsl(${(hash >>> 0) % 360} 72% 64%)`)!;
}

function color(value: JsonValue | undefined, fallback: GraphColorV2): GraphColorV2 {
  return typeof value === 'string' ? parseGraphColorV2(value) ?? fallback : fallback;
}

function font(value: JsonValue | undefined, fallback: GraphVisualThemeV2['labelFont']): GraphVisualThemeV2['labelFont'] {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  const match = /\b([0-9]+(?:\.[0-9]+)?)px(?:\/[^\s]+)?\s+(.+)$/.exec(value.trim());
  return match ? { ...fallback, sizePx: Number(match[1]), family: match[2] } : { ...fallback, family: value.trim() };
}

function positive(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function labelMode(value: JsonValue | undefined): 'adaptive' | 'all' | 'off' {
  return value === 'all' || value === 'off' ? value : 'adaptive';
}
