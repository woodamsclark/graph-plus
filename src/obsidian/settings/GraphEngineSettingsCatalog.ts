import type { JsonValue } from '../../graph-engine/contracts/v1/index.ts';

export type GraphSettingCategoryV1 = 'appearance' | 'layout-motion';
export type GraphSettingControlV1 =
  | { readonly type: 'toggle' }
  | { readonly type: 'select'; readonly options: Readonly<Record<string, string>> }
  | {
      readonly type: 'slider';
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly unit?: string;
      /** Multiplies a displayed value before it is stored. */
      readonly storageScale?: number;
      /** Raises a displayed value to this power before applying storageScale. */
      readonly storageExponent?: number;
    };

export interface GraphSettingPresentationV1 {
  readonly id: string;
  readonly category: GraphSettingCategoryV1;
  readonly moduleId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly control: GraphSettingControlV1;
  readonly scopes: readonly ('global' | 'profile' | 'quick')[];
}

/**
 * One intentionally small, user-facing vocabulary shared by Settings, profile
 * customization, and Quick Settings. Solver internals deliberately do not appear.
 */
export const GRAPH_SETTING_PRESENTATIONS_V1: readonly GraphSettingPresentationV1[] = [
  entry('rendering.renderQuality', 'appearance', 'rendering', 'renderQuality', 'Render quality', 'Balance sharpness and energy use.',
    { type: 'select', options: { automatic: 'Automatic', 'high-fidelity': 'High fidelity', 'energy-saver': 'Energy saver' } },
    ['global', 'profile']),
  entry('rendering.labelMode', 'appearance', 'rendering', 'labelMode', 'Labels', 'Choose when labels are shown.',
    { type: 'select', options: { adaptive: 'Adaptive', all: 'All', off: 'Off' } }),
  entry('anima.labelPosition', 'appearance', 'anima', 'labelPosition', 'Label position', 'Place labels above or below nodes.',
    { type: 'select', options: { above: 'Above', below: 'Below' } }),
  entry('anima.adaptiveLabelThreshold2d', 'appearance', 'anima', 'adaptiveLabelThreshold2d', '2D label saliency', 'Higher values keep labels closer to the most visually salient nodes in 2D.',
    { type: 'slider', min: 0, max: 100, step: 5 }),
  entry('anima.adaptiveLabelThreshold3d', 'appearance', 'anima', 'adaptiveLabelThreshold3d', '3D label saliency', 'Higher values keep labels closer to the most visually salient nodes in 3D.',
    { type: 'slider', min: 0, max: 100, step: 5 }),
  entry('rendering.nodeRadiusScale', 'appearance', 'rendering', 'nodeRadiusScale', 'Node size', 'Scale all node sizes.',
    { type: 'slider', min: 0.5, max: 4, step: 0.1 }),
  entry('rendering.edgeThicknessScale', 'appearance', 'rendering', 'edgeThicknessScale', 'Link thickness', 'Scale all link widths.',
    { type: 'slider', min: 0.1, max: 5, step: 0.05 }),
  entry('rendering.showArrows', 'appearance', 'rendering', 'showArrows', 'Link arrows', 'Show link direction arrows.',
    { type: 'toggle' }),
  entry('node-regions.boundariesVisible', 'appearance', 'node-regions', 'boundariesVisible', 'Region boundaries', 'Show region boundary shapes in 2D.',
    { type: 'toggle' }),

  entry('force-layout.centeringStrength', 'layout-motion', 'force-layout', 'centeringStrength', 'Center force', 'Pull the graph toward its center.',
    { type: 'slider', min: 0, max: 1, step: 0.001 }),
  entry('force-layout.repulsionStrength', 'layout-motion', 'force-layout', 'repulsionStrength', 'Repel force', 'Push nodes apart.',
    { type: 'slider', min: 0, max: 1, step: 0.001, storageScale: 50000, storageExponent: 2 }),
  entry('force-layout.springStrength', 'layout-motion', 'force-layout', 'springStrength', 'Link force', 'Control how strongly links pull connected nodes together.',
    { type: 'slider', min: 0, max: 1, step: 0.001, storageScale: 5, storageExponent: 2 }),
  entry('force-layout.springLength', 'layout-motion', 'force-layout', 'springLength', 'Link distance', 'Set the preferred spacing of linked nodes.',
    { type: 'slider', min: 20, max: 500, step: 5 }),
  entry('force-layout.velocityDecay', 'layout-motion', 'force-layout', 'velocityDecay', 'Velocity decay', '0 keeps all motion; higher values calm movement sooner.',
    { type: 'slider', min: 0, max: 0.9, step: 0.05 }),
  entry('force-layout.collisionRadius', 'layout-motion', 'force-layout', 'collisionRadius', 'Collision spacing', 'Keep nearby nodes from overlapping.',
    { type: 'slider', min: 0, max: 200, step: 5 }),
  entry('force-layout.axialSpringAxis', 'layout-motion', 'force-layout', 'axialSpringAxis', 'Axial spring', 'Flatten 3D layout toward a world plane.',
    { type: 'select', options: { off: 'Off', x: 'X', y: 'Y', z: 'Z' } }),
  entry('force-layout.axialSpringStiffness', 'layout-motion', 'force-layout', 'axialSpringStiffness', 'Axial stiffness', 'Control how strongly 3D layout flattens.',
    { type: 'slider', min: 0, max: 90, step: 5, unit: '%', storageScale: 0.01 }),
  entry('node-regions.membershipStrength', 'layout-motion', 'node-regions', 'membershipStrength', 'Region attraction', 'Pull nodes toward their assigned regions.',
    { type: 'slider', min: 0, max: 2, step: 0.01 }),
] as const;

const BY_ID = new Map(GRAPH_SETTING_PRESENTATIONS_V1.map((value) => [value.id, value]));

export function graphSettingPresentationV1(id: string): GraphSettingPresentationV1 {
  const value = BY_ID.get(id);
  if (!value) throw new Error(`Unknown graph setting presentation "${id}".`);
  return value;
}

export function graphSettingDisplayValueV1(
  presentation: GraphSettingPresentationV1,
  value: JsonValue | undefined,
): JsonValue | undefined {
  if (presentation.control.type !== 'slider' || typeof value !== 'number') return value;
  const scaled = value / (presentation.control.storageScale ?? 1);
  return Math.pow(scaled, 1 / (presentation.control.storageExponent ?? 1));
}

export function graphSettingStoredValueV1(
  presentation: GraphSettingPresentationV1,
  value: JsonValue,
): JsonValue {
  if (presentation.control.type !== 'slider' || typeof value !== 'number') return value;
  return Math.pow(value, presentation.control.storageExponent ?? 1)
    * (presentation.control.storageScale ?? 1);
}

function entry(
  id: string,
  category: GraphSettingCategoryV1,
  moduleId: string,
  key: string,
  name: string,
  description: string,
  control: GraphSettingControlV1,
  scopes: readonly ('global' | 'profile' | 'quick')[] = ['global', 'profile', 'quick'],
): GraphSettingPresentationV1 {
  return {
    id,
    category,
    moduleId,
    key,
    name,
    description,
    control,
    scopes,
  };
}
