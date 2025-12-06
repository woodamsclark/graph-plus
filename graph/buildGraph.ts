import { App, TFile, CachedMetadata } from 'obsidian';
import { GraphNode, GraphEdge, GraphData, Settings } from '../types/interfaces.ts';
import { DEFAULT_SETTINGS } from '../main';

export async function buildGraph(app: App): Promise<GraphData> {
  const files: TFile[]        = app.vault.getMarkdownFiles();
  const { nodes, nodeByPath } = createNoteNodes(files);
  const { edges, edgeSet    } = buildNoteEdgesFromResolvedLinks(app, nodeByPath);

  if (DEFAULT_SETTINGS.showTags !== false) {
    addTagNodesAndEdges(app, files, nodes, nodeByPath, edges, edgeSet);
  }
  computeNodeDegrees(nodes, nodeByPath, edges);
  markBidirectionalEdges(edges);
  const centerNode = pickCenterNode(app, nodes, DEFAULT_SETTINGS);
  markCenterNode(nodes, centerNode);
  return { nodes, edges };
}

function createNoteNodes(files: TFile[]){
  const nodes: GraphNode[] = [];
  for (const file of files) {
    const jitter = 50; // world units; tweak to taste
    const x0 = (Math.random() - 0.5) * jitter;
    const y0 = (Math.random() - 0.5) * jitter;
    const node: GraphNode = {
      id: file.path,
      filePath: file.path,
      file: file,
      label: file.basename,
      x: x0,
      y: y0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0,
      isCenterNode: false,
    };
    nodes.push(node);
  }

  const nodeByPath = new Map<string, GraphNode>();
  for (const n of nodes) nodeByPath.set(n.id, n);

  return { nodes, nodeByPath };
}

function buildNoteEdgesFromResolvedLinks(app: App, nodeByPath: Map<string, GraphNode>): { edges: GraphEdge[]; edgeSet: Set<string> } {
  const resolved: any       = (app.metadataCache as any).resolvedLinks || {};
  const edges: GraphEdge[]  = [];
  const edgeSet             = new Set<string>();
  const countDuplicates     = Boolean(DEFAULT_SETTINGS.countDuplicateLinks);

  for (const sourcePath of Object.keys(resolved)) {
    const targets = resolved[sourcePath] || {};
    for (const targetPath of Object.keys(targets)) {
      if (!nodeByPath.has(sourcePath) || !nodeByPath.has(targetPath)) continue;

      const key       = `${sourcePath}->${targetPath}`;
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
  return { edges, edgeSet };
}

function computeNodeDegrees(nodes: GraphNode[], nodeByPath: Map<string, GraphNode>, edges: GraphEdge[]): void {
  for (const e of edges) {
    const src = nodeByPath.get(e.sourceId);
    const tgt = nodeByPath.get(e.targetId);

    if (!src || !tgt) continue;
    const c       = Number(e.linkCount  || 1) || 1;
    src.outDegree = (src.outDegree      || 0) + c;
    tgt.inDegree  = (tgt.inDegree       || 0) + c;
  }

  for (const n of nodes) { n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0); }
}

function markBidirectionalEdges(edges: GraphEdge[]): void {
  const edgeMap = new Map<string, GraphEdge>();
  for (const e of edges) { edgeMap.set(`${e.sourceId}->${e.targetId}`, e); }
  for (const e of edges) {
    const reverseKey = `${e.targetId}->${e.sourceId}`;
    if (edgeMap.has(reverseKey)) {
      e.bidirectional     = true;
      const other         = edgeMap.get(reverseKey)!;
      other.bidirectional = true;
    }
  }
}

function addTagNodesAndEdges(
  app       : App,
  files     : TFile[],
  nodes     : GraphNode[],
  nodeByPath: Map<string, GraphNode>,
  edges     : GraphEdge[],
  edgeSet   : Set<string>,
): void {
  const tagNodeByName = new Map<string, GraphNode>();
  const ensureTagNode = (tagName: string): GraphNode => {
    let node = tagNodeByName.get(tagName);
    if (node) return node;

    node = {
      id: `tag:${tagName}`,
      label: `#${tagName}`,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      filePath: `tag:${tagName}`,
      type: 'tag',
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0,
    };

    nodes.push(node);
    tagNodeByName.set(tagName, node);
    nodeByPath.set(node.id, node);

    return node;
  };

  // ...existing extractTags + loop over files, same as before...
}

function pickCenterNode(app: App, nodes: GraphNode[], settings: Settings): GraphNode | null {
  if (!settings.usePinnedCenterNote) return null;

  const onlyNotes = nodes.filter((n) => (n as any).type !== 'tag');
  const preferOut = Boolean(settings.useOutlinkFallback);
  const metric = (n: GraphNode) => (preferOut ? n.outDegree || 0 : n.inDegree || 0);

  const chooseBy = (predicate: (n: GraphNode) => boolean): GraphNode | null => {
    let best: GraphNode | null = null;
    for (const n of onlyNotes) {
      if (!predicate(n)) continue;
      if (!best || metric(n) > metric(best)) {
        best = n;
      }
    }
    return best;
  };

  let chosen: GraphNode | null = null;
  const raw = String(settings.pinnedCenterNotePath || '').trim();

  if (raw) {
    const mc    : any = (app as any).metadataCache;
    let resolved: any = null;

    try {
      resolved = mc?.getFirstLinkpathDest?.(raw, '');
      if (!resolved && !raw.endsWith('.md')) {
        resolved = mc?.getFirstLinkpathDest?.(raw + '.md', '');
      }
    } catch {}

    if (resolved?.path) {
      chosen = chooseBy((n) => n.filePath === resolved.path);
    }

    if (!chosen) {
      const normA = raw;
      const normB = raw.endsWith('.md') ? raw : raw + '.md';
      chosen = chooseBy((n) => n.filePath === normA || n.filePath === normB);
    }

    if (!chosen) {
      const base    = raw.endsWith('.md') ? raw.slice(0, -3) : raw;
      chosen        = chooseBy((n) => {
        const file  = (n as any).file;
        const bn    = file?.basename || n.label;
        return String(bn) === base;
      });
    }
  }

  if (!chosen) {
    for (const n of onlyNotes) {
      if (!chosen || metric(n) > metric(chosen)) {
        chosen = n;
      }
    }
  }
  return chosen;
}

function markCenterNode(nodes: GraphNode[], centerNode: GraphNode | null): void {
  for (const n of nodes) { (n as any).isCenterNode          = false;  }
  if (centerNode)        { (centerNode as any).isCenterNode = true;   }
}
