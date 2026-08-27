import { Notice, Setting, setIcon } from 'obsidian';
import {
  GRAPH_QUICK_SETTINGS_CONTROL_IDS_V1 as CONTROLS,
  GRAPH_QUICK_SETTINGS_SECTION_IDS_V1 as SECTIONS,
  type Disposable,
  type GraphEffectiveSettingsV1,
  type GraphQuickSettingsContributionV1,
  type GraphViewStateV1,
  type JsonValue,
} from '../../graph-engine/contracts/v1/index.ts';
import type { GraphEngineSessionUiMountContextV1 } from '../../graph-engine/service/index.ts';
import {
  graphUiControlIsShownV1,
  graphUiSectionIsShownV1,
  type EffectiveGraphSessionUiPolicyV1,
} from './GraphEngineUiPolicy.ts';
import { ObsidianGraphUiLayoutV1 } from './ObsidianGraphUiLayout.ts';

const SECTION_TITLES: Readonly<Record<string, string>> = {
  [SECTIONS.filter]: 'Filter',
  [SECTIONS.form]: 'Form',
  [SECTIONS.display]: 'Display',
  [SECTIONS.camera]: 'Camera',
  [SECTIONS.forces]: 'Forces',
  [SECTIONS.regions]: 'Regions',
};

export class GraphEngineQuickSettingsPanelV1 implements Disposable {
  private root?: HTMLDivElement;
  private status?: HTMLDivElement;
  private layout?: ObsidianGraphUiLayoutV1;
  private intentSubscription?: Disposable;
  private overrideSubscription?: Disposable;
  private contributionDisposables: Disposable[] = [];
  private collapsed: boolean;
  private disposed = false;

  constructor(
    private readonly context: GraphEngineSessionUiMountContextV1,
    private readonly policy: EffectiveGraphSessionUiPolicyV1,
  ) {
    this.collapsed = policy.quickSettings.visibility === 'collapsed';
  }

  mount(): void {
    if (this.root || this.disposed || this.policy.quickSettings.visibility === 'hidden') return;
    const root = this.context.container.ownerDocument.createElement('div');
    root.className = 'graph-engine-quick-settings graphplus-graph-controls graph-controls';
    root.dataset.graphEngineQuickSettings = '';
    root.addEventListener('pointerdown', stopPropagation);
    root.addEventListener('wheel', stopPropagation);
    this.context.container.append(root);
    this.root = root;
    this.layout = new ObsidianGraphUiLayoutV1(
      this.context.container,
      root,
      this.policy.hostOcclusions,
    );
    this.intentSubscription = this.context.session.onIntent((intent) => {
      if (intent.type === 'selection-changed' || intent.type === 'focus-changed' || intent.type === 'node-drag-ended') {
        void this.render();
      }
    });
    this.overrideSubscription = this.context.controls.onSessionOverridesChanged(() => { void this.render(); });
    void this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeContributions();
    this.intentSubscription?.dispose();
    this.intentSubscription = undefined;
    this.overrideSubscription?.dispose();
    this.overrideSubscription = undefined;
    this.layout?.dispose();
    this.layout = undefined;
    this.root?.remove();
    this.root = undefined;
    this.status = undefined;
  }

  private async render(): Promise<void> {
    const root = this.root;
    if (!root || this.disposed) return;
    const [viewState, effective, document] = await Promise.all([
      this.context.session.exportViewState(),
      this.context.session.exportEffectiveSettings(),
      this.context.session.exportDocument(),
    ]);
    if (!this.root || this.disposed) return;
    this.disposeContributions();
    root.replaceChildren();
    root.classList.toggle('is-collapsed', this.collapsed);
    if (this.collapsed) {
      const open = this.iconButton('settings-2', 'Open graph controls', () => {
        this.collapsed = false;
        void this.render();
      });
      open.classList.add('graphplus-controls-open', 'graph-engine-controls-open');
      root.append(open);
      return;
    }

    const header = div(root, 'graphplus-controls-header graph-engine-controls-header');
    const title = this.context.container.ownerDocument.createElement('span');
    title.className = 'graphplus-controls-title graph-engine-controls-title';
    title.textContent = 'Graph controls';
    header.append(title);
    const actions = div(header, 'graphplus-controls-actions graph-engine-controls-actions');
    actions.append(this.iconButton('rotate-ccw', 'Reset camera and release focus', () => {
      void this.context.session.resetCamera();
      void this.context.session.focusNode(null);
    }));
    actions.append(this.iconButton('x', 'Collapse graph controls', () => {
      this.collapsed = true;
      void this.render();
    }));

    const body = div(root, 'graphplus-controls-body graph-engine-controls-body');
    const contributions = groupContributions(this.policy.quickSettings.contributions);
    this.renderFilter(body, contributions.get(SECTIONS.filter) ?? []);
    await this.renderForm(body, viewState, effective, contributions.get(SECTIONS.form) ?? []);
    this.renderDisplay(body, effective, contributions.get(SECTIONS.display) ?? []);
    this.renderCamera(body, contributions.get(SECTIONS.camera) ?? []);
    this.renderForces(body, effective, contributions.get(SECTIONS.forces) ?? []);
    this.renderRegions(body, effective, contributions.get(SECTIONS.regions) ?? []);
    for (const [sectionId, values] of contributions) {
      if (Object.values(SECTIONS).includes(sectionId as typeof SECTIONS[keyof typeof SECTIONS])) continue;
      if (!graphUiSectionIsShownV1(this.policy, sectionId)) continue;
      const sectionBody = this.section(body, humanize(sectionId), false);
      this.mountContributions(sectionBody, values);
    }
    this.status = div(root, 'graphplus-controls-status graph-engine-controls-status');
    this.status.textContent = `${document.nodes.length} nodes · ${document.edges.length} links`;
  }

  private renderFilter(parent: HTMLElement, contributions: readonly GraphQuickSettingsContributionV1[]): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.filter)) return;
    const body = this.section(parent, SECTION_TITLES[SECTIONS.filter], true);
    if (graphUiControlIsShownV1(this.policy, SECTIONS.filter, CONTROLS.clearFilter)) {
      new Setting(body).setName('Active filters').setDesc('Consumers supply neutral filter ASTs.')
        .addButton((button) => button.setButtonText('Clear filters').onClick(() => this.context.session.clearFilter()));
    }
    this.mountContributions(body, contributions);
  }

  private async renderForm(
    parent: HTMLElement,
    viewState: GraphViewStateV1,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): Promise<void> {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.form)) return;
    const body = this.section(parent, SECTION_TITLES[SECTIONS.form], true);
    if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.mindMap)) {
      const form = effective.modules.form;
      const selectedId = viewState.selectedNodeIds.length === 1 ? viewState.selectedNodeIds[0] : undefined;
      const rootNodeId = this.context.controls.getSessionOverrides().modules?.form?.settings?.rootNodeId;
      new Setting(body)
        .setName('Mind map')
        .setDesc(form?.enabled
          ? `Root: ${typeof rootNodeId === 'string' ? rootNodeId : 'automatic'}`
          : selectedId ? `Ready from: ${selectedId}` : 'Select one visible node to enable.')
        .addToggle((toggle) => toggle
          .setValue(form?.enabled === true)
          .setDisabled(form?.enabled !== true && !selectedId)
          .onChange(async (enabled) => {
            if (enabled && !selectedId) {
              new Notice('Select one visible node before enabling Mind Map.');
              await this.render();
              return;
            }
            if (enabled && selectedId) {
              await this.context.controls.setModuleSetting('form', 'rootNodeId', selectedId);
            }
            await this.context.controls.setModuleEnabled('form', enabled);
            if (enabled) await this.context.session.fitNodes();
          }));
      if (form?.enabled) {
        if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.formDirection)) {
          const direction = form.settings.direction;
          new Setting(body).setName('Direction').addDropdown((dropdown) => dropdown
            .addOptions({ either: 'Both', outgoing: 'Outgoing', incoming: 'Incoming' })
            .setValue(direction === 'outgoing' || direction === 'incoming' ? direction : 'either')
            .onChange((value) => void this.setTransientFormSetting('direction', value)));
        }
        if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.formDepth)) {
          this.transientFormSlider(body, 'Depth', readNumber(form.settings.maxDepth, 3), 1, 8, 1, 'maxDepth');
        }
        if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.formBranchColors)) {
          this.transientFormToggle(body, 'Branch colors', form.settings.colorBranches !== false, 'colorBranches');
        }
        if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.formCrossLinks)) {
          this.transientFormToggle(body, 'Cross-links', form.settings.showCrossLinks !== false, 'showCrossLinks');
        }
        if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.formDisconnected)) {
          this.transientFormToggle(body, 'Disconnected nodes', form.settings.showDisconnected === true, 'showDisconnected');
        }
      }
    }
    this.mountContributions(body, contributions);
  }

  private renderDisplay(
    parent: HTMLElement,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.display)) return;
    const body = this.section(parent, SECTION_TITLES[SECTIONS.display], false);
    const rendering = effective.modules.rendering;
    if (rendering) {
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.labels)) {
        new Setting(body).setName('Labels').addDropdown((dropdown) => dropdown
          .addOptions({ adaptive: 'Adaptive', all: 'All', off: 'Off' })
          .setValue(readLabelMode(rendering.settings.labelMode))
          .onChange(async (value) => {
            await this.context.profileSettings.setModuleSetting('rendering', 'labelMode', value);
            await this.render();
          }));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.nodeSize)) {
        this.slider(body, 'Node size', readNumber(rendering.settings.nodeRadiusScale, 1), 0.5, 4, 0.1, 'rendering', 'nodeRadiusScale');
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.linkThickness)) {
        this.slider(body, 'Link thickness', readNumber(rendering.settings.edgeThicknessScale, 1), 0.25, 4, 0.05, 'rendering', 'edgeThicknessScale');
      }
    }
    this.mountContributions(body, contributions);
  }

  private async setTransientFormSetting(key: string, value: JsonValue | undefined): Promise<void> {
    await this.context.controls.setModuleSetting('form', key, value);
  }

  private transientFormToggle(parent: HTMLElement, name: string, value: boolean, key: string): void {
    new Setting(parent).setName(name).addToggle((toggle) => toggle
      .setValue(value)
      .onChange((next) => void this.setTransientFormSetting(key, next)));
  }

  private transientFormSlider(
    parent: HTMLElement,
    name: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: string,
  ): void {
    const setting = new Setting(parent).setName(name).setDesc(`Current: ${formatNumber(value)}`);
    setting.settingEl.classList.add('graphplus-slider-setting', 'graph-engine-slider-setting');
    setting.addSlider((slider) => {
      slider.setLimits(min, max, step).setValue(value).setDynamicTooltip().onChange((next) => {
        void this.context.controls.setModuleSetting('form', key, next);
      });
      slider.sliderEl.addEventListener('dblclick', (event) => {
        event.preventDefault();
        void this.setTransientFormSetting(key, undefined);
      });
    });
    if (this.context.controls.getSessionOverrides().modules?.form?.settings?.[key] !== undefined) {
      setting.addExtraButton((control) => control.setIcon('rotate-ccw').setTooltip('Reset to profile default')
        .onClick(() => this.setTransientFormSetting(key, undefined)));
    }
  }

  private renderCamera(parent: HTMLElement, contributions: readonly GraphQuickSettingsContributionV1[]): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.camera)) return;
    const body = this.section(parent, SECTION_TITLES[SECTIONS.camera], false);
    if (graphUiControlIsShownV1(this.policy, SECTIONS.camera, CONTROLS.resetCamera)) {
      new Setting(body).setName('Camera').setDesc('Reset framing without changing the graph document.')
        .addButton((button) => button.setButtonText('Reset camera').onClick(() => this.context.session.resetCamera()));
    }
    this.mountContributions(body, contributions);
  }

  private renderForces(
    parent: HTMLElement,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.forces)) return;
    const body = this.section(parent, SECTION_TITLES[SECTIONS.forces], false);
    const forces = effective.modules['force-layout'];
    if (forces?.enabled) {
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.centerForce)) {
        this.slider(body, 'Center force', readNumber(forces.settings.centeringStrength, 0.002), 0, 0.05, 0.001, 'force-layout', 'centeringStrength');
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.radialForce)) {
        this.slider(body, 'Repel force', readNumber(forces.settings.repulsionStrength, 7000), 0, 50000, 250, 'force-layout', 'repulsionStrength');
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.linkForce)) {
        this.slider(body, 'Link force', readNumber(forces.settings.springStrength, 0.25), 0, 5, 0.05, 'force-layout', 'springStrength');
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.linkDistance)) {
        this.slider(body, 'Link distance', readNumber(forces.settings.springLength, 100), 20, 500, 5, 'force-layout', 'springLength');
      }
    }
    this.mountContributions(body, contributions);
  }

  private renderRegions(
    parent: HTMLElement,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    const regions = effective.modules['node-regions'];
    if (!regions?.enabled || !graphUiSectionIsShownV1(this.policy, SECTIONS.regions)) return;
    const body = this.section(parent, SECTION_TITLES[SECTIONS.regions], false);
    if (graphUiControlIsShownV1(this.policy, SECTIONS.regions, CONTROLS.regionBoundaries)) {
      new Setting(body)
        .setName('Show region boundaries')
        .setDesc(effective.dimensions === '2d'
          ? 'Draw live visual boundaries without changing membership forces.'
          : 'Region boundaries are available in 2D only.')
        .addToggle((toggle) => toggle
          .setValue(regions.settings.boundariesVisible !== false)
          .setDisabled(effective.dimensions !== '2d')
          .onChange(async (visible) => {
            await this.context.profileSettings.setModuleSetting('node-regions', 'boundariesVisible', visible);
            await this.render();
          }));
    }
    this.mountContributions(body, contributions);
  }

  private slider(
    parent: HTMLElement,
    name: string,
    value: number,
    min: number,
    max: number,
    step: number,
    moduleId: string,
    key: string,
  ): void {
    const setting = new Setting(parent).setName(name).setDesc(`Current: ${formatNumber(value)}`);
    setting.settingEl.classList.add('graphplus-slider-setting', 'graph-engine-slider-setting');
    setting.addSlider((slider) => {
      slider.setLimits(min, max, step).setValue(value).setDynamicTooltip().onChange((next) => {
        void this.context.profileSettings.setModuleSetting(moduleId, key, next);
      });
      slider.sliderEl.addEventListener('dblclick', async (event) => {
        event.preventDefault();
        await this.context.profileSettings.setModuleSetting(moduleId, key, undefined);
        await this.render();
      });
    });
    const overridden = this.context.profileSettings.getUserOverrides().modules?.[moduleId]?.settings?.[key] !== undefined;
    if (overridden) setting.addExtraButton((control) => control
      .setIcon('rotate-ccw')
      .setTooltip('Reset to profile default')
      .onClick(async () => {
        await this.context.profileSettings.setModuleSetting(moduleId, key, undefined);
        await this.render();
      }));
  }

  private section(parent: HTMLElement, title: string, open: boolean): HTMLElement {
    const details = this.context.container.ownerDocument.createElement('details');
    details.className = 'graphplus-control-section graph-engine-control-section';
    details.open = open;
    const summary = this.context.container.ownerDocument.createElement('summary');
    const label = this.context.container.ownerDocument.createElement('span');
    label.textContent = title;
    const icon = this.context.container.ownerDocument.createElement('span');
    icon.className = 'graphplus-section-chevron graph-engine-section-chevron';
    setIcon(icon, 'chevron-down');
    summary.append(label, icon);
    details.append(summary);
    const body = div(details, 'graphplus-control-section-body graph-engine-control-section-body');
    parent.append(details);
    return body;
  }

  private mountContributions(
    container: HTMLElement,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    for (const contribution of [...contributions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))) {
      const slot = div(container, 'graph-engine-ui-contribution');
      slot.dataset.graphEngineContribution = contribution.id;
      try {
        const disposable = contribution.mount(slot, {
          consumerId: this.context.consumerId,
          profileId: this.context.profileId,
          session: this.context.session,
        });
        if (disposable) this.contributionDisposables.push(disposable);
      } catch (error) {
        slot.textContent = `Control unavailable: ${error instanceof Error ? error.message : String(error)}`;
        slot.classList.add('mod-warning');
      }
    }
  }

  private disposeContributions(): void {
    for (const disposable of this.contributionDisposables.splice(0)) {
      try { disposable.dispose(); } catch {}
    }
  }

  private iconButton(icon: string, label: string, action: () => void): HTMLButtonElement {
    const element = this.context.container.ownerDocument.createElement('button');
    element.type = 'button';
    element.className = 'clickable-icon graphplus-icon-button graph-engine-icon-button';
    element.setAttribute('aria-label', label);
    setIcon(element, icon);
    element.addEventListener('click', action);
    return element;
  }
}

function groupContributions(
  values: readonly GraphQuickSettingsContributionV1[],
): Map<string, GraphQuickSettingsContributionV1[]> {
  const result = new Map<string, GraphQuickSettingsContributionV1[]>();
  for (const value of values) {
    const section = result.get(value.sectionId) ?? [];
    section.push(value);
    result.set(value.sectionId, section);
  }
  return result;
}

function div(parent: HTMLElement, className: string): HTMLDivElement {
  const value = parent.ownerDocument.createElement('div');
  value.className = className;
  parent.append(value);
  return value;
}

function readNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readLabelMode(value: JsonValue | undefined): 'adaptive' | 'all' | 'off' {
  return value === 'all' || value === 'off' ? value : 'adaptive';
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}
