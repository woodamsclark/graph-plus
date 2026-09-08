import { Component, MarkdownRenderer, type App, type TFile } from 'obsidian';
import { GraphPlusNotePreviewControllerV1 } from './GraphPlusNotePreviewController.ts';

/** Shared Obsidian Markdown host for global and local graph+ preview surfaces. */
export function createGraphPlusNotePreviewControllerV1(options: {
  readonly app: App;
  readonly container: HTMLElement;
  readonly isVisible: () => boolean;
  readonly onPreviewSurfaceActive: (active: boolean) => void | Promise<void>;
  readonly onDismissRequested: () => void | Promise<void>;
}): GraphPlusNotePreviewControllerV1<TFile> {
  return new GraphPlusNotePreviewControllerV1({
    container: options.container,
    isVisible: options.isVisible,
    readFile: (file) => options.app.vault.cachedRead(file),
    renderMarkdown: async (markdown, element, sourcePath) => {
      const component = new Component();
      component.load();
      try {
        await MarkdownRenderer.render(options.app, markdown, element, sourcePath, component);
        return { dispose: () => component.unload() };
      } catch (error) {
        component.unload();
        throw error;
      }
    },
    openFile: (file) => options.app.workspace.getLeaf(false).openFile(file),
    openLink: (link, sourcePath, newLeaf) => options.app.workspace.openLinkText(link, sourcePath, newLeaf),
    onPreviewSurfaceActive: options.onPreviewSurfaceActive,
    onDismissRequested: options.onDismissRequested,
  });
}
