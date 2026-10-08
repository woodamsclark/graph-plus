import type { SearchResult } from 'obsidian';

// Obsidian provides this API at runtime; the npm package contains types only.
// This host double exercises Graph+ indexing/filtering, not Obsidian's matcher implementation.
export let lastSimpleSearchQuery: string | undefined;
export let simpleSearchPreparations = 0;

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
  lastSimpleSearchQuery = query;
  simpleSearchPreparations += 1;
  const words = query.toLowerCase().trim().split(/\s+/);
  return (text) => words.every((word) => text.toLowerCase().includes(word))
    ? { score: 0, matches: [] }
    : null;
}
