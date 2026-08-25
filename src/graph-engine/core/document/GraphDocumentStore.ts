import {
  assertGraphDocumentV1,
  cloneGraphDocumentV1,
  validateGraphDocumentV1,
  type ApplyGraphPatchResultV1,
  type Disposable,
  type GraphDocumentV1,
  type GraphEdgeV1,
  type GraphNodeV1,
  type GraphPatchErrorV1,
  type GraphPatchOperationV1,
  type GraphPatchV1,
} from '../../contracts/v1/index.ts';

export interface CoreGraphChangedEventV1 {
  readonly documentId: string;
  readonly previousRevision: number;
  readonly revision: number;
  readonly patch?: GraphPatchV1;
  readonly cause: 'patch' | 'replace-document';
}

export class GraphDocumentStore {
  private document: GraphDocumentV1;
  private nodeIds: Set<string>;
  private readonly listeners = new Set<(event: CoreGraphChangedEventV1) => void>();

  constructor(document: GraphDocumentV1) {
    this.document = cloneGraphDocumentV1(document);
    this.nodeIds = new Set(this.document.nodes.map((node) => node.id));
  }

  get documentId(): string {
    return this.document.documentId;
  }

  get revision(): number {
    return this.document.revision;
  }

  exportDocument(): GraphDocumentV1 {
    return cloneGraphDocumentV1(this.document);
  }

  /**
   * Returns the engine-owned canonical document for internal runtime work.
   * This reference must never cross a public session or consumer boundary.
   */
  readDocument(): GraphDocumentV1 {
    return this.document;
  }

  hasNode(nodeId: string): boolean {
    return this.nodeIds.has(nodeId);
  }

  replaceDocument(document: GraphDocumentV1): void {
    const next = cloneGraphDocumentV1(document);
    const previousRevision = this.document.revision;
    this.document = next;
    this.nodeIds = new Set(next.nodes.map((node) => node.id));
    this.emit({
      documentId: next.documentId,
      previousRevision,
      revision: next.revision,
      cause: 'replace-document',
    });
  }

  applyPatch(patch: GraphPatchV1): ApplyGraphPatchResultV1 {
    const headerError = validatePatchHeader(patch);
    if (headerError) return rejected(this.document.revision, patchIdOf(patch), headerError);
    if (patch.baseRevision !== this.document.revision) {
      return rejected(this.document.revision, patch.patchId, {
        code: 'stale-revision',
        message: `Patch revision ${patch.baseRevision} does not match active revision ${this.document.revision}.`,
      });
    }

    const nodes = new Map(this.document.nodes.map((node) => [node.id, cloneNode(node)] as const));
    const edges = new Map(this.document.edges.map((edge) => [edge.id, cloneEdge(edge)] as const));

    for (let index = 0; index < patch.operations.length; index += 1) {
      const operation = patch.operations[index];
      const operationError = applyOperation(operation, nodes, edges);
      if (operationError) {
        return rejected(this.document.revision, patch.patchId, { ...operationError, operationIndex: index });
      }
    }

    const previousRevision = this.document.revision;
    const next: GraphDocumentV1 = {
      schemaVersion: 1,
      documentId: this.document.documentId,
      revision: previousRevision + 1,
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    };
    const validation = validateGraphDocumentV1(next);
    if (!validation.valid) {
      return rejected(previousRevision, patch.patchId, {
        code: 'invalid-value',
        message: validation.errors.map((entry) => `${entry.path}: ${entry.message}`).join('; '),
      });
    }

    const storedPatch = clonePatch(patch);
    this.document = cloneGraphDocumentV1(next);
    this.nodeIds = new Set(next.nodes.map((node) => node.id));
    this.emit({
      documentId: next.documentId,
      previousRevision,
      revision: next.revision,
      patch: storedPatch,
      cause: 'patch',
    });
    return {
      applied: true,
      previousRevision,
      revision: next.revision,
      patchId: patch.patchId,
    };
  }

  onChanged(listener: (event: CoreGraphChangedEventV1) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(event: CoreGraphChangedEventV1): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

function applyOperation(
  operation: GraphPatchOperationV1,
  nodes: Map<string, GraphNodeV1>,
  edges: Map<string, GraphEdgeV1>,
): GraphPatchErrorV1 | null {
  if (!operation || typeof operation !== 'object' || typeof (operation as { type?: unknown }).type !== 'string') {
    return { code: 'invalid-operation', message: 'Patch operation must be an object with a type.' };
  }

  switch (operation.type) {
    case 'add-node': {
      const error = validateStandaloneNode(operation.node);
      if (error) return error;
      if (nodes.has(operation.node.id)) return duplicate('node', operation.node.id);
      nodes.set(operation.node.id, cloneNode(operation.node));
      return null;
    }
    case 'replace-node': {
      const error = validateStandaloneNode(operation.node);
      if (error) return error;
      if (!nodes.has(operation.node.id)) return missing('node', operation.node.id);
      nodes.set(operation.node.id, cloneNode(operation.node));
      return null;
    }
    case 'remove-node': {
      if (!isNonEmptyId(operation.nodeId) || typeof operation.removeIncidentEdges !== 'boolean') {
        return { code: 'invalid-operation', message: 'remove-node requires a node ID and explicit incident-edge policy.' };
      }
      if (!nodes.has(operation.nodeId)) return missing('node', operation.nodeId);
      const incident = [...edges.values()].filter(
        (edge) => edge.sourceId === operation.nodeId || edge.targetId === operation.nodeId,
      );
      if (incident.length && !operation.removeIncidentEdges) {
        return {
          code: 'dangling-edge',
          message: `Removing node "${operation.nodeId}" would leave ${incident.length} incident edge(s).`,
        };
      }
      nodes.delete(operation.nodeId);
      if (operation.removeIncidentEdges) {
        for (const edge of incident) edges.delete(edge.id);
      }
      return null;
    }
    case 'add-edge': {
      const error = validateStandaloneEdge(operation.edge, nodes);
      if (error) return error;
      if (edges.has(operation.edge.id)) return duplicate('edge', operation.edge.id);
      edges.set(operation.edge.id, cloneEdge(operation.edge));
      return null;
    }
    case 'replace-edge': {
      const error = validateStandaloneEdge(operation.edge, nodes);
      if (error) return error;
      if (!edges.has(operation.edge.id)) return missing('edge', operation.edge.id);
      edges.set(operation.edge.id, cloneEdge(operation.edge));
      return null;
    }
    case 'remove-edge': {
      if (!isNonEmptyId(operation.edgeId)) {
        return { code: 'invalid-operation', message: 'remove-edge requires a non-empty edge ID.' };
      }
      if (!edges.has(operation.edgeId)) return missing('edge', operation.edgeId);
      edges.delete(operation.edgeId);
      return null;
    }
    default:
      return { code: 'invalid-operation', message: `Unknown patch operation "${String((operation as { type?: unknown }).type)}".` };
  }
}

function validateStandaloneNode(node: unknown): GraphPatchErrorV1 | null {
  const result = validateGraphDocumentV1({
    schemaVersion: 1,
    documentId: 'validation',
    revision: 0,
    nodes: [node],
    edges: [],
  });
  if (result.valid) return null;
  return {
    code: 'invalid-value',
    message: result.errors.map((entry) => `${entry.path}: ${entry.message}`).join('; '),
  };
}

function validateStandaloneEdge(
  edge: unknown,
  nodes: ReadonlyMap<string, GraphNodeV1>,
): GraphPatchErrorV1 | null {
  if (!edge || typeof edge !== 'object') {
    return { code: 'invalid-value', message: 'Edge must be an object.' };
  }
  const candidate = edge as GraphEdgeV1;
  if (!nodes.has(candidate.sourceId) || !nodes.has(candidate.targetId)) {
    return {
      code: 'dangling-edge',
      message: `Edge "${candidate.id}" refers to a missing endpoint.`,
    };
  }
  const result = validateGraphDocumentV1({
    schemaVersion: 1,
    documentId: 'validation',
    revision: 0,
    nodes: [...nodes.values()],
    edges: [candidate],
  });
  if (result.valid) return null;
  return {
    code: 'invalid-value',
    message: result.errors.map((entry) => `${entry.path}: ${entry.message}`).join('; '),
  };
}

function validatePatchHeader(patch: GraphPatchV1): GraphPatchErrorV1 | null {
  if (!patch || typeof patch !== 'object') return { code: 'invalid-operation', message: 'Patch must be an object.' };
  if (patch.schemaVersion !== 1) return { code: 'invalid-operation', message: 'Expected patch schema version 1.' };
  if (!isNonEmptyId(patch.patchId)) return { code: 'invalid-operation', message: 'Patch ID must be a non-empty string.' };
  if (!Number.isSafeInteger(patch.baseRevision) || patch.baseRevision < 0) {
    return { code: 'invalid-value', message: 'Patch base revision must be a non-negative safe integer.' };
  }
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    return { code: 'invalid-operation', message: 'Patch operations must be a non-empty array.' };
  }
  return null;
}

function clonePatch(patch: GraphPatchV1): GraphPatchV1 {
  return {
    schemaVersion: 1,
    patchId: patch.patchId,
    baseRevision: patch.baseRevision,
    operations: patch.operations.map((operation) => {
      switch (operation.type) {
        case 'add-node': return { type: 'add-node', node: cloneNode(operation.node) };
        case 'replace-node': return { type: 'replace-node', node: cloneNode(operation.node) };
        case 'remove-node': return { ...operation };
        case 'add-edge': return { type: 'add-edge', edge: cloneEdge(operation.edge) };
        case 'replace-edge': return { type: 'replace-edge', edge: cloneEdge(operation.edge) };
        case 'remove-edge': return { ...operation };
      }
    }),
  };
}

function cloneNode(node: GraphNodeV1): GraphNodeV1 {
  return cloneGraphDocumentV1({
    schemaVersion: 1,
    documentId: 'clone',
    revision: 0,
    nodes: [node],
    edges: [],
  }).nodes[0];
}

function cloneEdge(edge: GraphEdgeV1): GraphEdgeV1 {
  const placeholderNodes = [...new Set([edge.sourceId, edge.targetId])].map((id) => ({ id }));
  return cloneGraphDocumentV1({
    schemaVersion: 1,
    documentId: 'clone',
    revision: 0,
    nodes: placeholderNodes,
    edges: [edge],
  }).edges[0];
}

function duplicate(kind: 'node' | 'edge', id: string): GraphPatchErrorV1 {
  return { code: 'duplicate-id', message: `Duplicate ${kind} ID "${id}".` };
}

function missing(kind: 'node' | 'edge', id: string): GraphPatchErrorV1 {
  return {
    code: kind === 'node' ? 'missing-node' : 'missing-edge',
    message: `Missing ${kind} "${id}".`,
  };
}

function rejected(revision: number, patchId: string, error: GraphPatchErrorV1): ApplyGraphPatchResultV1 {
  return { applied: false, revision, patchId, error };
}

function patchIdOf(patch: unknown): string {
  return patch && typeof patch === 'object' && typeof (patch as { patchId?: unknown }).patchId === 'string'
    ? (patch as { patchId: string }).patchId
    : '';
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createGraphDocumentStore(document: GraphDocumentV1): GraphDocumentStore {
  assertGraphDocumentV1(document);
  return new GraphDocumentStore(document);
}
