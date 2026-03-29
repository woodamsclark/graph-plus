import type {
  Module,
  BaseSettings,
  RenderSettings,
  RenderFrame,
  RenderLinkState,
  RenderNodeState,
  Tickable,
  UIState,
  GraphModule,
  TuningSettings,
  RendererModuleSettings,
  SettingsAwareSystem,
} from "../../grammar/interfaces.ts";

import type { RenderFrameStore } from "./RenderFrameStore.ts";
import type { AnimaStateStore } from "../4. Modules/AnimaStateStore.ts";

type RenderStateComposerDeps = {
  getGraph: ()          => GraphModule;
  getUIState: ()        => UIState;
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

export class RenderStateComposer implements Module, Tickable, SettingsAwareSystem<RendererModuleSettings>  {
  initialize(): void {
    // No startup work yet.
  }

  dispose(): void {
    this.deps.getFrameStore().set(null);
  }

  constructor(
    private settings: RendererModuleSettings,
    private deps: RenderStateComposerDeps) {

    }


  updateSettings(settings: RendererModuleSettings): void {
    this.settings = settings;
  }
  
  
  public tick(_dt: number, _nowMs: number): void {
    const graph = this.deps.getGraph().get();
    if (!graph) {
      this.deps.getFrameStore().set(null);
      return;
    }

    const tuning      = this.settings.tuning;
    const base        = this.settings.base;
    const ui          = this.deps.getUIState();
    const animaStore  = this.deps.getAnimaStore();

    // --- Config snapshot
    const settings: RenderSettings = {
      backgroundColor:  base.backgroundColor ?? themeBackgroundColor,
      nodeColor:        base.nodeColor ?? themeNodeColor,
      tagColor:         base.tagColor ?? themeTagColor,
      edgeColor:        base.linkColor ?? "#888",
      labelColor:       base.labelColor ?? themeLabelColor,
      labelFontSize:    base.labelFontSize,
      showLabels:       base.showLabels,
      showTags:         base.showTags,
      hoverScale:       base.hoverScale,
      useInterfaceFont: base.useInterfaceFont,
      labelOffsetY:     tuning.labelOffsetY,
    };

    // --- Nodes
    const nodes: RenderNodeState[] = graph.nodes.map((node) => {
      const anima = animaStore.get(node.id);

      const labelOpacity = anima
        ? Math.max(0, Math.min(1, anima.level / anima.capacity))
        : 0;

      const hovered = ui.hoveredNodeId === node.id;
      const scale = hovered ? base.hoverScale : 1;
      const visible = base.showTags || node.type !== "tag";

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
      settings,
    };

    this.deps.getFrameStore().set(frame);
  }


}