import { MarkdownView, type App, type EventRef, type TFile } from 'obsidian';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import type {
  GraphPlusHostEventV1,
  GraphPlusNavigatorV1,
} from '../graph-plus/application/index.ts';
import type { Disposable } from '../graph-engine/public.ts';

/** The single inbound and outbound boundary between Obsidian and Graph+. */
export class ObsidianGraphBridgeV1 implements GraphPlusNavigatorV1<TFile> {
  private refs: Array<{ readonly owner: { offref(ref: EventRef): void }; readonly ref: EventRef }> = [];
  private listener?: (event: GraphPlusHostEventV1) => void;

  constructor(private readonly app: App) {}

  start(listener: (event: GraphPlusHostEventV1) => void): Disposable {
    if (this.listener) throw new Error('ObsidianGraphBridge is already connected.');
    this.listener = listener;
    const invalidate = (): void => listener({ type: 'canonical-vault-invalidated' });
    this.track(this.app.vault, this.app.vault.on('create', invalidate));
    this.track(this.app.vault, this.app.vault.on('modify', invalidate));
    this.track(this.app.vault, this.app.vault.on('delete', invalidate));
    this.track(this.app.vault, this.app.vault.on('rename', invalidate));
    this.track(this.app.metadataCache, this.app.metadataCache.on('changed', invalidate));
    this.track(this.app.workspace, this.app.workspace.on('active-leaf-change', () => {
      listener({ type: 'active-note-changed', nodeId: this.activeNoteNodeId() });
    }));
    this.track(this.app.workspace, this.app.workspace.on('file-open', (file) => {
      listener({
        type: 'active-note-changed',
        nodeId: file?.extension === 'md' ? noteNodeId(file.path) : undefined,
      });
    }));
    return { dispose: () => this.stop() };
  }

  activeNoteNodeId(): string | undefined {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file
      ?? this.app.workspace.getActiveFile();
    return file?.extension === 'md' ? noteNodeId(file.path) : undefined;
  }

  async openNote(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async openTag(tag: string): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType('search')[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: 'search', active: true, state: { query: `tag:#${tag}` } }, { focus: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private track(owner: { offref(ref: EventRef): void }, ref: EventRef): void {
    this.refs.push({ owner, ref });
  }

  private stop(): void {
    for (const { owner, ref } of this.refs.splice(0)) owner.offref(ref);
    this.listener = undefined;
  }
}
