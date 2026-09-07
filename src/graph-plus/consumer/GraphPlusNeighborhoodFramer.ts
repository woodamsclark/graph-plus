import type {
  GraphDocumentV1,
  GraphSessionV1,
  Vec3,
} from '../../graph-engine/contracts/v1/index.ts';

interface GraphPlusNeighborhoodFramerOptionsV1 {
  readonly container: HTMLElement;
  readonly getSession: () => GraphSessionV1 | undefined;
  readonly getDocument: () => GraphDocumentV1 | undefined;
  readonly getVisibleNodeIds?: () => ReadonlySet<string> | undefined;
}

interface GraphPlusNeighborhoodFrameOptionsV1 {
  readonly minimumRadius?: number;
  readonly followSettling?: boolean;
}

/**
 * Keeps camera framing derived from Graph+ focus semantics while leaving the
 * engine's camera primitive topology-agnostic.
 */
export class GraphPlusNeighborhoodFramerV1 {
  private timer?: number;
  private generation = 0;

  constructor(private readonly options: GraphPlusNeighborhoodFramerOptionsV1) {}

  async frame(nodeId: string, options?: GraphPlusNeighborhoodFrameOptionsV1): Promise<void> {
    this.cancel();
    const session = this.options.getSession();
    const document = this.options.getDocument();
    if (!session || !document || !document.nodes.some((node) => node.id === nodeId)) return;
    const framedNodeIds = neighborhoodNodeIds(document, nodeId, this.options.getVisibleNodeIds?.());
    const generation = this.generation;
    await session.fitNodes(framedNodeIds, {
      centerNodeId: nodeId,
      ...(options?.minimumRadius === undefined ? {} : { minimumRadius: options.minimumRadius }),
    });
    if (generation !== this.generation) return;
    if (options?.followSettling === false) return;
    this.followSettlingPositions(nodeId, framedNodeIds, generation);
  }

  cancel(): void {
    this.generation += 1;
    if (this.timer === undefined) return;
    this.options.container.ownerDocument.defaultView?.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private followSettlingPositions(
    nodeId: string,
    framedNodeIds: readonly string[],
    generation: number,
  ): void {
    const window = this.options.container.ownerDocument.defaultView;
    if (!window) return;
    let previous: Readonly<Record<string, Vec3>> | undefined;
    let stableSamples = 0;
    let sampleCount = 0;
    const sample = async (): Promise<void> => {
      this.timer = undefined;
      const session = this.options.getSession();
      const document = this.options.getDocument();
      if (!session || !document || generation !== this.generation) return;
      if (!document.nodes.some((node) => node.id === nodeId)) return;
      const state = await session.exportViewState();
      if (generation !== this.generation || state.focusedNodeId !== nodeId) return;
      const positions = selectPositions(state.positions, framedNodeIds);
      const movement = previous ? maximumMovement(previous, positions) : Number.POSITIVE_INFINITY;
      previous = positions;
      stableSamples = movement <= 0.75 ? stableSamples + 1 : 0;
      sampleCount += 1;
      await session.fitNodes(framedNodeIds, { centerNodeId: nodeId });
      if (generation !== this.generation || stableSamples >= 3 || sampleCount >= 25) return;
      this.timer = window.setTimeout(() => { void sample(); }, 120);
    };
    this.timer = window.setTimeout(() => { void sample(); }, 120);
  }
}

export function neighborhoodNodeIds(
  document: GraphDocumentV1,
  focusedNodeId: string,
  visibleNodeIds?: ReadonlySet<string>,
): readonly string[] {
  const included = new Set<string>();
  if (!visibleNodeIds || visibleNodeIds.has(focusedNodeId)) included.add(focusedNodeId);
  for (const edge of document.edges) {
    const neighbor = edge.sourceId === focusedNodeId
      ? edge.targetId
      : edge.targetId === focusedNodeId
        ? edge.sourceId
        : undefined;
    if (neighbor && (!visibleNodeIds || visibleNodeIds.has(neighbor))) included.add(neighbor);
  }
  return [...included];
}

function selectPositions(
  positions: Readonly<Record<string, Vec3>>,
  nodeIds: readonly string[],
): Readonly<Record<string, Vec3>> {
  return Object.fromEntries(nodeIds.flatMap((nodeId) => {
    const position = positions[nodeId];
    return position ? [[nodeId, position]] : [];
  }));
}

function maximumMovement(
  previous: Readonly<Record<string, Vec3>>,
  next: Readonly<Record<string, Vec3>>,
): number {
  let maximum = 0;
  for (const [nodeId, position] of Object.entries(next)) {
    const prior = previous[nodeId];
    if (!prior) return Number.POSITIVE_INFINITY;
    maximum = Math.max(maximum, Math.hypot(
      position.x - prior.x,
      position.y - prior.y,
      position.z - prior.z,
    ));
  }
  return Object.keys(previous).length === Object.keys(next).length
    ? maximum
    : Number.POSITIVE_INFINITY;
}
