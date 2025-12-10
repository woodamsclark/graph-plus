// utils/defaultSettings.ts
import type { Settings } from './Interfaces.ts';

export const DEFAULT_SETTINGS: Settings = {
  graph: {
    minNodeRadius      : 3,
    maxNodeRadius      : 20,
    minCenterAlpha     : 0.1,
    maxCenterAlpha     : 0.6,
    highlightDepth     : 1,
    focusSmoothing     : 0.8,
    nodeColor          : undefined, // use theme
    tagColor           : undefined,
    labelColor         : undefined,
    edgeColor          : undefined,
    nodeColorAlpha     : 0.1,
    tagColorAlpha      : 0.1,
    labelBaseFontSize  : 24,
    labelFadeRangePx   : 8,
    labelColorAlpha    : 1.0,
    labelRadius        : 30,
    useInterfaceFont   : true,
    edgeColorAlpha     : 0.1,
    countDuplicateLinks: true,
    drawDoubleLines    : true,
    showTags           : true,
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
    gravityRadius       : 6,
    gravityFallOff      : 3,
    mouseGravityRadius  : 15, // change later if you want
    mouseGravityStrength: 1,
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
    cameraAnimDuration: 300,
    state: {
      yaw     : Math.PI / 6,
      pitch   : Math.PI / 8,
      distance: 1200,
      targetX : 0,
      targetY : 0,
      targetZ : 0,
      offsetX : 0,
      offsetY : 0,
    },
  },

  nodePositions: {}, // Record<string, {x:number;y:number;z:number}> or whatever your type is
};
