import {
  DEFAULT_GRAPH_VISUAL_THEME_V2,
  freezeGraphVisualThemeV2,
  graphColorV2,
  graphColorToCssV2,
  parseGraphColorV2,
  type GraphColorV2,
  type GraphFontV2,
  type GraphVisualThemeV2,
} from '../graph-engine/runtime/theme/index.ts';
import type { GraphPlusColorOverridesV1 } from '../graph-plus/consumer/index.ts';

export const FRANK_GRAPH_PLUS_THEME_V2: GraphVisualThemeV2 = freezeGraphVisualThemeV2({
  revision: 0,
  colorConstraint: 'red-green',
  colors: {
    background: graphColorV2(1, 0, 0),
    node: graphColorV2(0, 1, 0),
    tagNode: graphColorV2(1, 0, 0),
    selectedNode: graphColorV2(1, 0, 0),
    focusedNode: graphColorV2(0, 1, 0),
    highlightedNode: graphColorV2(1, 0, 0),
    memoryConstellation: graphColorV2(0, 1, 0),
    nodeOutline: graphColorV2(0, 1, 0),
    edge: graphColorV2(0, 1, 0),
    arrow: graphColorV2(1, 0, 0),
    label: graphColorV2(0, 1, 0),
    animaAccent: graphColorV2(1, 0, 0),
  },
  labelFont: DEFAULT_GRAPH_VISUAL_THEME_V2.labelFont,
});

export class ThemeStyleResolver {
  constructor(
    private getRoot: () => HTMLElement = () => document.body,
    private getOverrides: () => GraphPlusColorOverridesV1 = () => ({}),
    private isFrankMode: () => boolean = () => false,
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
    if (this.isFrankMode()) return freezeGraphVisualThemeV2({
      ...FRANK_GRAPH_PLUS_THEME_V2,
      revision,
      labelFont: styles ? font(styles) : FRANK_GRAPH_PLUS_THEME_V2.labelFont,
    });
    if (!styles) return this.withOverrides({ ...DEFAULT_GRAPH_VISUAL_THEME_V2, revision });
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
        '--graph-plus-surface-background',
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
    return this.withOverrides({
      revision,
      colors: {
        background,
        node,
        tagNode,
        selectedNode: tagNode,
        focusedNode: highlighted,
        highlightedNode: highlighted,
        memoryConstellation: this.color(root, this.read(styles, '--graph-plus-memory-constellation'), highlighted),
        nodeOutline: outline,
        edge,
        arrow,
        label,
        animaAccent: highlighted,
      },
      labelFont: font(styles),
    });
  }

  private withOverrides(theme: GraphVisualThemeV2): GraphVisualThemeV2 {
    const overrides = this.getOverrides();
    const background = overrides.background ? parseGraphColorV2(overrides.background) : undefined;
    const node = overrides.noteNode ? parseGraphColorV2(overrides.noteNode) : undefined;
    const tagNode = overrides.tagNode ? parseGraphColorV2(overrides.tagNode) : undefined;
    return freezeGraphVisualThemeV2({
      ...theme,
      colors: {
        ...theme.colors,
        ...(background ? { background } : {}),
        ...(node ? { node } : {}),
        ...(tagNode ? { tagNode } : {}),
      },
    });
  }

  private color(root: HTMLElement, value: string, fallback: GraphColorV2): GraphColorV2 {
    const parsed = parseGraphColorV2(value);
    if (parsed) return parsed;
    if (!value.trim()) return fallback;
    const element = root.ownerDocument.createElement('span');
    element.style.color = value;
    if (!element.style.color) return fallback;
    element.style.position = 'absolute';
    element.style.visibility = 'hidden';
    root.append(element);
    try {
      const normalized = root.ownerDocument.defaultView?.getComputedStyle(element).color ?? '';
      const parsed = parseGraphColorV2(normalized);
      if (parsed) return parsed;
      if (!normalized) return fallback;
      // Computed styles preserve modern CSS color spaces (e.g. OKLCH).
      // Let the browser convert them to the renderer's sRGB channels.
      const canvas = root.ownerDocument.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return fallback;
      context.fillStyle = normalized;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return graphColorV2(r / 255, g / 255, b / 255, a / 255);
    } finally {
      element.remove();
    }
  }
}

function applyOpacity(color: string, opacityValue: string): string {
  if (!opacityValue.trim()) return color;
  const opacity = Number(opacityValue);
  if (!Number.isFinite(opacity) || opacity >= 1) return color;
  const parsed = parseGraphColorV2(color);
  if (parsed) return graphColorToCssV2(parsed, Math.max(0, opacity));
  return `color-mix(in srgb, ${color} ${Math.max(0, opacity) * 100}%, transparent)`;
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
