import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphRenderThemeV1 } from '../../render/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class RenderingModule implements GraphModuleInstanceV1 {
  private theme: GraphRenderThemeV1;
  private labelMode: 'adaptive' | 'all' | 'off';
  private nodeRadiusScale: number;
  private edgeThicknessScale: number;
  private tokenColors: Readonly<Record<string, string>>;
  private graphSystem: 'new' | 'legacy';

  constructor(
    private readonly palette: GraphRenderThemeV1,
    settings: Readonly<Record<string, JsonValue>>,
    profileSettings: Readonly<Record<string, JsonValue>> = {},
  ) {
    this.theme = palette;
    this.labelMode = 'adaptive';
    this.nodeRadiusScale = 1;
    this.edgeThicknessScale = 1;
    this.tokenColors = {};
    this.graphSystem = readGraphSystem(profileSettings);
    this.updateSettings(settings);
  }

  updateProfileSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.graphSystem = readGraphSystem(settings);
    this.updateSettings(this.rawSettings);
  }

  private rawSettings: Readonly<Record<string, JsonValue>> = {};

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.rawSettings = settings;
    const selected = modeSettings(settings, this.graphSystem);
    this.theme = {
      ...this.palette,
      backgroundColor: color(selected.backgroundColor, this.palette.backgroundColor),
      nodeColor: color(selected.nodeColor, this.palette.nodeColor),
      selectedNodeColor: color(selected.selectedNodeColor, this.palette.selectedNodeColor),
      focusedNodeColor: color(selected.focusedNodeColor, this.palette.focusedNodeColor),
      edgeColor: color(selected.edgeColor, this.palette.edgeColor),
      arrowColor: color(selected.arrowColor, this.palette.arrowColor ?? this.palette.edgeColor),
      labelColor: color(selected.labelColor, this.palette.labelColor),
      labelFont: font(selected.labelFont, this.palette.labelFont),
      labelMode: labelMode(selected.labelMode),
      showArrows: this.graphSystem === 'new' ? selected.showArrows === true : selected.showArrows !== false,
    };
    this.labelMode = labelMode(selected.labelMode);
    this.nodeRadiusScale = positive(selected.nodeRadiusScale, 1);
    this.edgeThicknessScale = positive(selected.edgeThicknessScale, 1);
    this.tokenColors = readTokenColors(selected.tokenColors);
  }

  contributeFrame(state: Parameters<NonNullable<GraphModuleInstanceV1['contributeFrame']>>[0]) {
    return {
      theme: this.theme,
      nodeContributions: Object.fromEntries(state.document.nodes.map((node) => {
        const tokenColor = colorForTokens(node.tokens, this.tokenColors);
        return [node.id, {
          showLabel: this.labelMode !== 'off',
          ...(this.graphSystem === 'legacy'
            ? { radiusScale: this.nodeRadiusScale }
            : { baseRadiusScale: this.nodeRadiusScale }),
          ...(this.graphSystem === 'legacy' && tokenColor ? { color: tokenColor } : {}),
        }];
      })),
      edgeContributions: Object.fromEntries(state.document.edges.map((edge) => [edge.id, {
        ...(this.graphSystem === 'legacy'
          ? { thicknessScale: this.edgeThicknessScale }
          : { baseThicknessScale: this.edgeThicknessScale }),
      }])),
    };
  }
}

function readGraphSystem(settings: Readonly<Record<string, JsonValue>>): 'new' | 'legacy' {
  return settings.graphSystem === 'new' ? 'new' : 'legacy';
}

function modeSettings(
  settings: Readonly<Record<string, JsonValue>>,
  mode: 'new' | 'legacy',
): Readonly<Record<string, JsonValue>> {
  const value = settings[`${mode}Settings`];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : settings;
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
