import { App, TFile, CachedMetadata } from 'obsidian';

export interface VisualSettings {
  minNodeRadius        : number;
  maxNodeRadius        : number;
  minCenterAlpha       : number;
  maxCenterAlpha       : number;
  highlightDepth       : number;  // screen-space label reveal radius (× size)
  focusSmoothing       : number;
  nodeColor?           : string;   // optional color overrides (CSS color strings). If unset, theme vars are used.
  nodeColorAlpha       : number;
  tagColor?            : string;
  tagColorAlpha        : number;
  edgeColor?           : string;
  edgeColorAlpha       : number;
  labelColor?          : string;
  labelColorAlpha      : number;
  labelBaseFontSize    : number;
  labelFadeRangePx     : number;
  labelRadius          : number;
  useInterfaceFont     : boolean;
}

export interface PhysicsSettings {
  repulsionStrength    : number;
  springStrength       : number;
  springLength         : number;
  centerPull           : number;
  damping              : number;
  notePlaneStiffness   : number;
  tagPlaneStiffness    : number;
  centerX              : number;
  centerY              : number;
  centerZ              : number;
  mouseGravityEnabled  : boolean;
  gravityRadius        : number;   // scales per-node screen radius
  gravityFallOff       : number;   // falloff steepness
}

export interface Settings {
  visuals              : VisualSettings;
  physics              : PhysicsSettings;
  countDuplicateLinks  : boolean;
  mutualLinkDoubleLine : boolean;
  interaction: {
    momentumScale      : number;
    dragThreshold      : number; // in screen pixels
    rotateSensitivityX : number;
    rotateSensitivityY : number;
  };
  // persistent node positions keyed by vault name, then by file path
  // settings.nodePositions[vaultId][filePath] = { x, y }
  nodePositions?: Record<string, Record<string, { x: number; y: number; z?: number }>>;
  showTags?: boolean;
  usePinnedCenterNote?: boolean;
  pinnedCenterNotePath?: string;
  useOutlinkFallback?: boolean;
}

export interface RendererSettings {
  canvas: HTMLCanvasElement;
  settings: Settings
}

export interface Camera {
  yaw: number;      // rotation around Y axis
  pitch: number;    // rotation around X axis
  distance: number; // camera distance from target
  targetX: number;
  targetY: number;
  targetZ: number;
  zoom: number;     // additional zoom scalar
}

export interface Renderer {
  setGraph(graph: GraphData): void;
  resize(width: number, height: number): void;
  render(): void;
  destroy(): void;
  setHoveredNode(nodeId: string | null): void;
  getNodeRadiusForHit(node: any): number;
  setGlowSettings(visuals: VisualSettings): void;
  setHoverState(hoveredId: string | null, highlightedIds: Set<string>, mouseX: number, mouseY: number): void;
  zoomAt(screenX: number, screenY: number, factor: number): void;
  panBy(screenDx: number, screenDy: number): void;
  resetPanToCenter?(): void;
  screenToWorld2D(screenX: number, screenY: number): { x: number; y: number };
  screenToWorld3D?(screenX: number, screenY: number, zCam: number, cam: Camera): { x: number; y: number; z: number };
  setRenderOptions?(opts: { mutualDoubleLines?: boolean; showTags?: boolean }): void;
  // projection helpers for hit-testing
  getNodeScreenPosition?(node: any): { x: number; y: number };
  getProjectedNode?(node: any): { x: number; y: number; depth: number };
  getScale?(): number;
  // camera controls
  setCamera?(cam: Partial<Camera>): void;
  getCamera?(): Camera;
  getCameraBasis?(cam: Camera): { right: { x: number; y: number; z: number }; up: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } };
}
export type GraphNodeType = 'note' | 'tag';

export interface GraphNode {
  id            : string;
  label         : string;
  x             : number;
  y             : number;
  z             : number;
  filePath      : string;
  file?         : TFile;
  vx?           : number;
  vy?           : number;
  vz?           : number;
  type?         : GraphNodeType;
  inDegree      : number;
  outDegree     : number;
  totalDegree   : number;
  isCenterNode? : boolean;
}

export interface GraphEdge {
  id?           : string;
  sourceId      : string;
  targetId      : string;
  linkCount?    : number;
  bidirectional?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Simulation {
  start(): void;
  stop(): void;
  tick(dt: number): void;
  reset(): void;
  setOptions(opts: Partial<SimulationSettings>): void;
  // pinned node control: prevent physics from moving these nodes
  setPinnedNodes?(ids: Set<string>): void;
  // allow the controller to provide mouse world coords and hovered node id
  setMouseAttractor?(x: number | null, y: number | null, nodeId: string | null): void;
}

export interface SimulationSettings {
  repulsionStrength   : number;
  springStrength      : number;
  springLength        : number;
  centerPull          : number;
  damping             : number;
  // 3D center point
  centerX?            : number;
  centerY?            : number;
  centerZ?            : number;
  centerNodeId?       : string;
  // plane constraint stiffness (soft springs to planes)
  notePlaneStiffness? : number;  // pull notes toward z = 0
  tagPlaneStiffness?  : number;  // pull tags toward x = 0
  // mouse attraction tuning
  mouseAttractionRadius?  : number;
  mouseAttractionStrength?: number;
  mouseAttractionExponent?: number;
}

export interface InputManagerCallbacks {
    // Camera Control
    onOrbitStart     (dx: number, dy: number): void;
    onOrbitMove      (dx: number, dy: number): void;
    onOrbitEnd       (): void;
    onPanStart       (screenX: number, screenY: number): void;
    onPanMove        (dx: number, dy: number): void;
    onPanEnd         (): void;
    onZoom           (screenX: number, screenY: number, delta: number): void;
    onFollowStart    (nodeId: string): void;
    onFollowEnd      (): void;
    resetCamera      (): void;

    // Node Interaction
    onHover         (screenX: number, screenY: number): void;
    onOpenNode      (screenX: number, screenY: number): void;

    // Node Dragging (Coordinates are relative to the screen for the simulation)
    onDragStart     (nodeId: string, screenX: number, screenY: number): void;
    onDragMove      (screenX: number, screenY: number): void;
    onDragEnd       (): void;

    // Utility
    detectClickedNode   (screenX: number, screenY: number): { id: string, filePath?: string, label: string } | null;
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
