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

  // Settings
export interface GraphPlusSettings {
  graph                 : GraphSettings;
  physics               : PhysicsSettings;
  camera                : CameraSettings;
  ui                    : UISettings;
}

export interface GraphSettings {
  minNodeRadius         : number;
  maxNodeRadius         : number;
  // nodeRadiusScaling // global scaling
  nodeColor?            : string;   // optional color overrides (CSS color strings). If unset, theme vars are used.
  tagColor?             : string;
  edgeColor?            : string;
  
  showTags              : boolean;
  showLabels            : boolean;
  
  labelFontSize         : number;
  labelRevealRadius     : number;
  labelColor?           : string; 

  backgroundColor?      : string;
  useInterfaceFont      : boolean;
  countDuplicateLinks   : boolean;
  drawDoubleLines       : boolean;
  hoverScale            : number;
  //highlightDepth        : number;  // screen-space label reveal radius (× size)
}

export interface PhysicsSettings {
  repulsionStrength     : number;
  edgeStrength        : number;
  edgeLength          : number;
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
  rotateSensitivityX    : number;
  rotateSensitivityY    : number;
  zoomSensitivity       : number;
  min_distance          : number;// = 100;
  max_distance          : number;// = 5000;
  min_pitch             : number;//    = -Math.PI / 2 + 0.05;
  max_pitch             : number;//    =  Math.PI / 2 - 0.05;
  state                 : CameraState;
}

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

export class GraphStore {
  private graph:  GraphData | null = null;
  
  get():          GraphData | null { return this.graph; }
  set(graph:      GraphData | null) { this.graph = graph; }
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
  tick(dt: number)                  : void;
  reset()                           : void;
  setPinnedNodes?(ids: Set<string>) : void;
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
// --- Interaction State & Events ----------------------------------------------


export interface InteractionInterpreterSystem extends Tickable {
}

// --- Renderer System ---------------------------------------------------------

export interface RenderSystem extends Tickable {
  resize(width: number, height: number): void;
  render(): void;
  destroy(): void;
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

export interface DrainableQueue<T>{
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




export type RenderConfig = {
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
  config: RenderConfig;
};