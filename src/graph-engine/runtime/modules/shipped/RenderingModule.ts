import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphRenderThemeV1 } from '../../render/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class RenderingModule implements GraphModuleInstanceV1 {
  private theme: GraphRenderThemeV1;
  private labelMode: 'adaptive' | 'all' | 'off';
  private nodeRadiusScale: number;
  private edgeThicknessScale: number;

  constructor(
    private readonly palette: GraphRenderThemeV1,
    settings: Readonly<Record<string, JsonValue>>,
  ) {
    this.theme = palette;
    this.labelMode = 'adaptive';
    this.nodeRadiusScale = 1;
    this.edgeThicknessScale = 1;
    this.updateSettings(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.theme = {
      ...this.palette,
      backgroundColor: color(settings.backgroundColor, this.palette.backgroundColor),
      nodeColor: color(settings.nodeColor, this.palette.nodeColor),
      selectedNodeColor: color(settings.selectedNodeColor, this.palette.selectedNodeColor),
      focusedNodeColor: color(settings.focusedNodeColor, this.palette.focusedNodeColor),
      edgeColor: color(settings.edgeColor, this.palette.edgeColor),
      arrowColor: color(settings.arrowColor, this.palette.arrowColor ?? this.palette.edgeColor),
      labelColor: color(settings.labelColor, this.palette.labelColor),
      labelFont: font(settings.labelFont, this.palette.labelFont),
      labelMode: labelMode(settings.labelMode),
      showArrows: settings.showArrows === true,
    };
    this.labelMode = labelMode(settings.labelMode);
    this.nodeRadiusScale = positive(settings.nodeRadiusScale, 1);
    this.edgeThicknessScale = positive(settings.edgeThicknessScale, 1);
  }

  contributeFrame(state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]) {
    return {
      theme: this.theme,
      nodeContributions: Object.fromEntries(state.document.nodes.map((node) => [node.id, {
          showLabel: this.labelMode !== 'off',
          baseRadiusScale: this.nodeRadiusScale,
        }])),
      edgeContributions: Object.fromEntries(state.document.edges.map((edge) => [edge.id, {
        baseThicknessScale: this.edgeThicknessScale,
      }])),
    };
  }
}


function color(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function font(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function positive(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function labelMode(value: JsonValue | undefined): 'adaptive' | 'all' | 'off' {
  return value === 'all' || value === 'off' ? value : 'adaptive';
}
