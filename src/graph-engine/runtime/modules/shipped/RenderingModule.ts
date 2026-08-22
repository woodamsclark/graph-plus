import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphRenderThemeV1 } from '../../render/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class RenderingModule implements GraphModuleInstanceV1 {
  private readonly theme: GraphRenderThemeV1;
  private readonly showLabels: boolean;
  private readonly nodeRadiusScale: number;
  private readonly edgeThicknessScale: number;
  private readonly tokenColors: Readonly<Record<string, string>>;

  constructor(palette: GraphRenderThemeV1, settings: Readonly<Record<string, JsonValue>>) {
    this.theme = {
      backgroundColor: color(settings.backgroundColor, palette.backgroundColor),
      nodeColor: color(settings.nodeColor, palette.nodeColor),
      selectedNodeColor: color(settings.selectedNodeColor, palette.selectedNodeColor),
      focusedNodeColor: color(settings.focusedNodeColor, palette.focusedNodeColor),
      edgeColor: color(settings.edgeColor, palette.edgeColor),
      labelColor: color(settings.labelColor, palette.labelColor),
      labelFont: font(settings.labelFont, palette.labelFont),
    };
    this.showLabels = settings.showLabels !== false;
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
          showLabel: this.showLabels,
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

function readTokenColors(value: JsonValue | undefined): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function colorForTokens(tokens: readonly string[] | undefined, colors: Readonly<Record<string, string>>): string | undefined {
  for (const token of tokens ?? []) if (colors[token]) return colors[token];
  return undefined;
}
