export type ThemePalette = {
  nodeColor:        string;
  tagColor:         string;
  linkColor:        string;
  labelColor:       string;
  arrowColor:       string;
  backgroundColor:  string;
  highlightColor:   string;
  outlineColor:     string;
};

export class ThemeStyleResolver {
  constructor(private getRoot: () => HTMLElement = () => document.body) {}

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

  getPalette(): ThemePalette {
    const root = this.getRoot();
    const styles = root.ownerDocument.defaultView?.getComputedStyle(root);
    if (!styles) {
      return {
        nodeColor: '#888',
        tagColor: '#888',
        linkColor: '#666',
        labelColor: '#ccc',
        arrowColor: '#666',
        backgroundColor: '#111',
        highlightColor: '#e0af68',
        outlineColor: '#ccc',
      };
    }

    const accent = this.read(
      styles,
      "--color-accent",
      "--interactive-accent",
      "--text-accent"
    );
    
    return {
      nodeColor: this.probe(root, 'color-fill') || this.read(styles, '--graph-node') || accent || "#888",
      tagColor: this.probe(root, 'color-fill-tag') || this.read(
        styles,
        '--graph-node-tag',
        "--color-accent-2",
        "--color-purple",
        "--interactive-accent"
      ) || accent || "#888",
      linkColor: this.probe(root, 'color-line') || this.read(
        styles,
        '--graph-line',
        "--background-modifier-border",
        "--color-base-35"
      ) || "#666",
      labelColor: this.probe(root, 'color-text') || this.read(
        styles,
        '--graph-text',
        "--text-normal"
      ) || "#ccc",
      arrowColor: this.probe(root, 'color-arrow') || this.read(styles, '--graph-line') || '#666',
      backgroundColor: this.read(
        styles,
        '--graph-background',
        "--background-primary"
      ) || "#111",
      highlightColor: this.probe(root, 'color-fill-focused') || this.read(
        styles,
        '--graph-node-focused',
        '--graph-node-unresolved',
        '--interactive-accent-hover',
        '--color-accent'
      ) || accent || '#e0af68',
      outlineColor: this.probe(root, 'color-circle') || this.read(
        styles,
        '--graph-node-focused',
        '--text-normal'
      ) || '#ccc',
    };
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
