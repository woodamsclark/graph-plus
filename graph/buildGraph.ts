import { App, TFile, CachedMetadata } from 'obsidian';

export type GraphNodeType = 'note' | 'tag';

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  filePath: string;
  file?: TFile;
  vx?: number;
  vy?: number;
  vz?: number;
  type?: GraphNodeType;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
}

export interface GraphEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  // number of links from source -> target (resolvedLinks count)
  linkCount?: number;
  // whether the reverse edge (target->source) exists
  hasReverse?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function buildGraph(app: App, options?: { countDuplicates?: boolean }): Promise<GraphData> {
  const files: TFile[] = app.vault.getMarkdownFiles();

  const nodes: GraphNode[] = files.map((file) => ({
    id: file.path,
    filePath: file.path,
    file: file,
    label: file.basename,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    type: 'note',
    inDegree: 0,
    outDegree: 0,
    totalDegree: 0,
  }));

  // map for resolving paths to nodes
  const nodeByPath = new Map<string, GraphNode>();
  for (const n of nodes) nodeByPath.set(n.id, n);

  // Prefer using Obsidian's resolvedLinks map so our edges match the
  // core graph connections exactly. `resolvedLinks` maps sourcePath -> { destPath: count }
  // and already resolves linkpaths; iterate that structure instead of walking per-file caches.
  const resolved: any = (app.metadataCache as any).resolvedLinks || {};

  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  const countDuplicates = Boolean(options?.countDuplicates);

  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath] || {};
    for (const targetPath of Object.keys(targets)) {
      // only add edges between files we actually included as nodes
      if (!nodeByPath.has(sourcePath) || !nodeByPath.has(targetPath)) continue;
      const key = `${sourcePath}->${targetPath}`;
      if (!edgeSet.has(key)) {
        const rawCount = Number(targets[targetPath] || 1) || 1;
        const linkCount = countDuplicates ? rawCount : 1;
        edges.push({ id: key, sourceId: sourcePath, targetId: targetPath, linkCount, hasReverse: false });
        edgeSet.add(key);
      }
    }
  }

  // Build tag nodes and note->tag edges
  // Tag node id format: `tag:<name>`; label: `#<name>`; type: 'tag'
  const tagNodeByName = new Map<string, GraphNode>();
  function ensureTagNode(tagName: string): GraphNode {
    let n = tagNodeByName.get(tagName);
    if (n) return n;
    n = {
      id: `tag:${tagName}`,
      label: `#${tagName}`,
      x: 0,
      y: 0,
      z: 0,
      filePath: '',
      vx: 0,
      vy: 0,
      vz: 0,
      type: 'tag',
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0,
    };
    nodes.push(n);
    tagNodeByName.set(tagName, n);
    nodeByPath.set(n.id, n);
    return n;
  }

  function extractTags(cache: CachedMetadata | null): string[] {
    if (!cache) return [];
    const found: string[] = [];
    try {
      // inline tags: cache.tags?: Array<{ tag: string }>
      const inline = (cache as any).tags as Array<{ tag: string }> | undefined;
      if (Array.isArray(inline)) {
        for (const t of inline) {
          if (!t || !t.tag) continue;
          const raw = t.tag.startsWith('#') ? t.tag.slice(1) : t.tag;
          if (raw) found.push(raw);
        }
      }
    } catch {}
    try {
      // frontmatter tags: tags or tag; can be string or array
      const fm = (cache as any).frontmatter || {};
      const vals: any[] = [];
      if (fm) {
        if (Array.isArray(fm.tags)) vals.push(...fm.tags);
        else if (typeof fm.tags === 'string') vals.push(fm.tags);
        if (Array.isArray(fm.tag)) vals.push(...fm.tag);
        else if (typeof fm.tag === 'string') vals.push(fm.tag);
      }
      for (const v of vals) {
        if (!v) continue;
        if (typeof v === 'string') {
          const s = v.startsWith('#') ? v.slice(1) : v;
          if (s) found.push(s);
        }
      }
    } catch {}
    // de-duplicate
    const uniq = Array.from(new Set(found));
    return uniq;
  }

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file) as CachedMetadata | null;
    const tags = extractTags(cache);
    if (!tags || tags.length === 0) continue;
    const noteNode = nodeByPath.get(file.path);
    if (!noteNode) continue;
    for (const tagName of tags) {
      const tagNode = ensureTagNode(tagName);
      const key = `${noteNode.id}->${tagNode.id}`;
      if (!edgeSet.has(key)) {
        edges.push({ id: key, sourceId: noteNode.id, targetId: tagNode.id, linkCount: 1, hasReverse: false });
        edgeSet.add(key);
      }
    }
  }

  // compute in/out/total degrees directly from edges using linkCount
  for (const e of edges) {
    const src = nodeByPath.get(e.sourceId);
    const tgt = nodeByPath.get(e.targetId);
    if (!src || !tgt) continue;
    const c = Number(e.linkCount || 1) || 1;
    src.outDegree = (src.outDegree || 0) + c;
    tgt.inDegree = (tgt.inDegree || 0) + c;
  }

  for (const n of nodes) {
    n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0);
  }

  // detect mutual edges (reverse links) and mark hasReverse on both
  const edgeMap = new Map<string, GraphEdge>();
  for (const e of edges) {
    edgeMap.set(`${e.sourceId}->${e.targetId}`, e);
  }
  for (const e of edges) {
    const reverseKey = `${e.targetId}->${e.sourceId}`;
    if (edgeMap.has(reverseKey)) {
      e.hasReverse = true;
      const other = edgeMap.get(reverseKey)!;
      other.hasReverse = true;
    }
  }

  return { nodes, edges };
}
