import { isGraphNodeAttachmentV1, type GraphAttachmentAssignmentFailureV1, type GraphDimensionsV1,
  type GraphDocumentV1, type GraphAttachmentSlotsStateV1, type GraphNodeAttachmentV1, type Vec3 } from '../../../contracts/v1/index.ts';
import { AttachmentSlots, type AttachmentEndpoint } from './AttachmentSlots.ts';
import { angularSpringStiffnessV1 } from './ConnectionAngles.ts';

/** Shared admission rules for live physics and staged graph edits. */
export function activeAttachmentPatterns(document: GraphDocumentV1,
  overrides?: Readonly<Record<string, GraphNodeAttachmentV1 | null>>): Map<string, GraphNodeAttachmentV1> {
  const patterns = new Map<string, GraphNodeAttachmentV1>();
  for (const node of document.nodes) {
    const requested = overrides && Object.prototype.hasOwnProperty.call(overrides, node.id) ? overrides[node.id] : node.attachment;
    const pattern = requested === null ? undefined : isGraphNodeAttachmentV1(requested) ? requested : node.attachment;
    if (pattern?.enabled === true && (pattern.count ?? 1) > 1 && (pattern.rigidity === 'locked' || angularSpringStiffnessV1(pattern) > 0)) patterns.set(node.id, pattern);
  }
  return patterns;
}

function endpoints(document: GraphDocumentV1): AttachmentEndpoint[] {
  return document.edges.flatMap(edge => [
    { edgeId: edge.id, ownerId: edge.sourceId, neighborId: edge.targetId, endpoint: 'source' as const, slot: edge.attachment?.sourceSlot },
    { edgeId: edge.id, ownerId: edge.targetId, neighborId: edge.sourceId, endpoint: 'target' as const, slot: edge.attachment?.targetSlot },
  ]);
}

function neighbors(document: GraphDocumentV1): Map<string, string[]> {
  const connected = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    if (edge.sourceId === edge.targetId) continue;
    for (const [owner, neighbor] of [[edge.sourceId, edge.targetId], [edge.targetId, edge.sourceId]]) {
      const group = connected.get(owner) ?? new Set<string>(); group.add(neighbor); connected.set(owner, group);
    }
  }
  return new Map([...connected].map(([id, group]) => [id, [...group].sort()]));
}

/** Runs on private coordinates and private slot state, without advancing or mutating the live world. */
export function strictAttachmentFailures(document: GraphDocumentV1, context: {
  readonly dimensions: GraphDimensionsV1;
  readonly positions: Readonly<Record<string, Vec3>>;
  readonly pinnedNodeIds: readonly string[];
  readonly layoutEnabled: boolean;
  readonly previous?: { readonly document: GraphDocumentV1; readonly positions: Readonly<Record<string, Vec3>>; readonly slots: unknown };
}): GraphAttachmentAssignmentFailureV1[] {
  const strict = new Set(document.nodes.filter(node => node.attachment?.enabled === true && node.attachment.assignment === 'strict').map(node => node.id));
  if (!strict.size) return [];
  const slots = new AttachmentSlots(context.dimensions);
  const pinned = new Set(context.pinnedNodeIds), mobile = (id: string) => !pinned.has(id);
  const copy = (positions: Readonly<Record<string, Vec3>>) => Object.fromEntries(Object.entries(positions).map(([id, point]) => [id, { ...point }]));
  if (context.previous && context.layoutEnabled) {
    slots.restore(context.previous.slots);
    slots.prepare(activeAttachmentPatterns(context.previous.document), neighbors(context.previous.document), copy(context.previous.positions), mobile, endpoints(context.previous.document));
  }
  const requests = endpoints(document);
  if (context.layoutEnabled) slots.prepare(activeAttachmentPatterns(document), neighbors(document), copy(context.positions), mobile, requests);
  return attachmentFailuresFromState(document, slots.snapshot(), context.layoutEnabled);
}

export function attachmentFailuresFromState(document: GraphDocumentV1, snapshot: GraphAttachmentSlotsStateV1, layoutEnabled = true): GraphAttachmentAssignmentFailureV1[] {
  const strict = new Set(document.nodes.filter(node => node.attachment?.enabled === true && node.attachment.assignment === 'strict').map(node => node.id));
  if (!strict.size) return [];
  return endpoints(document).filter(endpoint => strict.has(endpoint.ownerId)).flatMap(endpoint => {
    const owner = snapshot.owners[endpoint.ownerId];
    const status = snapshot.requests?.find(request => request.edgeId === endpoint.edgeId && request.endpoint === endpoint.endpoint)?.status;
    const binding = owner?.bindings.find(binding => binding.neighborId === endpoint.neighborId);
    if (layoutEnabled && (endpoint.slot === undefined ? binding !== undefined : status === 'bound')) return [];
    const reason: GraphAttachmentAssignmentFailureV1['reason'] = !layoutEnabled ? 'layout-unavailable'
      : status && status !== 'bound' ? status : !owner ? 'inactive'
        : owner.bindings.length >= owner.count ? 'occupied' : 'unbound';
    return [{ edgeId: endpoint.edgeId, endpoint: endpoint.endpoint, ownerId: endpoint.ownerId, neighborId: endpoint.neighborId,
      ...(endpoint.slot === undefined ? {} : { requestedSlot: endpoint.slot }), reason,
      message: `Attachment ${endpoint.edgeId}.${endpoint.endpoint} on node ${endpoint.ownerId} could not be assigned (${reason}).`,
    }];
  });
}
