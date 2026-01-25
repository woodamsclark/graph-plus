import type { App } from "obsidian";
import { Graph } from "../graph+/Graph.ts";
import type { GraphData } from "../graph+/grammar/interfaces.ts";

type DataStoragePlugin = {
  loadData: () => Promise<any>;
  saveData: (data: any) => Promise<void>;
};

type GraphStoreDeps = {
  getApp: () => App;
  getPlugin: () => DataStoragePlugin | null;
};

export class ObsidianGraphSource {
  private store: Graph;

  constructor(deps: GraphStoreDeps) {
    this.store = new Graph(deps);
  }

  async rebuild(): Promise<GraphData | null> {
    await this.store.rebuild();
    return this.store.get();
  }

  save(): void {
    this.store.save();
  }
}
