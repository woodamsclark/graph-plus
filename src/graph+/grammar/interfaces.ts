import { TFile } from 'obsidian';


export type NodeType  = 'note' | 'tag' | 'canvas'; // canvas nodes is a future feature 01-01-2026
export type Vec2      = { x: number;  y: number };
export type ScreenPt  = { x: number;  y: number };
export type ClientPt  = { x: number;  y: number };
export type Location  = { x: number;  y: number;  z: number };
export type Velocity  = { x: number;  y: number;  z: number };
export type Vec3      = { x: number;  y: number;  z: number };


// these to be moved into Anima module eventually
type anima    = { level : number,  capacity : number }; // pressure = level / threshold
type gate     = {
    state           : "open" | "closed",
    // open if dp > threshold
    // close if dp < threshold * hysteresis
    threshold   : number,  // delta pressure needed to open; edge.strength * edge.length; modulated by strain
    hysteresis  : number,  // 0...0.2; some fraction 
    // Open: flow = conductance * dp
    // Closed: backflow = leak * dp
    // live_threshold = edge.strength * edge.length * (1 + strain) // calculated live, since strain is deviation fron length
  }

export type UIState = {
  gravityCenter: Vec2 | null;
  hoveredNodeId:  string | null;
  followedNodeId: string | null;
  draggedNodeId:  string | null;
  isPanning:      boolean;
  isRotating:     boolean;
};

  // --- Interfaces ------------------------------------------------------

export type GraphPlusSettings = {
  base:     BaseSettings;
  layout:   LayoutSettings;
  physics:  PhysicsSettings;
  camera:   CameraSettings;
  tuning:   TuningSettings;
  ui:       UISettings;
};

export type BaseSettings = {
  minNodeRadius: number;
  maxNodeRadius: number;
  nodeColor?: string;
  tagColor?: string;
  linkColor?: string;
  backgroundColor?: string;
  labelColor?: string;
  labelFontSize: number;
  labelRevealRadius: number;
  useInterfaceFont: boolean;
  countDuplicateLinks: boolean;
  drawDoubleLines: boolean;
  showTags: boolean;
  showLabels: boolean;
  hoverScale: number;
};

export type LayoutSettings = {
  linkLength:         number;
  linkStrength:       number;
  centerPull:         number;
  notePlaneStiffness: number;
  tagPlaneStiffness:  number;
  worldCenterX:       number;
  worldCenterY:       number;
  worldCenterZ:       number;
}; 

export interface PhysicsSettings {
  repulsionStrength     : number;
  damping               : number;
  mouseGravityEnabled   : boolean;
  mouseGravityRadius    : number;
  mouseGravityStrength  : number;
  mouseGravityExponent  : number;
}

export interface CameraSettings {
    momentumScale     : number; 
    rotateSensitivityX: number;
    rotateSensitivityY: number;
    zoomSensitivity   : number; 
    minDistance       : number; 
    maxDistance       : number; 
    minPitch          : number;
    maxPitch          : number;
    initialState: {
      yaw       : number;
      pitch     : number;
      distance  : number;
      targetX   : number;
      targetY   : number;
      targetZ   : number;
      offsetX   : number;
      offsetY   : number;
      offsetZ   : number;
      rotateVelX: number;
      rotateVelY: number;
      panVelX   : number;
      panVelY   : number;
      zoomVel   : number;
    },
}


export interface AnimaSettings { // I'm not sure if I actually want these // 03-28-2026
  drainPerSecond: number;
  openNodeGain  : number;
  followNodeGain: number;
  pinNodeGain   : number;
  dragNodeGain  : number;
};


export type UISettings = {
    longPressMs:            number;
    longPressPointerKinds:  Array<PointerKind>;
    dragThresholdPx:        number;
    doubleClickMs:          number;
};

// State and Stores
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
  rotateVelX            : number;
  rotateVelY            : number;
  panVelX               : number;
  panVelY               : number;
  zoomVel               : number;
  worldAnchorPoint?     : { x: number; y: number; z: number } | null;
}

export interface GraphData {
  nodes     : Node[];
  links     : Link[];
  linksOut  : Record<string, Record<string, number>>;
  linksIn   : Record<string, Record<string, number>>;
  // linksOut[nodeId][targetId] = count of links from nodeId to targetId
  // linksOut[nodeId] = { targetId: count, ... }
  // linksIn[nodeId][sourceId]  = count of links from sourceId to nodeId
  // linksIn[nodeId]  = { sourceId: count, ... }
}

  // kP = edge.thickness / edge.length;
  // kD = something you tune
  // dpRate = (dp - prevDp) / dt;
  // flow = kP * dp + kD * dpRate

  // strain = dp / (distance(edge.src, edge.tgt) - edge.length) / edge.length;
  // stress = strain * edge.strength


  // dp = (src.anima.level / anima.threshold) - (tgt.anima.level / anima.threshold

export interface Node {
  id            : string;
  label         : string;
  location      : Location;
  velocity      : Velocity;
  type          : NodeType;
  radius        : number;
  anima         : anima;
  file?         : TFile;
}

export interface Link {
  id            : string;
  sourceId      : string;
  targetId      : string;
  bidirectional?: boolean;
  length        : number; // to replace settings.physics edge length; preferred resting length
  strength      : number; // to replace settings.physics edge strength, though this is probably the same for all edges
  thickness     : number;
  //kP            : number; // defined runtime
  //kD            : number; // defined runtime
  gate          : gate;
}

export interface Simulation {
  start()                           : void;
  stop()                            : void;
  tick(dt: number, physicsSettings: PhysicsSettings, layoutSettings: LayoutSettings)                  : void;
  reset()                           : void;
  setPinnedNodes?(ids: Set<string>) : void;
  updateDragTarget?(target: { x: number; y: number } | null): void;
  beginDrag?(nodeId: string, target: { x: number; y: number; z: number }): void;
  endDrag?(): void;
}

export interface WorldTransform {
  rotationX : number; // radians
  rotationY : number;  // radians
  scale     : number; // unitless zoom scalar
}

// --- Tickable Interface ------------------------------------------------------


export interface Tickable {
  tick(dt: number, nowMs: number): void;
}

// --- Module Lifecycle -------------------------------------------------------

export interface Module {
  initialize?():  Promise<void> | void;
  rebuild?():     Promise<void> | void;
  save?():        Promise<void> | void;
  dispose?():     Promise<void> | void;
}

export interface GraphModule extends Module {
  initialize():   Promise<void>;
  ensureBuilt():  Promise<GraphData>;
  get():          GraphData | null;
  getOrThrow():   GraphData;
  hasGraph():     boolean;
  rebuild():      Promise<void>;
  save():         Promise<void>;
}


// --- Interaction State & Events ----------------------------------------------


export interface InteractionInterpreterSystem extends Tickable {
}

// --- Renderer System ---------------------------------------------------------

export interface RenderSystem extends Tickable {
  resize(width: number, height: number): void;
  render():     void;
  destroy():    void;
}

// --- Physics System ----------------------------------------------------------

export interface PhysicsSystem extends Tickable {
  start(): void;
  stop(): void;
  rebuild(): void;
  pinNode(nodeId: string): void;
  unpinNode(nodeId: string): void;
}

export interface CommandSystem extends Tickable {
}

export interface DrainableBuffer<T>{
  push(e: T): void;
  drain(): T[];
  clear(): void;
}

export interface Store<T> {
  get(): Readonly<T>;
}

export interface KeyedStore<K, V> {
  get(key: K): V | null;
}

export type PointerKind = "mouse" | "touch" | "pen";


export type UserInputEvent =
  | {
      type: "POINTER_DOWN";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      button: 0 | 1 | 2;
      ctrl: boolean;
      meta: boolean;
      shift: boolean;
      timeMs: number;
    }
  | {
      type: "POINTER_MOVE";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      timeMs: number;
    }
  | {
      type: "POINTER_UP";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      button: 0 | 1 | 2;
      timeMs: number;
    }
  | {
      type: "POINTER_CANCEL";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      timeMs: number;
    }
  | {
      type: "WHEEL";
      screen: ScreenPt;
      client: ClientPt;
      deltaX: number;
      deltaY: number;
      ctrl: boolean;
      meta: boolean;
      shift: boolean;
      timeMs: number;
    }
  | {
      type: "LONG_PRESS";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      timeMs: number;
    };




export type RenderSettings = {
  backgroundColor?: string;
  nodeColor?: string;
  tagColor?: string;
  edgeColor?: string;
  labelColor?: string;
  labelFontSize: number;
  showLabels: boolean;
  showTags: boolean;
  hoverScale: number;
  useInterfaceFont: boolean;
  labelOffsetY: number;
};

export type RenderNodeState = {
  id: string;
  label: string;
  type: NodeType;
  world: Vec3;
  radius: number;
  scale: number;
  labelOpacity: number;
  visible: boolean;
};

export type RenderLinkState = {
  id: string;
  sourceId: string;
  targetId: string;
  thickness: number;
  visible: boolean;
};

export type RenderFrame = {
  nodes: RenderNodeState[];
  links: RenderLinkState[];
  settings: RenderSettings;
};

export type TuningSettings = {
  linkThicknessScale: number;
  linkThicknessMin: number;

  nodeDegreeRadiusScale: number;
  initialJitter: number;

  labelOffsetY: number;

  pinchThresholdPx: number;
  rotateThresholdRad: number;

  repulsionMinDistance: number;
  barnesHutTheta: number;
  barnesHutEpsilon: number;

  mouseGravityPaddingWorld: number;
};

export type GraphModuleSettings         = Pick<GraphPlusSettings, 'base'    | 'layout' | 'tuning'>;
export type PhysicsModuleSettings       = Pick<GraphPlusSettings, 'physics' | 'layout' | 'tuning'>;
export type RendererModuleSettings      = Pick<GraphPlusSettings, 'base'    | 'tuning'>;
export type UIModuleSettings            = Pick<GraphPlusSettings, 'ui'      | 'tuning'>;
export type CameraModuleSettings        = Pick<GraphPlusSettings, 'camera'>;
export type InputModuleSettings         = Pick<GraphPlusSettings, 'ui'>;


export interface SettingsAwareSystem<TSettings> {
  updateSettings(settings: TSettings): void;
}

export interface ConfigurableModule<TSettings> extends Module, SettingsAwareSystem<TSettings> {}

export interface ConfigurableSystem<TSettings> {
  updateSettings(settings: TSettings): void;
}