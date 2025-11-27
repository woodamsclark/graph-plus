import { App, TFile } from 'obsidian';

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
  inDegree: number;
  outDegree: number;
  totalDegree: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function buildGraph(app: App): Promise<GraphData> {
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
    inDegree: 0,
    outDegree: 0,
    totalDegree: 0,
  }));

  // map for resolving paths to nodes
  const nodeByPath = new Map<string, GraphNode>();
  for (const n of nodes) nodeByPath.set(n.id, n);

  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  // Prefer using Obsidian's resolvedLinks map so our edges match the
  // core graph connections exactly. `resolvedLinks` maps sourcePath -> { destPath: count }
  // and already resolves linkpaths; iterate that structure instead of walking per-file caches.
  const resolved: any = (app.metadataCache as any).resolvedLinks || {};
  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath] || {};
    for (const targetPath of Object.keys(targets)) {
      // only add edges between files we actually included as nodes
      if (!nodeByPath.has(sourcePath) || !nodeByPath.has(targetPath)) continue;
      const key = `${sourcePath}->${targetPath}`;
      if (!edgeSet.has(key)) {
        edges.push({ sourceId: sourcePath, targetId: targetPath });
        edgeSet.add(key);
      }
    }
  }
  // compute in/out/total degrees directly from edges
  for (const e of edges) {
    const src = nodeByPath.get(e.sourceId);
    const tgt = nodeByPath.get(e.targetId);
    if (!src || !tgt) continue;
    src.outDegree = (src.outDegree || 0) + 1;
    tgt.inDegree = (tgt.inDegree || 0) + 1;
  }

  for (const n of nodes) {
    n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0);
  }

  return { nodes, edges };
}
