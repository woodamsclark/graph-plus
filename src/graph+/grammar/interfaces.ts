import { TFile } from 'obsidian';

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
  cameraAnimDuration    : number;
  focalLengthPx         : number;
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

export type NodeType = 'note' | 'tag' | 'canvas'; // canvas nodes is a future feature 01-01-2026

type location = { x     : number;  y        : number;       z : number  };
type velocity = { vx    : number;  vy       : number;       vz: number  };



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

export type ScreenPt = { x: number; y: number };
export type ClientPt = { x: number; y: number };


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

// --- Tickable Interface ------------------------------------------------------

export interface Tickable {
  tick(dt: number, nowMs: number): void;
}

/*export type WorldState = {
  graph: GraphData | null;
  camera: CameraController;
  interaction: InteractionState;
};*/


// --- Interaction State & Events ----------------------------------------------

export type Vec2 = { x: number; y: number };

export type InteractionState = {
  gravityCenter: Vec2 | null;
  hoveredNodeId: string | null;
  followedNodeId: string | null;
  draggedNodeId: string | null;
  isPanning: boolean;
  isRotating: boolean;
};

export type InteractionEvent =
  | { type: "OPEN_NODE_REQUESTED"; node: Node }
  | { type: "PINNED_SET"; ids: Set<string> }
  | { type: "MOUSE_GRAVITY_SET"; on: boolean };


export interface InteractionSystem extends Tickable {
  getState(): Readonly<InteractionState>;
  ingest(events: InputEvent[]): void;        // optional if you drain internally
  drainEvents(): InteractionEvent[];
  // optional: cursorType if you want renderer/cursor to query it
  getCursorType(): string;
}

export type InputEvent =
  | { type: "MOUSE_MOVE"; x: number; y: number }
  | { type: "DRAG_START"; nodeId: string; x: number; y: number }
  | { type: "DRAG_MOVE"; x: number; y: number }
  | { type: "DRAG_END" }
  | { type: "PAN_START"; x: number; y: number }
  | { type: "PAN_MOVE"; x: number; y: number }
  | { type: "PAN_END" }
  | { type: "ROTATE_START"; x: number; y: number }
  | { type: "ROTATE_MOVE"; x: number; y: number }
  | { type: "ROTATE_END" }
  | { type: "ZOOM"; x: number; y: number; delta: number }
  | { type: "OPEN_NODE"; x: number; y: number }
  | { type: "FOLLOW_START"; nodeId: string }
  | { type: "FOLLOW_END" }
  | { type: "RESET_CAMERA" };


// --- Renderer System ---------------------------------------------------------

export interface RendererSystem extends Tickable{
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
