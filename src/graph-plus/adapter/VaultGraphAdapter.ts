import type {
  GraphAttributeValue,
  GraphDocumentV1,
  GraphEdgeV1,
  GraphNodeRegionDefinitionV1,
  GraphNodeV1,
} from '../../graph-engine/contracts/v1/index.ts';
import { assertGraphDocumentV1 } from '../../graph-engine/contracts/v1/index.ts';
import type { ObsidianSearchDocumentV1, ObsidianSearchIndexV1 } from '../query/index.ts';
import { GraphPlusLookupV1 } from './GraphPlusLookup.ts';

export interface VaultGraphNoteV1<TFile> {
  readonly file: TFile;
  readonly path: string;
  readonly basename: string;
  readonly extension: string;
  readonly content?: string;
  readonly tags: readonly string[];
  readonly properties: Readonly<Record<string, readonly string[]>>;
  readonly frontmatterLinks?: readonly { readonly relation: string; readonly targetPath: string }[];
}

export interface VaultGraphSnapshotV1<TFile> {
  readonly vaultId: string;
  readonly notes: readonly VaultGraphNoteV1<TFile>[];
  readonly resolvedLinks: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface VaultGraphProjectionV1<TFile> {
  readonly document: GraphDocumentV1;
  readonly lookup: GraphPlusLookupV1<TFile>;
  readonly searchIndex: ObsidianSearchIndexV1;
}

export class VaultGraphAdapterV1<TFile> {
  constructor(private readonly options: { readonly countDuplicateLinks: boolean }) {}

  build(snapshot: VaultGraphSnapshotV1<TFile>, revision = 0): VaultGraphProjectionV1<TFile> {
    const lookup = new GraphPlusLookupV1<TFile>();
    const searchIndex = new Map<string, ObsidianSearchDocumentV1>();
    const tags = new Set<string>();
    const notes = [...snapshot.notes].sort((left, right) => left.path.localeCompare(right.path));
    const nodes: GraphNodeV1[] = notes.map((note) => {
      const id = noteNodeId(note.path);
      lookup.setNote(id, note.file);
      for (const tag of note.tags) for (const expanded of expandTagPath(normalizeTag(tag))) tags.add(expanded);
      const propertyTokens = Object.entries(note.properties).flatMap(([key, values]) =>
        values.map((value) => `property:${key.toLowerCase()}:${value.toLowerCase()}`));
      const attributes: Record<string, GraphAttributeValue> = {
        kind: 'note',
        path: note.path,
        extension: note.extension.toLowerCase(),
        tags: note.tags.map(normalizeTag).filter(Boolean),
      };
      for (const [key, values] of Object.entries(note.properties)) {
        attributes[`property:${key.toLowerCase()}`] = values.map((value) => value.toLowerCase());
      }
      searchIndex.set(id, {
        nodeId: id,
        kind: 'note',
        path: note.path,
        basename: note.basename,
        extension: note.extension.toLowerCase(),
        content: note.content ?? '',
        tags: note.tags.map(normalizeTag).filter(Boolean),
        properties: Object.fromEntries(Object.entries(note.properties).map(([key, values]) => [
          key.toLowerCase(),
          values.map(String),
        ])),
      });
      return {
        id,
        label: note.basename,
        tokens: ['kind:note', ...note.tags.map((tag) => `tag:${normalizeTag(tag)}`), ...propertyTokens],
        attributes,
        positionHint: stablePosition(id),
      };
    });
    for (const tag of [...tags].sort()) {
      const id = tagNodeId(tag);
      lookup.setTag(id, tag);
      searchIndex.set(id, {
        nodeId: id,
        kind: 'tag',
        path: `#${tag}`,
        basename: `#${tag}`,
        extension: '',
        content: '',
        tags: [tag],
        properties: {},
      });
      nodes.push({
        id,
        label: `#${tag}`,
        tokens: ['kind:tag', `tag:${tag}`],
        attributes: { kind: 'tag', tags: [tag] },
        positionHint: stablePosition(id),
      });
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = new Map<string, MutableEdge>();
    const regionMembers = new Map<string, Set<string>>(
      [...tags].map((tag) => [tagNodeId(tag), new Set<string>()]),
    );
    for (const note of notes) {
      for (const tag of [...new Set(note.tags.map(normalizeTag).filter(Boolean))]) {
        addEdge(edges, noteNodeId(note.path), tagNodeId(tag), 1, 'tag');
        regionMembers.get(tagNodeId(tag))?.add(noteNodeId(note.path));
      }
    }
    for (const tag of tags) {
      const chain = expandTagPath(tag);
      for (let index = 1; index < chain.length; index += 1) {
        addEdge(edges, tagNodeId(chain[index - 1]), tagNodeId(chain[index]), 1, 'tag-parent');
        regionMembers.get(tagNodeId(chain[index - 1]))?.add(tagNodeId(chain[index]));
      }
    }
    for (const [sourcePath, targets] of Object.entries(snapshot.resolvedLinks)) {
      for (const [targetPath, count] of Object.entries(targets)) {
        addEdge(
          edges,
          noteNodeId(sourcePath),
          noteNodeId(targetPath),
          this.options.countDuplicateLinks ? finiteWeight(count) : 1,
          'link',
        );
      }
    }
    for (const note of notes) {
      for (const relation of note.frontmatterLinks ?? []) {
        const edge = edges.get(edgeKey(noteNodeId(note.path), noteNodeId(relation.targetPath)));
        const token = normalizeRelation(relation.relation);
        if (edge && token) edge.tokens.add(`relation:${token}`);
      }
    }
    const documentEdges: GraphEdgeV1[] = [...edges.values()]
      .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        directed: true,
        weight: edge.weight,
        tokens: [...edge.tokens].sort(),
        attributes: { relations: [...edge.tokens].filter((token) => token.startsWith('relation:')).map((token) => token.slice(9)) },
      }));
    const document: GraphDocumentV1 = {
      schemaVersion: 1,
      documentId: `graph-plus:vault:${snapshot.vaultId}`,
      revision,
      nodes,
      edges: documentEdges,
      nodeRegions: {
        version: 1,
        definitions: [...regionMembers.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([regionNodeId, members]): GraphNodeRegionDefinitionV1 => ({
            regionNodeId,
            directMemberNodeIds: [...members].sort(),
          })),
      },
    };
    assertGraphDocumentV1(document);
    return { document, lookup, searchIndex };
  }

  reconcile(previous: GraphDocumentV1, snapshot: VaultGraphSnapshotV1<TFile>): VaultGraphProjectionV1<TFile> {
    const next = this.build(snapshot, previous.revision + 1);
    if (sameDocumentContent(previous, next.document)) {
      return { document: previous, lookup: next.lookup, searchIndex: next.searchIndex };
    }
    return next;
  }
}

interface MutableEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  weight: number;
  readonly tokens: Set<string>;
}

function addEdge(
  edges: Map<string, MutableEdge>,
  sourceId: string,
  targetId: string,
  weight: number,
  relation: string,
): void {
  const key = edgeKey(sourceId, targetId);
  const token = `relation:${normalizeRelation(relation)}`;
  const existing = edges.get(key);
  if (existing) {
    existing.weight += finiteWeight(weight);
    existing.tokens.add(token);
    return;
  }
  edges.set(key, {
    id: `edge:${encodeURIComponent(sourceId)}:${encodeURIComponent(targetId)}`,
    sourceId,
    targetId,
    weight: finiteWeight(weight),
    tokens: new Set([token]),
  });
}

export function noteNodeId(path: string): string {
  return `note:${path}`;
}

export function tagNodeId(tag: string): string {
  return `tag:${normalizeTag(tag)}`;
}

function edgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}\u0000${targetId}`;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/^tag:/, '').replace(/^#/, '').trim();
}

function normalizeRelation(relation: string): string {
  return relation.trim().toLowerCase();
}

function expandTagPath(tag: string): readonly string[] {
  const result: string[] = [];
  let current = '';
  for (const part of tag.split('/').map((value) => value.trim()).filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    result.push(current);
  }
  return result;
}

function finiteWeight(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function stablePosition(id: string): { x: number; y: number; z: number } {
  const seed = stableHash(id);
  return {
    x: (unitFromHash(seed) - 0.5) * 80,
    y: (unitFromHash(seed ^ 0x9e3779b9) - 0.5) * 80,
    z: (unitFromHash(seed ^ 0x85ebca6b) - 0.5) * 80,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitFromHash(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0xffffffff;
}

function sameDocumentContent(left: GraphDocumentV1, right: GraphDocumentV1): boolean {
  return left.documentId === right.documentId
    && JSON.stringify(left.nodes) === JSON.stringify(right.nodes)
    && JSON.stringify(left.edges) === JSON.stringify(right.edges)
    && JSON.stringify(left.nodeRegions) === JSON.stringify(right.nodeRegions);
}
