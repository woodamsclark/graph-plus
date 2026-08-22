export type ThemePalette = {
  nodeColor:        string;
  tagColor:         string;
  linkColor:        string;
  labelColor:       string;
  backgroundColor:  string;
};

export class ThemeStyleResolver {
  constructor(private getRoot: () => HTMLElement = () => document.body) {}

  private read(styles: CSSStyleDeclaration, ...vars: string[]): string {
    for (const name of vars) {
      const value = styles.getPropertyValue(name).trim();
      if (value) return value;
    }
    return "";
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
        backgroundColor: '#111',
      };
    }

    const accent = this.read(
      styles,
      "--color-accent",
      "--interactive-accent",
      "--text-accent"
    );
    
    return {
      nodeColor: accent || "#888",
      tagColor: this.read(
        styles,
        "--color-accent-2",
        "--color-purple",
        "--interactive-accent"
      ) || accent || "#888",
      linkColor: this.read(
        styles,
        "--background-modifier-border",
        "--color-base-35"
      ) || "#666",
      labelColor: this.read(
        styles,
        "--text-normal"
      ) || "#ccc",
      backgroundColor: this.read(
        styles,
        "--background-primary"
      ) || "#111",
    };
  }
}
