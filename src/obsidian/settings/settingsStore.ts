import type { GraphPlusSettings } from '../shared/interfaces';

let currentSettings: GraphPlusSettings;
const listeners = new Set<() => void>();

export function initSettings(initial: GraphPlusSettings) {
  currentSettings = initial;
}

export function getSettings(): GraphPlusSettings {
  return currentSettings;
}

export function updateSettings(mutator: (s: GraphPlusSettings) => void) {
  mutator(currentSettings);
  for (const l of listeners) l();
}

export function onSettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
