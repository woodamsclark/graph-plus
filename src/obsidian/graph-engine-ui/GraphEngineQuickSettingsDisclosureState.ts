export class GraphEngineQuickSettingsDisclosureStateV1 {
  private readonly openBySection = new Map<string, boolean>();

  resolve(sectionId: string, defaultOpen: boolean): boolean {
    return this.openBySection.get(sectionId) ?? defaultOpen;
  }

  remember(sectionId: string, open: boolean): void {
    this.openBySection.set(sectionId, open);
  }
}
