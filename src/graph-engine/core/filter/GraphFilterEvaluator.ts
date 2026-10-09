import type {
  GraphAttributeValue,
  GraphDocumentV1,
  GraphEdgeV1,
  GraphFilterAstV1,
  GraphFilterRequestV1,
  GraphNodeV1,
  GraphScalar,
} from '../../contracts/v1/index.ts';
import { GraphTopologyIndex } from '../document/GraphTopologyIndex.ts';

export interface GraphFilterSelectionV1 {
  readonly nodeIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
}

export interface GraphFilterValidationErrorV1 {
  readonly path: string;
  readonly message: string;
}

export class InvalidGraphFilterErrorV1 extends Error {
  readonly errors: readonly GraphFilterValidationErrorV1[];

  constructor(errors: readonly GraphFilterValidationErrorV1[]) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join('; '));
    this.name = 'InvalidGraphFilterErrorV1';
    this.errors = errors;
  }
}

export function evaluateGraphFilterV1(
  document: GraphDocumentV1,
  request: GraphFilterRequestV1,
): GraphFilterSelectionV1 {
  const errors = validateGraphFilterRequestV1(request);
  if (errors.length) throw new InvalidGraphFilterErrorV1(errors);

  // Compile once per evaluation. Topology is built only if a traversing
  // predicate actually runs; ordinary ID/text/attribute filters need none.
  let topology: GraphTopologyIndex | undefined;
  const getTopology = () => topology ??= new GraphTopologyIndex(document);
  const nodeMatches = compilePredicate(request.node, getTopology);
  const edgeMatches = compilePredicate(request.edge, getTopology);
  const nodeIds = new Set(document.nodes.filter(nodeMatches).map(node => node.id));
  const edgeIds = new Set(document.edges
    .filter(edge => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId) && edgeMatches(edge))
    .map(edge => edge.id));
  return { nodeIds, edgeIds };
}

export function validateGraphFilterRequestV1(request: unknown): readonly GraphFilterValidationErrorV1[] {
  const errors: GraphFilterValidationErrorV1[] = [];
  if (!isRecord(request)) return [{ path: '$', message: 'Filter request must be an object.' }];
  validateKnownKeys(request, ['schemaVersion', 'scope', 'node', 'edge'], '$', errors);
  if (request.schemaVersion !== 1) errors.push({ path: '$.schemaVersion', message: 'Expected schema version 1.' });
  if (request.scope !== 'render' && request.scope !== 'projection') {
    errors.push({ path: '$.scope', message: 'Scope must be render or projection.' });
  }
  if (request.node !== undefined) validateAst(request.node, '$.node', 'node', errors, 0);
  if (request.edge !== undefined) validateAst(request.edge, '$.edge', 'edge', errors, 0);
  return errors;
}

function compilePredicate(
  ast: GraphFilterAstV1 | undefined,
  getTopology: () => GraphTopologyIndex,
): (value: GraphNodeV1 | GraphEdgeV1) => boolean {
  if (!ast) return () => true;
  if (ast.op === 'id-in') {
    const ids = new Set(ast.ids);
    return value => ids.has(value.id);
  }
  if (ast.op === 'connected-to' || ast.op === 'within-depth') {
    let selection: ReadonlySet<string> | undefined;
    return value => {
      selection ??= ast.op === 'connected-to'
        ? getTopology().connected(ast.nodeIds, ast.direction ?? 'either')
        : getTopology().withinDepth(ast.rootNodeIds, ast.maxDepth, ast.direction ?? 'either');
      return selection.has(value.id);
    };
  }
  if (ast.op === 'and' || ast.op === 'or') {
    const operands = ast.operands.map(operand => compilePredicate(operand, getTopology));
    return ast.op === 'and' ? value => operands.every(match => match(value))
      : value => operands.some(match => match(value));
  }
  if (ast.op === 'not') {
    const match = compilePredicate(ast.operand, getTopology);
    return value => !match(value);
  }
  return value => evaluateLeaf(value, ast);
}

function evaluateLeaf(value: GraphNodeV1 | GraphEdgeV1, ast: GraphFilterAstV1): boolean {
  switch (ast.op) {
    case 'all': return true;
    case 'none': return false;
    case 'id-in': return false; // Compiled to Set membership above.
    case 'has-token': return value.tokens?.includes(ast.token) ?? false;
    case 'attribute-equals':
      return scalarEquals(value.attributes?.[ast.attribute], ast.value);
    case 'attribute-contains':
      return attributeContains(value.attributes?.[ast.attribute], ast.value);
    case 'attribute-number-range': {
      const candidate = value.attributes?.[ast.attribute];
      if (typeof candidate !== 'number') return false;
      return (ast.min === undefined || candidate >= ast.min) && (ast.max === undefined || candidate <= ast.max);
    }
    case 'and':
    case 'or':
    case 'not':
    case 'connected-to':
    case 'within-depth':
      return false;
  }
}

function scalarEquals(attribute: GraphAttributeValue | undefined, expected: GraphScalar): boolean {
  return !isUnknownArray(attribute) && attribute === expected;
}

function attributeContains(attribute: GraphAttributeValue | undefined, expected: GraphScalar): boolean {
  return isUnknownArray(attribute) && attribute.some((value) => value === expected);
}

function validateAst(
  value: unknown,
  path: string,
  target: 'node' | 'edge',
  errors: GraphFilterValidationErrorV1[],
  depth: number,
): void {
  if (depth > 100) {
    errors.push({ path, message: 'Filter AST exceeds maximum nesting depth.' });
    return;
  }
  if (!isRecord(value) || typeof value.op !== 'string') {
    errors.push({ path, message: 'Filter AST node must be an object with an operation.' });
    return;
  }
  switch (value.op) {
    case 'all':
    case 'none':
      validateKnownKeys(value, ['op'], path, errors);
      return;
    case 'and':
    case 'or':
      validateKnownKeys(value, ['op', 'operands'], path, errors);
      if (!isUnknownArray(value.operands)) {
        errors.push({ path: `${path}.operands`, message: 'Operands must be an array.' });
        return;
      }
      value.operands.forEach((operand, index) => validateAst(operand, `${path}.operands[${index}]`, target, errors, depth + 1));
      return;
    case 'not':
      validateKnownKeys(value, ['op', 'operand'], path, errors);
      validateAst(value.operand, `${path}.operand`, target, errors, depth + 1);
      return;
    case 'id-in':
      validateKnownKeys(value, ['op', 'ids'], path, errors);
      validateStringArray(value.ids, `${path}.ids`, errors);
      return;
    case 'has-token':
      validateKnownKeys(value, ['op', 'token'], path, errors);
      validateString(value.token, `${path}.token`, errors);
      return;
    case 'attribute-equals':
    case 'attribute-contains':
      validateKnownKeys(value, ['op', 'attribute', 'value'], path, errors);
      validateString(value.attribute, `${path}.attribute`, errors);
      if (!isGraphScalar(value.value)) errors.push({ path: `${path}.value`, message: 'Value must be a finite graph scalar.' });
      return;
    case 'attribute-number-range':
      validateKnownKeys(value, ['op', 'attribute', 'min', 'max'], path, errors);
      validateString(value.attribute, `${path}.attribute`, errors);
      validateOptionalFiniteNumber(value.min, `${path}.min`, errors);
      validateOptionalFiniteNumber(value.max, `${path}.max`, errors);
      if (typeof value.min === 'number' && typeof value.max === 'number' && value.min > value.max) {
        errors.push({ path, message: 'Numeric range minimum cannot exceed maximum.' });
      }
      return;
    case 'connected-to':
      validateKnownKeys(value, ['op', 'nodeIds', 'direction'], path, errors);
      if (target === 'edge') errors.push({ path, message: 'connected-to is valid only for node filters.' });
      validateStringArray(value.nodeIds, `${path}.nodeIds`, errors);
      validateDirection(value.direction, `${path}.direction`, errors);
      return;
    case 'within-depth':
      validateKnownKeys(value, ['op', 'rootNodeIds', 'maxDepth', 'direction'], path, errors);
      if (target === 'edge') errors.push({ path, message: 'within-depth is valid only for node filters.' });
      validateStringArray(value.rootNodeIds, `${path}.rootNodeIds`, errors);
      if (!Number.isSafeInteger(value.maxDepth) || (value.maxDepth as number) < 0) {
        errors.push({ path: `${path}.maxDepth`, message: 'Maximum depth must be a non-negative safe integer.' });
      }
      validateDirection(value.direction, `${path}.direction`, errors);
      return;
    default:
      errors.push({ path: `${path}.op`, message: `Unknown filter operation "${value.op}".` });
  }
}

function validateString(value: unknown, path: string, errors: GraphFilterValidationErrorV1[]): void {
  if (typeof value !== 'string') errors.push({ path, message: 'Expected a string.' });
}

function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: GraphFilterValidationErrorV1[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push({ path: `${path}.${key}`, message: `Unknown filter field "${key}".` });
  }
}

function validateStringArray(value: unknown, path: string, errors: GraphFilterValidationErrorV1[]): void {
  if (!isUnknownArray(value) || value.some((entry) => typeof entry !== 'string')) {
    errors.push({ path, message: 'Expected an array of strings.' });
  }
}

function validateOptionalFiniteNumber(value: unknown, path: string, errors: GraphFilterValidationErrorV1[]): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push({ path, message: 'Expected a finite number.' });
  }
}

function validateDirection(value: unknown, path: string, errors: GraphFilterValidationErrorV1[]): void {
  if (value !== undefined && value !== 'incoming' && value !== 'outgoing' && value !== 'either') {
    errors.push({ path, message: 'Direction must be incoming, outgoing, or either.' });
  }
}

function isGraphScalar(value: unknown): value is GraphScalar {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || isUnknownArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Preserve unknown element types instead of the built-in any[] narrowing. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
