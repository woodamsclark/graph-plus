import type {
  RenderFrame,
  RenderFocusPlane,
  RenderLinkState,
  RenderNodeState,
  RenderSettings,
}                                               from "../../types/domain/render.ts";

import type {
  CameraSettings,
  BaseSettings, 
  ModuleWithSettings, 
  SettingsFor, 
  TuningSettings }                              from "../../types/index.ts";
import type { GraphData }                       from "../../types/domain/graph.ts";
  
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
    const animaStore  = this.deps.animaStore;

    const theme                     = this.deps.getThemePalette();
    const settings: RenderSettings  = resolveRenderStyle(base, theme, tuning);
    const focusPlane: RenderFocusPlane = resolveFocusPlane(this.settings.camera, graph, this.deps);

    // --- Nodes
    const nodes: RenderNodeState[] = graph.nodes.map((node) => {
      const anima        = animaStore.get(node.id);
      const pressure     = anima?.pressure ?? 0;
      // const pressureLabel = formatAnimaLabel(pressure, level, capacity);

      const labelOpacity = graph.projection.mode === 'mind-map'
        ? 1
        : anima
          ? pressureToLabelOpacity(pressure)
          : 0;
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        world: node.location,
        radius: node.radius,
        animaPressure: pressure,
        labelOpacity,
        visible: true,
        color: node.view?.color,
        role: node.view?.role,
      };
    });

    // --- Links
    const links: RenderLinkState[] = graph.links.map((link) => ({
      id: link.id,
      sourceId: link.sourceId,
      targetId: link.targetId,
      thickness: link.thickness,
      visible: true,
      color: link.view?.color,
      role: link.view?.role,
    }));

    const animaFlows = animaStore.getCurrentFlows().map((flow) => ({
      fromNodeId: flow.fromNodeId,
      toNodeId: flow.toNodeId,
      amount: flow.amount,
      strength: flow.strength,
    }));

    const frame: RenderFrame = {
      nodes,
      links,
      animaFlows,
      settings,
      focusPlane,
    };

    this.deps.frameStore.set(frame);
  }

  public destroy(): void {
    // No cleanup work yet.
  }

}

function resolveFocusPlane(
  cameraSettings: CameraSettings,
  graph: GraphData,
  deps: FrameComposerDeps,
): RenderFocusPlane {
  const currentDistance = deps.camera?.getState().distance ?? cameraSettings.initialState.distance;
  const zoomScaledFocus = scaleFocusPlaneForZoom(
    cameraSettings.focusPlaneHalfWidth,
    cameraSettings.focusPlaneFadeDistance,
    currentDistance,
    cameraSettings.initialState.distance,
  );

  let centerViewZ = 0;
  const followedNodeId = deps.uiState.followedNodeId;
  if (followedNodeId && deps.camera) {
    const focusedNode = graph.nodes.find((node) => node.id === followedNodeId);
    if (focusedNode) {
      centerViewZ = deps.camera.worldToScreen(focusedNode.location).viewZ;
    }
  }

  return {
    enabled: cameraSettings.focusPlaneEnabled,
    centerViewZ,
    halfWidth: zoomScaledFocus.halfWidth,
    fadeDistance: zoomScaledFocus.fadeDistance,
    minAlpha: cameraSettings.focusPlaneMinAlpha,
  };
}

function scaleFocusPlaneForZoom(
  halfWidth: number,
  fadeDistance: number,
  currentDistance: number,
  baselineDistance: number,
): { halfWidth: number; fadeDistance: number } {
  const safeBaseline = Math.max(1, baselineDistance);
  const zoomRatio = Math.max(0.0001, currentDistance) / safeBaseline;

  // Use a softened zoom curve so close-in focus tightens noticeably
  // without collapsing into an unusably thin band.
  const zoomScale = clamp(Math.sqrt(zoomRatio), 0.25, 4);

  return {
    halfWidth: halfWidth * zoomScale,
    fadeDistance: fadeDistance * zoomScale,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pressureToLabelOpacity(pressure: number): number {
  const excessPressure = Math.max(0, pressure - 1);
  return 1 - Math.exp(-2 * excessPressure);
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
