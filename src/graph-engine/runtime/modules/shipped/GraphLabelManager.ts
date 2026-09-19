import type { GraphDimensionsV1, JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphNodeRenderContributionV1, GraphPresentationPolicyV2 } from '../../render/index.ts';

export interface GraphLabelRequestV1 {
  readonly nodeId: string;
  /** Interaction requests may override the global off mode. */
  readonly forceVisible?: boolean;
  /** Persistent structure requests bypass the adaptive collision budget. */
  readonly alwaysVisible?: boolean;
  readonly scale?: number;
}

export interface GraphManagedLabelNodeV1 {
  readonly nodeId: string;
  readonly radius: number;
  readonly prior?: GraphNodeRenderContributionV1;
}

/**
 * Owns label eligibility, sizing, and adaptive-policy configuration. Graph and
 * interaction code submit requests; they do not directly manipulate labels.
 */
export class GraphLabelManager {
  private labelPosition: 'above' | 'below' = 'below';
  private adaptiveLabelThreshold2d = 50;
  private adaptiveLabelThreshold3d = 50;

  constructor(settings: Readonly<Record<string, JsonValue>>) {
    this.updateSettings(settings);
  }

  updateSettings(settings: Readonly<Record<string, JsonValue>>): void {
    this.labelPosition = settings.labelPosition === 'above' ? 'above' : 'below';
    this.adaptiveLabelThreshold2d = readThreshold(settings.adaptiveLabelThreshold2d, 50);
    this.adaptiveLabelThreshold3d = readThreshold(settings.adaptiveLabelThreshold3d, 50);
  }

  resolve(
    nodes: readonly GraphManagedLabelNodeV1[],
    requests: readonly GraphLabelRequestV1[],
  ): Readonly<Record<string, GraphNodeRenderContributionV1>> {
    const requestsByNode = new Map<string, GraphLabelRequestV1>();
    for (const request of requests) {
      const prior = requestsByNode.get(request.nodeId);
      requestsByNode.set(request.nodeId, {
        nodeId: request.nodeId,
        forceVisible: prior?.forceVisible === true || request.forceVisible === true,
        alwaysVisible: prior?.alwaysVisible === true || request.alwaysVisible === true,
        scale: Math.min(prior?.scale ?? 1, request.scale ?? 1),
      });
    }
    return Object.fromEntries(nodes.map(({ nodeId, radius, prior }) => {
      const request = requestsByNode.get(nodeId);
      const forceVisible = request?.forceVisible === true;
      return [nodeId, {
        labelOpacity: 1,
        showLabel: forceVisible || prior?.showLabel !== false,
        labelFontSize: (14 + radius / 4) * (request?.scale ?? 1),
        labelForceVisible: forceVisible,
        labelAlwaysVisible: prior?.labelAlwaysVisible === true || request?.alwaysVisible === true || forceVisible,
      }];
    }));
  }

  policy(dimensions: GraphDimensionsV1): GraphPresentationPolicyV2 {
    return {
      labelScaleMode: 'fixed',
      labelPosition: this.labelPosition,
      adaptiveLabelThreshold: dimensions === '3d'
        ? this.adaptiveLabelThreshold3d
        : this.adaptiveLabelThreshold2d,
    };
  }
}

function readThreshold(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}
