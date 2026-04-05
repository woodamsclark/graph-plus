import type { GraphPlusSettings } from "../../graph+/types/settings/appSettings.ts";

export const DEFAULT_SETTINGS: GraphPlusSettings = {
  base: {
    minNodeRadius:        3,
    maxNodeRadius:        20,
    nodeColor:            undefined,
    tagColor:             undefined,
    linkColor:            undefined,
    backgroundColor:      undefined,
    labelColor:           undefined,
    labelFontSize:        12,
    useInterfaceFont:     true,
    countDuplicateLinks:  false,
    drawDoubleLines:      false,
    showTags:             true,
    showLabels:           true,
  },

  layout: {
    linkLength: 100,
    linkStrength: 1,
    centerPull: 0.001,
    notePlaneStiffness: 0,
    tagPlaneStiffness: 0,
    worldCenterX: 0,
    worldCenterY: 0,
    worldCenterZ: 0,
  },

  physics: {
    repulsionStrength: 5000,
    damping: 0.5,
    mouseGravityEnabled: true,
    mouseGravityRadius: 15,
    mouseGravityStrength: 10,
    mouseGravityExponent: 2,
  },

  camera: {
    momentumScale: 0.12,
    rotateSensitivityX: 0.005,
    rotateSensitivityY: 0.005,
    zoomSensitivity: 20,
    minDistance: 300,
    maxDistance: 5000,
    minPitch: -Math.PI / 2 + 0.05,
    maxPitch: Math.PI / 2 - 0.05,
    initialState: {
      yaw: 0,
      pitch: 0,
      distance: 4000,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      rotateVelX: 0,
      rotateVelY: 0,
      panVelX: 0,
      panVelY: 0,
      zoomVel: 0,
    },
  },

tuning: {
  linkThickness:    .1,

  initialJitter: 50,

  labelOffsetY: 12,

  pinchThresholdPx: 2,
  rotateThresholdRad: 0,

  repulsionMinDistance: 40,
  barnesHutTheta: 0.8,
  barnesHutEpsilon: 1e-3,

  mouseGravityPaddingWorld: 4,
  },
  
  ui: {
    longPressMs: 450,
    longPressPointerKinds: ["touch", "pen"],
    dragThresholdPx: 6,
    doubleClickMs: 300,
  },
};