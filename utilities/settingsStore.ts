import type { Settings } from './Interfaces';

let currentSettings: Settings;
const listeners = new Set<() => void>();

export function initSettings(initial: Settings) {
  currentSettings = initial;
}

export function getSettings(): Settings {
  return currentSettings;
}

export function updateSettings(mutator: (s: Settings) => void) {
  mutator(currentSettings);
  for (const l of listeners) l();
}

export function onSettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
