import { App, TFile } from "obsidian";
import type { GraphData, GraphEdge, GraphNode } from "../shared/interfaces.ts";
import { getSettings } from "../settings/settingsStore.ts";

type ResolvedLinks = Record<string, Record<string, number>>;

const NOTE_PREFIX = "";      // note id is file.path
const TAG_PREFIX  = "tag:";  // tag id is `tag:<tagName>` where tagName excludes '#'

function noteIdFromFile(file: TFile): string {
  return file.path;
}

function tagIdFromName(tagName: string): string {
  return `${TAG_PREFIX}${tagName}`;
}

function normalizeTag(raw: string): string | null {
  // cache.tags uses "#foo" and "#foo/bar"
  if (!raw) return null;
  if (!raw.startsWith("#")) return null;
  const name = raw.slice(1).trim();
  return name.length ? name : null;
}

function cssSafeJitter(jitter = 50) {
  return (Math.random() - 0.5) * jitter;
}

function addEdgeOnce(
  edges: GraphEdge[],
  edgeSet: Set<string>,
  sourceId: string,
  targetId: string,
  linkCount = 1,
) {
  const key = `${sourceId}->${targetId}`;
  if (edgeSet.has(key)) return;
  edges.push({
    id: key,
    sourceId,
    targetId,
    linkCount,
    bidirectional: false,
  });
  edgeSet.add(key);
}

function markBidirectionalEdges(edges: GraphEdge[]) {
  const map = new Map<string, GraphEdge>();
  for (const e of edges) map.set(`${e.sourceId}->${e.targetId}`, e);

  for (const e of edges) {
    const rev = map.get(`${e.targetId}->${e.sourceId}`);
    if (rev) {
      e.bidirectional = true;
      rev.bidirectional = true;
    }
  }
}

function computeDegreesAndRadii(nodes: GraphNode[], nodeById: Map<string, GraphNode>, edges: GraphEdge[]) {
  // reset (so rebuilds don't accumulate)
  for (const n of nodes) {
    n.inLinks = 0;
    n.outLinks = 0;
    n.totalLinks = 0;
  }

  for (const e of edges) {
    const src = nodeById.get(e.sourceId);
    const tgt = nodeById.get(e.targetId);
    if (!src || !tgt) continue;

    const c = Number(e.linkCount ?? 1) || 1;
    src.outLinks += c;
    tgt.inLinks  += c;
  }

  for (const n of nodes) {
    n.totalLinks = (n.inLinks || 0) + (n.outLinks || 0);
    n.radius = 4 + Math.log2(1 + n.totalLinks);
  }
}

function pickCenterNode(app: App, nodes: GraphNode[]): GraphNode | null {
  const settings = getSettings();
  if (!settings.graph.useCenterNote) return null;

  const onlyNotes = nodes.filter(n => n.type === "note");
  if (!onlyNotes.length) return null;

  const preferOut = Boolean(settings.graph.useOutlinkFallback);
  const metric = (n: GraphNode) => (preferOut ? n.outLinks : n.inLinks) || 0;

  // 1) If centerNoteTitle set, try to resolve it.
  const raw = String(settings.graph.centerNoteTitle || "").trim();
  if (raw) {
    try {
      const mc = app.metadataCache as any;

      // Try resolving as linkpath
      let dest: TFile | null = null;
      dest = mc.getFirstLinkpathDest?.(raw, "") ?? null;
      if (!dest && !raw.endsWith(".md")) {
        dest = mc.getFirstLinkpathDest?.(raw + ".md", "") ?? null;
      }

      if (dest?.path) {
        const hit = onlyNotes.find(n => n.id === dest!.path);
        if (hit) return hit;
      }

      // Try direct file path match
      const normB = raw.endsWith(".md") ? raw : raw + ".md";
      const hit2 = onlyNotes.find(n => n.id === raw || n.id === normB);
      if (hit2) return hit2;

      // Try basename match
      const base = raw.endsWith(".md") ? raw.slice(0, -3) : raw;
      const hit3 = onlyNotes.find(n => (n.file?.basename ?? n.label) === base);
      if (hit3) return hit3;
    } catch {
      // fall through to auto-pick
    }
  }

  // 2) Otherwise pick by degree metric
  let best = onlyNotes[0];
  for (const n of onlyNotes) {
    if (metric(n) > metric(best)) best = n;
  }
  return best ?? null;
}

export async function buildGraph(app: App): Promise<GraphData> {
  const settings = getSettings();
  const files = app.vault.getMarkdownFiles();

  // ─────────────────────────────────────────────
  // 1) Build NOTE nodes
  // ─────────────────────────────────────────────
  const nodes: GraphNode[] = [];
  const nodeById = new Map<string, GraphNode>();

  for (const file of files) {
    const id = noteIdFromFile(file);

    const node: GraphNode = {
      id,
      file,
      label: file.basename,

      location:{
        x: cssSafeJitter(50),
        y: cssSafeJitter(50),
        z: cssSafeJitter(50),
      },
      velocity: {vx: 0, vy: 0, vz: 0,},

      type: "note",
      inLinks: 0,
      outLinks: 0,
      totalLinks: 0,
      radius: 0,
    };

    nodes.push(node);
    nodeById.set(id, node);
  }

  // ─────────────────────────────────────────────
  // 2) Build NOTE ↔ NOTE edges from resolvedLinks
  // ─────────────────────────────────────────────
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  const resolved: ResolvedLinks = ((app.metadataCache as any).resolvedLinks || {}) as ResolvedLinks;
  const countDuplicates = Boolean(settings.graph.countDuplicateLinks);

  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath] || {};
    if (!nodeById.has(sourcePath)) continue;

    for (const targetPath of Object.keys(targets)) {
      if (!nodeById.has(targetPath)) continue;

      const rawCount = Number(targets[targetPath] ?? 1) || 1;
      const linkCount = countDuplicates ? rawCount : 1;

      addEdgeOnce(edges, edgeSet, sourcePath, targetPath, linkCount);
    }
  }

  // ─────────────────────────────────────────────
  // 3) TAG nodes + NOTE → TAG edges
  // ─────────────────────────────────────────────
  if (settings.graph.showTags !== false) {
    const mc = app.metadataCache;

    const ensureTagNode = (tagName: string): GraphNode => {
      const id = tagIdFromName(tagName);
      const existing = nodeById.get(id);
      if (existing) return existing;

      const n: GraphNode = {
        id,
        file: undefined,
        label: `#${tagName}`,

        location: { x: 0, y: 0, z: 0, },
        velocity: { vx: 0, vy: 0, vz: 0, },

        type: "tag",
        inLinks: 0,
        outLinks: 0,
        totalLinks: 0,
        radius: 0,
      };

      nodes.push(n);
      nodeById.set(id, n);
      return n;
    };

    for (const file of files) {
      const noteNodeId = noteIdFromFile(file);
      if (!nodeById.has(noteNodeId)) continue;

      const cache = mc.getFileCache(file);
      if (!cache?.tags?.length) continue;

      for (const entry of cache.tags) {
        const tagName = normalizeTag(entry.tag);
        if (!tagName) continue;

        const tagNode = ensureTagNode(tagName);
        addEdgeOnce(edges, edgeSet, noteNodeId, tagNode.id, 1);
      }
    }
  }

  // ─────────────────────────────────────────────
  // 4) Derived properties
  // ─────────────────────────────────────────────
  computeDegreesAndRadii(nodes, nodeById, edges);
  markBidirectionalEdges(edges);

  // ─────────────────────────────────────────────
  // 5) Center node (optional)
  // ─────────────────────────────────────────────
  const centerNode = pickCenterNode(app, nodes);

  return { nodes, edges, centerNode };
}
