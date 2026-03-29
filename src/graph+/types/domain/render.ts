import type { Vec3 } from "./math.ts";

export type RenderSettings = {
  backgroundColor?: string;
  nodeColor?:       string;
  tagColor?:        string;
  edgeColor?:       string;
  labelColor?:      string;
  labelFontSize:    number;
  showLabels:       boolean;
  showTags:         boolean;
  useInterfaceFont: boolean;
  labelOffsetY:     number;
};

export type RenderNodeState = {
  id:           string;
  label:        string;
  type:         "note" | "tag" | "canvas";
  world:        Vec3;
  radius:       number;
  labelOpacity: number;
  visible:      boolean;
};

export type RenderLinkState = {
  id:         string;
  sourceId:   string;
  targetId:   string;
  thickness:  number;
  visible:    boolean;
};

export type RenderFrame = {
  nodes:    RenderNodeState[];
  links:    RenderLinkState[];
  settings: RenderSettings;
};