import { App, TFile } from 'obsidian';

export interface GraphSettings {
  minNodeRadius         : number;
  maxNodeRadius         : number;
  // nodeRadiusScaling // global scaling
  nodeColor?            : string;   // optional color overrides (CSS color strings). If unset, theme vars are used.
  tagColor?             : string;
  edgeColor?            : string;
  
  showTags              : boolean;
  showLabels            : boolean;
  
  labelFontSize     : number;
  labelRevealRadius     : number;
  labelColor?           : string; 

  backgroundColor?      : string;
  useInterfaceFont      : boolean;
  countDuplicateLinks   : boolean;
  drawDoubleLines       : boolean;
  hoverScale            : number;
  //highlightDepth        : number;  // screen-space label reveal radius (× size)
  centerNoteTitle       : string;
  useCenterNote         : boolean;
  useOutlinkFallback    : boolean;
}

export interface PhysicsSettings {
  repulsionStrength     : number;
  springStrength        : number;
  springLength          : number;
  centerPull            : number;
  damping               : number;
  notePlaneStiffness    : number;
  tagPlaneStiffness     : number;
  mouseGravityEnabled   : boolean;
  mouseGravityRadius    : number;
  mouseGravityStrength  : number;
  mouseGravityExponent  : number;  
  // not changeable by user, maybe move these elsewhere conceptually
  readonly worldCenterX : number;
  readonly worldCenterY : number;
  readonly worldCenterZ : number;

}

export interface CameraSettings {
  momentumScale         : number;
  dragThreshold         : number;
  rotateSensitivityX    : number;
  rotateSensitivityY    : number;
  zoomSensitivity       : number;
  cameraAnimDuration    : number;
  state                 : CameraState;
}

export interface GraphPlusSettings {
  graph                 : GraphSettings;
  physics               : PhysicsSettings;
  camera                : CameraSettings;
}

export interface CameraState {
  yaw                   : number;      // rotation around Y axis
  pitch                 : number;      // rotation around X axis
  distance              : number;      // camera distance from target
  targetX               : number;
  targetY               : number;
  targetZ               : number;
  offsetX               : number;
  offsetY               : number;
  offsetZ               : number;
  orbitVelX             : number;
  orbitVelY             : number;
  panVelX               : number;
  panVelY               : number;
  zoomVel               : number;
  worldAnchorPoint?     : { x: number; y: number; z: number } | null;
}

export interface Renderer {
  resize(width: number, height: number)                       : void;
  render()                                                    : void;
  destroy()                                                   : void;
  setGraph(data: GraphData)                                   : void;
  setMouseScreenPosition(pos: { x: number; y: number } | null): void;
  refreshTheme()                                              : void;
}

export interface GraphData {
  nodes         : GraphNode[];
  edges         : GraphEdge[];
  centerNode?   : GraphNode | null;
}

export type GraphNodeType = 'note' | 'tag' | 'canvas'; // canvas nodes is a future feature 01-01-2026

type location = { x: number; y: number; z: number };
type velocity = { vx: number; vy: number; vz: number };

export interface GraphNode {
  id            : string;
  label         : string;
  location      : location;
  velocity      : velocity;
  type          : GraphNodeType;
  inLinks       : number;
  outLinks      : number;
  totalLinks    : number;
  radius        : number; 
  anima?        : number;
  file?         : TFile;
}

export interface GraphEdge {
  id?           : string;
  sourceId      : string;
  targetId      : string;
  linkCount?    : number;
  bidirectional?: boolean;
}

export interface Simulation {
  start()                           : void;
  stop()                            : void;
  tick(dt: number)                  : void;
  reset()                           : void;
  setPinnedNodes?(ids: Set<string>) : void;
}

export interface WorldTransform {
  rotationX : number; // radians
  rotationY : number;  // radians
  scale     : number; // unitless zoom scalar
}

export type ScreenPt = { x: number; y: number };
export type ClientPt = { x: number; y: number };