import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphRenderThemeV1 } from '../../render/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class RenderingModule implements GraphModuleInstanceV1 {
  private theme: GraphRenderThemeV1;
  private labelMode: 'adaptive' | 'all' | 'off';
  private nodeRadiusScale: number;
  private edgeThicknessScale: number;
  private tokenColors: Readonly<Record<string, string>>;

  constructor(private readonly palette: GraphRenderThemeV1, settings: Readonly<Record<string, JsonValue>>) {
    this.theme = palette;
    this.labelMode = 'adaptive';
    this.nodeRadiusScale = 1;
    this.edgeThicknessScale = 1;
    this.tokenColors = {};
    this.updateSettings(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.theme = {
      backgroundColor: color(settings.backgroundColor, this.palette.backgroundColor),
      nodeColor: color(settings.nodeColor, this.palette.nodeColor),
      selectedNodeColor: color(settings.selectedNodeColor, this.palette.selectedNodeColor),
      focusedNodeColor: color(settings.focusedNodeColor, this.palette.focusedNodeColor),
      edgeColor: color(settings.edgeColor, this.palette.edgeColor),
      labelColor: color(settings.labelColor, this.palette.labelColor),
      labelFont: font(settings.labelFont, this.palette.labelFont),
      labelMode: labelMode(settings.labelMode),
    };
    this.labelMode = labelMode(settings.labelMode);
    this.nodeRadiusScale = positive(settings.nodeRadiusScale, 1);
    this.edgeThicknessScale = positive(settings.edgeThicknessScale, 1);
    this.tokenColors = readTokenColors(settings.tokenColors);
  }

  contributeFrame(state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]) {
    return {
      theme: this.theme,
      nodeContributions: Object.fromEntries(state.document.nodes.map((node) => {
        const tokenColor = colorForTokens(node.tokens, this.tokenColors);
        return [node.id, {
          showLabel: this.labelMode !== 'off',
          radiusScale: this.nodeRadiusScale,
          ...(tokenColor ? { color: tokenColor } : {}),
        }];
      })),
      edgeContributions: Object.fromEntries(state.document.edges.map((edge) => [edge.id, {
        thicknessScale: this.edgeThicknessScale,
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

function readTokenColors(value: JsonValue | undefined): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function colorForTokens(tokens: readonly string[] | undefined, colors: Readonly<Record<string, string>>): string | undefined {
  for (const token of tokens ?? []) if (colors[token]) return colors[token];
  return undefined;
}
