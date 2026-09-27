import type { GraphViewStateV1, Vec3 } from '../../contracts/v1/index.ts';

/** The graph subjects Ego presently holds in conscious activity. */
export interface Awareness {
  readonly nodeIds: ReadonlySet<string>;
  readonly centroid?: Vec3;
}

/** Ego owns Awareness and no presentation, interaction, or camera policy. */
export interface Ego {
  readonly awareness: Awareness;
}

export function resolveAwareness(options: {
  readonly viewState: Pick<GraphViewStateV1, 'selectedNodeIds'>;
  readonly positions: Readonly<Record<string, Vec3>>;
}): Awareness {
  const nodeIds = new Set(options.viewState.selectedNodeIds.filter((nodeId) => options.positions[nodeId] !== undefined));
  const positions = [...nodeIds].map((nodeId) => options.positions[nodeId] as Vec3);
  if (positions.length === 0) return { nodeIds };
  const total = positions.reduce((sum, position) => ({
    x: sum.x + position.x,
    y: sum.y + position.y,
    z: sum.z + position.z,
  }), { x: 0, y: 0, z: 0 });
  return {
    nodeIds,
    centroid: {
      x: total.x / positions.length,
      y: total.y / positions.length,
      z: total.z / positions.length,
    },
  };
}

export function createEgo(options: Parameters<typeof resolveAwareness>[0]): Ego {
  return { awareness: resolveAwareness(options) };
}
