import { App, TFile } from 'obsidian';

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface GraphData {
  nodes: GraphNode[];
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

  return { nodes };
}
