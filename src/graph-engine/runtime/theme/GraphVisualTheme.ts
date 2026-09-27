import { graphColorV2, type GraphColorV2 } from './GraphColor.ts';

export interface GraphFontV2 {
  readonly family: string;
  readonly sizePx: number;
  readonly weight: number;
  readonly style: 'normal' | 'italic' | 'oblique';
  readonly lineHeightPx: number;
}

export interface GraphVisualThemeV2 {
  readonly revision: number;
  /** Optional final-palette constraint applied after module color contributions. */
  readonly colorConstraint?: 'red-green';
  readonly colors: {
    readonly background: GraphColorV2;
    readonly node: GraphColorV2;
    readonly tagNode: GraphColorV2;
    readonly selectedNode: GraphColorV2;
    readonly focusedNode: GraphColorV2;
    readonly highlightedNode: GraphColorV2;
    readonly nodeOutline: GraphColorV2;
    readonly edge: GraphColorV2;
    readonly arrow: GraphColorV2;
    readonly label: GraphColorV2;
    readonly animaAccent: GraphColorV2;
  };
  readonly labelFont: GraphFontV2;
}

export const DEFAULT_GRAPH_VISUAL_THEME_V2: GraphVisualThemeV2 = Object.freeze({
  revision: 0,
  colors: Object.freeze({
    background: graphColorV2(0, 0, 0, 0),
    node: graphColorV2(0x7a / 255, 0xa2 / 255, 0xf7 / 255),
    selectedNode: graphColorV2(0xbb / 255, 0x9a / 255, 0xf7 / 255),
    focusedNode: graphColorV2(0xe0 / 255, 0xaf / 255, 0x68 / 255),
    tagNode: graphColorV2(0xa7 / 255, 0x8b / 255, 0xfa / 255),
    highlightedNode: graphColorV2(0xe0 / 255, 0xaf / 255, 0x68 / 255),
    nodeOutline: graphColorV2(0xcd / 255, 0xd6 / 255, 0xf4 / 255),
    edge: graphColorV2(0x7f / 255, 0x84 / 255, 0x9c / 255),
    arrow: graphColorV2(0x7f / 255, 0x84 / 255, 0x9c / 255),
    label: graphColorV2(0xcd / 255, 0xd6 / 255, 0xf4 / 255),
    animaAccent: graphColorV2(0xe0 / 255, 0xaf / 255, 0x68 / 255),
  }),
  labelFont: Object.freeze({ family: 'sans-serif', sizePx: 12, weight: 400, style: 'normal', lineHeightPx: 14.4 }),
});

export function graphVisualThemesEqualV2(left: GraphVisualThemeV2, right: GraphVisualThemeV2): boolean {
  return JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 });
}

export function freezeGraphVisualThemeV2(theme: GraphVisualThemeV2): GraphVisualThemeV2 {
  return Object.freeze({
    revision: theme.revision,
    colors: Object.freeze({ ...theme.colors }),
    labelFont: Object.freeze({ ...theme.labelFont }),
  });
}
