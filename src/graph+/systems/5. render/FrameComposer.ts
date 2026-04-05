import type {
  RenderFrame,
  RenderLinkState,
  RenderNodeState,
  RenderSettings,
}                                               from "../../types/domain/render.ts";

import type { 
  BaseSettings, 
  ModuleWithSettings, 
  SettingsFor, 
  TuningSettings }                              from "../../types/index.ts";
  
import type { FrameComposerDeps }               from "../../deps/framecomposer.deps.ts";
import type { ThemePalette }                    from "../../../obsidian/themeStyleResolver.ts";

export class FrameComposer implements ModuleWithSettings<'renderComposer'> {

  constructor(
    private settings: SettingsFor<'renderComposer'>,
    private deps:     FrameComposerDeps) 
    {
    }
  
  initialize(): void {
    // No startup work yet.
  }

  updateSettings(settings: SettingsFor<'renderComposer'>): void {
    this.settings = settings;
  }
  
  public tick(_dt: number): void {
    const graph = this.deps.graph?.get();
    if (!graph) {
      this.deps.frameStore.set(null);
      return;
    }

    const tuning      = this.settings.tuning;
    const base        = this.settings.base;
    const ui          = this.deps.uiState;
    const animaStore  = this.deps.animaStore;

    const theme                     = this.deps.getThemePalette();
    const settings: RenderSettings  = resolveRenderStyle(base, theme, tuning);

    // --- Nodes
    const nodes: RenderNodeState[] = graph.nodes.map((node) => {
      const anima = animaStore.get(node.id);

      const labelOpacity = anima
        ? Math.max(0, Math.min(1, anima.level / anima.capacity))
        : 0;

      const hovered = ui.hoveredNodeId === node.id;
      const visible = base.showTags || node.type !== "tag";

      return {
        id: node.id,
        label: node.label,
        type: node.type,
        world: node.location,
        radius: node.radius,
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

    this.deps.frameStore.set(frame);
  }

  public destroy(): void {
    // No cleanup work yet.
  }

}

function resolveRenderStyle(
    base: BaseSettings,
    theme: ThemePalette,
    tuning: TuningSettings
  ): RenderSettings {
    return {
      backgroundColor:  base.backgroundColor ?? theme.backgroundColor,
      nodeColor:        base.nodeColor ?? theme.nodeColor,
      tagColor:         base.tagColor ?? theme.tagColor,
      linkColor:        base.linkColor ?? theme.linkColor,
      labelColor:       base.labelColor ?? theme.labelColor,
      labelFontSize:    base.labelFontSize,
      showLabels:       base.showLabels,
      showTags:         base.showTags,
      useInterfaceFont: base.useInterfaceFont,
      labelOffsetY:     tuning.labelOffsetY,
    };
  }
