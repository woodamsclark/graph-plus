import { Setting } from 'obsidian';
import {
  GRAPH_QUICK_SETTINGS_SECTION_IDS_V1 as SECTIONS,
  type GraphQuickSettingsContributionV1,
} from '../graph-engine/contracts/v1/index.ts';
import type { GraphDocumentV1 } from '../graph-engine/contracts/v1/index.ts';
import type { GraphPlusLensStateV1 } from '../graph-plus/query/index.ts';

interface GraphPlusUiConsumerV1 {
  getLens(): GraphPlusLensStateV1;
  setLens(next: GraphPlusLensStateV1): Promise<void>;
  getDocument(): GraphDocumentV1 | undefined;
}

export function createGraphPlusUiContributionsV1(
  getConsumer: () => GraphPlusUiConsumerV1,
): readonly GraphQuickSettingsContributionV1[] {
  return [
    {
      id: 'graph-plus.refine-vault',
      sectionId: SECTIONS.filter,
      order: 10,
      mount: (container) => mountRefineVault(container, getConsumer()),
    },
  ];
}

function mountRefineVault(container: HTMLElement, consumer: GraphPlusUiConsumerV1) {
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
