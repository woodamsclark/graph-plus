import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type GraphEnginePlugin from '../main.ts';
import type { GraphPlusColorOverridesV1 } from '../../graph-plus/consumer/index.ts';
import type { GraphColorV2 } from '../../graph-engine/runtime/theme/index.ts';
import { GraphEngineSettingsPanelV1 } from './GraphEngineSettingsPanel.ts';
import { preserveSettingsScrollV1 } from './SettingsScroll.ts';

export class GraphEngineSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly graphPlus: GraphEnginePlugin) {
    super(app, graphPlus);
  }

  display(): void {
    const { containerEl } = this;
    preserveSettingsScrollV1(containerEl, () => {
      containerEl.empty();
      const enginePanel = new GraphEngineSettingsPanelV1(this.graphPlus.engineSettings);
      enginePanel.renderProfiles(containerEl, this.app, () => this.display());
      this.renderGeneral(containerEl);
      enginePanel.renderGlobal(containerEl, () => this.display());
      this.renderRecovery(containerEl);
      this.renderMiscellany(containerEl);
    });
  }

  private renderGeneral(parent: HTMLElement): void {
    new Setting(parent).setName('General').setHeading();
    const settings = this.graphPlus.settings;
    new Setting(parent).setName('Enable graph+').setDesc('Allow the graph+ view and commands.')
      .addToggle((toggle) => toggle.setValue(settings.enabled).onChange(async (enabled) => {
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, enabled });
      }));
    new Setting(parent).setName('Show tags by default').setDesc('Include tag nodes in new graph+ views.')
      .addToggle((toggle) => toggle.setValue(settings.showTags).onChange(async (showTags) => {
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, showTags });
      }));
    new Setting(parent).setName('Count duplicate links').setDesc('Use repeated note links as link weight.')
      .addToggle((toggle) => toggle.setValue(settings.countDuplicateLinks).onChange(async (countDuplicateLinks) => {
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, countDuplicateLinks });
      }));

    const effective = this.graphPlus.engineSettings.getEffectiveProfile('graph-plus', 'default');
    new Setting(parent).setName('Default dimensions').setDesc('Used when opening graph+.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ '2d': '2D', '3d': '3D' })
        .setValue(effective.dimensions)
        .onChange(async (dimensions) => {
          await this.graphPlus.engineSettings.setProfileDimensions(
            'graph-plus',
            'default',
            dimensions as '2d' | '3d',
          );
          this.display();
        }));

    new Setting(parent).setName('Colors').setHeading();
    const palette = this.graphPlus.resolveGraphPlusThemePalette();
    this.renderColorOverride(parent, 'Background', 'Graph canvas background.', 'background', palette.colors.background);
    this.renderColorOverride(parent, 'Note nodes', 'Ordinary note node color.', 'noteNode', palette.colors.node);
    this.renderColorOverride(parent, 'Tag nodes', 'Tag node color.', 'tagNode', palette.colors.tagNode);
  }

  private renderColorOverride(
    parent: HTMLElement,
    name: string,
    description: string,
    key: keyof GraphPlusColorOverridesV1,
    inherited: GraphColorV2,
  ): void {
    const override = this.graphPlus.settings.colors[key];
    const setting = new Setting(parent)
      .setName(name)
      .setDesc(`${description} ${override ? 'Graph+ override.' : 'Inherited from the active Obsidian theme.'}`)
      .addColorPicker((picker) => picker
        .setValue(override ?? colorHex(inherited))
        .onChange(async (color) => {
          await this.graphPlus.updateGraphPlusSettings({
            ...this.graphPlus.settings,
            colors: { ...this.graphPlus.settings.colors, [key]: color.toLowerCase() },
          });
          this.display();
        }));
    if (override) setting.addExtraButton((button) => button
      .setIcon('rotate-ccw')
      .setTooltip('Use active Obsidian theme')
      .onClick(async () => {
        const colors = { ...this.graphPlus.settings.colors };
        delete colors[key];
        await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, colors });
        this.display();
      }));
  }

  private renderRecovery(parent: HTMLElement): void {
    new Setting(parent).setName('Data and recovery').setHeading();
    const section = parent.createDiv({ cls: 'graphplus-danger-zone' });
    new Setting(section).setName('Danger zone').setHeading();
    const canReset = this.graphPlus.canResetGraphLayoutData();
    new Setting(section)
      .setName('Reset graph layout data for this vault')
      .setDesc(canReset
        ? 'Regenerate placement and camera state without changing notes, links, filters, or settings.'
        : 'Keep one Global graph+ pane open and close any additional Global graph+ panes. A Local graph+ pane does not make this action available.')
      .addButton((button) => button
        .setButtonText('Reset layout…')
        .setWarning()
        .setDisabled(!canReset)
        .onClick(() => new GraphLayoutResetModal(this.app, this.graphPlus).open()));
  }

  private renderMiscellany(parent: HTMLElement): void {
    new Setting(parent).setName('Miscellany').setHeading();
    new Setting(parent)
      .setName('Frank mode')
      .setDesc("for Frank's eyes only.")
      .addToggle((toggle) => toggle
        .setValue(this.graphPlus.settings.frankMode)
        .onChange(async (frankMode) => {
          await this.graphPlus.updateGraphPlusSettings({ ...this.graphPlus.settings, frankMode });
        }));
  }
}

function colorHex(color: GraphColorV2): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

class GraphLayoutResetModal extends Modal {
  constructor(app: App, private readonly graphPlus: GraphEnginePlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl('h2', { text: `Reset graph+ layout for “${this.app.vault.getName()}”?` });
    this.contentEl.createEl('p', {
      text: 'Node placement, camera framing, pins, focus, and selection will be lost. Vault content, graph filters, Form, colors, labels, and settings will remain unchanged.',
    });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const reset = actions.createEl('button', { text: 'Reset layout', cls: 'mod-warning' });
    reset.addEventListener('click', () => {
      reset.disabled = true;
      void this.graphPlus.resetGraphLayoutData().then((success) => {
        this.close();
        new Notice(success ? 'graph+ layout was regenerated.' : 'Keep one Global graph+ pane open, close any additional Global graph+ panes, and try again.');
      }).catch((error) => {
        reset.disabled = false;
        new Notice(`graph+ layout reset failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
