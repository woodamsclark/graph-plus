import type { App } from "obsidian";
import { GraphStore } from "../the garden/adam/GraphStore.ts";
import type { GraphData } from "../the garden/adam/interfaces.ts";

type DataStoragePlugin = {
  loadData: () => Promise<any>;
  saveData: (data: any) => Promise<void>;
};

type GraphStoreDeps = {
  getApp: () => App;
  getPlugin: () => DataStoragePlugin | null;
};

export class ObsidianGraphSource {
  private store: GraphStore;

  constructor(deps: GraphStoreDeps) {
    this.store = new GraphStore(deps);
  }

  async rebuild(): Promise<GraphData | null> {
    await this.store.rebuild();
    return this.store.get();
  }

  save(): void {
    this.store.save();
  }
}
