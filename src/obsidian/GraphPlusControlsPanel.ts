import { Menu, Notice, Setting, setIcon } from 'obsidian';
import type { Disposable, GraphNodeContextRequestedIntentV1, GraphViewStateV1 } from '../graph-engine/public.ts';
import type { GraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import type { GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';

export class GraphPlusControlsPanelV1<TFile> {
  private root?: HTMLDivElement;
  private status?: HTMLDivElement;
  private collapsed = false;
  private filterTimer: number | undefined;
  private lensFrame: number | undefined;
  private pendingLens?: MutableLens;
  private intentSubscription?: Disposable;
  private viewState?: GraphViewStateV1;

  constructor(
    private readonly container: HTMLElement,
    private readonly consumer: GraphPlusConsumerV1<TFile>,
  ) {}

  mount(): void {
    if (this.root) return;
    this.root = this.container.ownerDocument.createElement('div');
    this.root.className = 'graphplus-graph-controls graph-controls';
    this.root.addEventListener('pointerdown', stopPropagation);
    this.root.addEventListener('wheel', stopPropagation);
    this.container.append(this.root);
    this.intentSubscription = this.consumer.getSession()?.onIntent((intent) => {
      if (intent.type === 'node-context-requested') this.openContextMenu(intent);
      if (intent.type === 'selection-changed' || intent.type === 'focus-changed' || intent.type === 'node-drag-ended') {
        void this.refreshViewState(true);
      }
    });
    this.render();
    void this.refreshViewState(true);
  }

  unmount(): void {
    if (this.filterTimer !== undefined) this.container.ownerDocument.defaultView?.clearTimeout(this.filterTimer);
    if (this.lensFrame !== undefined) this.container.ownerDocument.defaultView?.cancelAnimationFrame(this.lensFrame);
    if (this.pendingLens) void this.consumer.setLens(this.pendingLens);
    this.filterTimer = undefined;
    this.lensFrame = undefined;
    this.pendingLens = undefined;
    this.intentSubscription?.dispose();
    this.intentSubscription = undefined;
    this.root?.remove();
    this.root = undefined;
    this.status = undefined;
  }

  refresh(): void {
    this.updateStatus();
    void this.refreshViewState(false);
  }

  private render(): void {
    if (!this.root) return;
    this.root.replaceChildren();
    this.root.classList.toggle('is-collapsed', this.collapsed);
    if (this.collapsed) {
      const open = this.iconButton('settings-2', 'Open graph controls', () => { this.collapsed = false; this.render(); });
      open.classList.add('graphplus-controls-open');
      this.root.append(open);
      return;
    }
    const header = div(this.root, 'graphplus-controls-header');
    const title = this.container.ownerDocument.createElement('span');
    title.className = 'graphplus-controls-title';
    title.textContent = 'Graph controls';
    header.append(title);
    const actions = div(header, 'graphplus-controls-actions');
    actions.append(this.iconButton('rotate-ccw', 'Reset camera and release focus', () => {
      void this.consumer.getSession()?.resetCamera();
      void this.consumer.getSession()?.focusNode(null);
    }));
    actions.append(this.iconButton('x', 'Close graph controls', () => { this.collapsed = true; this.render(); }));
    const body = div(this.root, 'graphplus-controls-body');
    this.renderRefine(body);
    this.renderDisplay(body);
    this.renderForces(body);
    this.status = div(this.root, 'graphplus-controls-status');
    this.updateStatus();
  }

  private renderRefine(parent: HTMLElement): void {
    const body = this.section(parent, 'Refine graph', true);
    const lens = this.consumer.getLens();
    new Setting(body).setName('Search').setDesc('path:, tag:, type:, [property:value], -term, OR').addSearch((search) => {
      search.setPlaceholder('Filter nodes…').setValue(lens.query);
      search.onChange((value) => {
        const window = this.container.ownerDocument.defaultView;
        if (this.filterTimer !== undefined) window?.clearTimeout(this.filterTimer);
        this.filterTimer = window?.setTimeout(() => {
          this.filterTimer = undefined;
          void this.updateLens((next) => { next.query = value; });
        }, 120);
      });
    });
    this.toggle(body, 'Tags', lens.showTags, (value) => this.updateLens((next) => { next.showTags = value; }));
    this.toggle(body, 'Orphans', lens.showOrphans, (value) => this.updateLens((next) => { next.showOrphans = value; }));
    new Setting(body).addButton((button) => button.setButtonText('Reset filters').onClick(async () => {
      await this.updateLens((next) => { next.query = ''; next.showTags = true; next.showOrphans = true; });
      this.render();
    }));
    this.renderMindMap(body, lens);
  }

  private renderMindMap(body: HTMLElement, lens: GraphPlusLensStateV1): void {
    const selected = this.viewState?.selectedNodeIds ?? [];
    const selectedId = selected.length === 1 ? selected[0] : undefined;
    new Setting(body).setName('Mind map').setDesc(lens.form.enabled
      ? `Root: ${this.nodeLabel(lens.form.rootNodeId)}`
      : selectedId ? `Ready from: ${this.nodeLabel(selectedId)}` : 'Select one visible node to enable.')
      .addToggle((toggle) => toggle
        .setValue(lens.form.enabled)
        .setDisabled(!lens.form.enabled && selectedId === undefined)
        .onChange(async (value) => {
          if (value) {
            if (!selectedId) { new Notice('Select one visible node before enabling Mind Map.'); this.render(); return; }
            await this.consumer.mindMapFromNode(selectedId);
          } else {
            await this.updateLens((next) => { next.form.enabled = false; });
          }
          await this.refreshViewState(false);
          this.render();
        }));
    if (!lens.form.enabled) return;
    if (selectedId && selectedId !== lens.form.rootNodeId) {
      const reform = new Setting(body).setName('Selected node').setDesc(this.nodeLabel(selectedId));
      reform.settingEl.classList.add('graphplus-reform-setting');
      reform.addButton((control) => control
        .setButtonText('Re-form from selected')
        .onClick(async () => {
          await this.consumer.mindMapFromNode(selectedId);
          await this.refreshViewState(false);
          this.render();
        }));
    }
    new Setting(body).setName('Direction').addDropdown((dropdown) => dropdown
      .addOptions({ either: 'Both', outgoing: 'Outgoing', incoming: 'Incoming' })
      .setValue(lens.form.direction)
      .onChange((value) => void this.updateLens((next) => { next.form.direction = value as GraphPlusLensStateV1['form']['direction']; })));
    const relationOptions: Record<string, string> = { '': 'Any relation' };
    for (const edge of this.consumer.getDocument()?.edges ?? []) {
      for (const token of edge.tokens ?? []) if (token.startsWith('relation:')) relationOptions[token.slice(9)] = token.slice(9);
    }
    new Setting(body).setName('Relation').addDropdown((dropdown) => dropdown
      .addOptions(relationOptions)
      .setValue(lens.form.relation ?? '')
      .onChange((value) => void this.updateLens((next) => { next.form.relation = value || undefined; })));
    const depth = lens.form.maxDepth ?? this.effectiveNumber('form', 'maxDepth', 3);
    this.slider(body, 'Depth', depth, 1, 8, 1,
      (value) => { this.scheduleLensUpdate((next) => { next.form.maxDepth = value; }); },
      () => this.updateLens((next) => { delete next.form.maxDepth; }),
      lens.form.maxDepth !== undefined);
    this.toggle(body, 'Branch colors', lens.form.colorBranches, (value) => this.updateLens((next) => { next.form.colorBranches = value; }));
    this.toggle(body, 'Cross-links', lens.form.showCrossLinks, (value) => this.updateLens((next) => { next.form.showCrossLinks = value; }));
    this.toggle(body, 'Disconnected nodes', lens.form.showDisconnected, (value) => this.updateLens((next) => { next.form.showDisconnected = value; }));
  }

  private renderDisplay(parent: HTMLElement): void {
    const body = this.section(parent, 'Display', false);
    const lens = this.consumer.getLens();
    const labels = new Setting(body).setName('Labels');
    labels.addDropdown((dropdown) => dropdown
      .addOptions({ adaptive: 'Adaptive', all: 'All', off: 'Off' })
      .setValue(lens.display.labelMode ?? this.effectiveLabelMode())
      .onChange((value) => void this.updateLens((next) => {
        next.display.labelMode = value === 'all' || value === 'off' ? value : 'adaptive';
      })));
    if (lens.display.labelMode !== undefined) labels.addExtraButton((control) => control
      .setIcon('rotate-ccw').setTooltip('Reset to profile default')
      .onClick(async () => { await this.updateLens((next) => { delete next.display.labelMode; }); this.render(); }));
    this.slider(body, 'Node size', lens.display.nodeRadiusScale ?? this.effectiveNumber('rendering', 'nodeRadiusScale', 1), 0.5, 4, 0.1,
      (value) => { this.scheduleLensUpdate((next) => { next.display.nodeRadiusScale = value; }); },
      () => this.updateLens((next) => { delete next.display.nodeRadiusScale; }),
      lens.display.nodeRadiusScale !== undefined);
    this.slider(body, 'Link thickness', lens.display.edgeThicknessScale ?? this.effectiveNumber('rendering', 'edgeThicknessScale', 1), 0.25, 4, 0.05,
      (value) => { this.scheduleLensUpdate((next) => { next.display.edgeThicknessScale = value; }); },
      () => this.updateLens((next) => { delete next.display.edgeThicknessScale; }),
      lens.display.edgeThicknessScale !== undefined);
  }

  private renderForces(parent: HTMLElement): void {
    const body = this.section(parent, 'Forces', false);
    const lens = this.consumer.getLens();
    this.slider(body, 'Center force', lens.force.centeringStrength ?? this.effectiveNumber('force-layout', 'centeringStrength', 0.002), 0, 0.05, 0.001,
      (value) => { this.scheduleLensUpdate((next) => { next.force.centeringStrength = value; }); },
      () => this.updateLens((next) => { delete next.force.centeringStrength; }),
      lens.force.centeringStrength !== undefined);
    this.slider(body, 'Repel force', lens.force.repulsionStrength ?? this.effectiveNumber('force-layout', 'repulsionStrength', 7000), 0, 50000, 250,
      (value) => { this.scheduleLensUpdate((next) => { next.force.repulsionStrength = value; }); },
      () => this.updateLens((next) => { delete next.force.repulsionStrength; }),
      lens.force.repulsionStrength !== undefined);
    this.slider(body, 'Link force', lens.force.springStrength ?? this.effectiveNumber('force-layout', 'springStrength', 0.25), 0, 5, 0.05,
      (value) => { this.scheduleLensUpdate((next) => { next.force.springStrength = value; }); },
      () => this.updateLens((next) => { delete next.force.springStrength; }),
      lens.force.springStrength !== undefined);
    this.slider(body, 'Link distance', lens.force.springLength ?? this.effectiveNumber('force-layout', 'springLength', 100), 20, 500, 5,
      (value) => { this.scheduleLensUpdate((next) => { next.force.springLength = value; }); },
      () => this.updateLens((next) => { delete next.force.springLength; }),
      lens.force.springLength !== undefined);
  }

  private section(parent: HTMLElement, title: string, open: boolean): HTMLElement {
    const details = this.container.ownerDocument.createElement('details');
    details.className = 'graphplus-control-section';
    details.open = open;
    const summary = this.container.ownerDocument.createElement('summary');
    const label = this.container.ownerDocument.createElement('span');
    label.textContent = title;
    const icon = this.container.ownerDocument.createElement('span');
    icon.className = 'graphplus-section-chevron';
    setIcon(icon, 'chevron-down');
    summary.append(label, icon);
    details.append(summary);
    const body = div(details, 'graphplus-control-section-body');
    parent.append(details);
    return body;
  }

  private toggle(parent: HTMLElement, name: string, value: boolean, change: (value: boolean) => void | Promise<void>): void {
    new Setting(parent).setName(name).addToggle((toggle) => toggle.setValue(value).onChange(change));
  }

  private slider(
    parent: HTMLElement,
    name: string,
    value: number,
    min: number,
    max: number,
    step: number,
    change: (value: number) => void,
    reset: () => void | Promise<void>,
    overridden: boolean,
  ): void {
    const setting = new Setting(parent).setName(name).setDesc(`Current: ${formatNumber(value)}`);
    setting.settingEl.classList.add('graphplus-slider-setting');
    setting.addSlider((slider) => {
      slider.setLimits(min, max, step).setValue(value).setDynamicTooltip().onChange(change);
      slider.sliderEl.addEventListener('dblclick', async (event) => {
        event.preventDefault();
        await reset();
        this.render();
      });
    });
    if (overridden) setting.addExtraButton((control) => control
      .setIcon('rotate-ccw').setTooltip('Reset to profile default')
      .onClick(async () => { await reset(); this.render(); }));
  }

  private async updateLens(mutator: (lens: MutableLens) => void): Promise<void> {
    const lens = this.pendingLens ?? this.consumer.getLens() as MutableLens;
    if (this.lensFrame !== undefined) this.container.ownerDocument.defaultView?.cancelAnimationFrame(this.lensFrame);
    this.lensFrame = undefined;
    this.pendingLens = undefined;
    mutator(lens);
    await this.consumer.setLens(lens);
    this.updateStatus();
  }

  private scheduleLensUpdate(mutator: (lens: MutableLens) => void): void {
    const lens = this.pendingLens ?? this.consumer.getLens() as MutableLens;
    mutator(lens);
    this.pendingLens = lens;
    if (this.lensFrame !== undefined) return;
    this.lensFrame = this.container.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.lensFrame = undefined;
      const pending = this.pendingLens;
      this.pendingLens = undefined;
      if (pending) void this.consumer.setLens(pending).then(() => this.updateStatus());
    });
  }

  private async refreshViewState(rerender: boolean): Promise<void> {
    const session = this.consumer.getSession();
    if (!session) return;
    this.viewState = await session.exportViewState();
    if (rerender) this.render();
  }

  private nodeLabel(nodeId: string | undefined): string {
    if (!nodeId) return 'Unavailable';
    const node = this.consumer.getDocument()?.nodes.find((candidate) => candidate.id === nodeId);
    return node?.label ?? nodeId;
  }

  private openContextMenu(intent: GraphNodeContextRequestedIntentV1): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('Focus node').setIcon('scan-eye').onClick(() => void this.consumer.focusNode(intent.nodeId)));
    menu.addItem((item) => item.setTitle('Mind map from here').setIcon('git-fork').onClick(() => void this.consumer.mindMapFromNode(intent.nodeId).then(() => this.refreshViewState(true))));
    const kind = this.consumer.nodeKind(intent.nodeId);
    if (kind) menu.addItem((item) => item.setTitle(kind === 'note' ? 'Open note' : 'Open tag').setIcon('file-text').onClick(() => void this.consumer.openNode(intent.nodeId)));
    const pinned = this.viewState?.pinnedNodeIds.includes(intent.nodeId) === true;
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(pinned ? 'Unpin node' : 'Pin node').setIcon(pinned ? 'pin-off' : 'pin').onClick(() => void this.consumer.setNodePinned(intent.nodeId, !pinned).then(() => this.refreshViewState(true))));
    const bounds = this.container.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left + intent.anchor.x, y: bounds.top + intent.anchor.y });
  }

  private updateStatus(): void {
    if (!this.status) return;
    const document = this.consumer.getDocument();
    this.status.textContent = document ? `${document.nodes.length} nodes · ${document.edges.length} links` : 'Loading graph…';
  }

  private effectiveNumber(moduleId: string, key: string, fallback: number): number {
    const value = this.consumer.getEffectiveSettings()?.modules[moduleId]?.settings[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private effectiveLabelMode(): 'adaptive' | 'all' | 'off' {
    const value = this.consumer.getEffectiveSettings()?.modules.rendering?.settings.labelMode;
    return value === 'all' || value === 'off' ? value : 'adaptive';
  }

  private iconButton(icon: string, label: string, action: () => void): HTMLButtonElement {
    const element = button(this.container, '');
    element.className = 'clickable-icon graphplus-icon-button';
    element.setAttribute('aria-label', label);
    setIcon(element, icon);
    element.addEventListener('click', action);
    return element;
  }
}

type MutableLens = {
  query: string;
  showTags: boolean;
  showOrphans: boolean;
  display: { labelMode?: 'adaptive' | 'all' | 'off'; nodeRadiusScale?: number; edgeThicknessScale?: number };
  force: { repulsionStrength?: number; springStrength?: number; springLength?: number; centeringStrength?: number };
  form: {
    enabled: boolean;
    rootNodeId?: string;
    direction: 'incoming' | 'outgoing' | 'either';
    relation?: string;
    maxDepth?: number;
    showCrossLinks: boolean;
    showDisconnected: boolean;
    colorBranches: boolean;
  };
};

function div(parent: HTMLElement, className: string): HTMLDivElement {
  const value = parent.ownerDocument.createElement('div');
  value.className = className;
  parent.append(value);
  return value;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const value = container.ownerDocument.createElement('button');
  value.type = 'button';
  value.textContent = text;
  return value;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
