import { PointerKind } from "../../types/domain/ui.ts";

export type BaseSettings = {
  minNodeRadius:        number;
  maxNodeRadius:        number;
  labelFontSize:        number;
  labelRevealRadius:    number;
  hoverScale:           number;
  nodeColor?:           string;
  tagColor?:            string;
  linkColor?:           string;
  backgroundColor?:     string;
  labelColor?:          string;
  useInterfaceFont:     boolean;
  countDuplicateLinks:  boolean;
  drawDoubleLines:      boolean;
  showTags:             boolean;
  showLabels:           boolean;
};

export type LayoutSettings = {
  linkLength:           number;
  linkStrength:         number;
  centerPull:           number;
  notePlaneStiffness:   number;
  tagPlaneStiffness:    number;
  worldCenterX:         number;
  worldCenterY:         number;
  worldCenterZ:         number;
};

export type PhysicsSettings = {
  repulsionStrength:    number;
  damping:              number;
  mouseGravityEnabled:  boolean;
  mouseGravityRadius:   number;
  mouseGravityStrength: number;
  mouseGravityExponent: number;
};

export type CameraSettings = {
  momentumScale:        number;
  rotateSensitivityX:   number;
  rotateSensitivityY:   number;
  zoomSensitivity:      number;
  minDistance:          number;
  maxDistance:          number;
  minPitch:             number;
  maxPitch:             number;
  initialState: {
    yaw:        number;
    pitch:      number;
    distance:   number;
    targetX:    number;
    targetY:    number;
    targetZ:    number;
    offsetX:    number;
    offsetY:    number;
    offsetZ:    number;
    rotateVelX: number;
    rotateVelY: number;
    panVelX:    number;
    panVelY:    number;
    zoomVel:    number;
  };
};

//export type PointerKind = "mouse" | "touch" | "pen";

export type UISettings = {
  longPressMs:      number;
  dragThresholdPx:  number;
  doubleClickMs:    number;
  longPressPointerKinds: PointerKind[];
};

export type TuningSettings = {
  linkThicknessScale:       number;
  linkThicknessMin:         number;
  nodeDegreeRadiusScale:    number;
  initialJitter:            number;
  labelOffsetY:             number;
  pinchThresholdPx:         number;
  rotateThresholdRad:       number;
  repulsionMinDistance:     number;
  barnesHutTheta:           number;
  barnesHutEpsilon:         number;
  mouseGravityPaddingWorld: number;
};

export type GraphPlusSettings = {
  base:     BaseSettings;
  layout:   LayoutSettings;
  physics:  PhysicsSettings;
  camera:   CameraSettings;
  ui:       UISettings;
  tuning:   TuningSettings;
};