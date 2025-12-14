import { App, TFile, CachedMetadata } from 'obsidian';
import { GraphNode, GraphEdge, GraphData, GraphPlusSettings } from '../utilities/interfaces.ts';
import { getSettings } from '../utilities/settingsStore.ts';

interface ResolvedLinks {
  [sourcePath: string]: {
    [targetPath: string]: number; // number = link count
  };
}

export async function buildGraph(app: App): Promise<GraphData> {
  const settings = getSettings();
  const files: TFile[]        = app.vault.getMarkdownFiles();
  const { nodes, nodeByPath } = createNoteNodes(files);
  const { edges, edgeSet    } = buildNoteEdgesFromResolvedLinks(app, nodeByPath);

  if (settings.graph.showTags !== false) {
    addTagNodesAndEdges(app, files, nodes, nodeByPath, edges, edgeSet);
  }
  computeNodeDegrees(nodes, nodeByPath, edges);
  markBidirectionalEdges(edges);
  const centerNode = pickCenterNode(app, nodes);
  return { nodes, edges, centerNode };
}

function createNoteNodes(files: TFile[]){
  const nodes: GraphNode[] = [];
  for (const file of files) {
    const jitter = 50; // world units; tweak to taste
    const x0 = (Math.random() - 0.5) * jitter;
    const y0 = (Math.random() - 0.5) * jitter;
    const node: GraphNode = {
      id          : file.path,
      filePath    : file.path,
      file        : file,
      label       : file.basename,
      x           : x0,
      y           : y0,
      z           : 0,
      vx          : 0,
      vy          : 0,
      vz          : 0,
      inDegree    : 0,
      outDegree   : 0,
      totalDegree : 0,
    };
    nodes.push(node);
  }

  const nodeByPath = new Map<string, GraphNode>();
  for (const n of nodes) nodeByPath.set(n.id, n);

  return { nodes, nodeByPath };
}

function buildNoteEdgesFromResolvedLinks(app: App, nodeByPath: Map<string, GraphNode>): { edges: GraphEdge[]; edgeSet: Set<string> } {
  const settings            = getSettings();
  const resolved: ResolvedLinks = (app.metadataCache as any).resolvedLinks || {};
  const edges: GraphEdge[]  = [];
  const edgeSet             = new Set<string>();
  const countDuplicates     = Boolean(settings.graph.countDuplicateLinks);

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
      id          : `tag:${tagName}`,
      label       : `#${tagName}`,
      x           : 0,
      y           : 0,
      z           : 0,
      vx          : 0,
      vy          : 0,
      vz          : 0,
      filePath    : `tag:${tagName}`,
      type        : 'tag',
      inDegree    : 0,
      outDegree   : 0,
      totalDegree : 0,
    };

    nodes.push(node);
    tagNodeByName.set(tagName, node);
    nodeByPath.set(node.id, node);

    return node;
  };
}

function pickCenterNode(app: App, nodes: GraphNode[]): GraphNode | null {
  const settings = getSettings();
  if (!settings.graph.useCenterNote) return null;

  let centerNode = undefined;

  // if centerNoteTitle is defined, use it.
  if (settings.graph.centerNoteTitle) {
    centerNode = nodes.find((n) => n.id === settings.graph.centerNoteTitle);
    if (centerNode !== undefined) return centerNode; // if found, return it
  }

  // ...else calculate it. settings.graph.useOutlinkFallback as alternative
  const onlyNotes = nodes.filter((n) => n.type !== 'tag');
  const preferOut = Boolean(settings.graph.useOutlinkFallback);
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
  const raw = String(settings.graph.centerNoteTitle || '').trim();

  if (raw) {
    const mc = app.metadataCache as unknown as {
      resolvedLinks: ResolvedLinks;
      getFirstLinkpathDest(path: string, source: string): TFile | null;
    };

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