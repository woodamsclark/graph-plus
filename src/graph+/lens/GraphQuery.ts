import type { Node } from '../types/domain/graph.ts';

type QueryNode =
  | { kind: 'predicate'; value: string }
  | { kind: 'not'; child: QueryNode }
  | { kind: 'and'; children: QueryNode[] }
  | { kind: 'or'; children: QueryNode[] };

export type CompiledGraphQuery = {
  matches: (node: Node) => boolean;
  error?: string;
};

export function compileGraphQuery(source: string): CompiledGraphQuery {
  const query = source.trim();
  if (!query) return { matches: () => true };

  try {
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
        if (tokens[index].toUpperCase() === 'AND') {
          index += 1;
          continue;
        }
        children.push(parseUnary());
      }
      if (!children.length) throw new Error('Expected a filter term.');
      return children.length === 1 ? children[0] : { kind: 'and', children };
    };

    const parseUnary = (): QueryNode => {
      const token = tokens[index];
      if (!token) throw new Error('Expected a filter term.');
      if (token === '-') {
        index += 1;
        return { kind: 'not', child: parseUnary() };
      }
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
    return { matches: (node) => evaluate(root, node) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid filter.';
    return { matches: () => true, error: message };
  }
}

function evaluate(query: QueryNode, node: Node): boolean {
  if (query.kind === 'not') return !evaluate(query.child, node);
  if (query.kind === 'and') return query.children.every((child) => evaluate(child, node));
  if (query.kind === 'or') return query.children.some((child) => evaluate(child, node));
  return matchPredicate(node, query.value);
}

function matchPredicate(node: Node, raw: string): boolean {
  const token = stripQuotes(raw).trim().toLowerCase();
  if (!token) return true;

  if (token.startsWith('[') && token.endsWith(']')) {
    const body = token.slice(1, -1);
    const separator = body.indexOf(':');
    if (separator < 0) return Object.prototype.hasOwnProperty.call(node.facets.properties, body);
    const key = body.slice(0, separator).trim();
    const value = stripQuotes(body.slice(separator + 1)).trim();
    return (node.facets.properties[key] ?? []).some((candidate) => candidate.includes(value));
  }

  const separator = token.indexOf(':');
  if (separator > 0) {
    const operator = token.slice(0, separator);
    const value = stripQuotes(token.slice(separator + 1));
    switch (operator) {
      case 'file':
        return node.label.toLowerCase().includes(value) || (node.facets.path ?? '').toLowerCase().includes(value);
      case 'path':
        return (node.facets.path ?? '').toLowerCase().includes(value);
      case 'tag':
        return node.facets.tags.some((tag) => tag.includes(normalizeTag(value)));
      case 'type':
        return node.type === value;
      case 'ext':
      case 'extension':
        return (node.facets.extension ?? '').toLowerCase() === value.replace(/^\./, '');
      default:
        return false;
    }
  }

  if (token.startsWith('/') && token.endsWith('/') && token.length > 2) {
    try {
      return new RegExp(token.slice(1, -1), 'i').test(node.facets.searchText);
    } catch {
      return false;
    }
  }

  return node.facets.searchText.includes(token);
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  let bracketDepth = 0;

  const flush = () => {
    const value = current.trim();
    if (value) tokens.push(value);
    current = '';
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      current += char;
      if (char === quote && source[i - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (bracketDepth === 0 && (char === '(' || char === ')')) {
      flush();
      tokens.push(char);
      continue;
    }
    if (bracketDepth === 0 && /\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }

  if (quote) throw new Error('Unclosed quote.');
  if (bracketDepth) throw new Error('Unclosed property filter.');
  flush();
  return tokens;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && last === first) return trimmed.slice(1, -1).toLowerCase();
  return trimmed.toLowerCase();
}

function normalizeTag(value: string): string {
  return value.replace(/^tag:/, '').replace(/^#/, '').toLowerCase();
}
