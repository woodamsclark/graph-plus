import { App } from "obsidian";
import type { DataStoragePlugin } from "../types/domain/graph.ts";


export type GraphDeps = {
  app:    App;
  plugin: DataStoragePlugin | null;
};
