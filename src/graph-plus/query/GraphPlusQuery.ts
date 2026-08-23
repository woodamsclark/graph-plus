import type {
  GraphDocumentV1,
  GraphFilterAstV1,
  GraphFilterRequestV1,
  GraphNodeV1,
  GraphSettingsOverridesV1,
} from '../../graph-engine/contracts/v1/index.ts';

type QueryNode =
  | { readonly kind: 'predicate'; readonly value: string }
  | { readonly kind: 'not'; readonly child: QueryNode }
  | { readonly kind: 'and'; readonly children: readonly QueryNode[] }
  | { readonly kind: 'or'; readonly children: readonly QueryNode[] };

export interface GraphPlusLensStateV1 {
  readonly query: string;
  readonly showTags: boolean;
  readonly showOrphans: boolean;
  readonly display: {
    readonly labelMode?: 'adaptive' | 'all' | 'off';
    readonly nodeRadiusScale?: number;
    readonly edgeThicknessScale?: number;
  };
  readonly force: {
    readonly repulsionStrength?: number;
    readonly springStrength?: number;
    readonly springLength?: number;
    readonly centeringStrength?: number;
  };
  readonly form: {
    readonly enabled: boolean;
    readonly rootNodeId?: string;
    readonly direction: 'incoming' | 'outgoing' | 'either';
    readonly relation?: string;
    readonly maxDepth?: number;
    readonly showCrossLinks: boolean;
    readonly showDisconnected: boolean;
    readonly colorBranches: boolean;
  };
}

export interface CompiledGraphPlusFilterV1 {
  readonly request: GraphFilterRequestV1;
  readonly visibleNodeIds: readonly string[];
  readonly error?: string;
}

export function createDefaultGraphPlusLensV1(showTags = true): GraphPlusLensStateV1 {
  return {
    query: '',
    showTags,
    showOrphans: true,
    display: {},
    force: {},
    form: {
      enabled: false,
      direction: 'either',
      showCrossLinks: false,
      showDisconnected: false,
      colorBranches: true,
    },
  };
}

export function compileGraphPlusFilterV1(
  document: GraphDocumentV1,
  lens: GraphPlusLensStateV1,
): CompiledGraphPlusFilterV1 {
  try {
    const query = parseQuery(lens.query);
    const connected = connectedNodeIds(document);
    const ids = document.nodes
      .filter((node) => lens.showTags || node.attributes?.kind !== 'tag')
      .filter((node) => lens.showOrphans || connected.has(node.id))
      .filter((node) => query === undefined || evaluate(query, node))
      .map((node) => node.id);
    return {
      request: {
        schemaVersion: 1,
        scope: 'projection',
        node: { op: 'id-in', ids },
      },
      visibleNodeIds: ids,
    };
  } catch (error) {
    return {
      request: { schemaVersion: 1, scope: 'projection', node: { op: 'all' } },
      visibleNodeIds: document.nodes.map((node) => node.id),
      error: error instanceof Error ? error.message : 'Invalid filter.',
    };
  }
}

export function graphPlusSessionOverridesV1(lens: GraphPlusLensStateV1): GraphSettingsOverridesV1 {
  return {
    modules: {
      form: {
        enabled: lens.form.enabled,
        settings: {
          ...(lens.form.rootNodeId ? { rootNodeId: lens.form.rootNodeId } : {}),
          direction: lens.form.direction,
          ...(lens.form.relation ? { edgeToken: `relation:${lens.form.relation}` } : {}),
          ...(lens.form.maxDepth === undefined ? {} : { maxDepth: lens.form.maxDepth }),
          showCrossLinks: lens.form.showCrossLinks,
          showDisconnected: lens.form.showDisconnected,
          colorBranches: lens.form.colorBranches,
        },
      },
      rendering: {
        settings: {
          ...(lens.display.labelMode === undefined ? {} : { labelMode: lens.display.labelMode }),
          ...(lens.display.nodeRadiusScale === undefined ? {} : { nodeRadiusScale: lens.display.nodeRadiusScale }),
          ...(lens.display.edgeThicknessScale === undefined ? {} : { edgeThicknessScale: lens.display.edgeThicknessScale }),
        },
      },
      'force-layout': {
        settings: {
          ...(lens.force.repulsionStrength === undefined ? {} : { repulsionStrength: lens.force.repulsionStrength }),
          ...(lens.force.springStrength === undefined ? {} : { springStrength: lens.force.springStrength }),
          ...(lens.force.springLength === undefined ? {} : { springLength: lens.force.springLength }),
          ...(lens.force.centeringStrength === undefined ? {} : { centeringStrength: lens.force.centeringStrength }),
        },
      },
    },
  };
}

function parseQuery(source: string): QueryNode | undefined {
  const query = source.trim();
  if (!query) return undefined;
  const tokens = tokenize(query);
  let index = 0;
  const parseOr = (): QueryNode => {
    const children = [parseAnd()];
    while (tokens[index]?.toUpperCase() === 'OR') {
      index += 1;
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };
  const parseAnd = (): QueryNode => {
    const children: QueryNode[] = [];
    while (index < tokens.length && tokens[index] !== ')' && tokens[index].toUpperCase() !== 'OR') {
      if (tokens[index].toUpperCase() === 'AND') { index += 1; continue; }
      children.push(parseUnary());
    }
    if (children.length === 0) throw new Error('Expected a filter term.');
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };
  const parseUnary = (): QueryNode => {
    const token = tokens[index];
    if (!token) throw new Error('Expected a filter term.');
    if (token === '-') { index += 1; return { kind: 'not', child: parseUnary() }; }
    if (token.startsWith('-') && token.length > 1) {
      index += 1;
      return { kind: 'not', child: { kind: 'predicate', value: token.slice(1) } };
    }
    if (token === '(') {
      index += 1;
      const child = parseOr();
      if (tokens[index] !== ')') throw new Error('Missing closing parenthesis.');
      index += 1;
      return child;
    }
    if (token === ')') throw new Error('Unexpected closing parenthesis.');
    index += 1;
    return { kind: 'predicate', value: token };
  };
  const root = parseOr();
  if (index < tokens.length) throw new Error(`Unexpected term: ${tokens[index]}`);
  return root;
}

function evaluate(query: QueryNode, node: GraphNodeV1): boolean {
  if (query.kind === 'not') return !evaluate(query.child, node);
  if (query.kind === 'and') return query.children.every((child) => evaluate(child, node));
  if (query.kind === 'or') return query.children.some((child) => evaluate(child, node));
  return matchPredicate(node, query.value);
}

function matchPredicate(node: GraphNodeV1, raw: string): boolean {
  const token = stripQuotes(raw).trim().toLowerCase();
  if (!token) return true;
  if (token.startsWith('[') && token.endsWith(']')) {
    const body = token.slice(1, -1);
    const separator = body.indexOf(':');
    const key = separator < 0 ? body : body.slice(0, separator).trim();
    const attribute = node.attributes?.[`property:${key}`];
    if (separator < 0) return attribute !== undefined;
    const value = stripQuotes(body.slice(separator + 1)).trim();
    return contains(attribute, value);
  }
  const separator = token.indexOf(':');
  if (separator > 0) {
    const operator = token.slice(0, separator);
    const value = stripQuotes(token.slice(separator + 1));
    switch (operator) {
      case 'file': return contains(node.label, value) || contains(node.attributes?.path, value);
      case 'path': return contains(node.attributes?.path, value);
      case 'tag': return contains(node.attributes?.tags, normalizeTag(value));
      case 'type': return node.attributes?.kind === value;
      case 'ext':
      case 'extension': return node.attributes?.extension === value.replace(/^\./, '');
      default: return false;
    }
  }
  if (token.startsWith('/') && token.endsWith('/') && token.length > 2) {
    return new RegExp(token.slice(1, -1), 'i').test(String(node.attributes?.searchText ?? ''));
  }
  return contains(node.attributes?.searchText, token);
}

function connectedNodeIds(document: GraphDocumentV1): Set<string> {
  return new Set(document.edges.flatMap((edge) => [edge.sourceId, edge.targetId]));
}

function contains(value: unknown, search: string): boolean {
  if (Array.isArray(value)) return value.some((candidate) => String(candidate).toLowerCase().includes(search));
  return String(value ?? '').toLowerCase().includes(search);
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  let bracketDepth = 0;
  const flush = (): void => {
    if (current.trim()) tokens.push(current.trim());
    current = '';
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === quote && source[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (bracketDepth === 0 && (character === '(' || character === ')')) { flush(); tokens.push(character); continue; }
    if (bracketDepth === 0 && /\s/.test(character)) { flush(); continue; }
    current += character;
  }
  if (quote) throw new Error('Unclosed quote.');
  if (bracketDepth) throw new Error('Unclosed property filter.');
  flush();
  return tokens;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]
    ? trimmed.slice(1, -1).toLowerCase()
    : trimmed.toLowerCase();
}

function normalizeTag(value: string): string {
  return value.replace(/^tag:/, '').replace(/^#/, '').toLowerCase();
}

export function graphPlusFilterAstForIdsV1(ids: readonly string[]): GraphFilterAstV1 {
  return { op: 'id-in', ids };
}
