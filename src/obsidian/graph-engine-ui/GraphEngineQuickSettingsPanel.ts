import { Setting, setIcon, type SliderComponent } from 'obsidian';
import {
  GRAPH_VIEW_DEFINITIONS_V1,
  type GraphViewIdV1,
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
import { isQuickSettingsToggleKeyV1 } from './GraphEngineQuickSettingsShortcut.ts';
import { ObsidianGraphUiLayoutV1 } from './ObsidianGraphUiLayout.ts';
import {
  graphSettingDisplayValueV1,
  graphSettingPresentationV1,
  graphSettingStoredValueV1,
} from '../settings/GraphEngineSettingsCatalog.ts';

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
  private viewSubscription?: Disposable;
  private overrideSubscription?: Disposable;
  private graphSubscription?: Disposable;
  private contributionDisposables: Disposable[] = [];
  private activeViewId: GraphViewIdV1 = 'overview';
  private collapsed: boolean;
  private renderRevision = 0;
  private graphCounts?: { readonly nodes: number; readonly edges: number };
  private autoCloseTimer?: number;
  private localSettingWrites = 0;
  private disposed = false;

  constructor(
    private readonly context: GraphEngineSessionUiMountContextV1,
    private readonly policy: EffectiveGraphSessionUiPolicyV1,
  ) {
    this.collapsed = policy.quickSettings.visibility === 'collapsed';
  }

  mount(): void {
    if (this.root || this.disposed || this.policy.quickSettings.visibility === 'hidden') return;
    this.activeViewId = this.context.session.getActiveView().id;
    this.collapsed = !(this.context.session.getViewUiState(this.activeViewId)?.quickSettingsOpen
      ?? this.policy.quickSettings.visibility === 'shown');
    const root = this.context.container.ownerDocument.createElement('div');
    root.className = 'graph-engine-quick-settings graphplus-graph-controls graph-controls';
    root.dataset.graphEngineQuickSettings = '';
    root.addEventListener('pointerdown', stopPropagation);
    root.addEventListener('pointerup', stopPropagation);
    root.addEventListener('click', stopPropagation);
    root.addEventListener('wheel', stopPropagation);
    root.addEventListener('pointerenter', this.cancelAutoClose);
    root.addEventListener('pointerleave', this.scheduleAutoClose);
    this.context.container.addEventListener('keydown', this.handleKeyDown, true);
    this.context.container.addEventListener('pointerdown', this.handleOutsidePointerDown, true);
    this.context.container.append(root);
    this.root = root;
    this.layout = new ObsidianGraphUiLayoutV1(
      this.context.container,
      root,
      this.policy.hostOcclusions,
    );
    this.intentSubscription = this.context.session.onIntent((intent) => {
      if (this.collapsed) return;
      if (intent.type === 'selection-changed' || intent.type === 'focus-changed' || intent.type === 'node-drag-ended') {
        void this.render();
      }
    });
    this.viewSubscription = this.context.session.onViewChanged((view) => {
      if (this.activeViewId === view.id) return;
      this.activeViewId = view.id;
      this.collapsed = !(this.context.session.getViewUiState(this.activeViewId)?.quickSettingsOpen
        ?? this.policy.quickSettings.visibility === 'shown');
      void this.render();
    });
    this.overrideSubscription = this.context.controls.onSessionOverridesChanged(() => {
      if (!this.collapsed && this.localSettingWrites === 0) void this.render();
    });
    this.graphSubscription = this.context.session.onGraphChanged(() => {
      if (this.collapsed) this.graphCounts = undefined;
      else void this.refreshGraphCounts();
    });
    void this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAutoClose();
    this.disposeContributions();
    this.viewSubscription?.dispose();
    this.viewSubscription = undefined;
    this.intentSubscription?.dispose();
    this.intentSubscription = undefined;
    this.overrideSubscription?.dispose();
    this.overrideSubscription = undefined;
    this.graphSubscription?.dispose();
    this.graphSubscription = undefined;
    this.layout?.dispose();
    this.layout = undefined;
    this.root?.removeEventListener('pointerenter', this.cancelAutoClose);
    this.root?.removeEventListener('pointerleave', this.scheduleAutoClose);
    this.context.container.removeEventListener('keydown', this.handleKeyDown, true);
    this.context.container.removeEventListener('pointerdown', this.handleOutsidePointerDown, true);
    this.root?.remove();
    this.root = undefined;
    this.status = undefined;
    this.graphCounts = undefined;
  }

  private readonly handleOutsidePointerDown = (event: PointerEvent): void => {
    if (this.collapsed || !this.root || this.root.contains(event.target as Node)) return;
    this.setCollapsed(true);
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.render();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed || !isQuickSettingsToggleKeyV1(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.setCollapsed(!this.collapsed);
    void this.render();
  };

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    const state = this.context.session.getViewUiState(this.activeViewId);
    this.context.session.setViewUiState(this.activeViewId, {
      quickSettingsOpen: !collapsed, expandedSectionIds: state?.expandedSectionIds ?? [],
    });
  }

  private async render(): Promise<void> {
    const root = this.root;
    if (!root || this.disposed) return;
    const revision = ++this.renderRevision;
    root.classList.toggle('is-collapsed', this.collapsed);
    if (this.collapsed) {
      this.cancelAutoClose();
      this.disposeContributions();
      root.replaceChildren();
      const open = this.iconButton('settings-2', 'Open graph controls', () => {
        this.setCollapsed(false);
        void this.render();
      });
      open.classList.add('graphplus-controls-open', 'graph-engine-controls-open');
      root.append(open);
      return;
    }
    const [viewState, effective] = await Promise.all([
      this.context.session.exportViewState(),
      this.context.session.exportEffectiveSettings(),
    ]);
    if (!this.graphCounts) await this.refreshGraphCounts(false);
    if (!this.root || this.disposed || revision !== this.renderRevision) return;
    this.disposeContributions();
    root.replaceChildren();

    const header = div(root, 'graphplus-controls-header graph-engine-controls-header');
    const title = this.context.container.ownerDocument.createElement('span');
    title.className = 'graphplus-controls-title graph-engine-controls-title';
    title.textContent = `${GRAPH_VIEW_DEFINITIONS_V1[this.activeViewId].title} controls`;
    header.append(title);
    const actions = div(header, 'graphplus-controls-actions graph-engine-controls-actions');
    const view = GRAPH_VIEW_DEFINITIONS_V1[this.activeViewId];
    const availableViews = this.context.session.getAvailableViews();
    if (view.controls.navigationActions.includes('back')
      && view.interactions.escapeActivation !== view.id
      && availableViews.includes(view.interactions.escapeActivation)) {
      actions.append(this.iconButton('arrow-up', 'Back one View', () => {
        this.context.controls.navigateView('back');
      }));
    }
    if (view.controls.navigationActions.includes('overview') && view.id === 'focus' && availableViews.includes('overview')) {
      actions.append(this.iconButton('globe', 'Return to Overview', () => { this.context.controls.navigateView('overview'); }));
    }
    if (view.controls.navigationActions.includes('clear-constellation') && viewState.selectedNodeIds.length > 0) {
      actions.append(this.iconButton('eraser', 'Clear active constellation', () => { this.context.controls.navigateView('clear-constellation'); }));
    }
    actions.append(this.iconButton('x', 'Collapse graph controls', () => {
      this.setCollapsed(true);
      void this.render();
    }));

    const body = div(root, 'graphplus-controls-body graph-engine-controls-body');
    const declared = GRAPH_VIEW_DEFINITIONS_V1[this.activeViewId].controls.quickSettingsSectionIds;
    const contributions = groupContributions(this.policy.quickSettings.contributions);
    if (declared.includes(SECTIONS.filter)) this.renderFilter(body, contributions.get(SECTIONS.filter) ?? []);
    if (declared.includes(SECTIONS.form)) this.renderForm(
      body,
      viewState,
      effective,
      contributions.get(SECTIONS.form) ?? [],
      contributions.get(SECTIONS.regions) ?? [],
    );
    if (declared.includes(SECTIONS.display)) this.renderDisplay(body, effective, contributions.get(SECTIONS.display) ?? []);
    if (declared.includes(SECTIONS.forces)) this.renderForces(body, effective, contributions.get(SECTIONS.forces) ?? []);
    for (const [sectionId, values] of contributions) {
      if (Object.values(SECTIONS).includes(sectionId as typeof SECTIONS[keyof typeof SECTIONS])) continue;
      if (!graphUiSectionIsShownV1(this.policy, sectionId)) continue;
      const sectionBody = this.section(body, sectionId, humanize(sectionId), false);
      this.mountContributions(sectionBody, values);
    }
    this.status = div(root, 'graphplus-controls-status graph-engine-controls-status');
    this.updateStatus();
  }

  private async refreshGraphCounts(updateStatus = true): Promise<void> {
    if (this.disposed) return;
    const document = await this.context.session.exportDocument();
    if (this.disposed) return;
    this.graphCounts = { nodes: document.nodes.length, edges: document.edges.length };
    if (updateStatus) this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status || !this.graphCounts) return;
    this.status.textContent = `${this.graphCounts.nodes} nodes · ${this.graphCounts.edges} links`;
  }

  private renderFilter(parent: HTMLElement, contributions: readonly GraphQuickSettingsContributionV1[]): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.filter)) return;
    const body = this.section(parent, SECTIONS.filter, SECTION_TITLES[SECTIONS.filter], false);
    if (graphUiControlIsShownV1(this.policy, SECTIONS.filter, CONTROLS.clearFilter)) {
      new Setting(body).setName('Active filters')
        .addButton((button) => button.setButtonText('Clear filters').onClick(() => this.context.session.clearFilter()));
    }
    this.mountContributions(body, contributions);
  }

  private renderForm(
    parent: HTMLElement,
    viewState: GraphViewStateV1,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
    regionContributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.form)) return;
    const body = this.section(parent, SECTIONS.form, SECTION_TITLES[SECTIONS.form], false);
    this.renderFormDimensions(body, effective);
    /* Mind Map deferred: keep this implementation for a later release.
    if (graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.mindMap)) {
      const form = effective.modules.form;
      const selectedId = viewState.selectedNodeIds.length === 1 ? viewState.selectedNodeIds[0] : undefined;
      new Setting(body)
        .setName('Mind map')
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
    */
    this.renderRegionControls(body, effective);
    this.mountContributions(body, contributions);
    this.mountContributions(body, regionContributions);
  }

  private renderFormDimensions(parent: HTMLElement, effective: GraphEffectiveSettingsV1): void {
    const descriptor = this.context.profileSettings.getDescriptor();
    const allowed = descriptor.allowedDimensions ?? ['2d', '3d'];
    if (descriptor.uiDefaults?.dimensionControlVisible !== true
      || allowed.length < 2
      || !graphUiControlIsShownV1(this.policy, SECTIONS.form, CONTROLS.formDimensions)) return;
    new Setting(parent).setName('Graph dimensions').addDropdown((dropdown) => {
      for (const dimensions of allowed) dropdown.addOption(dimensions, dimensions === '2d' ? '2D' : '3D');
      dropdown.setValue(effective.dimensions).onChange(async (value) => {
        await this.writeProfileDimensions(value as '2d' | '3d');
        await this.render();
      });
    });
  }

  private renderDisplay(
    parent: HTMLElement,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.display)) return;
    const body = this.section(parent, SECTIONS.display, SECTION_TITLES[SECTIONS.display], false);
    const rendering = effective.modules.rendering;
    const anima = effective.modules.anima;
    let adaptiveThresholdHost: HTMLDivElement | undefined;
    if (rendering) {
      const settings = rendering.settings;
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.labels)) {
        const presentation = graphSettingPresentationV1('rendering.labelMode');
        new Setting(body).setName(presentation.name).addDropdown((dropdown) => dropdown
          .addOptions(selectOptions(presentation))
          .setValue(readLabelMode(settings.labelMode))
          .onChange(async (value) => {
            await this.context.profileSettings.setModuleSetting('rendering', 'labelMode', value);
            if (adaptiveThresholdHost) adaptiveThresholdHost.hidden = value !== 'adaptive';
          }));
      }
    }
    if (anima?.enabled
      && graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.labelPosition)) {
      const presentation = graphSettingPresentationV1('anima.labelPosition');
      new Setting(body).setName(presentation.name).addDropdown((dropdown) => dropdown
        .addOptions(selectOptions(presentation))
        .setValue(readLabelPosition(anima.settings.labelPosition))
        .onChange(async (value) => {
          await this.context.profileSettings.setModuleSetting('anima', 'labelPosition', value);
        }));
    }
    if (rendering) {
      const settings = rendering.settings;
      if (anima?.enabled
        && graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.labelSaliency)) {
        const thresholdKey = effective.dimensions === '3d'
          ? 'adaptiveLabelThreshold3d'
          : 'adaptiveLabelThreshold2d';
        adaptiveThresholdHost = div(body, 'graph-engine-conditional-control');
        adaptiveThresholdHost.hidden = readLabelMode(settings.labelMode) !== 'adaptive';
        this.catalogSlider(adaptiveThresholdHost, `anima.${thresholdKey}`, readNumber(anima.settings[thresholdKey], 50));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.nodeSize)) {
        this.catalogSlider(body, 'rendering.nodeRadiusScale', readNumber(settings.nodeRadiusScale, 1));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.linkThickness)) {
        this.catalogSlider(body, 'rendering.edgeThicknessScale', readNumber(settings.edgeThicknessScale, 0.1));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.display, CONTROLS.showArrows)) {
        const presentation = graphSettingPresentationV1('rendering.showArrows');
        new Setting(body).setName(presentation.name).addToggle((toggle) => toggle
          .setValue(settings.showArrows === true)
          .onChange(async (visible) => {
            await this.context.profileSettings.setModuleSetting('rendering', 'showArrows', visible);
          }));
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
    const setting = new Setting(parent).setName(name);
    setting.settingEl.classList.add('graphplus-slider-setting', 'graph-engine-slider-setting');
    setting.addSlider((slider) => {
      slider.setLimits(min, max, step).setValue(value).setDynamicTooltip();
      slider.sliderEl.addEventListener('input', () => {
        const next = slider.getValue();
        numberInput.value = formatSliderValue(next, step);
        void this.writeSessionSetting('form', key, next);
      });
      const numberInput = this.sliderNumberInput(setting, slider, name, min, max, step, (next) => {
        void this.writeSessionSetting('form', key, next);
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

  private renderForces(
    parent: HTMLElement,
    effective: GraphEffectiveSettingsV1,
    contributions: readonly GraphQuickSettingsContributionV1[],
  ): void {
    if (!graphUiSectionIsShownV1(this.policy, SECTIONS.forces)) return;
    const body = this.section(parent, SECTIONS.forces, SECTION_TITLES[SECTIONS.forces], false);
    const forces = effective.modules['force-layout'];
    if (forces?.enabled) {
      const settings = forces.settings;
      let axialStiffnessHost: HTMLDivElement | undefined;
      if (effective.dimensions === '3d'
        && graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.axialSpringAxis)) {
        const presentation = graphSettingPresentationV1('force-layout.axialSpringAxis');
        new Setting(body)
          .setName(presentation.name)
          .addDropdown((dropdown) => dropdown
            .addOptions(selectOptions(presentation))
            .setValue(readAxialAxis(settings.axialSpringAxis))
            .onChange(async (axis) => {
              await this.context.profileSettings.setModuleSetting('force-layout', 'axialSpringAxis', axis);
              if (axialStiffnessHost) axialStiffnessHost.hidden = axis === 'off';
            }));
      }
      if (effective.dimensions === '3d'
        && graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.axialSpringStiffness)) {
        axialStiffnessHost = div(body, 'graph-engine-conditional-control');
        axialStiffnessHost.hidden = readAxialAxis(settings.axialSpringAxis) === 'off';
        this.catalogSlider(axialStiffnessHost, 'force-layout.axialSpringStiffness', readNumber(settings.axialSpringStiffness, 0));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.centerForce)) {
        this.catalogSlider(body, 'force-layout.centeringStrength', readNumber(settings.centeringStrength, 0.1));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.radialForce)) {
        this.catalogSlider(body, 'force-layout.repulsionStrength', readNumber(settings.repulsionStrength, 1000));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.linkForce)) {
        this.catalogSlider(body, 'force-layout.springStrength', readNumber(settings.springStrength, 1));
      }
      if (graphUiControlIsShownV1(this.policy, SECTIONS.forces, CONTROLS.linkDistance)) {
        this.catalogSlider(body, 'force-layout.springLength', readNumber(settings.springLength, 250));
      }
    }
    this.mountContributions(body, contributions);
  }

  private renderRegionControls(parent: HTMLElement, effective: GraphEffectiveSettingsV1): void {
    const regions = effective.modules['node-regions'];
    if (!regions?.enabled || !graphUiSectionIsShownV1(this.policy, SECTIONS.regions)) return;
    const settings = regions.settings;
    if (graphUiControlIsShownV1(this.policy, SECTIONS.regions, CONTROLS.regionAttraction)) {
      this.catalogSlider(parent, 'node-regions.membershipStrength', readNumber(settings.membershipStrength, 0.18));
    }
    if (graphUiControlIsShownV1(this.policy, SECTIONS.regions, CONTROLS.regionBoundaries)) {
      const presentation = graphSettingPresentationV1('node-regions.boundariesVisible');
      new Setting(parent)
        .setName(presentation.name)
        .addToggle((toggle) => toggle
          .setValue(settings.boundariesVisible !== false)
          .setDisabled(effective.dimensions !== '2d')
          .onChange(async (visible) => {
            await this.context.profileSettings.setModuleSetting('node-regions', 'boundariesVisible', visible);
          }));
    }
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
    toStoredValue: (value: number) => number = (value) => value,
    description?: string,
  ): void {
    const setting = new Setting(parent).setName(name);
    if (description) setting.setDesc(description);
    setting.settingEl.classList.add('graphplus-slider-setting', 'graph-engine-slider-setting');
    setting.addSlider((slider) => {
      slider.setLimits(min, max, step).setValue(value).setDynamicTooltip();
      slider.sliderEl.addEventListener('input', () => {
        const next = slider.getValue();
        numberInput.value = formatSliderValue(next, step);
        void this.writeProfileSetting(moduleId, key, toStoredValue(next));
      });
      const numberInput = this.sliderNumberInput(setting, slider, name, min, max, step, (next) => {
        void this.writeProfileSetting(moduleId, key, toStoredValue(next));
      });
      slider.sliderEl.addEventListener('dblclick', async (event) => {
        event.preventDefault();
        await this.context.profileSettings.setModuleSetting(moduleId, key, undefined);
        await this.render();
      });
    });
    const rawOverrides = this.context.profileSettings.getUserOverrides().modules?.[moduleId]?.settings;
    const overridden = rawOverrides?.[key] !== undefined;
    if (overridden) setting.addExtraButton((control) => control
      .setIcon('rotate-ccw')
      .setTooltip('Reset to profile default')
      .onClick(async () => {
        await this.context.profileSettings.setModuleSetting(moduleId, key, undefined);
        await this.render();
      }));
  }

  private sliderNumberInput(
    setting: Setting,
    slider: SliderComponent,
    name: string,
    min: number,
    max: number,
    step: number,
    onValue: (value: number) => void,
  ): HTMLInputElement {
    const input = setting.settingEl.ownerDocument.createElement('input');
    input.className = 'graphplus-slider-number graph-engine-slider-number';
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = formatSliderValue(slider.getValue(), step);
    input.setAttribute('aria-label', `${name} value`);
    input.addEventListener('input', () => {
      const entered = input.valueAsNumber;
      if (!Number.isFinite(entered)) return;
      const next = normalizeSliderValue(entered, min, max, step);
      slider.setValue(next);
      onValue(next);
    });
    input.addEventListener('blur', () => {
      input.value = formatSliderValue(slider.getValue(), step);
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') input.blur();
    });
    slider.sliderEl.after(input);
    return input;
  }

  private catalogSlider(parent: HTMLElement, id: string, value: number, description?: string): void {
    const presentation = graphSettingPresentationV1(id);
    if (presentation.control.type !== 'slider') throw new Error(`${id} is not a slider setting.`);
    const displayValue = graphSettingDisplayValueV1(presentation, value);
    this.slider(
      parent,
      presentation.name,
      typeof displayValue === 'number' ? displayValue : presentation.control.min,
      presentation.control.min,
      presentation.control.max,
      presentation.control.step,
      presentation.moduleId,
      presentation.key,
      (next) => graphSettingStoredValueV1(presentation, next) as number,
      description,
    );
  }

  private writeProfileSetting(moduleId: string, key: string, value: JsonValue | undefined): Promise<void> {
    this.localSettingWrites += 1;
    return this.context.profileSettings.setModuleSetting(moduleId, key, value)
      .finally(() => { this.localSettingWrites = Math.max(0, this.localSettingWrites - 1); });
  }

  private writeProfileDimensions(dimensions: '2d' | '3d'): Promise<void> {
    this.localSettingWrites += 1;
    return this.context.profileSettings.setDimensions(dimensions)
      .finally(() => { this.localSettingWrites = Math.max(0, this.localSettingWrites - 1); });
  }

  private writeSessionSetting(moduleId: string, key: string, value: JsonValue | undefined): Promise<void> {
    this.localSettingWrites += 1;
    return this.context.controls.setModuleSetting(moduleId, key, value)
      .finally(() => { this.localSettingWrites = Math.max(0, this.localSettingWrites - 1); });
  }

  private readonly cancelAutoClose = (): void => {
    if (this.autoCloseTimer === undefined) return;
    this.context.container.ownerDocument.defaultView?.clearTimeout(this.autoCloseTimer);
    this.autoCloseTimer = undefined;
  };

  private readonly scheduleAutoClose = (event: PointerEvent): void => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    this.cancelAutoClose();
    if (this.collapsed || this.disposed) return;
    this.autoCloseTimer = this.context.container.ownerDocument.defaultView?.setTimeout(() => {
      this.autoCloseTimer = undefined;
      if (this.disposed) return;
      this.setCollapsed(true);
      void this.render();
    }, 5_000);
  };

  private section(parent: HTMLElement, sectionId: string, title: string, defaultOpen: boolean): HTMLElement {
    const details = this.context.container.ownerDocument.createElement('details');
    details.className = 'graphplus-control-section graph-engine-control-section';
    const viewId = this.activeViewId;
    const saved = this.context.session.getViewUiState(viewId);
    details.open = saved ? saved.expandedSectionIds.includes(sectionId) : defaultOpen;
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      const state = this.context.session.getViewUiState(viewId)
        ?? { quickSettingsOpen: !this.collapsed, expandedSectionIds: [] };
      const sections = new Set(state.expandedSectionIds);
      if (details.open) sections.add(sectionId); else sections.delete(sectionId);
      this.context.session.setViewUiState(viewId, { ...state, expandedSectionIds: [...sections] });
    });
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

function readLabelMode(value: JsonValue | undefined): 'adaptive' | 'proximity' | 'off' {
  return value === 'adaptive' || value === 'off' ? value : value === 'all' ? 'adaptive' : 'proximity';
}

function readLabelPosition(value: JsonValue | undefined): 'above' | 'below' {
  return value === 'below' ? 'below' : 'above';
}

function readAxialAxis(value: JsonValue | undefined): 'off' | 'x' | 'y' | 'z' {
  return value === 'x' || value === 'y' || value === 'z' ? value : 'off';
}

function selectOptions(presentation: ReturnType<typeof graphSettingPresentationV1>): Record<string, string> {
  if (presentation.control.type !== 'select') throw new Error(`${presentation.id} is not a select setting.`);
  return { ...presentation.control.options };
}


function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

function normalizeSliderValue(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const stepped = min + Math.round((clamped - min) / step) * step;
  return Number(stepped.toFixed(sliderStepPrecision(step)));
}

function formatSliderValue(value: number, step: number): string {
  return String(Number(value.toFixed(sliderStepPrecision(step))));
}

function sliderStepPrecision(step: number): number {
  const decimal = String(step).split('.')[1];
  return decimal?.length ?? 0;
}
