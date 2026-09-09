import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphPresentationPolicyV2 } from '../../render/index.ts';
import { freezeGraphVisualThemeV2, parseGraphColorV2, type GraphColorV2, type GraphVisualThemeV2 } from '../../theme/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class RenderingModule implements GraphModuleInstanceV1 {
  private baseTheme: GraphVisualThemeV2;
  private theme: GraphVisualThemeV2;
  private settings: Readonly<Record<string, JsonValue>> = {};
  private policy: GraphPresentationPolicyV2;
  private labelMode: 'adaptive' | 'all' | 'off';
  private nodeRadiusScale: number;
  private edgeThicknessScale: number;

  constructor(
    palette: GraphVisualThemeV2,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.baseTheme = palette;
    this.theme = palette;
    this.policy = {};
    this.labelMode = 'adaptive';
    this.nodeRadiusScale = 2;
    this.edgeThicknessScale = 0.1;
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
    this.policy = {
      labelMode: labelMode(settings.labelMode),
      showArrows: settings.showArrows === true,
    };
    this.labelMode = labelMode(settings.labelMode);
    this.nodeRadiusScale = positive(settings.nodeRadiusScale, 2);
    this.edgeThicknessScale = positive(settings.edgeThicknessScale, 0.1);
  }

  contributeFrame(state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]) {
    return {
      theme: this.theme,
      presentationPolicy: this.policy,
      nodeContributions: Object.fromEntries(state.document.nodes.map((node) => [node.id, {
          showLabel: this.labelMode !== 'off',
          baseRadiusScale: this.nodeRadiusScale,
        }])),
      edgeContributions: Object.fromEntries(state.document.edges.map((edge) => [edge.id, {
        baseThicknessScale: this.edgeThicknessScale,
      }])),
    };
  }

  onThemeChanged(theme: GraphVisualThemeV2): void {
    this.baseTheme = theme;
    this.updateSettings(this.settings);
  }
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
