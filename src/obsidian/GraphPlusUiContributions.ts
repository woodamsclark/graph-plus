import { Setting } from 'obsidian';
import {
  GRAPH_QUICK_SETTINGS_SECTION_IDS_V1 as SECTIONS,
  type GraphQuickSettingsContributionV1,
} from '../graph-engine/contracts/v1/index.ts';
import type { GraphPlusConsumerV1 } from '../graph-plus/consumer/index.ts';

export function createGraphPlusUiContributionsV1<TFile>(
  getConsumer: () => GraphPlusConsumerV1<TFile>,
): readonly GraphQuickSettingsContributionV1[] {
  return [
    {
      id: 'graph-plus.refine-vault',
      sectionId: SECTIONS.filter,
      order: 10,
      mount: (container) => mountRefineVault(container, getConsumer()),
    },
    {
      id: 'graph-plus.relation',
      sectionId: SECTIONS.form,
      order: 10,
      mount: (container) => mountRelation(container, getConsumer()),
    },
  ];
}

function mountRefineVault<TFile>(container: HTMLElement, consumer: GraphPlusConsumerV1<TFile>) {
  const lens = consumer.getLens();
  const window = container.ownerDocument.defaultView;
  let timer: number | undefined;
  const searchSetting = new Setting(container);
  searchSetting.settingEl.classList.add('graphplus-domain-search');
  searchSetting.addSearch((search) => {
    search.setPlaceholder('Filter nodes…').setValue(lens.query).onChange((query) => {
      if (timer !== undefined) window?.clearTimeout(timer);
      timer = window?.setTimeout(() => {
        timer = undefined;
        void consumer.setLens({ ...consumer.getLens(), query });
      }, 120);
    });
  });
  new Setting(container).setName('Tags').addToggle((toggle) => toggle
    .setValue(lens.showTags)
    .onChange((showTags) => consumer.setLens({ ...consumer.getLens(), showTags })));
  new Setting(container).setName('Orphans').addToggle((toggle) => toggle
    .setValue(lens.showOrphans)
    .onChange((showOrphans) => consumer.setLens({ ...consumer.getLens(), showOrphans })));
  new Setting(container).addButton((button) => button.setButtonText('Reset filters').onClick(async () => {
    await consumer.setLens({ ...consumer.getLens(), query: '', showTags: true, showOrphans: true });
  }));
  return {
    dispose: () => {
      if (timer !== undefined) window?.clearTimeout(timer);
      timer = undefined;
    },
  };
}

function mountRelation<TFile>(container: HTMLElement, consumer: GraphPlusConsumerV1<TFile>): void {
  const lens = consumer.getLens();
  if (!lens.form.enabled) return;
  const relationOptions: Record<string, string> = { '': 'Any relation' };
  for (const edge of consumer.getDocument()?.edges ?? []) {
    for (const token of edge.tokens ?? []) {
      if (token.startsWith('relation:')) relationOptions[token.slice('relation:'.length)] = token.slice('relation:'.length);
    }
  }
  new Setting(container).setName('Relation').addDropdown((dropdown) => dropdown
    .addOptions(relationOptions)
    .setValue(lens.form.relation ?? '')
    .onChange((relation) => consumer.setLens({
      ...consumer.getLens(),
      form: { ...consumer.getLens().form, relation: relation || undefined },
    })));
}
