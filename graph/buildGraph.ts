import { App, TFile } from 'obsidian';

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
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
    label: file.basename,
    x: 0,
    y: 0,
    z: 0,
  }));

  // map for resolving paths to nodes
  const nodeByPath = new Map<string, GraphNode>();
  for (const n of nodes) nodeByPath.set(n.id, n);

  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  for (const file of files) {
    const cache: any = app.metadataCache.getFileCache(file);
    if (!cache || !cache.links) continue;

    for (const linkEntry of cache.links) {
      const linkPath = linkEntry.link;
      if (!linkPath) continue;

      const destFile = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
      if (!destFile) continue;
      if (!nodeByPath.has(destFile.path)) continue;

      const sourceId = file.path;
      const targetId = destFile.path;
      const key = `${sourceId}->${targetId}`;
      if (!edgeSet.has(key)) {
        edges.push({ sourceId, targetId });
        edgeSet.add(key);
      }
    }
  }

  return { nodes, edges };
}
