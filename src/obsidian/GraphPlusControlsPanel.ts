import { Setting, setIcon } from 'obsidian';
import type { GraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';
import type { GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';

export class GraphPlusControlsPanelV1<TFile> {
  private root?: HTMLDivElement;
  private status?: HTMLDivElement;
  private collapsed = false;
  private filterTimer: number | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly consumer: GraphPlusConsumerV1<TFile>,
    private readonly getActiveNoteId: () => string | undefined,
  ) {}

  mount(): void {
    if (this.root) return;
    this.root = this.container.ownerDocument.createElement('div');
    this.root.className = 'graphplus-graph-controls graph-controls';
    this.root.addEventListener('pointerdown', stopPropagation);
    this.root.addEventListener('wheel', stopPropagation);
    this.container.append(this.root);
    this.render();
  }

  unmount(): void {
    if (this.filterTimer !== undefined) this.container.ownerDocument.defaultView?.clearTimeout(this.filterTimer);
    this.filterTimer = undefined;
    this.root?.remove();
    this.root = undefined;
    this.status = undefined;
  }

  refresh(): void {
    this.updateStatus();
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
    this.renderFilter(body);
    this.renderForm(body);
    this.renderDisplay(body);
    this.renderForces(body);
    this.status = div(this.root, 'graphplus-controls-status');
    this.updateStatus();
  }

  private renderFilter(parent: HTMLElement): void {
    const body = this.section(parent, 'Filter', true);
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
  }

  private renderForm(parent: HTMLElement): void {
    const body = this.section(parent, 'Form', true);
    const lens = this.consumer.getLens();
    this.toggle(body, 'Mind map', lens.form.enabled, async (value) => {
      await this.updateLens((next) => { next.form.enabled = value; });
      this.render();
    });
    const roots = this.consumer.getDocument()?.nodes ?? [];
    const rootSetting = new Setting(body).setName('Central idea').setDesc('Blank chooses the most connected visible node.');
    rootSetting.addSearch((search) => {
      search.setPlaceholder('Automatic').setValue(lens.form.rootNodeId ?? '');
      const listId = `graphplus-roots-${Math.random().toString(36).slice(2)}`;
      search.inputEl.setAttribute('list', listId);
      const list = this.container.ownerDocument.createElement('datalist');
      list.id = listId;
      for (const node of roots) {
        const option = this.container.ownerDocument.createElement('option');
        option.value = node.id;
        option.label = node.label ?? node.id;
        list.append(option);
      }
      body.append(list);
      search.onChange((value) => void this.updateLens((next) => {
        next.form.rootNodeId = value.trim() || undefined;
      }));
    });
    const rootActions = div(body, 'graphplus-root-actions');
    const focused = this.consumer.getSession();
    const focusedButton = button(this.container, 'Use focused');
    focusedButton.addEventListener('click', async () => {
      const focusedId = (await focused?.exportViewState())?.focusedNodeId;
      if (focusedId) await this.updateLens((next) => { next.form.rootNodeId = focusedId; });
    });
    const activeId = this.getActiveNoteId();
    const activeButton = button(this.container, 'Use current note');
    activeButton.disabled = activeId === undefined;
    activeButton.addEventListener('click', () => {
      if (activeId) void this.updateLens((next) => { next.form.rootNodeId = activeId; });
    });
    rootActions.append(focusedButton, activeButton);
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
    new Setting(body).setName('Depth').setDesc(lens.form.maxDepth === undefined ? 'Unlimited' : String(lens.form.maxDepth))
      .addSlider((slider) => slider.setLimits(0, 8, 1).setValue(lens.form.maxDepth ?? 0).setDynamicTooltip()
        .onChange((value) => void this.updateLens((next) => { next.form.maxDepth = value === 0 ? undefined : value; })));
    this.toggle(body, 'Branch colors', lens.form.colorBranches, (value) => this.updateLens((next) => { next.form.colorBranches = value; }));
    this.toggle(body, 'Cross-links', lens.form.showCrossLinks, (value) => this.updateLens((next) => { next.form.showCrossLinks = value; }));
    this.toggle(body, 'Disconnected nodes', lens.form.showDisconnected, (value) => this.updateLens((next) => { next.form.showDisconnected = value; }));
  }

  private renderDisplay(parent: HTMLElement): void {
    const body = this.section(parent, 'Display', false);
    const lens = this.consumer.getLens();
    this.toggle(body, 'Text', lens.display.showLabels, (value) => this.updateLens((next) => { next.display.showLabels = value; }));
    this.slider(body, 'Node size', lens.display.nodeRadiusScale, 0.5, 4, 0.1,
      (value) => this.updateLens((next) => { next.display.nodeRadiusScale = value; }));
    this.slider(body, 'Link thickness', lens.display.edgeThicknessScale, 0.25, 4, 0.05,
      (value) => this.updateLens((next) => { next.display.edgeThicknessScale = value; }));
  }

  private renderForces(parent: HTMLElement): void {
    const body = this.section(parent, 'Forces', false);
    const lens = this.consumer.getLens();
    this.slider(body, 'Center force', lens.force.centeringStrength, 0, 2, 0.01,
      (value) => this.updateLens((next) => { next.force.centeringStrength = value; }));
    this.slider(body, 'Repel force', lens.force.repulsionStrength, 0, 50000, 250,
      (value) => this.updateLens((next) => { next.force.repulsionStrength = value; }));
    this.slider(body, 'Link force', lens.force.springStrength, 0, 10, 0.1,
      (value) => this.updateLens((next) => { next.force.springStrength = value; }));
    this.slider(body, 'Link distance', lens.force.springLength, 20, 500, 5,
      (value) => this.updateLens((next) => { next.force.springLength = value; }));
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
    change: (value: number) => void | Promise<void>,
  ): void {
    new Setting(parent).setName(name).addSlider((slider) => slider
      .setLimits(min, max, step)
      .setValue(value)
      .setDynamicTooltip()
      .onChange(change));
  }

  private async updateLens(mutator: (lens: MutableLens) => void): Promise<void> {
    const lens = this.consumer.getLens() as MutableLens;
    mutator(lens);
    await this.consumer.setLens(lens);
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    const document = this.consumer.getDocument();
    this.status.textContent = document ? `${document.nodes.length} nodes · ${document.edges.length} links` : 'Loading graph…';
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
  display: { showLabels: boolean; nodeRadiusScale: number; edgeThicknessScale: number };
  force: { repulsionStrength: number; springStrength: number; springLength: number; centeringStrength: number };
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
