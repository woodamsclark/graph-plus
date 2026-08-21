import type { TFile } from 'obsidian';
import type { Location, Velocity } from './math.ts';

export type NodeType = 'note' | 'tag' | 'canvas' | 'attachment' | 'unresolved';

export type NodeFacets = {
  path?: string;
  extension?: string;
  tags: string[];
  properties: Record<string, string[]>;
  searchText: string;
};

export type NodeView = {
  color?: string;
  branchId?: string;
  depth?: number;
  role?: 'root' | 'branch' | 'leaf' | 'disconnected';
};

export type LinkView = {
  color?: string;
  role?: 'tree' | 'cross';
};

export type AnimaState = {
  level: number;
  capacity: number;
};

export type GateState = {
  state: 'open' | 'closed';
  threshold: number;
  hysteresis: number;
};

export interface Node {
  id: string;
  label: string;
  location: Location;
  velocity: Velocity;
  type: NodeType;
  radius: number;
  anima: AnimaState;
  file?: TFile;
  facets: NodeFacets;
  view?: NodeView;
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  bidirectional?: boolean;
  length: number;
  strength: number;
  thickness: number;
  weight: number;
  relations: string[];
  gate: GateState;
  view?: LinkView;
}

export interface GraphData {
  nodes:    Node[];
  links:    Link[];
  linksOut: Record<string, Record<string, number>>;
  linksIn:  Record<string, Record<string, number>>;
  projection: {
    mode: 'free' | 'mind-map';
    sourceNodeCount: number;
    sourceLinkCount: number;
    rootId?: string;
    queryError?: string;
  };
}

export interface GraphAccessor {
  get():        GraphData | null;
  hasGraph():   boolean;
  destroy():      void;
}

export type WeightedEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
  relation?: string;
};

export type DataStoragePlugin = {
    loadData: () => Promise<any>;
    saveData: (data: any) => Promise<void>;
};

export type PersistedGraphState = {
    version: number;
    vaultId: string;
    nodePositions: Record<string, { x: number; y: number; z: number }>;
};
