import {
  DEFAULT_GRAPH_VISUAL_THEME_V2,
  freezeGraphVisualThemeV2,
  graphColorV2,
  parseGraphColorV2,
  type GraphColorV2,
  type GraphFontV2,
  type GraphVisualThemeV2,
} from '../graph-engine/runtime/theme/index.ts';

export const DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2: GraphVisualThemeV2 = freezeGraphVisualThemeV2({
  revision: 0,
  colors: {
    background: graphColorV2(0x0b / 255, 0x08 / 255, 0x10 / 255),
    node: graphColorV2(0x4b / 255, 0x35 / 255, 0x62 / 255),
    tagNode: graphColorV2(0xe1 / 255, 0xd7 / 255, 0xeb / 255),
    selectedNode: graphColorV2(0x82 / 255, 0x63 / 255, 0x9b / 255),
    focusedNode: graphColorV2(0xc5 / 255, 0xa8 / 255, 0xd5 / 255),
    highlightedNode: graphColorV2(0xa5 / 255, 0x7e / 255, 0xb9 / 255),
    nodeOutline: graphColorV2(0xd8 / 255, 0xca / 255, 0xe2 / 255),
    edge: graphColorV2(0x72 / 255, 0x5d / 255, 0x7e / 255, 0.48),
    arrow: graphColorV2(0xa0 / 255, 0x7d / 255, 0xb2 / 255, 0.72),
    label: graphColorV2(0xf1 / 255, 0xed / 255, 0xf4 / 255),
    animaAccent: graphColorV2(0xb9 / 255, 0x8d / 255, 0xcd / 255),
  },
  labelFont: DEFAULT_GRAPH_VISUAL_THEME_V2.labelFont,
});

export class ThemeStyleResolver {
  constructor(
    private getRoot: () => HTMLElement = () => document.body,
    private isDefaultObsidianTheme: () => boolean = () => false,
  ) {}

  private read(styles: CSSStyleDeclaration, ...vars: string[]): string {
    for (const name of vars) {
      const value = styles.getPropertyValue(name).trim();
      if (value) return this.resolveVariables(styles, value, new Set([name]));
    }
    return "";
  }

  private resolveVariables(styles: CSSStyleDeclaration, value: string, visited: Set<string>): string {
    let result = value;
    for (let depth = 0; depth < 12 && result.includes('var('); depth += 1) {
      let changed = false;
      result = result.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]+))?\)/g, (_match, name: string, fallback: string | undefined) => {
        if (visited.has(name)) return fallback?.trim() ?? '';
        const replacement = styles.getPropertyValue(name).trim() || fallback?.trim() || '';
        if (!replacement) return '';
        visited.add(name);
        const resolved = this.resolveVariables(styles, replacement, visited);
        visited.delete(name);
        changed = true;
        return resolved;
      });
      if (!changed) break;
    }
    return result.trim();
  }

  private probe(root: HTMLElement, roleClass: string): string {
    const view = root.ownerDocument.defaultView;
    if (!view) return '';
    const element = root.ownerDocument.createElement('span');
    element.className = `graph-view ${roleClass}`;
    element.style.position = 'absolute';
    element.style.pointerEvents = 'none';
    element.style.visibility = 'hidden';
    root.append(element);
    try {
      const inherited = view.getComputedStyle(root);
      const styles = view.getComputedStyle(element);
      const color = styles.color.trim();
      const opacity = styles.opacity.trim();
      if (!color || (color === inherited.color.trim() && opacity === inherited.opacity.trim())) return '';
      return applyOpacity(color, opacity);
    } finally {
      element.remove();
    }
  }

  getPalette(revision = 0): GraphVisualThemeV2 {
    const root = this.getRoot();
    const styles = root.ownerDocument.defaultView?.getComputedStyle(root);
    if (!styles) return freezeGraphVisualThemeV2({ ...DEFAULT_GRAPH_VISUAL_THEME_V2, revision });
    if (this.isDefaultObsidianTheme()) {
      return freezeGraphVisualThemeV2({
        ...DEFAULT_OBSIDIAN_GRAPH_PLUS_THEME_V2,
        revision,
        labelFont: font(styles),
      });
    }

    const accent = this.read(
      styles,
      "--color-accent",
      "--interactive-accent",
      "--text-accent"
    );
    
    const fallback = DEFAULT_GRAPH_VISUAL_THEME_V2.colors;
    const node = this.color(root, this.probe(root, 'color-fill') || this.read(styles, '--graph-node') || accent, fallback.node);
    const tagNode = this.color(root, this.probe(root, 'color-fill-tag') || this.read(
        styles,
        '--graph-node-tag',
        "--color-accent-2",
        "--color-purple",
        "--interactive-accent"
      ) || accent, fallback.tagNode);
    const edge = this.color(root, this.probe(root, 'color-line') || this.read(
        styles,
        '--graph-line',
        "--background-modifier-border",
        "--color-base-35"
      ), fallback.edge);
    const label = this.color(root, this.probe(root, 'color-text') || this.read(
        styles,
        '--graph-text',
        "--text-normal"
      ), fallback.label);
    const arrow = this.color(root, this.probe(root, 'color-arrow') || this.read(styles, '--graph-line'), edge);
    const background = this.color(root, this.read(
        styles,
        '--graph-background',
        "--background-primary"
      ), fallback.background);
    const highlighted = this.color(root, this.probe(root, 'color-fill-focused') || this.read(
        styles,
        '--graph-node-focused',
        '--graph-node-unresolved',
        '--interactive-accent-hover',
        '--color-accent'
      ) || accent, fallback.highlightedNode);
    const outline = this.color(root, this.probe(root, 'color-circle') || this.read(
        styles,
        '--graph-node-focused',
        '--text-normal'
      ), fallback.nodeOutline);
    return freezeGraphVisualThemeV2({
      revision,
      colors: {
        background,
        node,
        tagNode,
        selectedNode: tagNode,
        focusedNode: highlighted,
        highlightedNode: highlighted,
        nodeOutline: outline,
        edge,
        arrow,
        label,
        animaAccent: highlighted,
      },
      labelFont: font(styles),
    });
  }

  private color(root: HTMLElement, value: string, fallback: GraphColorV2): GraphColorV2 {
    const parsed = parseGraphColorV2(value);
    if (parsed) return parsed;
    if (!value.trim()) return fallback;
    const element = root.ownerDocument.createElement('span');
    element.style.color = value;
    element.style.position = 'absolute';
    element.style.visibility = 'hidden';
    root.append(element);
    try {
      const normalized = root.ownerDocument.defaultView?.getComputedStyle(element).color ?? '';
      return parseGraphColorV2(normalized) ?? fallback;
    } finally {
      element.remove();
    }
  }
}

function applyOpacity(color: string, opacityValue: string): string {
  if (!opacityValue.trim()) return color;
  const opacity = Number(opacityValue);
  if (!Number.isFinite(opacity) || opacity >= 1) return color;
  const channels = color.match(/[0-9]+(?:\.[0-9]+)?/g)?.map(Number);
  if (!channels || channels.length < 3) return color;
  const alpha = Math.max(0, Math.min(1, (channels[3] ?? 1) * Math.max(0, opacity)));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Number(alpha.toFixed(4))})`;
}

function font(styles: CSSStyleDeclaration): GraphFontV2 {
  const fallback = DEFAULT_GRAPH_VISUAL_THEME_V2.labelFont;
  const size = Number.parseFloat(styles.fontSize);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  const weight = Number.parseInt(styles.fontWeight, 10);
  const style = styles.fontStyle === 'italic' || styles.fontStyle === 'oblique' ? styles.fontStyle : 'normal';
  return {
    family: styles.fontFamily.trim() || fallback.family,
    sizePx: Number.isFinite(size) && size > 0 ? size : fallback.sizePx,
    weight: Number.isFinite(weight) ? weight : fallback.weight,
    style,
    lineHeightPx: Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : (Number.isFinite(size) ? size * 1.2 : fallback.lineHeightPx),
  };
}
