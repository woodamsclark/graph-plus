import type { GraphViewIdV1 } from '../../graph-engine/contracts/v1/index.ts';
import type { GraphSessionControlPortV1 } from '../../graph-engine/runtime/host/GraphSessionControlPort.ts';

/** Resolve clearing against the experience's available Views and consumer actions. */
export function resolveClearConstellationActionV1(
  availableViews: readonly GraphViewIdV1[],
  selectedNodeIds: readonly string[],
  controls: Pick<GraphSessionControlPortV1, 'navigateView' | 'resolveNodeActions' | 'invokeNodeAction'>,
): (() => void) | undefined {
  if (selectedNodeIds.length === 0) return undefined;
  if (availableViews.includes('overview')) {
    return () => controls.navigateView('clear-constellation');
  }
  // Focus-only consumers own the minimum Attention subject they must retain.
  const member = selectedNodeIds.find(nodeId =>
    controls.resolveNodeActions(['clear-constellation'], nodeId).length > 0);
  return member === undefined ? undefined : () => { controls.invokeNodeAction('clear-constellation', member); };
}
