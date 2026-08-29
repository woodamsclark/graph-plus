export interface ObsidianSearchDocumentV1 {
  readonly nodeId: string;
  readonly kind: 'note' | 'tag';
  readonly path: string;
  readonly basename: string;
  readonly extension: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly properties: Readonly<Record<string, readonly string[]>>;
}

export type ObsidianSearchIndexV1 = ReadonlyMap<string, ObsidianSearchDocumentV1>;

type QueryNode =
  | { readonly kind: 'predicate'; readonly value: string }
  | { readonly kind: 'not'; readonly child: QueryNode }
  | { readonly kind: 'and'; readonly children: readonly QueryNode[] }
  | { readonly kind: 'or'; readonly children: readonly QueryNode[] };

export interface ObsidianSearchCompatibilityQueryV1 {
  matches(document: ObsidianSearchDocumentV1): boolean;
}

/**
 * Compiles the documented, public Obsidian Search syntax used by Graph view.
 * This deliberately avoids Obsidian's undocumented internal search objects.
 */
export function compileObsidianSearchCompatibilityV1(
  source: string,
): ObsidianSearchCompatibilityQueryV1 | undefined {
  const root = parseQuery(source);
  if (!root) return undefined;
  return {
    matches: (document) => evaluate(root, document, false),
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
      if (tokens[index].toUpperCase() === 'AND') {
        index += 1;
        continue;
      }
      children.push(parseUnary());
    }
    if (children.length === 0) throw new Error('Expected a search term.');
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };
  const parseUnary = (): QueryNode => {
    const token = tokens[index];
    if (!token) throw new Error('Expected a search term.');
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
  return root;
}

function evaluate(
  query: QueryNode,
  document: ObsidianSearchDocumentV1,
  caseSensitive: boolean,
): boolean {
  if (query.kind === 'not') return !evaluate(query.child, document, caseSensitive);
  if (query.kind === 'and') return query.children.every((child) => evaluate(child, document, caseSensitive));
  if (query.kind === 'or') return query.children.some((child) => evaluate(child, document, caseSensitive));
  return matchPredicate(document, query.value, caseSensitive);
}

function matchPredicate(
  document: ObsidianSearchDocumentV1,
  raw: string,
  caseSensitive: boolean,
): boolean {
  const token = raw.trim();
  if (!token) return true;
  if (token.startsWith('[') && token.endsWith(']')) {
    return matchProperty(document, token.slice(1, -1), caseSensitive);
  }
  const separator = token.indexOf(':');
  if (separator > 0) {
    const operator = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1);
    switch (operator) {
      case 'file':
        return matchText(document.basename, value, caseSensitive)
          || matchText(fileName(document.path), value, caseSensitive);
      case 'path': return matchText(document.path, value, caseSensitive);
      case 'content': return matchText(document.content, value, caseSensitive);
      case 'tag': return document.tags.some((tag) => equalText(tag, normalizeTag(stripQuotes(value)), caseSensitive));
      case 'line': return document.content.split(/\r?\n/).some((line) => matchText(line, value, caseSensitive));
      case 'block': return document.content.split(/(?:\r?\n){2,}/).some((block) => matchText(block, value, caseSensitive));
      case 'section': return splitSections(document.content).some((section) => matchText(section, value, caseSensitive));
      case 'task': return taskLines(document.content).some((line) => matchText(line, value, caseSensitive));
      case 'task-todo': return taskLines(document.content, false).some((line) => matchText(line, value, caseSensitive));
      case 'task-done': return taskLines(document.content, true).some((line) => matchText(line, value, caseSensitive));
      case 'match-case': return matchText(searchableText(document), value, true);
      case 'ignore-case': return matchText(searchableText(document), value, false);
      // Retain the old Graph+ aliases for saved filters while using Obsidian semantics elsewhere.
      case 'type': return equalText(document.kind, stripQuotes(value), caseSensitive);
      case 'ext':
      case 'extension': return equalText(document.extension, stripQuotes(value).replace(/^\./, ''), caseSensitive);
      default: return false;
    }
  }
  return matchText(searchableText(document), token, caseSensitive);
}

function matchProperty(
  document: ObsidianSearchDocumentV1,
  body: string,
  caseSensitive: boolean,
): boolean {
  const separator = body.indexOf(':');
  const key = stripQuotes(separator < 0 ? body : body.slice(0, separator)).trim().toLowerCase();
  if (!key) return false;
  const values = document.properties[key];
  if (separator < 0) return values !== undefined;
  if (!values) return false;
  const search = body.slice(separator + 1).trim();
  return values.some((value) => matchText(value, search, caseSensitive));
}

function matchText(text: string, rawSearch: string, caseSensitive: boolean): boolean {
  const search = rawSearch.trim();
  if (!search) return true;
  if (isRegex(search)) {
    const expression = parseRegex(search, caseSensitive);
    return expression.test(text);
  }
  const term = stripQuotes(search);
  return caseSensitive
    ? text.includes(term)
    : text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

function equalText(left: string, right: string, caseSensitive: boolean): boolean {
  return caseSensitive ? left === right : left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function searchableText(document: ObsidianSearchDocumentV1): string {
  return `${document.path}\n${document.basename}\n${document.content}`;
}

function taskLines(content: string, completed?: boolean): readonly string[] {
  return content.split(/\r?\n/).filter((line) => {
    const match = /^\s*[-*+]\s+\[([^\]])\]\s*/.exec(line);
    if (!match) return false;
    if (completed === undefined) return true;
    return completed ? match[1].toLowerCase() === 'x' : match[1] === ' ';
  });
}

function splitSections(content: string): readonly string[] {
  const sections: string[] = [];
  let current = '';
  for (const line of content.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line) && current) {
      sections.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  let bracketDepth = 0;
  let regex = false;
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
    if (regex) {
      current += character;
      if (character === '/' && source[index - 1] !== '\\') regex = false;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '/' && (!current || current.endsWith(':'))) {
      regex = true;
      current += character;
      continue;
    }
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (bracketDepth === 0 && (character === '(' || character === ')')) {
      flush();
      tokens.push(character);
      continue;
    }
    if (bracketDepth === 0 && /\s/.test(character)) {
      flush();
      continue;
    }
    current += character;
  }
  if (quote) throw new Error('Unclosed quote.');
  if (regex) throw new Error('Unclosed regular expression.');
  if (bracketDepth) throw new Error('Unclosed property search.');
  flush();
  return tokens;
}

function parseRegex(value: string, caseSensitive: boolean): RegExp {
  const lastSlash = value.lastIndexOf('/');
  const pattern = value.slice(1, lastSlash);
  const suppliedFlags = value.slice(lastSlash + 1);
  const flags = caseSensitive || suppliedFlags.includes('i') ? suppliedFlags : `${suppliedFlags}i`;
  return new RegExp(pattern, [...new Set(flags)].join(''));
}

function isRegex(value: string): boolean {
  return value.startsWith('/') && value.lastIndexOf('/') > 0;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]
    ? trimmed.slice(1, -1)
    : trimmed;
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function normalizeTag(value: string): string {
  return value.replace(/^tag:/i, '').replace(/^#/, '').trim();
}
