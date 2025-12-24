import { debounce } from '../shared/debounce.ts';
import { GraphDependencies } from './GraphController.ts';

export class NodePositionStore {
    private deps            : GraphDependencies;
    private saveDebounced   : () => void;

    constructor(deps: GraphDependencies) {
        this.deps           = deps;
        this.saveDebounced  = debounce(() => this.saveNodePositions(), 2000, true);
    }

    public saveSoon(): void {
        this.saveDebounced();
    } 

    public saveNodePositions(): void {
        try {
            const graph     = this.deps.getGraph();
            
            const app       = this.deps.getApp();
            const vaultId   = app.vault.getName();
            const plugin    = this.deps.getPlugin();

            if (!vaultId || !graph || !app || !plugin) return;

            const allSaved  = plugin.settings.nodePositions || {};            

            if (!allSaved[vaultId]) {
                allSaved[vaultId]   = {};
            }

            const map = allSaved[vaultId];

            for (const node of graph.nodes) {
                if (!Number.isFinite(node.x) || !Number.isFinite(node.y))   continue;
                if (!node.filePath)                                         continue;

                map[node.filePath] = { x: node.x, y: node.y, z: node.z };
            }

            plugin.settings.nodePositions = allSaved;
            try { plugin.saveSettings && plugin.saveSettings(); } 
            catch (e) { console.error('Failed to save node positions', e); }
        } catch (e) { console.error('Greater Graph: saveNodePositions error', e); }
    }
}