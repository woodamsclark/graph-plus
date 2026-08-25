import type { Disposable } from '../../graph-engine/contracts/v1/index.ts';
import type {
  GraphEngineSessionUiHostV1,
  GraphEngineSessionUiMountContextV1,
} from '../../graph-engine/service/index.ts';
import { GraphEngineContextMenuV1 } from './GraphEngineContextMenu.ts';
import { GraphEngineQuickSettingsPanelV1 } from './GraphEngineQuickSettingsPanel.ts';
import { resolveGraphSessionUiPolicyV1 } from './GraphEngineUiPolicy.ts';

export class ObsidianGraphEngineSessionUiHostV1 implements GraphEngineSessionUiHostV1 {
  mount(context: GraphEngineSessionUiMountContextV1): Disposable {
    const policy = resolveGraphSessionUiPolicyV1(
      context.profileSettings.getDescriptor(),
      context.sessionOptions.ui,
    );
    const quickSettings = new GraphEngineQuickSettingsPanelV1(context, policy);
    const contextMenu = new GraphEngineContextMenuV1(context, policy);
    const overrideSubscription = context.controls.onSessionOverridesChanged((overrides) => {
      try {
        void Promise.resolve(context.sessionOptions.onSessionOverridesChanged?.(overrides)).catch(() => undefined);
      } catch {}
    });
    quickSettings.mount();
    contextMenu.mount();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        overrideSubscription.dispose();
        contextMenu.dispose();
        quickSettings.dispose();
      },
    };
  }
}
