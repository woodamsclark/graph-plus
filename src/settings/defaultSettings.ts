// utils/defaultSettings.ts
import type { GraphPlusSettings } from '../shared/interfaces.ts';

export const DEFAULT_SETTINGS: GraphPlusSettings = {
  graph: {
    minNodeRadius      : 3,
    maxNodeRadius      : 20,
    nodeColor          : undefined,
    tagColor           : undefined,
    edgeColor          : undefined,
    backgroundColor    : undefined,
    labelColor         : undefined,
    labelFontSize  : 12,
    labelRevealRadius  : 100,
    useInterfaceFont   : true,
    countDuplicateLinks: true,
    drawDoubleLines    : true,
    showTags           : true,
    showLabels         : true,
    hoverScale         : 1.0,
    useCenterNote      : false,
    centerNoteTitle    : '',
    useOutlinkFallback : false,
  },

  physics: {
    repulsionStrength   : 5000,
    springStrength      : 1,
    springLength        : 100,
    centerPull          : 0.001,
    damping             : 0.7,
    notePlaneStiffness  : 0,
    tagPlaneStiffness   : 0,
    mouseGravityEnabled : true,
    mouseGravityRadius  : 15,
    mouseGravityStrength: 10,
    mouseGravityExponent: 2,
    worldCenterX        : 0,
    worldCenterY        : 0,
    worldCenterZ        : 0,
  },

  camera: {
    momentumScale     : 0.12,
    dragThreshold     : 4,
    rotateSensitivityX: 0.005,
    rotateSensitivityY: 0.005,
    zoomSensitivity   : 5,
    cameraAnimDuration: 300,
    state: {
      yaw     : 0,
      pitch   : 0,
      distance: 1200,
      targetX : 0,
      targetY : 0,
      targetZ : 0,
      offsetX : 0,
      offsetY : 0,
      offsetZ : 0,
      orbitVelX: 0,
      orbitVelY: 0,
      panVelX  : 0,
      panVelY  : 0,
      zoomVel  : 0,
    },
  },

  nodePositions: {}, // Record<string, {x:number;y:number;z:number}> or whatever your type is
};
