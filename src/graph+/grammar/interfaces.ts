import { TFile } from 'obsidian';


export type NodeType  = 'note' | 'tag' | 'canvas'; // canvas nodes is a future feature 01-01-2026
export type Vec2      = {  x: number;  y: number };
export type ScreenPt  = {  x: number;  y: number };
export type ClientPt  = {  x: number;  y: number };
export type location         = {  x: number;  y: number;  z: number  };
export type velocity         = { vx: number; vy: number; vz: number  };
export type Vec3 = { x: number; y: number; z: number };

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


export type TranslationState = {
  gravityCenter: Vec2 | null;
  hoveredNodeId: string | null;
  followedNodeId: string | null;
  draggedNodeId: string | null;
  isPanning: boolean;
  isRotating: boolean;
};

export type TranslationEvent =
  | { type: "OPEN_NODE_REQUESTED"; node: { id: string; label: string, type: string } }
  | { type: "PINNED_SET"; ids: Set<string> }
  | { type: "MOUSE_GRAVITY_SET"; on: boolean };


  // --- Interfaces ------------------------------------------------------

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
  dragThreshold         : number;
  longPressMs           : number;
  rotateSensitivityX    : number;
  rotateSensitivityY    : number;
  zoomSensitivity       : number;
  min_distance          : number;// = 100;
  max_distance          : number;// = 5000;
  min_pitch             : number;//    = -Math.PI / 2 + 0.05;
  max_pitch             : number;//    =  Math.PI / 2 - 0.05;
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
  rotateVelX             : number;
  rotateVelY             : number;
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

export class GraphState {
  private graph: GraphData | null = null;
  get(): GraphData | null { return this.graph; }
  set(graph: GraphData | null) { this.graph = graph; }
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
  location      : location;
  velocity      : velocity;
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



export interface TranslationSystem extends Tickable {
  getState(): Readonly<TranslationState>;
  // optional: cursorType if you want renderer/cursor to query it
  getCursorType(): string;
}

// --- Renderer System ---------------------------------------------------------

export interface RenderSystem extends Tickable{
  resize(width: number, height: number)                       : void;
  render()                                                    : void;
  destroy()                                                   : void;
  setGraph: (graph: GraphData | null) => void;
  setMouseScreenPosition(pos: { x: number; y: number } | null): void;
  setFollowedNode(node: string | null)               : void;
  refreshTheme()                                              : void;
  tick(dt: number, nowMs: number): void;
}


// --- Physics System ----------------------------------------------------------

export interface PhysicsSystem extends Tickable {
  start(): void;
  stop(): void;
  rebuild(): void;
  setPinnedNodes(ids: Set<string>): void;
}

export interface CommandSystem extends Tickable {
}

export type PointerKind = "mouse" | "touch" | "pen";

export type InputSettings = {}; // future use

export type InputEvent =
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

    // Commands are for when the user interacts with the graph
    // Commanding it to do something
export type Command =
| { type: "RequestOpenNode"; nodeId: string }
| { type: "SetMouseGravity"; on: boolean }
| { type: "SetPinned"; ids: Set<string> }
| { type: "ReplacePinnedSet"; ids: Set<string> }
| { type: "BeginDrag"; nodeId: string }
| { type: "DragTarget"; nodeId: string; targetWorld: Vec3 }
| { type: "EndDrag"; nodeId: string }
| { type: "FollowNode"; nodeId: string | null }