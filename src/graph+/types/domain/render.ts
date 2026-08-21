import type { Vec3 } from "./math.ts";
import type { NodeType } from "./graph.ts";

export type RenderSettings = {
  backgroundColor:  string;
  nodeColor:        string;
  tagColor:         string;
  linkColor:        string;
  labelColor:       string;
  labelFontSize:    number;
  showLabels:       boolean;
  showTags:         boolean;
  useInterfaceFont: boolean;
  labelOffsetY:     number;
};

export type RenderFocusPlane = {
  enabled: boolean;
  centerViewZ: number;
  halfWidth: number;
  fadeDistance: number;
  minAlpha: number;
};

export type RenderNodeState = {
  id:           string;
  label:        string;
  type:         NodeType;
  world:        Vec3;
  radius:       number;
  animaPressure: number;
  labelOpacity: number;
  visible:      boolean;
  color?:       string;
  role?:        'root' | 'branch' | 'leaf' | 'disconnected';
};

export type RenderLinkState = {
  id:         string;
  sourceId:   string;
  targetId:   string;
  thickness:  number;
  visible:    boolean;
  color?:     string;
  role?:      'tree' | 'cross';
};

export type RenderAnimaFlowState = {
  fromNodeId: string;
  toNodeId:   string;
  amount:     number;
  strength:   number;
};

export type RenderFrame = {
  nodes:      RenderNodeState[];
  links:      RenderLinkState[];
  animaFlows: RenderAnimaFlowState[];
  settings:   RenderSettings;
  focusPlane: RenderFocusPlane;
};
