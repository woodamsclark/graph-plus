import { Menu } from 'obsidian';
import {
  GRAPH_CORE_CONTEXT_ACTION_IDS_V1 as CORE,
  type Disposable,
  type GraphNodeContextRequestedIntentV1,
} from '../../graph-engine/contracts/v1/index.ts';
import type { GraphEngineSessionUiMountContextV1 } from '../../graph-engine/service/index.ts';
import {
  graphCoreActionIsShownV1,
  type EffectiveGraphSessionUiPolicyV1,
} from './GraphEngineUiPolicy.ts';

export class GraphEngineContextMenuV1 implements Disposable {
  private subscription?: Disposable;

  constructor(
    private readonly context: GraphEngineSessionUiMountContextV1,
    private readonly policy: EffectiveGraphSessionUiPolicyV1,
  ) {}

  mount(): void {
    if (this.subscription || !this.policy.contextMenu.enabled) return;
    this.subscription = this.context.session.onIntent((intent) => {
      if (intent.type === 'node-context-requested') void this.open(intent);
    });
  }

  dispose(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
  }

  private async open(intent: GraphNodeContextRequestedIntentV1): Promise<void> {
    const descriptor = this.context.profileSettings.getDescriptor();
    const activationIds = descriptor.interaction?.activationActionIds ?? [];
    const contextIds = descriptor.interaction?.contextActionIds ?? [];
    const primary = this.context.controls.resolveNodeActions(activationIds, intent.nodeId)[0];
    const otherIds = contextIds.filter((id) => id !== primary?.id);
    const others = this.context.controls.resolveNodeActions(otherIds, intent.nodeId);
    const viewState = await this.context.session.exportViewState();
    const menu = new Menu();
    if (primary) this.addConsumerAction(menu, primary.id, primary.label, primary.icon, intent.nodeId);
    for (const action of others) this.addConsumerAction(menu, action.id, action.label, action.icon, intent.nodeId);
    const coreVisible = Object.values(CORE).some((id) => graphCoreActionIsShownV1(this.policy, id));
    if ((primary || others.length) && coreVisible) menu.addSeparator();
    if (viewState.selectedNodeIds.length > 0 && graphCoreActionIsShownV1(this.policy, CORE.focusNode)) {
      menu.addItem((item) => item.setTitle('Focus node').setIcon('scan-eye').onClick(() => {
        void this.context.session.focusNode(intent.nodeId);
      }));
    }
    if (graphCoreActionIsShownV1(this.policy, CORE.toggleConstellation)) {
      const member = viewState.selectedNodeIds.includes(intent.nodeId);
      menu.addItem((item) => item.setTitle(member ? 'Remove from constellation' : 'Add to constellation')
        .setIcon(member ? 'minus' : 'plus').onClick(() => {
          this.context.controls.toggleConstellationNode(intent.nodeId, intent.modality);
        }));
    }
    if (graphCoreActionIsShownV1(this.policy, CORE.mindMapNode)) {
      menu.addItem((item) => item.setTitle('Mind map from here').setIcon('git-fork').onClick(() => {
        void this.context.controls.setModuleSetting('form', 'rootNodeId', intent.nodeId)
          .then(() => this.context.controls.setModuleEnabled('form', true));
      }));
    }
    if (graphCoreActionIsShownV1(this.policy, CORE.togglePin)) {
      const pinned = viewState.pinnedNodeIds.includes(intent.nodeId);
      menu.addItem((item) => item.setTitle(pinned ? 'Unpin node' : 'Pin node').setIcon(pinned ? 'pin-off' : 'pin').onClick(() => {
        void this.context.session.setNodePinned(intent.nodeId, !pinned);
      }));
    }
    const bounds = this.context.container.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left + intent.anchor.x, y: bounds.top + intent.anchor.y });
  }

  private addConsumerAction(
    menu: Menu,
    actionId: string,
    label: string,
    icon: string | undefined,
    nodeId: string,
  ): void {
    menu.addItem((item) => {
      item.setTitle(label);
      if (icon) item.setIcon(icon);
      item.onClick(() => { this.context.controls.invokeNodeAction(actionId, nodeId); });
    });
  }
}
