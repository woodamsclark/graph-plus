import type { GraphAttributeValue, GraphScalar, Vec3 } from './values.ts';

export interface GraphDocumentV1 {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly revision: number;
  readonly nodes: readonly GraphNodeV1[];
  readonly edges: readonly GraphEdgeV1[];
}

export interface GraphNodeV1 {
  readonly id: string;
  readonly label?: string;
  readonly tokens?: readonly string[];
  readonly attributes?: Readonly<Record<string, GraphAttributeValue>>;
  readonly positionHint?: Vec3;
}

export interface GraphEdgeV1 {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly directed?: boolean;
  readonly weight?: number;
  readonly tokens?: readonly string[];
  readonly attributes?: Readonly<Record<string, GraphAttributeValue>>;
}

export type GraphDocumentValidationCodeV1 =
  | 'invalid-schema-version'
  | 'invalid-document-id'
  | 'invalid-revision'
  | 'invalid-node'
  | 'invalid-edge'
  | 'duplicate-node-id'
  | 'duplicate-edge-id'
  | 'dangling-edge'
  | 'invalid-value';

export interface GraphDocumentValidationErrorV1 {
  readonly code: GraphDocumentValidationCodeV1;
  readonly path: string;
  readonly message: string;
}

export type GraphDocumentValidationResultV1 =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly GraphDocumentValidationErrorV1[] };

export interface GraphDocumentBuilderV1 {
  addNode(node: GraphNodeV1): this;
  addEdge(edge: GraphEdgeV1): this;
  build(options: { documentId: string; revision?: number }): GraphDocumentV1;
}

export class InvalidGraphDocumentErrorV1 extends Error {
  readonly errors: readonly GraphDocumentValidationErrorV1[];

  constructor(errors: readonly GraphDocumentValidationErrorV1[]) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join('; '));
    this.name = 'InvalidGraphDocumentErrorV1';
    this.errors = errors;
  }
}

export function validateGraphDocumentV1(value: unknown): GraphDocumentValidationResultV1 {
  const errors: GraphDocumentValidationErrorV1[] = [];
  if (!isRecord(value)) {
    return invalid('invalid-value', '$', 'Graph document must be an object.');
  }
  validateKnownKeys(value, ['schemaVersion', 'documentId', 'revision', 'nodes', 'edges'], '$', errors);

  if (value.schemaVersion !== 1) {
    errors.push(error('invalid-schema-version', '$.schemaVersion', 'Expected schema version 1.'));
  }
  validateId(value.documentId, '$.documentId', 'invalid-document-id', errors);
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    errors.push(error('invalid-revision', '$.revision', 'Revision must be a non-negative safe integer.'));
  }

  const nodes = Array.isArray(value.nodes) ? value.nodes : null;
  const edges = Array.isArray(value.edges) ? value.edges : null;
  if (!nodes) errors.push(error('invalid-node', '$.nodes', 'Nodes must be an array.'));
  if (!edges) errors.push(error('invalid-edge', '$.edges', 'Edges must be an array.'));

  const nodeIds = new Set<string>();
  for (let index = 0; index < (nodes?.length ?? 0); index += 1) {
    const node = nodes![index];
    const path = `$.nodes[${index}]`;
    if (!isRecord(node)) {
      errors.push(error('invalid-node', path, 'Node must be an object.'));
      continue;
    }
    validateKnownKeys(node, ['id', 'label', 'tokens', 'attributes', 'positionHint'], path, errors);
    const idValid = validateId(node.id, `${path}.id`, 'invalid-node', errors);
    if (idValid) {
      if (nodeIds.has(node.id as string)) {
        errors.push(error('duplicate-node-id', `${path}.id`, `Duplicate node ID "${node.id as string}".`));
      }
      nodeIds.add(node.id as string);
    }
    validateOptionalString(node, 'label', path, errors, 'invalid-node');
    validateOptionalTokens(node, path, errors, 'invalid-node');
    validateOptionalAttributes(node, path, errors, 'invalid-node');
    if (node.positionHint !== undefined) validateVec3(node.positionHint, `${path}.positionHint`, errors);
  }

  const edgeIds = new Set<string>();
  const validEdges: Array<{ edge: Record<string, unknown>; path: string }> = [];
  for (let index = 0; index < (edges?.length ?? 0); index += 1) {
    const edge = edges![index];
    const path = `$.edges[${index}]`;
    if (!isRecord(edge)) {
      errors.push(error('invalid-edge', path, 'Edge must be an object.'));
      continue;
    }
    validateKnownKeys(edge, ['id', 'sourceId', 'targetId', 'directed', 'weight', 'tokens', 'attributes'], path, errors);
    const idValid = validateId(edge.id, `${path}.id`, 'invalid-edge', errors);
    if (idValid) {
      if (edgeIds.has(edge.id as string)) {
        errors.push(error('duplicate-edge-id', `${path}.id`, `Duplicate edge ID "${edge.id as string}".`));
      }
      edgeIds.add(edge.id as string);
    }
    const sourceValid = validateId(edge.sourceId, `${path}.sourceId`, 'invalid-edge', errors);
    const targetValid = validateId(edge.targetId, `${path}.targetId`, 'invalid-edge', errors);
    if (edge.directed !== undefined && typeof edge.directed !== 'boolean') {
      errors.push(error('invalid-edge', `${path}.directed`, 'Directed must be a boolean.'));
    }
    if (edge.weight !== undefined && !isFiniteNumber(edge.weight)) {
      errors.push(error('invalid-value', `${path}.weight`, 'Weight must be finite.'));
    }
    validateOptionalTokens(edge, path, errors, 'invalid-edge');
    validateOptionalAttributes(edge, path, errors, 'invalid-edge');
    if (sourceValid && targetValid) validEdges.push({ edge, path });
  }

  for (const { edge, path } of validEdges) {
    if (!nodeIds.has(edge.sourceId as string)) {
      errors.push(error('dangling-edge', `${path}.sourceId`, `Missing source node "${edge.sourceId as string}".`));
    }
    if (!nodeIds.has(edge.targetId as string)) {
      errors.push(error('dangling-edge', `${path}.targetId`, `Missing target node "${edge.targetId as string}".`));
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

export function assertGraphDocumentV1(value: unknown): asserts value is GraphDocumentV1 {
  const result = validateGraphDocumentV1(value);
  if (!result.valid) throw new InvalidGraphDocumentErrorV1(result.errors);
}

export function cloneGraphDocumentV1(document: GraphDocumentV1): GraphDocumentV1 {
  assertGraphDocumentV1(document);
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    revision: document.revision,
    nodes: document.nodes.map(cloneNode),
    edges: document.edges.map(cloneEdge),
  };
}

export function createGraphDocumentBuilderV1(): GraphDocumentBuilderV1 {
  const nodes: GraphNodeV1[] = [];
  const edges: GraphEdgeV1[] = [];
  return {
    addNode(node) {
      nodes.push(cloneNode(node));
      return this;
    },
    addEdge(edge) {
      edges.push(cloneEdge(edge));
      return this;
    },
    build(options) {
      const document: GraphDocumentV1 = {
        schemaVersion: 1,
        documentId: options.documentId,
        revision: options.revision ?? 0,
        nodes: nodes.map(cloneNode),
        edges: edges.map(cloneEdge),
      };
      assertGraphDocumentV1(document);
      return document;
    },
  };
}

function cloneNode(node: GraphNodeV1): GraphNodeV1 {
  return {
    id: node.id,
    ...(node.label === undefined ? {} : { label: node.label }),
    ...(node.tokens === undefined ? {} : { tokens: [...node.tokens] }),
    ...(node.attributes === undefined ? {} : { attributes: cloneAttributes(node.attributes) }),
    ...(node.positionHint === undefined ? {} : { positionHint: { ...node.positionHint } }),
  };
}

function cloneEdge(edge: GraphEdgeV1): GraphEdgeV1 {
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    ...(edge.directed === undefined ? {} : { directed: edge.directed }),
    ...(edge.weight === undefined ? {} : { weight: edge.weight }),
    ...(edge.tokens === undefined ? {} : { tokens: [...edge.tokens] }),
    ...(edge.attributes === undefined ? {} : { attributes: cloneAttributes(edge.attributes) }),
  };
}

function cloneAttributes(attributes: Readonly<Record<string, GraphAttributeValue>>): Record<string, GraphAttributeValue> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
}

function validateOptionalString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: GraphDocumentValidationErrorV1[],
  code: GraphDocumentValidationCodeV1,
): void {
  if (value[key] !== undefined && typeof value[key] !== 'string') {
    errors.push(error(code, `${path}.${key}`, `${key} must be a string.`));
  }
}

function validateOptionalTokens(
  value: Record<string, unknown>,
  path: string,
  errors: GraphDocumentValidationErrorV1[],
  code: GraphDocumentValidationCodeV1,
): void {
  if (value.tokens === undefined) return;
  if (!Array.isArray(value.tokens) || value.tokens.some((token) => typeof token !== 'string')) {
    errors.push(error(code, `${path}.tokens`, 'Tokens must be an array of strings.'));
  }
}

function validateOptionalAttributes(
  value: Record<string, unknown>,
  path: string,
  errors: GraphDocumentValidationErrorV1[],
  code: GraphDocumentValidationCodeV1,
): void {
  if (value.attributes === undefined) return;
  if (!isRecord(value.attributes)) {
    errors.push(error(code, `${path}.attributes`, 'Attributes must be an object.'));
    return;
  }
  for (const [key, attribute] of Object.entries(value.attributes)) {
    if (!isGraphAttributeValue(attribute)) {
      errors.push(error('invalid-value', `${path}.attributes.${key}`, 'Attribute must be a scalar or scalar array.'));
    }
  }
}

function validateVec3(value: unknown, path: string, errors: GraphDocumentValidationErrorV1[]): void {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) {
    errors.push(error('invalid-value', path, 'Position must contain finite x, y, and z numbers.'));
    return;
  }
  validateKnownKeys(value, ['x', 'y', 'z'], path, errors);
}

function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: GraphDocumentValidationErrorV1[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(error('invalid-value', `${path}.${key}`, `Unknown public graph field "${key}".`));
    }
  }
}

function validateId(
  value: unknown,
  path: string,
  code: GraphDocumentValidationCodeV1,
  errors: GraphDocumentValidationErrorV1[],
): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(error(code, path, 'ID must be a non-empty string.'));
    return false;
  }
  return true;
}

function isGraphAttributeValue(value: unknown): value is GraphAttributeValue {
  if (isGraphScalar(value)) return true;
  return Array.isArray(value) && value.every(isGraphScalar);
}

function isGraphScalar(value: unknown): value is GraphScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function error(
  code: GraphDocumentValidationCodeV1,
  path: string,
  message: string,
): GraphDocumentValidationErrorV1 {
  return { code, path, message };
}

function invalid(
  code: GraphDocumentValidationCodeV1,
  path: string,
  message: string,
): GraphDocumentValidationResultV1 {
  return { valid: false, errors: [error(code, path, message)] };
}
