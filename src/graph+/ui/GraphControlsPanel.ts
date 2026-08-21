import { Setting, setIcon } from 'obsidian';
import type { GraphData, Node } from '../types/domain/graph.ts';
import type { GraphLensState } from '../types/domain/lens.ts';
import { createDefaultGraphLens } from '../types/domain/lens.ts';
import type { GraphPlusSettings } from '../types/settings/appSettings.ts';
import { getSettings, updateSettings } from '../../obsidian/settings/settingsStore.ts';

type PanelDeps = {
  getContainer: () => HTMLElement;
  getLens: () => GraphLensState;
  getGraph: () => GraphData | null;
  getSourceNodes: () => Node[];
  getRelations: () => string[];
  getFocusedNodeId: () => string | null;
  getCurrentFileId: () => string | null;
  onLensChange: (next: GraphLensState) => void;
  onResetView: () => void;
  onSettingsApplied: (mode: 'live' | 'rebuild') => Promise<void> | void;
};

export class GraphControlsPanel {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private collapsed = false;
  private filterTimer: number | null = null;

  constructor(private deps: PanelDeps) {}

  mount(): void {
    if (this.root) return;
    this.root = document.createElement('div');
    this.root.className = 'graphplus-graph-controls graph-controls';
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.addEventListener('wheel', (event) => event.stopPropagation());
    this.deps.getContainer().appendChild(this.root);
    this.render();
  }

  unmount(): void {
    if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
    this.filterTimer = null;
    this.root?.remove();
    this.root = null;
    this.body = null;
    this.status = null;
  }

  refresh(): void {
    this.updateStatus();
  }

  private render(): void {
    if (!this.root) return;
    this.root.empty();
    this.root.toggleClass('is-collapsed', this.collapsed);

    if (this.collapsed) {
      const open = this.iconButton('settings-2', 'Open graph controls', () => {
        this.collapsed = false;
        this.render();
      });
      open.addClass('graphplus-controls-open');
      this.root.appendChild(open);
      return;
    }

    const header = this.root.createDiv({ cls: 'graphplus-controls-header' });
    header.createSpan({ text: 'Graph controls', cls: 'graphplus-controls-title' });
    const actions = header.createDiv({ cls: 'graphplus-controls-actions' });
    actions.appendChild(this.iconButton('rotate-ccw', 'Reset camera and release focus', () => this.deps.onResetView()));
    actions.appendChild(this.iconButton('x', 'Close graph controls', () => {
      this.collapsed = true;
      this.render();
    }));

    this.body = this.root.createDiv({ cls: 'graphplus-controls-body' });
    this.renderFilter(this.body);
    this.renderForm(this.body);
    this.renderGroups(this.body);
    this.renderDisplay(this.body);
    this.renderForces(this.body);

    this.status = this.root.createDiv({ cls: 'graphplus-controls-status' });
    this.updateStatus();
  }

  private renderFilter(parent: HTMLElement): void {
    const body = this.section(parent, 'Filter', true);
    const lens = this.deps.getLens();
    new Setting(body)
      .setName('Search')
      .setDesc('path:, tag:, type:, [property:value], -term, OR')
      .addSearch((search) => {
        search.setPlaceholder('Filter nodes…').setValue(lens.filter.query);
        search.onChange((value) => {
          if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
          this.filterTimer = window.setTimeout(() => {
            this.applyLens((next) => { next.filter.query = value; });
          }, 120);
        });
      });
    this.toggle(body, 'Tags', lens.filter.showTags, (value) => {
      this.applyLens((next) => { next.filter.showTags = value; });
    });
    this.toggle(body, 'Attachments', lens.filter.showAttachments, (value) => {
      this.applyLens((next) => { next.filter.showAttachments = value; });
    });
    this.toggle(body, 'Unresolved links', lens.filter.showUnresolved, (value) => {
      this.applyLens((next) => { next.filter.showUnresolved = value; });
    });
    this.toggle(body, 'Orphans', lens.filter.showOrphans, (value) => {
      this.applyLens((next) => { next.filter.showOrphans = value; });
    });
    new Setting(body).addButton((button) => button
      .setButtonText('Reset filters')
      .onClick(() => {
        const showTags = getSettings().base.showTags;
        const fresh = createDefaultGraphLens(showTags);
        const current = this.deps.getLens();
        fresh.groups = current.groups;
        fresh.form = current.form;
        this.deps.onLensChange(fresh);
        this.render();
      }));
  }

  private renderGroups(parent: HTMLElement): void {
    const body = this.section(parent, 'Groups', false);
    const groups = this.deps.getLens().groups;
    if (!groups.length) body.createDiv({ text: 'Color the first matching group.', cls: 'graphplus-controls-hint' });
    groups.forEach((group, index) => {
      const row = body.createDiv({ cls: 'graphplus-group-row' });
      const color = row.createEl('input', { type: 'color' });
      color.value = group.color;
      color.setAttr('aria-label', `Group ${index + 1} color`);
      const query = row.createEl('input', { type: 'search', placeholder: 'tag:project' });
      query.value = group.query;
      query.setAttr('aria-label', `Group ${index + 1} query`);
      const remove = this.iconButton('trash-2', `Remove group ${index + 1}`, () => {
        this.applyLens((next) => { next.groups.splice(index, 1); }, true);
      });
      color.addEventListener('input', () => {
        this.applyLens((next) => { if (next.groups[index]) next.groups[index].color = color.value; });
      });
      query.addEventListener('change', () => {
        this.applyLens((next) => { if (next.groups[index]) next.groups[index].query = query.value; });
      });
      row.append(color, query, remove);
    });
    new Setting(body).addButton((button) => button.setButtonText('New group').onClick(() => {
      this.applyLens((next) => {
        next.groups.push({
          id: `group-${Date.now()}`,
          query: '',
          color: ['#e57373', '#4fc3f7', '#81c784', '#ba68c8'][next.groups.length % 4],
        });
      }, true);
    }));
  }

  private renderDisplay(parent: HTMLElement): void {
    const body = this.section(parent, 'Display', false);
    const settings = getSettings();
    this.settingToggle(body, 'Text', settings.base.showLabels, (value, next) => { next.base.showLabels = value; });
    this.settingSlider(body, 'Node size', settings.base.maxNodeRadius, 8, 60, 1, (value, next) => {
      next.base.maxNodeRadius = Math.max(value, next.base.minNodeRadius);
    });
    this.settingSlider(body, 'Link thickness', settings.tuning.linkThickness, 0.05, 4, 0.05, (value, next) => {
      next.tuning.linkThickness = value;
    });
  }

  private renderForces(parent: HTMLElement): void {
    const body = this.section(parent, 'Forces', false);
    const settings = getSettings();
    this.settingSlider(body, 'Center force', settings.layout.centerPull, 0, 0.2, 0.002, (value, next) => {
      next.layout.centerPull = value;
    });
    this.settingSlider(body, 'Repel force', settings.physics.repulsionStrength, 0, 20000, 100, (value, next) => {
      next.physics.repulsionStrength = value;
    });
    this.settingSlider(body, 'Link force', settings.layout.linkStrength, 0, 1, 0.01, (value, next) => {
      next.layout.linkStrength = value;
    });
    this.settingSlider(body, 'Link distance', settings.layout.linkLength, 20, 500, 5, (value, next) => {
      next.layout.linkLength = value;
    });
  }

  private renderForm(parent: HTMLElement): void {
    const body = this.section(parent, 'Form', true);
    const lens = this.deps.getLens();
    new Setting(body).setName('Layout').addDropdown((dropdown) => dropdown
      .addOptions({ free: 'Graph', 'mind-map': 'Mind map' })
      .setValue(lens.form.mode)
      .onChange((value) => {
        this.applyLens((next) => { next.form.mode = value as GraphLensState['form']['mode']; }, true);
      }));

    const rootSetting = new Setting(body).setName('Central idea').setDesc('Blank chooses the most connected visible node.');
    rootSetting.addSearch((search) => {
      search.setPlaceholder('Automatic').setValue(lens.form.rootId ?? '');
      const input = search.inputEl;
      const listId = `graphplus-roots-${Math.random().toString(36).slice(2)}`;
      input.setAttr('list', listId);
      const list = body.createEl('datalist');
      list.id = listId;
      for (const node of this.deps.getSourceNodes()) {
        const option = list.createEl('option');
        option.value = node.id;
        option.label = node.label;
      }
      search.onChange((value) => {
        this.applyLens((next) => { next.form.rootId = value.trim() || null; });
      });
    });
    const rootActions = body.createDiv({ cls: 'graphplus-root-actions' });
    const focused = this.deps.getFocusedNodeId();
    const current = this.deps.getCurrentFileId();
    const focusedButton = rootActions.createEl('button', { text: 'Use focused' });
    focusedButton.disabled = !focused;
    focusedButton.addEventListener('click', () => {
      if (focused) this.applyLens((next) => { next.form.rootId = focused; }, true);
    });
    const currentButton = rootActions.createEl('button', { text: 'Use current note' });
    currentButton.disabled = !current;
    currentButton.addEventListener('click', () => {
      if (current) this.applyLens((next) => { next.form.rootId = current; }, true);
    });

    new Setting(body).setName('Direction').addDropdown((dropdown) => dropdown
      .addOptions({ both: 'Both', outgoing: 'Outgoing', incoming: 'Incoming' })
      .setValue(lens.form.direction)
      .onChange((value) => this.applyLens((next) => {
        next.form.direction = value as GraphLensState['form']['direction'];
      })));
    const relations = { '': 'Any relation' } as Record<string, string>;
    for (const relation of this.deps.getRelations()) relations[relation] = relation;
    new Setting(body).setName('Relation').addDropdown((dropdown) => dropdown
      .addOptions(relations)
      .setValue(lens.form.relation)
      .onChange((value) => this.applyLens((next) => { next.form.relation = value; })));
    new Setting(body).setName('Depth').setDesc(lens.form.maxDepth === null ? 'Unlimited' : String(lens.form.maxDepth))
      .addSlider((slider) => slider
        .setLimits(0, 8, 1)
        .setValue(lens.form.maxDepth ?? 0)
        .setDynamicTooltip()
        .onChange((value) => this.applyLens((next) => { next.form.maxDepth = value === 0 ? null : value; })));
    this.toggle(body, 'Branch colors', lens.form.colorBranches, (value) => {
      this.applyLens((next) => { next.form.colorBranches = value; });
    });
    this.toggle(body, 'Cross-links', lens.form.showCrossLinks, (value) => {
      this.applyLens((next) => { next.form.showCrossLinks = value; });
    });
    this.toggle(body, 'Disconnected nodes', lens.form.showDisconnected, (value) => {
      this.applyLens((next) => { next.form.showDisconnected = value; });
    });
  }

  private section(parent: HTMLElement, title: string, open: boolean): HTMLElement {
    const details = parent.createEl('details', { cls: 'graphplus-control-section' });
    details.open = open;
    const summary = details.createEl('summary');
    summary.createSpan({ text: title });
    const icon = summary.createSpan({ cls: 'graphplus-section-chevron' });
    setIcon(icon, 'chevron-down');
    return details.createDiv({ cls: 'graphplus-control-section-body' });
  }

  private toggle(parent: HTMLElement, name: string, value: boolean, onChange: (value: boolean) => void): void {
    new Setting(parent).setName(name).addToggle((toggle) => toggle.setValue(value).onChange(onChange));
  }

  private settingToggle(
    parent: HTMLElement,
    name: string,
    value: boolean,
    mutator: (value: boolean, settings: GraphPlusSettings) => void,
  ): void {
    new Setting(parent).setName(name).addToggle((toggle) => toggle.setValue(value).onChange(async (nextValue) => {
      updateSettings((settings) => mutator(nextValue, settings));
      await this.deps.onSettingsApplied('live');
    }));
  }

  private settingSlider(
    parent: HTMLElement,
    name: string,
    value: number,
    min: number,
    max: number,
    step: number,
    mutator: (value: number, settings: GraphPlusSettings) => void,
  ): void {
    new Setting(parent).setName(name).addSlider((slider) => slider
      .setLimits(min, max, step)
      .setValue(value)
      .setDynamicTooltip()
      .onChange(async (nextValue) => {
        updateSettings((settings) => mutator(nextValue, settings));
        await this.deps.onSettingsApplied('live');
      }));
  }

  private applyLens(mutator: (lens: GraphLensState) => void, rerender = false): void {
    const next = this.deps.getLens();
    mutator(next);
    this.deps.onLensChange(next);
    if (rerender) this.render();
    else this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    const graph = this.deps.getGraph();
    if (!graph) {
      this.status.setText('Loading graph…');
      return;
    }
    const { projection } = graph;
    const parts = [
      `${graph.nodes.length}/${projection.sourceNodeCount} nodes`,
      `${graph.links.length}/${projection.sourceLinkCount} links`,
    ];
    if (projection.rootId) parts.push(`center: ${graph.nodes.find((node) => node.id === projection.rootId)?.label ?? projection.rootId}`);
    this.status.setText(projection.queryError ? `Filter error: ${projection.queryError}` : parts.join(' · '));
    this.status.toggleClass('is-error', Boolean(projection.queryError));
  }

  private iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clickable-icon graphplus-icon-button';
    button.setAttr('aria-label', label);
    button.setAttr('data-tooltip-position', 'left');
    setIcon(button, icon);
    button.addEventListener('click', onClick);
    return button;
  }
}
