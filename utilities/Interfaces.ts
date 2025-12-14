import { App, TFile, CachedMetadata } from 'obsidian';

export interface GraphSettings {
  // user defined//updated settings
  minNodeRadius         : number;
  maxNodeRadius         : number;
  minCenterAlpha        : number;
  maxCenterAlpha        : number;
  highlightDepth        : number;  // screen-space label reveal radius (× size)
  focusSmoothing        : number;
  nodeColor?            : string;   // optional color overrides (CSS color strings). If unset, theme vars are used.
  nodeColorAlpha        : number;
  tagColor?             : string;
  tagColorAlpha         : number;
  edgeColor?            : string;
  edgeColorAlpha        : number;
  labelColor?           : string;
  labelColorAlpha       : number;
  labelBaseFontSize     : number;
  labelFadeRangePx      : number;
  labelRadius           : number;
  useInterfaceFont      : boolean;
  countDuplicateLinks   : boolean;
  drawDoubleLines       : boolean;
  showTags              : boolean;
  showLabels            : boolean;
  hoverScale            : number;
  centerNoteTitle       : string;
  useCenterNote         : boolean;
  useOutlinkFallback    : boolean;
}

export interface PhysicsSettings {
  //user defined/updated settings
  repulsionStrength     : number;
  springStrength        : number;
  springLength          : number;
  centerPull            : number;
  damping               : number;
  notePlaneStiffness    : number;
  tagPlaneStiffness     : number;
  gravityRadius         : number;   // scales per-node screen radius
  gravityFallOff        : number;   // falloff steepness
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
  // user defined/updated settings
  momentumScale                     : number;
  dragThreshold                     : number;
  rotateSensitivityX                : number;
  rotateSensitivityY                : number;
  cameraAnimDuration                : number;
  state                             : CameraState;
}

export interface GraphPlusSettings {
  graph                 : GraphSettings;
  physics               : PhysicsSettings;
  camera                : CameraSettings;
  nodePositions         : Record<string, Record<string, { x: number; y: number; z?: number }>>;
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
  resize(width: number, height: number)                                             : void;
  render(cam: CameraState)                                                          : void;
  destroy()                                                                         : void;
  setHoveredNode(nodeId: string | null)                                             : void;
  getNodeRadiusForHit(node: any)                                                    : number;
  screenToWorld2D(screenX: number, screenY: number)                                 : { screenX: number; screenY: number };
  screenToWorld3D(screenX: number, screenY: number, zCam: number) : { screenX: number; screenY: number; screenZ: number };
  getNodeScreenPosition(node: any, cam: CameraState)                                : { screenX: number; screenY: number };
  getProjectedNode(node: any, cam: CameraState)                                     : { screenX: number; screenY: number; depth: number };
  setHoveredNode                                                                    : Renderer['setHoveredNode'];
  setGraph(data: GraphData)                                                         : void;
  getNodeRadius(node: any)                                                          : number;
}
export type GraphNodeType = 'note' | 'tag';

export interface GraphData {
  nodes         : GraphNode[];
  edges         : GraphEdge[];
  centerNode?   : GraphNode | null;
}

export interface GraphNode {
  id            : string;
  label         : string;
  x             : number;
  y             : number;
  z             : number;
  filePath      : string;
  file?         : TFile;
  vx            : number;
  vy            : number;
  vz            : number;
  type?         : GraphNodeType;
  inDegree      : number;
  outDegree     : number;
  totalDegree   : number;
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

export interface InputManagerCallbacks {
    // Camera Control
    onOrbitStart        (dx: number, dy: number)                          : void;
    onOrbitMove         (dx: number, dy: number)                          : void;
    onOrbitEnd          ()                                                : void;
    onPanStart          (screenX: number, screenY: number)                : void;
    onPanMove           (dx: number, dy: number)                          : void;
    onPanEnd            ()                                                : void;
    onZoom              (screenX: number, screenY: number, delta: number) : void;
    onFollowStart       (nodeId: string)                                  : void;
    onFollowEnd         ()                                                : void;
    resetCamera         ()                                                : void;
    // Node Interaction
    onHover             (screenX: number, screenY: number)                : void;
    onOpenNode          (screenX: number, screenY: number)                : void;
    // Node Dragging 
    onDragStart         (nodeId: string, screenX: number, screenY: number): void;
    onDragMove          (screenX: number, screenY: number)                : void;
    onDragEnd           (): void;
    // Utility
    detectClickedNode   (screenX: number, screenY: number)                : { id: string, filePath?: string, label: string } | null;
}

export enum PointerMode {
  Idle,
  Hover,
  Click,
  RightClick,
  DragNode,
  Pan,
  Orbit,
}
