import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphRenderThemeV1 } from '../../render/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class RenderingModule implements GraphModuleInstanceV1 {
  private readonly theme: GraphRenderThemeV1;

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
  }

  contributeFrame() {
    return { theme: this.theme };
  }
}

function color(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function font(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}
