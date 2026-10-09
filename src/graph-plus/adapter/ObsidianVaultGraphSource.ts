import type { App, TFile } from 'obsidian';
import type { VaultGraphNoteV1, VaultGraphSnapshotV1 } from './VaultGraphAdapter.ts';

interface ResolvedLinks {
  readonly [sourcePath: string]: Readonly<Record<string, number>>;
}

export class ObsidianVaultGraphSourceV1 {
  private inFlight?: Promise<VaultGraphSnapshotV1<TFile>>;

  constructor(private readonly app: App) {}

  async read(): Promise<VaultGraphSnapshotV1<TFile>> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.readFresh().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async readFresh(): Promise<VaultGraphSnapshotV1<TFile>> {
    const files = this.app.vault.getMarkdownFiles();
    const notes = files.map((file) => this.readNote(file));
    const cache = this.app.metadataCache as unknown as { readonly resolvedLinks?: ResolvedLinks };
    return {
      vaultId: this.app.vault.getName(),
      notes,
      resolvedLinks: cache.resolvedLinks ?? {},
    };
  }

  private readNote(file: TFile): VaultGraphNoteV1<TFile> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = isRecord(cache?.frontmatter) ? cache.frontmatter : {};
    const tags = new Set<string>();
    for (const tag of cache?.tags ?? []) if (typeof tag.tag === 'string') tags.add(normalizeTag(tag.tag));
    const frontmatterTags = frontmatter.tags ?? frontmatter.tag;
    if (typeof frontmatterTags === 'string') {
      for (const tag of frontmatterTags.split(/[,\s]+/)) if (tag) tags.add(normalizeTag(tag));
    } else if (Array.isArray(frontmatterTags)) {
      for (const tag of frontmatterTags) if (typeof tag === 'string') tags.add(normalizeTag(tag));
    }
    const properties: Record<string, readonly string[]> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === 'position') continue;
      const values = flattenValues(value);
      if (values.length > 0) properties[key.toLowerCase()] = values;
    }
    const extended = (cache ?? {}) as unknown as { readonly frontmatterLinks?: readonly { readonly key?: string; readonly link?: string }[] };
    const frontmatterLinks = (extended.frontmatterLinks ?? []).flatMap((entry) => {
      if (!entry.key || !entry.link) return [];
      const target = this.app.metadataCache.getFirstLinkpathDest(entry.link, file.path);
      return target ? [{ relation: entry.key, targetPath: target.path }] : [];
    });
    return {
      file,
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      tags: [...tags].filter(Boolean).sort(),
      properties,
      frontmatterLinks,
    };
  }
}

function flattenValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (isRecord(value)) return Object.entries(value).flatMap(([key, nested]) => [key.toLowerCase(), ...flattenValues(nested)]);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return [String(value).toLowerCase()];
  }
  return []; // Functions and symbols are not searchable frontmatter values.
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/^#/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
