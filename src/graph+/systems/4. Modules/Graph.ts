import { App, TFile } from 'obsidian';
import type {
  GraphData,
  Link,
  Node,
  NodeFacets,
  PersistedGraphState,
  WeightedEdge,
} from '../../types/domain/graph.ts';
import type { GraphLensState } from '../../types/domain/lens.ts';
import { cloneGraphLens, createDefaultGraphLens } from '../../types/domain/lens.ts';
import type { ModuleWithSettings, SettingsFor } from '../../types/index.ts';
import type { GraphDeps } from '../../deps/graph.deps.ts';
import { projectGraph } from '../../lens/GraphProjector.ts';

interface ResolvedLinks {
  [sourcePath: string]: { [targetPath: string]: number };
}

export class Graph implements ModuleWithSettings<'graph'> {
  private settings: SettingsFor<'graph'>;
  private deps: GraphDeps;
  private sourceData: GraphData | null = null;
  private data: GraphData | null = null;
  private cachedState: PersistedGraphState | null = null;
  private lensState: GraphLensState;

  constructor(settings: SettingsFor<'graph'>, deps: GraphDeps, initialLens?: GraphLensState) {
    this.deps = deps;
    this.settings = settings;
    this.lensState = initialLens
      ? cloneGraphLens(initialLens)
      : createDefaultGraphLens(settings.base.showTags);
  }

  updateSettings(settings: SettingsFor<'graph'>): void {
    this.settings = settings;
    if (this.sourceData) {
      for (const link of this.sourceData.links) {
        link.length = settings.layout.linkLength;
        link.strength = settings.layout.linkStrength;
        link.thickness = settings.tuning.linkThickness * Math.sqrt(link.weight);
      }
      this.computeNodeRadius(this.sourceData);
    }
    this.applyProjection();
  }

  async initialize(): Promise<void> {
    await this.ensureBuilt();
  }

  async ensureBuilt(): Promise<GraphData> {
    if (!this.sourceData) await this.buildGraph();
    if (!this.data) throw new Error('Graph failed to build.');
    return this.data;
  }

  get(): GraphData | null {
    return this.data;
  }

  getSource(): GraphData | null {
    return this.sourceData;
  }

  getOrThrow(): GraphData {
    if (!this.data) throw new Error('Graph has not been built yet.');
    return this.data;
  }

  hasGraph(): boolean {
    return this.data !== null;
  }

  getLensState(): GraphLensState {
    return cloneGraphLens(this.lensState);
  }

  setLensState(next: GraphLensState): GraphData | null {
    this.lensState = cloneGraphLens(next);
    this.applyProjection();
    return this.data;
  }

  async save(): Promise<void> {
    if (!this.sourceData) return;
    const state = this.extractState(this.sourceData, this.deps.app);
    await this.saveState(state);
    this.cachedState = state;
  }

  async rebuild(): Promise<void> {
    if (this.sourceData) this.cachedState = this.extractState(this.sourceData, this.deps.app);
    this.sourceData = null;
    this.data = null;
    await this.ensureBuilt();
  }

  destroy(): void {
    this.sourceData = null;
    this.data = null;
    this.cachedState = null;
  }

  private async buildGraph(): Promise<void> {
    const state = await this.loadState(this.deps.app);
    const graph = this.generateGraph(this.deps.app);
    if (state) this.applyPositions(graph, state);
    this.computeAdjacency(graph);
    this.computeNodeRadius(graph);
    this.markBidirectional(graph.links);
    this.sourceData = graph;
    this.applyProjection();
  }

  private applyProjection(): void {
    if (!this.sourceData) return;
    this.data = projectGraph(this.sourceData, this.lensState, {
      ringSpacing: Math.max(80, this.settings.layout.linkLength * 1.45),
    });
  }

  private async loadState(app: App): Promise<PersistedGraphState | null> {
    if (this.cachedState) return this.cachedState;
    const plugin = this.deps.plugin;
    if (!plugin) return null;
    const raw = await plugin.loadData().catch(() => null);
    if (!raw) return null;
    const state = raw?.graphStateByVault?.[app.vault.getName()] ?? null;
    this.cachedState = state;
    return state;
  }

  private async saveState(state: PersistedGraphState): Promise<void> {
    const plugin = this.deps.plugin;
    if (!plugin) return;
    const raw = await plugin.loadData().catch(() => ({}));
    const next = raw ?? {};
    next.graphStateByVault ??= {};
    next.graphStateByVault[state.vaultId] = state;
    await plugin.saveData(next);
  }

  private extractState(graph: GraphData, app: App): PersistedGraphState {
    const nodePositions: PersistedGraphState['nodePositions'] = {};
    for (const node of graph.nodes) {
      const { x, y, z } = node.location;
      if (![x, y, z].every(Number.isFinite)) continue;
      nodePositions[node.id] = { x, y, z };
    }
    return { version: 1, vaultId: app.vault.getName(), nodePositions };
  }

  private applyPositions(graph: GraphData, state: PersistedGraphState): void {
    for (const node of graph.nodes) {
      const position = state.nodePositions?.[node.id];
      if (!position) continue;
      node.location = { ...position };
      node.velocity = { x: 0, y: 0, z: 0 };
    }
  }

  private generateGraph(app: App): GraphData {
    const { tags, edges: noteTagEdges } = this.collectTagsAndNoteTagEdges(app);
    const unresolved = this.collectUnresolved(app);
    const nodes = [
      ...this.createFileNodes(app),
      ...this.createTagNodes(tags),
      ...this.createUnresolvedNodes(unresolved.targets),
    ];
    const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
    const edges: WeightedEdge[] = [
      ...this.noteNoteEdges(app),
      ...noteTagEdges,
      ...this.tagTagEdges(tags),
      ...unresolved.edges,
    ];
    const links = this.buildLinksFromEdges(edges, nodeById);
    this.addFrontmatterRelations(app, links);
    return {
      nodes,
      links,
      linksOut: {},
      linksIn: {},
      projection: {
        mode: 'free',
        sourceNodeCount: nodes.length,
        sourceLinkCount: links.length,
      },
    };
  }

  private collectTagsAndNoteTagEdges(app: App): { tags: Set<string>; edges: WeightedEdge[] } {
    const tags = new Set<string>();
    const edges: WeightedEdge[] = [];
    const tagMap = (app.metadataCache as any).getTags?.() as Record<string, number> | undefined;
    for (const rawTag of Object.keys(tagMap ?? {})) {
      const clean = this.normalizeTagName(rawTag);
      if (clean) this.addTagPathToSet(tags, clean);
    }
    for (const file of app.vault.getMarkdownFiles()) {
      for (const cleanTag of this.extractTagsFromFile(file, app)) {
        if (!cleanTag) continue;
        this.addTagPathToSet(tags, cleanTag);
        edges.push({ sourceId: file.path, targetId: cleanTag, weight: 1, relation: 'tag' });
      }
    }
    return { tags, edges };
  }

  private *noteNoteEdges(app: App): IterableIterator<WeightedEdge> {
    const resolvedLinks: ResolvedLinks = (app.metadataCache as any).resolvedLinks ?? {};
    const countDuplicates = Boolean(this.settings.base.countDuplicateLinks);
    for (const sourcePath of Object.keys(resolvedLinks)) {
      for (const [targetPath, count] of Object.entries(resolvedLinks[sourcePath] ?? {})) {
        yield {
          sourceId: sourcePath,
          targetId: targetPath,
          weight: countDuplicates ? Math.max(1, Number(count) || 1) : 1,
          relation: 'link',
        };
      }
    }
  }

  private *tagTagEdges(tags: Set<string>): IterableIterator<WeightedEdge> {
    for (const tag of tags) {
      const chain = this.expandTagPath(tag);
      for (let index = 1; index < chain.length; index++) {
        yield {
          sourceId: chain[index - 1],
          targetId: chain[index],
          weight: 1,
          relation: 'tag-parent',
        };
      }
    }
  }

  private collectUnresolved(app: App): { targets: Set<string>; edges: WeightedEdge[] } {
    const unresolvedLinks = (app.metadataCache as any).unresolvedLinks as ResolvedLinks | undefined;
    const targets = new Set<string>();
    const edges: WeightedEdge[] = [];
    for (const [sourcePath, targetMap] of Object.entries(unresolvedLinks ?? {})) {
      for (const [rawTarget, count] of Object.entries(targetMap ?? {})) {
        const target = rawTarget.trim();
        if (!target) continue;
        const targetId = this.unresolvedId(target);
        targets.add(target);
        edges.push({
          sourceId: sourcePath,
          targetId,
          weight: this.settings.base.countDuplicateLinks ? Math.max(1, Number(count) || 1) : 1,
          relation: 'unresolved',
        });
      }
    }
    return { targets, edges };
  }

  private createFileNodes(app: App): Node[] {
    return app.vault.getFiles().map((file) => {
      const type = file.extension === 'md'
        ? 'note'
        : file.extension === 'canvas'
          ? 'canvas'
          : 'attachment';
      const facets = this.createFileFacets(file, app);
      return this.createNode(file.path, file.basename, type, facets, file);
    });
  }

  private createTagNodes(tags: Set<string>): Node[] {
    return [...tags].sort().map((tag) => this.createNode(
      tag,
      `#${tag}`,
      'tag',
      { tags: [tag], properties: {}, searchText: `#${tag} ${tag}`.toLowerCase() },
    ));
  }

  private createUnresolvedNodes(targets: Set<string>): Node[] {
    return [...targets].sort().map((target) => this.createNode(
      this.unresolvedId(target),
      target,
      'unresolved',
      { path: target, tags: [], properties: {}, searchText: target.toLowerCase() },
    ));
  }

  private createNode(
    id: string,
    label: string,
    type: Node['type'],
    facets: NodeFacets,
    file?: TFile,
  ): Node {
    const jitter = this.settings.tuning.initialJitter;
    const seed = stableHash(id);
    return {
      id,
      label,
      location: {
        x: (unitFromHash(seed) - 0.5) * jitter,
        y: (unitFromHash(seed ^ 0x9e3779b9) - 0.5) * jitter,
        z: (unitFromHash(seed ^ 0x85ebca6b) - 0.5) * jitter,
      },
      velocity: { x: 0, y: 0, z: 0 },
      type,
      radius: 10,
      file,
      facets,
      anima: { level: 0, capacity: 100 },
    };
  }

  private createFileFacets(file: TFile, app: App): NodeFacets {
    const tags = file.extension === 'md' ? this.extractTagsFromFile(file, app) : [];
    const properties: Record<string, string[]> = {};
    const frontmatter = file.extension === 'md' ? app.metadataCache.getFileCache(file)?.frontmatter : null;
    if (frontmatter) {
      for (const [key, raw] of Object.entries(frontmatter)) {
        if (key === 'position') continue;
        const values = flattenFacetValues(raw);
        if (values.length) properties[key.toLowerCase()] = values;
      }
    }
    const propertyText = Object.entries(properties).flatMap(([key, values]) => [key, ...values]);
    return {
      path: file.path,
      extension: file.extension.toLowerCase(),
      tags,
      properties,
      searchText: [file.path, file.basename, file.extension, ...tags, ...propertyText].join(' ').toLowerCase(),
    };
  }

  private buildLinksFromEdges(edges: Iterable<WeightedEdge>, nodeById: Map<string, Node>): Link[] {
    const byId = new Map<string, Link>();
    for (const edge of edges) {
      if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) continue;
      const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
      const id = `${edge.sourceId}->${edge.targetId}`;
      const existing = byId.get(id);
      if (existing) {
        existing.weight += weight;
        existing.thickness = this.settings.tuning.linkThickness * Math.sqrt(existing.weight);
        if (edge.relation && !existing.relations.includes(edge.relation)) existing.relations.push(edge.relation);
        continue;
      }
      byId.set(id, {
        id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        length: this.settings.layout.linkLength,
        strength: this.settings.layout.linkStrength,
        thickness: this.settings.tuning.linkThickness * Math.sqrt(weight),
        weight,
        relations: [edge.relation ?? 'link'],
        gate: { state: 'closed', threshold: 0, hysteresis: 0 },
      });
    }
    return [...byId.values()];
  }

  private addFrontmatterRelations(app: App, links: Link[]): void {
    const byDirection = new Map(links.map((link) => [`${link.sourceId}\u0000${link.targetId}`, link] as const));
    for (const file of app.vault.getMarkdownFiles()) {
      const frontmatterLinks = (app.metadataCache.getFileCache(file) as any)?.frontmatterLinks as
        | Array<{ key?: string; link?: string }>
        | undefined;
      for (const entry of frontmatterLinks ?? []) {
        if (!entry.key || !entry.link) continue;
        const target = app.metadataCache.getFirstLinkpathDest(entry.link, file.path);
        if (!target) continue;
        const link = byDirection.get(`${file.path}\u0000${target.path}`);
        const relation = entry.key.trim().toLowerCase();
        if (link && relation && !link.relations.includes(relation)) link.relations.push(relation);
      }
    }
  }

  private computeAdjacency(graph: GraphData): void {
    graph.linksOut = {};
    graph.linksIn = {};
    for (const link of graph.links) {
      (graph.linksOut[link.sourceId] ??= {})[link.targetId] =
        ((graph.linksOut[link.sourceId] ?? {})[link.targetId] ?? 0) + link.weight;
      (graph.linksIn[link.targetId] ??= {})[link.sourceId] =
        ((graph.linksIn[link.targetId] ?? {})[link.sourceId] ?? 0) + link.weight;
    }
  }

  private computeNodeRadius(graph: GraphData): void {
    const counts = graph.nodes.map((node) => {
      const incoming = Object.values(graph.linksIn[node.id] ?? {}).reduce((sum, value) => sum + value, 0);
      const outgoing = Object.values(graph.linksOut[node.id] ?? {}).reduce((sum, value) => sum + value, 0);
      return incoming + outgoing;
    });
    const maxCount = Math.max(...counts, 1);
    for (let index = 0; index < graph.nodes.length; index++) {
      const normalized = counts[index] / maxCount;
      graph.nodes[index].radius = this.settings.base.minNodeRadius
        + Math.pow(normalized, 1.45) * (this.settings.base.maxNodeRadius - this.settings.base.minNodeRadius);
    }
  }

  private markBidirectional(links: Link[]): void {
    const byId = new Map(links.map((link) => [`${link.sourceId}\u0000${link.targetId}`, link] as const));
    for (const link of links) {
      if (byId.has(`${link.targetId}\u0000${link.sourceId}`)) link.bidirectional = true;
    }
  }

  private extractTagsFromFile(file: TFile, app: App): string[] {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) return [];
    const tags = new Set<string>();
    for (const tagCache of cache.tags ?? []) {
      if (typeof tagCache?.tag === 'string') tags.add(this.normalizeTagName(tagCache.tag));
    }
    const rawTags = (cache.frontmatter as any)?.tags ?? (cache.frontmatter as any)?.tag;
    if (typeof rawTags === 'string') {
      for (const value of rawTags.split(/[,\s]+/)) if (value) tags.add(this.normalizeTagName(value));
    } else if (Array.isArray(rawTags)) {
      for (const value of rawTags) if (typeof value === 'string') tags.add(this.normalizeTagName(value));
    }
    return [...tags].filter(Boolean);
  }

  private expandTagPath(tag: string): string[] {
    const parts = tag.split('/').map((part) => part.trim()).filter(Boolean);
    const result: string[] = [];
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      result.push(current);
    }
    return result;
  }

  private addTagPathToSet(tags: Set<string>, tag: string): void {
    for (const value of this.expandTagPath(tag)) tags.add(value);
  }

  private normalizeTagName(tag: string): string {
    return tag.trim().toLowerCase().replace(/^tag:/, '').replace(/^#/, '').trim();
  }

  private unresolvedId(target: string): string {
    return `unresolved:${target.trim().toLowerCase()}`;
  }
}

function flattenFacetValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenFacetValues);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, nested]) => [key.toLowerCase(), ...flattenFacetValues(nested)]);
  }
  return [String(value).toLowerCase()];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
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
