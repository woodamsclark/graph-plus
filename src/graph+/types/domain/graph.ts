import type { TFile } from 'obsidian';
import type { Location, Velocity } from './math.ts';

export type NodeType = 'note' | 'tag' | 'canvas';

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
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  bidirectional?: boolean;
  length: number;
  strength: number;
  thickness: number;
  gate: GateState;
}

export interface GraphData {
  nodes: Node[];
  links: Link[];
  linksOut: Record<string, Record<string, number>>;
  linksIn: Record<string, Record<string, number>>;
}

export interface GraphModuleLike {
  get():        GraphData | null;
  hasGraph():   boolean;
  clear():      void;
}