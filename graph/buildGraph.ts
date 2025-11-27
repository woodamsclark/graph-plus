import { App, TFile } from 'obsidian';

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
