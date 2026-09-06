import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type GraphEnginePlugin from '../main.ts';
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
      containerEl.createEl('h2', { text: 'graph-engine' });
      const enginePanel = new GraphEngineSettingsPanelV1(this.graphPlus.engineSettings);
      enginePanel.renderProfiles(containerEl, this.app, () => this.display());
      this.renderGeneral(containerEl);
      enginePanel.renderGlobal(containerEl, () => this.display());
      this.renderRecovery(containerEl);
    });
  }

  private renderGeneral(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'graph+' });
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
  }

  private renderRecovery(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Data and recovery' });
    const section = parent.createDiv({ cls: 'graphplus-danger-zone' });
    section.createEl('h4', { text: 'Danger zone' });
    const canReset = this.graphPlus.canResetGraphLayoutData();
    new Setting(section)
      .setName('Reset graph layout data for this vault')
      .setDesc(canReset
        ? 'Regenerate placement and camera state without changing notes, links, filters, or settings.'
        : 'Open exactly one graph+ view to make this action available.')
      .addButton((button) => button
        .setButtonText('Reset layout…')
        .setWarning()
        .setDisabled(!canReset)
        .onClick(() => new GraphLayoutResetModal(this.app, this.graphPlus).open()));
  }
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
        new Notice(success ? 'graph+ layout was regenerated.' : 'Open exactly one graph+ view and try again.');
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
