import { App, TFile } from "obsidian";
import { GraphData, Node, Link } from "./grammar/interfaces.ts";
import { getSettings } from "../obsidian/settings/settingsStore.ts";

type WeightedEdge = { sourceId: string; targetId: string; weight: number };

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
};

export class Graph {
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
        this.computeAdjacency(graph);
        this.computeNodeRadius(graph);

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
        const showTags = settings.graph.showTags;

        let tags = new Set<string>();
        let noteTagEdges: WeightedEdge[] = [];

        if (showTags) {
            const collected = this.collectTagsAndNoteTagEdges(app);
            tags = collected.tags;
            noteTagEdges = collected.edges;
        }

        const nodes = this.createNodes(app, tags, settings.graph.showTags);
        const nodeById = new Map(nodes.map(n => [n.id, n] as const));

        function* allEdges(this: Graph): IterableIterator<WeightedEdge> {
            yield* this.noteNoteEdges(app);

            if (!showTags) return;

            yield* noteTagEdges;
            yield* this.tagTagEdges(tags);
        }

        const links = this.buildLinksFromEdges(allEdges.call(this), nodeById);
        return { nodes, links, linksOut: {}, linksIn: {} };
    }

    private collectTagsAndNoteTagEdges(app: App): { tags: Set<string>; edges: WeightedEdge[] } {
        const tags = new Set<string>();
        const edges: WeightedEdge[] = [];

        // include metadataCache.getTags() too (optional)
        // it may be possible that getTags() captures tags that files do not, creating orphan tags
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

                this.addTagPathToSet(tags, cleanTag);               // for tag nodes + hierarchy
                edges.push({ sourceId, targetId: cleanTag, weight: 1 }); // note -> tag
            }
        }

        return { tags, edges };
    }

    private createNodes(app: App, tags: Set<string>, showTags:boolean): Node[] {

        let nodes: Node[] = [];
        if (showTags)
            nodes = this.createTagNodes(tags);
        nodes = nodes.concat(this.createNoteNodes(app));

        return nodes;
    }

    private *noteNoteEdges(app: App): IterableIterator<WeightedEdge> {
        const settings = getSettings();
        const resolvedLinks: ResolvedLinks = (app.metadataCache as any).resolvedLinks || {};
        const countDuplicates = Boolean(settings.graph.countDuplicateLinks);

        for (const sourcePath of Object.keys(resolvedLinks)) {
            const targets = resolvedLinks[sourcePath] || {};
            for (const targetPath of Object.keys(targets)) {
                const rawCount = Number(targets[targetPath]) || 1;
                yield {
                    sourceId: sourcePath,
                    targetId: targetPath,
                    weight  : countDuplicates ? rawCount : 1,
                };
            }
        }
    }

    private *tagTagEdges(tags: Set<string>): IterableIterator<WeightedEdge> {
        for (const t of tags) {
            const chain = this.expandTagPath(t); // ["a","a/b","a/b/c"]
            for (let i = 1; i < chain.length; i++) {
                yield { sourceId: chain[i - 1], targetId: chain[i], weight: 1 };
            }
        }
    }

    private createNoteNodes(app: App): Node[] {
        const files: TFile[]        = app.vault.getMarkdownFiles();
        const nodes: Node[]    = [];

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
                radius      : 10,
                file        : file,
                anima       : { level: 0, capacity: 100 }, 
            });
        }

        return nodes;
    }

    private createTagNodes(tags: Set<string>): Node[] {

        const jitter = 50;
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
                velocity: { vx: 0, vy: 0, vz: 0 },
                type: "tag",
                anima: { level: 0, capacity: 100 },
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

    private buildLinksFromEdges(edges: Iterable<WeightedEdge>, nodeById: Map<string, Node>): Link[] {
        const byId = new Map<string, Link>();

        for (const e of edges) {
            if (!nodeById.has(e.sourceId) || !nodeById.has(e.targetId)) continue;

            const thickness = Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1;
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
        const settings = getSettings();
        return {
            id          : `${sourceId}->${targetId}`,
            sourceId    : sourceId,
            targetId    : targetId,
            length      : settings.physics.edgeLength,
            strength    : settings.physics.edgeStrength,
            thickness   : thickness,
            gate        : {state: "closed", threshold: 0, hysteresis: 0, },
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
        const minR = getSettings().graph.minNodeRadius;
        const maxR = getSettings().graph.maxNodeRadius;

        for (const node of graph.nodes) {
            const incoming = graph.linksIn[node.id];
            const count = incoming
                ? Object.values(incoming).reduce((a, b) => a + b, 0)
                : 0;

            // example curve; tune later
            const r = minR + Math.sqrt(count) * 2;
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