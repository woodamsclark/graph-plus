import { App, TFile } from "obsidian";
import { GraphData, GraphNode, GraphEdge } from "../shared/interfaces.ts";
import { getSettings } from "../settings/settingsStore.ts";

type DataStoragePlugin = {
  loadData: () => Promise<any>;
  saveData: (data: any) => Promise<void>;
};

type GraphStoreDeps = {
  getApp: () => App;
  getPlugin: () => DataStoragePlugin | null;
};

type PersistedGraphState = {
  version: number;
  vaultId: string;
  nodePositions: Record<string, { x: number; y: number; z: number }>;
};

interface ResolvedLinks {
  [sourcePath: string]: { [targetPath: string]: number };
}

export class GraphStore {
  private deps: GraphStoreDeps;

  private graph         : GraphData             | null = null;
  private cachedState   : PersistedGraphState   | null = null;

  constructor(deps: GraphStoreDeps) {
    this.deps = deps;
  }

  /** Load-or-generate once and keep it as the single graph instance */
  public async init(): Promise<GraphData> {
    if (this.graph) return this.graph;

    const app   =       this.deps.getApp();
    const state = await this.loadState(app);
    const graph =       this.generateGraph(app);

    if (state) this.applyPositions(graph, state);
    this.decorateGraph(graph, app);

    this.graph = graph;
    return graph;
  }

  public get(): GraphData | null {
    return this.graph;
  }

  public async save(): Promise<void> {
    if (!this.graph) return;

    const app = this.deps.getApp();
    const state = this.extractState(this.graph, app);

    await this.saveState(state);
    this.cachedState = state;
  }

  public async rebuild(): Promise<GraphData> {
    this.graph = null;
    return await this.init();
  }

  public invalidate(): void {
    this.graph = null;
    // keep cachedState; it remains valid
  }

  // Persistence (data.json)

  private async loadState(app: App): Promise<PersistedGraphState | null> {
    if (this.cachedState) return this.cachedState;

    const plugin    = this.deps.getPlugin();
    if (!plugin) return null;

    const raw       = await plugin.loadData().catch(() => null);
    if (!raw) return null;

    const vaultId   = app.vault.getName();
    const state     = raw?.graphStateByVault?.[vaultId] ?? null;

    this.cachedState = state;
    return state;
  }

  private async saveState(state: PersistedGraphState): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const raw = await plugin.loadData().catch(() => ({}));
    const next = raw ?? {};
    next.graphStateByVault ??= {};
    next.graphStateByVault[state.vaultId] = state;

    await plugin.saveData(next);
  }

  private extractState(graph: GraphData, app: App): PersistedGraphState {
    const vaultId = app.vault.getName();
    const nodePositions: PersistedGraphState["nodePositions"] = {};

    for (const n of graph.nodes) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue;
      nodePositions[n.id] = { x: n.x, y: n.y, z: n.z };
    }

    return { version: 1, vaultId, nodePositions };
  }

  private applyPositions(graph: GraphData, state: PersistedGraphState): void {
    const pos = state.nodePositions || {};
    for (const n of graph.nodes) {
      const p = pos[n.id];
      if (!p) continue;
      n.x = p.x; n.y = p.y; n.z = p.z;
      n.vx = 0; n.vy = 0; n.vz = 0; // avoid load “explosions”
    }
  }

  // -----------------------
  // Generation (topology)
  // -----------------------

  private generateGraph(app: App): GraphData {
    const nodes     = this.createNodes(app);
    const nodeById  = new Map(nodes.map(n => [n.id, n] as const));
    const edges     = this.createEdgesFromResolvedLinks(app, nodeById);

    return { nodes, edges, centerNode: null };
  }

  private createNodes(app: App): GraphNode[] {
    const settings = getSettings();

    let nodes: GraphNode[] = [];
    if (settings.graph.showTags)
      nodes= this.createTagNodes(app);
    nodes = nodes.concat(this.createNoteNodes(app));

    return nodes;
  }

  private createNoteNodes(app: App): GraphNode[] {
    const files: TFile[] = app.vault.getMarkdownFiles();
    const nodes: GraphNode[] = [];

    for (const file of files) {
      const jitter = 50;
      nodes.push({
        id: file.path,
        filePath: file.path,
        file,
        label: file.basename,
        x: (Math.random() - 0.5) * jitter,
        y: (Math.random() - 0.5) * jitter,
        z: (Math.random() - 0.5) * jitter,
        vx: 0, vy: 0, vz: 0,
        type: "note",
        inDegree: 0, outDegree: 0, totalDegree: 0,
        radius: 0,
      });
    }

    return nodes;
  }

  private createTagNodes(app: App): GraphNode[] {
    // getTags isn't exposed, apparently, so we have to access it via (metadataCache as any)
    const tagMap = (app.metadataCache as any).getTags?.() as Record<string, number> | undefined;
    if (!tagMap) return [];

    const jitter = 50;
    const nodes: GraphNode[] = [];

    for (const rawTag of Object.keys(tagMap)) {
      const cleanTag = rawTag.startsWith("#") ? rawTag.slice(1) : rawTag;
      nodes.push({
        id: `tag:${cleanTag}`,
        label: `#${cleanTag}`,
        x: (Math.random() - 0.5) * jitter,
        y: (Math.random() - 0.5) * jitter,
        z: (Math.random() - 0.5) * jitter,
        vx: 0,
        vy: 0,
        vz: 0,
        type: "tag",
        inDegree: 0,
        outDegree: 0,
        totalDegree: 0,
        radius: 0,
      });
    }

    return nodes;
  }

  private createEdgesFromResolvedLinks(app: App, nodeById: Map<string, GraphNode>): GraphEdge[] {
    const settings = getSettings();
    const resolved: ResolvedLinks = (app.metadataCache as any).resolvedLinks || {};
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();
    const countDuplicates = Boolean(settings.graph.countDuplicateLinks);

    for (const sourcePath of Object.keys(resolved)) {
      const targets = resolved[sourcePath] || {};
      for (const targetPath of Object.keys(targets)) {
        if (!nodeById.has(sourcePath) || !nodeById.has(targetPath)) continue;

        const key = `${sourcePath}->${targetPath}`;
        if (edgeSet.has(key)) continue;

        const rawCount  = Number(targets[targetPath] || 1) || 1;
        const linkCount = countDuplicates ? rawCount : 1;

        edges.push({
          id: key,
          sourceId: sourcePath,
          targetId: targetPath,
          linkCount,
          bidirectional: false,
        });

        edgeSet.add(key);
      }
    }

    return edges;
  }

  // -----------------------
  // Decorations (settings)
  // -----------------------

  private decorateGraph(graph: GraphData, app: App): void {
    const settings = getSettings();

    if (settings.graph.showTags == true) {
      // keep isolated: addTagNodesAndEdges(graph, app)
      // (you can port your existing method here)
    }

    this.computeDegreesAndRadius(graph);
    this.markBidirectional(graph.edges);

    graph.centerNode = this.pickCenterNode(app, graph.nodes);
  }

  private computeDegreesAndRadius(graph: GraphData): void {
    const nodeById = new Map(graph.nodes.map(n => [n.id, n] as const));

    for (const e of graph.edges) {
      const src = nodeById.get(e.sourceId);
      const tgt = nodeById.get(e.targetId);
      if (!src || !tgt) continue;

      const c = Number(e.linkCount || 1) || 1;
      src.outDegree = (src.outDegree || 0) + c;
      tgt.inDegree  = (tgt.inDegree  || 0) + c;
    }

    for (const n of graph.nodes) {
      n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0);
      n.radius = 4 + Math.log2(1 + n.totalDegree);
    }
  }

  private markBidirectional(edges: GraphEdge[]): void {
    const m = new Map<string, GraphEdge>();
    for (const e of edges) m.set(`${e.sourceId}->${e.targetId}`, e);

    for (const e of edges) {
      const rev = m.get(`${e.targetId}->${e.sourceId}`);
      if (rev) {
        e.bidirectional = true;
        rev.bidirectional = true;
      }
    }
  }

  private pickCenterNode(app: App, nodes: GraphNode[]): GraphNode | null {
    return null;
    }
}