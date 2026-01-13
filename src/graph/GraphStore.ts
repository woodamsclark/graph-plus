import { App, TFile } from "obsidian";
import { GraphData, GraphNode, GraphEdge } from "../shared/interfaces.ts";
import { getSettings } from "../settings/settingsStore.ts";

// Performance note to fix later: we scan all files twice.
// Once to build tag nodes, once again to build tag edges.

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
    private graph: GraphData | null = null;
    private cachedState: PersistedGraphState | null = null;

    constructor(deps: GraphStoreDeps) {
        this.deps = deps;
    }

    private async buildGraph() {
        const app = this.deps.getApp();
        const state = await this.loadState(app);
        const graph = this.generateGraph(app);

        if (state) this.applyPositions(graph, state);
        this.decorateGraph(graph, app);

        this.graph = graph;
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

    public async rebuild() {
        // capture current layout into cachedState
        if (this.graph) {
            const app = this.deps.getApp();
            this.cachedState = this.extractState(this.graph, app);
        }

        this.invalidate()
        await this.buildGraph();
    }

    public invalidate(): void {
        this.graph = null;
        // keep cachedState; it remains valid
    }

    private async loadState(app: App): Promise<PersistedGraphState | null> {
        if (this.cachedState) return this.cachedState;

        const plugin = this.deps.getPlugin();
        if (!plugin) return null;

        const raw = await plugin.loadData().catch(() => null);
        if (!raw) return null;

        const vaultId = app.vault.getName();
        const state = raw?.graphStateByVault?.[vaultId] ?? null;

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
            if (!Number.isFinite(n.location.x) || !Number.isFinite(n.location.y) || !Number.isFinite(n.location.z)) continue;
            nodePositions[n.id] = { x: n.location.x, y: n.location.y, z: n.location.z };
        }

        return { version: 1, vaultId, nodePositions };
    }

    private applyPositions(graph: GraphData, state: PersistedGraphState): void {
        const pos = state.nodePositions || {};
        for (const n of graph.nodes) {
            const p = pos[n.id];
            if (!p) continue;
            n.location.x = p.x; n.location.y = p.y; n.location.z = p.z;
            n.velocity.vx = 0; n.velocity.vy = 0; n.velocity.vz = 0; // avoid load “explosions”
        }
    }

    private generateGraph(app: App): GraphData {
        const settings = getSettings();
        const nodes    = this.createNodes(app); // notes + tags
        const nodeById = new Map(nodes.map(n => [n.id, n] as const));

        const edges: GraphEdge[] = [];
        edges.push(...this.createNoteToNoteEdges(app, nodeById));

        if (settings.graph.showTags) {
            edges.push(...this.createNoteToTagEdges(app, nodeById));       // note -> tag
            edges.push(...this.createTagToTagEdges(app, nodeById));  // tag -> tag
        }


        return { nodes, edges };
    }

    private createNodes(app: App): GraphNode[] {
        const settings = getSettings();

        let nodes: GraphNode[] = [];
        if (settings.graph.showTags)
            nodes = this.createTagNodes(app);
        nodes = nodes.concat(this.createNoteNodes(app));

        return nodes;
    }

    private createNoteNodes(app: App): GraphNode[] {
        const files: TFile[]        = app.vault.getMarkdownFiles();
        const nodes: GraphNode[]    = [];

        for (const file of files) {
            const jitter = 50;
            nodes.push({
                id          : file.path,
                label       : file.basename,
                location    : { 
                    x : (Math.random() - 0.5) * jitter,
                    y : (Math.random() - 0.5) * jitter,
                    z : (Math.random() - 0.5) * jitter, 
                },
                velocity    : {
                    vx : 0,
                    vy : 0,
                    vz : 0,
                },
                type        : "note",
                inLinks     : 0,
                outLinks    : 0,
                totalLinks  : 0,
                radius      : 10,
                file        : file,
                anima       : 1, 
            });
        }

        return nodes;
    }

    private createTagNodes(app: App): GraphNode[] {
        const tags = new Set<string>();

        const tagMap = (app.metadataCache as any).getTags?.() as Record<string, number> | undefined;
        if (tagMap) {
            for (const rawTag of Object.keys(tagMap)) {
                const clean = this.normalizeTagName(rawTag);
                if (clean) this.addTagPathToSet(tags, clean);
            }
        }

        for (const file of app.vault.getMarkdownFiles()) {
            for (const cleanTag of this.extractTagsFromFile(file, app)) {
                if (cleanTag) this.addTagPathToSet(tags, cleanTag);
            }
        }

        const jitter = 50;
        const nodes: GraphNode[] = [];

        for (const cleanTag of tags) {
            nodes.push({
                id: cleanTag,
                label: `#${cleanTag}`,
                location: {
                    x: (Math.random() - 0.5) * jitter,
                    y: (Math.random() - 0.5) * jitter,
                    z: (Math.random() - 0.5) * jitter,
                },
                velocity: { vx: 0, vy: 0, vz: 0 },
                type: "tag",
                inLinks: 0,
                outLinks: 0,
                totalLinks: 0,
                anima: 1,
                radius: 10,
            });
        }

        return nodes;
    }

    private expandTagPath(tag: string): string[] {
        // "a/b/c" => ["a", "a/b", "a/b/c"]
        const parts = tag.split("/").map(p => p.trim()).filter(Boolean);
        const out: string[] = [];
        let cur = "";
        for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            out.push(cur);
        }
        return out;
    }

    private addTagPathToSet(tags: Set<string>, cleanTag: string) {
        for (const t of this.expandTagPath(cleanTag)) {
            tags.add(t);
        }
    }

    // does this only create note => note edges
    // or also note => tag edges?
    // if so, rename to createNodeEdges
    private createNoteToNoteEdges(app: App, nodeById: Map<string, GraphNode>): GraphEdge[] {
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

                const rawCount = Number(targets[targetPath] || 1) || 1;
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

    // modify this to create tag=>tag edges?
    private createNoteToTagEdges(app: App, nodeById: Map<string, GraphNode>): GraphEdge[] {
        const edges : GraphEdge[]   = [];
        const edgeSet               = new Set<string>(); // only for tag edges; ids are unique anyway
        const files                 = app.vault.getMarkdownFiles();

        for (const file of files) {
            const srcId = file.path;
            if (!nodeById.has(srcId)) continue;

            const tags = this.extractTagsFromFile(file, app);

            for (const cleanTag of tags) {
                const tagId = cleanTag;
                if (!nodeById.has(tagId)) continue;

                const id = `${srcId}->${tagId}`;
                if (edgeSet.has(id)) continue;

                edges.push({
                    id,
                    sourceId: srcId,
                    targetId: tagId,
                    linkCount: 1,
                    bidirectional: false,
                });

                edgeSet.add(id);
            }
        }

        return edges;
    }

    private createTagToTagEdges(app: App, nodeById: Map<string, GraphNode>): GraphEdge[] {
        const edges: GraphEdge[] = [];
        const edgeSet = new Set<string>();

        // Reconstruct the same tag universe you used for nodes.
        // If you want to avoid scanning twice later, you can refactor to build tags once and reuse.
        const tags = new Set<string>();

        const tagMap = (app.metadataCache as any).getTags?.() as Record<string, number> | undefined;
        if (tagMap) {
            for (const rawTag of Object.keys(tagMap)) {
                const clean = this.normalizeTagName(rawTag);
                if (clean) this.addTagPathToSet(tags, clean);
            }
        }

        for (const file of app.vault.getMarkdownFiles()) {
            for (const cleanTag of this.extractTagsFromFile(file, app)) {
                if (cleanTag) this.addTagPathToSet(tags, cleanTag);
            }
        }

        // For each tag, add edges parent -> child
        for (const t of tags) {
            const chain = this.expandTagPath(t); // ["a","a/b","a/b/c"]
            for (let i = 1; i < chain.length; i++) {
                const parent = chain[i - 1];
                const child  = chain[i];

                const parentId = parent;
                const childId  = child;
                if (!nodeById.has(parentId) || !nodeById.has(childId)) continue;

                const id = `${parentId}->${childId}`;
                if (edgeSet.has(id)) continue;

                edges.push({
                    id,
                    sourceId: parentId,
                    targetId: childId,
                    linkCount: 1,
                    bidirectional: false,
                });

                edgeSet.add(id);
            }
        }

        return edges;
    }

    private decorateGraph(graph: GraphData, app: App): void {
        this.computeLinksAndRadius(graph);
        this.markBidirectional(graph.edges);
    }

    private computeLinksAndRadius(graph: GraphData): void {
        const settings = getSettings();
        const nodeById = new Map(graph.nodes.map(n => [n.id, n] as const));

        // Reset first (prevents double-count if re-run)
        for (const node of graph.nodes) {
            node.inLinks    = 0;
            node.outLinks   = 0;
            node.totalLinks = 0;
        }

        for (const edge of graph.edges) {
            const src = nodeById.get(edge.sourceId);
            const tgt = nodeById.get(edge.targetId);
            if (!src || !tgt) continue;

            src.outLinks    += 1;
            tgt.inLinks     += 1;
        }

        for (const node of graph.nodes) {
            node.totalLinks = node.inLinks + node.outLinks;
            node.radius = Math.min( Math.max(settings.graph.minNodeRadius + Math.log2(1 + node.totalLinks), settings.graph.minNodeRadius), settings.graph.maxNodeRadius );
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

    private extractTagsFromFile(file: TFile, app: App): string[] {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache) return [];

        const tags = new Set<string>();

        // Inline tags (well-typed)
        for (const t of cache.tags ?? []) {
            const rawTag = t?.tag;
            if (typeof rawTag === "string") {
                tags.add(this.normalizeTagName(rawTag));
            }
        }

        // Frontmatter (weakly typed → we guard)
        const fm = cache.frontmatter;
        if (fm) {
            const rawTag = (fm as any).tags ?? (fm as any).tag;
            
            if (typeof rawTag === "string") {
                for (const part of rawTag.split(/[,\s]+/)) {
                    if (!part) continue;
                    tags.add(this.normalizeTagName(part));
                }
            } else if (Array.isArray(rawTag)) { // frontMatter tag is an array
                for (const v of rawTag) {
                    if (typeof v === "string") {
                        tags.add(this.normalizeTagName(v));
                    }
                }
            }
        }
        return [...tags];
    }

    private normalizeTagName(tag: string): string {
        let t = tag.trim().toLowerCase();

        // strip Obsidian search-style prefix
        if (t.startsWith("tag:")) {
            t = t.slice(4);
        }

        // strip leading #
        if (t.startsWith("#")) {
            t = t.slice(1);
        }

        return t.trim();
    }
}