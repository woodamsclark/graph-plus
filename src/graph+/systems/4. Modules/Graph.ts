import { App, TFile }                               from "obsidian";
import type { GraphData, Node, Link }               from "../../types/domain/graph.ts";
import type { ModuleWithSettings, SettingsFor }     from "../../types/index.ts";
import type { GraphDeps }                           from "../../deps/graph.deps.ts";
import type { PersistedGraphState, WeightedEdge }   from "../../types/domain/graph.ts";


interface ResolvedLinks {
    [sourcePath: string]: { [targetPath: string]: number };
}

export class Graph implements ModuleWithSettings<'graph'> {
    private settings: SettingsFor<'graph'>;
    private deps:           GraphDeps;
    private data:           GraphData           | null = null;
    private cachedState:    PersistedGraphState | null = null;

    constructor(settings: SettingsFor<'graph'>, deps: GraphDeps) {
        this.deps       = deps;
        this.settings   = settings;
    }

    updateSettings(settings: SettingsFor<'graph'>): void {
        this.settings = settings;
    }

    public async initialize(): Promise<void> {
        await this.ensureBuilt();
    }

    public async ensureBuilt(): Promise<GraphData> {
        if (!this.data) {
            await this.buildGraph();
        }

        if (!this.data) {
            throw new Error("Graph failed to build.");
        }

        return this.data;
    }

    private style(graph: GraphData){
        this.computeNodeRadius(graph);
        // or do I have Anima completely style the graph?
        //this.computeLinkStrength(graph); // linkStrength = 1+ number of linksIn
        //this.computeLinkLength(graph); // linkLength = linkLength / number of linksIn

    }

    public get(): GraphData | null {
        return this.data;
    }

    public getOrThrow(): GraphData {
        if (!this.data) {
            throw new Error("Graph has not been built yet.");
        }

        return this.data;
    }

    public hasGraph(): boolean {
        return this.data !== null;
    }

    public async save(): Promise<void> {
        if (!this.data) return;

        const app = this.deps.app;
        const state = this.extractState(this.data, app);

        await this.saveState(state);
        this.cachedState = state;
    }

    public async rebuild(): Promise<void> {
        if (this.data) {
            const app           = this.deps.app;
            this.cachedState    = this.extractState(this.data, app);
        }

        this.invalidate();
        await this.ensureBuilt();
    }

    private invalidate(): void {
        this.data = null;
    }

    public destroy(): void {
        this.data           = null;
        this.cachedState    = null;
    }

    private async buildGraph(): Promise<void> {
        const app   = this.deps.app;
        const state = await this.loadState(app);
        const graph = this.generateGraph(app);

        if (state) this.applyPositions(graph, state);
        this.computeAdjacency(graph);
        this.computeNodeRadius(graph);
        this.markBidirectional(graph.links);

        this.data = graph;
    }

    private async loadState(app: App): Promise<PersistedGraphState | null> {
        if (this.cachedState) return this.cachedState;

        const plugin = this.deps.plugin;
        if (!plugin) return null;

        const raw = await plugin.loadData().catch(() => null);
        if (!raw) return null;

        const vaultId = app.vault.getName();
        const state = raw?.graphStateByVault?.[vaultId] ?? null;

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
            n.location.x = p.x;
            n.location.y = p.y;
            n.location.z = p.z;
            n.velocity.x = 0;
            n.velocity.y = 0;
            n.velocity.z = 0;
        }
    }

    private generateGraph(app: App): GraphData {
        const settings = this.settings;
        const showTags = settings.base.showTags;

        let tags = new Set<string>();
        let noteTagEdges: WeightedEdge[] = [];

        if (showTags) {
            const collected = this.collectTagsAndNoteTagEdges(app);
            tags = collected.tags;
            noteTagEdges = collected.edges;
        }

        const nodes     = this.createNodes(app, tags, showTags);
        const nodeById  = new Map(nodes.map((n) => [n.id, n] as const));
        const edges     = this.collectEdges(app, showTags, tags, noteTagEdges);
        const links     = this.buildLinksFromEdges(edges, nodeById);

        return { nodes, links, linksOut: {}, linksIn: {} };
    }

    private collectEdges(
        app: App,
        showTags: boolean,
        tags: Set<string>,
        noteTagEdges: WeightedEdge[],
    ): WeightedEdge[] {
        const edges: WeightedEdge[] = [];

        for (const edge of this.noteNoteEdges(app)) {
            edges.push(edge);
        }

        if (!showTags) return edges;

        edges.push(...noteTagEdges);

        for (const edge of this.tagTagEdges(tags)) {
            edges.push(edge);
        }

        return edges;
    }

    private collectTagsAndNoteTagEdges(app: App): { tags: Set<string>; edges: WeightedEdge[] } {
        const tags = new Set<string>();
        const edges: WeightedEdge[] = [];

        const tagMap = (app.metadataCache as any).getTags?.() as Record<string, number> | undefined;
        if (tagMap) {
            for (const rawTag of Object.keys(tagMap)) {
                const clean = this.normalizeTagName(rawTag);
                if (clean) this.addTagPathToSet(tags, clean);
            }
        }

        for (const file of app.vault.getMarkdownFiles()) {
            const sourceId = file.path;

            for (const cleanTag of this.extractTagsFromFile(file, app)) {
                if (!cleanTag) continue;

                this.addTagPathToSet(tags, cleanTag);
                edges.push({ sourceId, targetId: cleanTag, weight: 1 });
            }
        }

        return { tags, edges };
    }

    private createNodes(app: App, tags: Set<string>, showTags: boolean): Node[] {
        const nodes: Node[] = [];

        if (showTags) {
            nodes.push(...this.createTagNodes(tags));
        }

        nodes.push(...this.createNoteNodes(app));
        return nodes;
    }

    private *noteNoteEdges(app: App): IterableIterator<WeightedEdge> {
        const settings                      = this.settings;
        const resolvedLinks: ResolvedLinks  = (app.metadataCache as any).resolvedLinks || {};
        const countDuplicates               = Boolean(settings.base.countDuplicateLinks);

        for (const sourcePath of Object.keys(resolvedLinks)) {
            const targets = resolvedLinks[sourcePath] || {};
            for (const targetPath of Object.keys(targets)) {
                const rawCount = Number(targets[targetPath]) || 1;
                yield {
                    sourceId:   sourcePath,
                    targetId:   targetPath,
                    weight:     countDuplicates ? rawCount : 1,
                };
            }
        }
    }

    private *tagTagEdges(tags: Set<string>): IterableIterator<WeightedEdge> {
        for (const t of tags) {
            const chain = this.expandTagPath(t);
            for (let i = 1; i < chain.length; i++) {
                yield { sourceId: chain[i - 1], targetId: chain[i], weight: 1 };
            }
        }
    }

    private createNoteNodes(app: App): Node[] {
        const files: TFile[] = app.vault.getMarkdownFiles();
        const nodes: Node[] = [];

        for (const file of files) {
            const tuning = this.settings.tuning;

            const jitter = tuning.initialJitter;
            nodes.push({
                id: file.path,
                label: file.basename,
                location: {
                    x: (Math.random() - 0.5) * jitter,
                    y: (Math.random() - 0.5) * jitter,
                    z: (Math.random() - 0.5) * jitter,
                },
                velocity: {
                    x: 0,
                    y: 0,
                    z: 0,
                },
                type: "note",
                radius: 10,
                file: file,
                anima: { level: 0, capacity: 100 },
            });
        }

        return nodes;
    }

    private createTagNodes(tags: Set<string>): Node[] {
        const tuning = this.settings.tuning;

        const jitter = tuning.initialJitter;
        const nodes: Node[] = [];

        for (const cleanTag of tags) {
            nodes.push({
                id: cleanTag,
                label: `#${cleanTag}`,
                location: {
                    x: (Math.random() - 0.5) * jitter,
                    y: (Math.random() - 0.5) * jitter,
                    z: (Math.random() - 0.5) * jitter,
                },
                velocity: { x: 0, y: 0, z: 0 },
                type: "tag",
                anima: { level: 0, capacity: 100 },
                radius: 10,
            });
        }

        return nodes;
    }

    private expandTagPath(tag: string): string[] {
        const parts = tag.split("/").map((p) => p.trim()).filter(Boolean);
        const out: string[] = [];
        let cur = "";
        for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            out.push(cur);
        }
        return out;
    }

    private addTagPathToSet(tags: Set<string>, cleanTag: string): void {
        for (const t of this.expandTagPath(cleanTag)) {
            tags.add(t);
        }
    }

    private buildLinksFromEdges(edges: Iterable<WeightedEdge>, nodeById: Map<string, Node>): Link[] {
        const byId = new Map<string, Link>();

        for (const e of edges) {
            if (!nodeById.has(e.sourceId) || !nodeById.has(e.targetId)) continue;

            const tuning    = this.settings.tuning;
            const rawWeight = Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1;

            const thickness = Math.max(
            tuning.linkThicknessMin,
            rawWeight * tuning.linkThicknessScale,
            );
            const id = `${e.sourceId}->${e.targetId}`;

            const existing = byId.get(id);
            if (existing) {
                existing.thickness += thickness;
                continue;
            }

            const link = this.createLink(e.sourceId, e.targetId, thickness);
            byId.set(id, link);
        }

        return [...byId.values()];
    }

    private createLink(sourceId: string, targetId: string, thickness: number): Link {
        const settings = this.settings;
        return {
            id: `${sourceId}->${targetId}`,
            sourceId: sourceId,
            targetId: targetId,
            length: this.settings.layout.linkLength,
            strength: this.settings.layout.linkStrength,
            thickness: thickness,
            gate: { state: "closed", threshold: 0, hysteresis: 0 },
        };
    }

    private computeAdjacency(graph: GraphData): void {
        const out: Record<string, Record<string, number>> = {};
        const inn: Record<string, Record<string, number>> = {};

        for (const link of graph.links) {
            const s = link.sourceId;
            const t = link.targetId;
            const w = link.thickness;

            (out[s] ??= {});
            out[s][t] = (out[s][t] || 0) + w;

            (inn[t] ??= {});
            inn[t][s] = (inn[t][s] || 0) + w;
        }

        graph.linksOut = out;
        graph.linksIn = inn;
    }

    private computeNodeRadius(graph: GraphData): void {
        const minR = this.settings.base.minNodeRadius;
        const maxR = this.settings.base.maxNodeRadius;

        const tuning = this.settings.tuning;

        for (const node of graph.nodes) {
            const incoming = graph.linksIn[node.id];
            const count = incoming
                ? Object.values(incoming).reduce((a, b) => a + b, 0)
                : 0;

            const r = minR + Math.sqrt(count) * tuning.nodeDegreeRadiusScale;
            node.radius = Math.min(maxR, r);
        }
    }

    private markBidirectional(links: Link[]): void {
        const byId = new Map<string, Link>();
        for (const link of links) byId.set(`${link.sourceId}->${link.targetId}`, link);

        for (const link of links) {
            const rev = byId.get(`${link.targetId}->${link.sourceId}`);
            if (rev) {
                link.bidirectional = true;
                rev.bidirectional = true;
            }
        }
    }

    private extractTagsFromFile(file: TFile, app: App): string[] {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache) return [];

        const tags = new Set<string>();

        for (const t of cache.tags ?? []) {
            const rawTag = t?.tag;
            if (typeof rawTag === "string") {
                tags.add(this.normalizeTagName(rawTag));
            }
        }

        const fm = cache.frontmatter;
        if (fm) {
            const rawTag = (fm as any).tags ?? (fm as any).tag;

            if (typeof rawTag === "string") {
                for (const part of rawTag.split(/[,\s]+/)) {
                    if (!part) continue;
                    tags.add(this.normalizeTagName(part));
                }
            } else if (Array.isArray(rawTag)) {
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

        if (t.startsWith("tag:")) {
            t = t.slice(4);
        }

        if (t.startsWith("#")) {
            t = t.slice(1);
        }

        return t.trim();
    }
}