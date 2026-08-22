export type GraphPlusLookupEntryV1<TFile> =
  | { readonly kind: 'note'; readonly file: TFile }
  | { readonly kind: 'tag'; readonly tag: string };

export class GraphPlusLookupV1<TFile> {
  private readonly entries = new Map<string, GraphPlusLookupEntryV1<TFile>>();

  setNote(nodeId: string, file: TFile): void {
    this.entries.set(nodeId, { kind: 'note', file });
  }

  setTag(nodeId: string, tag: string): void {
    this.entries.set(nodeId, { kind: 'tag', tag });
  }

  get(nodeId: string): GraphPlusLookupEntryV1<TFile> | undefined {
    return this.entries.get(nodeId);
  }

  has(nodeId: string): boolean {
    return this.entries.has(nodeId);
  }
}
