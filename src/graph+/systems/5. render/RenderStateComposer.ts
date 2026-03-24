import type {
  Module,
  GraphSettings,
  RenderConfig,
  RenderFrame,
  RenderLinkState,
  RenderNodeState,
  Tickable,
  UIState,
  GraphModule,
} from "../../grammar/interfaces.ts";

import type { RenderFrameStore } from "./RenderFrameStore.ts";
import type { AnimaStateStore } from "../4. Modules/AnimaStateStore.ts";

type RenderStateComposerDeps = {
  getGraph: ()          => GraphModule;
  getUIState: ()        => UIState;
  getGraphSettings: ()  => GraphSettings;
  getAnimaStore: ()     => AnimaStateStore;
  getFrameStore: ()     => RenderFrameStore;
};

// delete this later, but for now it allows the render state composer to pick up theme colors from CSS variables, so that the default graph appearance matches the Obsidian theme.
const styles = getComputedStyle(document.body);
const themeNodeColor        = styles.getPropertyValue("--interactive-accent").trim()          || "#888";
const themeTagColor         = styles.getPropertyValue("--color-purple").trim()                || themeNodeColor;
const themeEdgeColor        = styles.getPropertyValue("--background-modifier-border").trim()  || "#666";
const themeLabelColor       = styles.getPropertyValue("--text-normal").trim()                 || "#ccc";
const themeBackgroundColor  = styles.getPropertyValue("--background-primary").trim()          || "#111";

export class RenderStateComposer implements Module, Tickable {
  initialize(): void {
    // No startup work yet.
  }

  dispose(): void {
    this.deps.getFrameStore().set(null);
  }

  constructor(private deps: RenderStateComposerDeps) {}

  public tick(_dt: number, _nowMs: number): void {
    const graph = this.deps.getGraph().get();
    if (!graph) {
      this.deps.getFrameStore().set(null);
      return;
    }

    const ui          = this.deps.getUIState();
    const settings    = this.deps.getGraphSettings();
    const animaStore  = this.deps.getAnimaStore();

    // --- Config snapshot
    const config: RenderConfig = {
      backgroundColor:  settings.backgroundColor ?? themeBackgroundColor,
      nodeColor:        settings.nodeColor ?? themeNodeColor,
      tagColor:         settings.tagColor ?? themeTagColor,
      edgeColor:        settings.edgeColor ?? "#888",
      labelColor:       settings.labelColor ?? themeLabelColor,
      labelFontSize:    settings.labelFontSize,
      showLabels:       settings.showLabels,
      showTags:         settings.showTags,
      hoverScale:       settings.hoverScale,
      useInterfaceFont: settings.useInterfaceFont,
    };

    // --- Nodes
    const nodes: RenderNodeState[] = graph.nodes.map((node) => {
      const anima = animaStore.get(node.id);

      const labelOpacity = anima
        ? Math.max(0, Math.min(1, anima.level / anima.capacity))
        : 0;

      const hovered = ui.hoveredNodeId === node.id;
      const scale = hovered ? settings.hoverScale : 1;
      const visible = settings.showTags || node.type !== "tag";

      return {
        id: node.id,
        label: node.label,
        type: node.type,
        world: node.location,
        radius: node.radius,
        scale,
        labelOpacity,
        visible,
      };
    });

    // --- Links
    const links: RenderLinkState[] = graph.links.map((link) => ({
      id: link.id,
      sourceId: link.sourceId,
      targetId: link.targetId,
      thickness: link.thickness,
      visible: true,
    }));

    const frame: RenderFrame = {
      nodes,
      links,
      config,
    };

    this.deps.getFrameStore().set(frame);
  }
}