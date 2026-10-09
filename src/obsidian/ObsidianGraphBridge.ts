import { MarkdownView, type App, type EventRef, type Events, type TFile } from 'obsidian';
import { noteNodeId } from '../graph-plus/adapter/index.ts';
import type {
  GraphPlusUnconsciousActivityV1,
  GraphPlusNavigatorV1,
} from '../graph-plus/application/index.ts';
import type { Disposable } from '../graph-engine/public.ts';

/** The single inbound and outbound boundary between Obsidian and Graph+. */
export class ObsidianGraphBridgeV1 implements GraphPlusNavigatorV1<TFile> {
  private refs: Array<{ readonly owner: { offref(ref: EventRef): void }; readonly ref: EventRef }> = [];
  private hoveredLink?: Element;
  private hoveredNodeId?: string;
  private hoverDocument?: Document;
  private listener?: (event: GraphPlusUnconsciousActivityV1) => void;

  constructor(private readonly app: App) {}

  start(listener: (event: GraphPlusUnconsciousActivityV1) => void): Disposable {
    if (this.listener) throw new Error('ObsidianGraphBridge is already connected.');
    this.listener = listener;
    const invalidate = (): void => listener({ type: 'canonical-vault-invalidated' });
    this.track(this.app.vault, this.app.vault.on('create', invalidate));
    this.track(this.app.vault, this.app.vault.on('modify', invalidate));
    this.track(this.app.vault, this.app.vault.on('delete', invalidate));
    this.track(this.app.vault, this.app.vault.on('rename', invalidate));
    this.track(this.app.metadataCache, this.app.metadataCache.on('changed', invalidate));
    this.track(this.app.workspace, this.app.workspace.on('layout-change', () => {
      listener({ type: 'workspace-layout-changed' });
    }));
    this.track(this.app.workspace, this.app.workspace.on('active-leaf-change', () => {
      listener({ type: 'active-note-changed', nodeId: this.activeNoteNodeId(), timestamp: Date.now() });
    }));
    this.track(this.app.workspace, this.app.workspace.on('file-open', (file) => {
      listener({
        type: 'active-note-changed',
        nodeId: file?.extension === 'md' ? noteNodeId(file.path) : undefined,
        timestamp: Date.now(),
      });
    }));
    this.track(this.app.workspace, (this.app.workspace as Events).on('hover-link', (...args: unknown[]) => {
      const info = args[0] as { linktext?: string; sourcePath?: string; targetEl?: HTMLElement };
      if (info?.linktext && info.targetEl?.closest('.markdown-source-view, .markdown-preview-view')) {
        this.hoverLink(info.targetEl, info.linktext, info.sourcePath ?? '');
      }
    }));
    this.hoverDocument = this.app.workspace.containerEl.ownerDocument;
    this.hoverDocument.addEventListener('mouseover', this.onLinkMouseOver, true);
    this.hoverDocument.addEventListener('mouseout', this.onLinkMouseOut, true);
    listener({ type: 'active-note-changed', nodeId: this.activeNoteNodeId(), timestamp: Date.now() });
    return { dispose: () => this.stop() };
  }

  private readonly onLinkMouseOver = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const link = target?.closest?.('.internal-link, .cm-hmd-internal-link, .cm-link');
    if (!link?.closest('.markdown-source-view, .markdown-preview-view')) return;
    const sourceView = this.app.workspace.getLeavesOfType('markdown')
      .find(leaf => leaf.view.containerEl.contains(link))?.view;
    const sourcePath = (sourceView instanceof MarkdownView ? sourceView.file?.path : undefined)
      ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path
      ?? this.app.workspace.getActiveFile()?.path ?? '';
    const text = link.getAttribute('data-href') ?? link.getAttribute('href') ?? link.textContent ?? '';
    this.hoverLink(link, text, sourcePath);
  };

  private readonly onLinkMouseOut = (event: MouseEvent): void => {
    if (!this.hoveredLink) return;
    const target = event.target as Node | null;
    const next = event.relatedTarget as Node | null;
    if (target && this.hoveredLink.contains(target) && (!next || !this.hoveredLink.contains(next))) {
      this.hoveredLink = undefined;
      this.hoveredNodeId = undefined;
      this.listener?.({ type: 'document-link-hovered' });
    }
  };

  private hoverLink(element: Element, text: string, sourcePath: string): void {
    const linkpath = text.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0];
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    const nodeId = file?.extension === 'md' ? noteNodeId(file.path) : undefined;
    this.hoveredLink = element;
    if (nodeId === this.hoveredNodeId) return;
    this.hoveredNodeId = nodeId;
    this.listener?.({ type: 'document-link-hovered', nodeId });
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
    this.hoverDocument?.removeEventListener('mouseover', this.onLinkMouseOver, true);
    this.hoverDocument?.removeEventListener('mouseout', this.onLinkMouseOut, true);
    this.hoverDocument = undefined;
    this.hoveredLink = undefined;
    this.hoveredNodeId = undefined;
    for (const { owner, ref } of this.refs.splice(0)) owner.offref(ref);
    this.listener = undefined;
  }
}
