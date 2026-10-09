import type {
  ConsumerProfileDescriptorV1,
  GraphQuickSettingsOptionsV1,
  GraphQuickSettingsSectionOptionsV1,
  GraphSessionUiOptionsV1,
  GraphUiControlVisibilityV1,
  GraphUiVisibilityV1,
} from '../../graph-engine/contracts/v1/index.ts';

export interface EffectiveGraphSessionUiPolicyV1 {
  readonly quickSettings: {
    readonly visibility: GraphUiVisibilityV1;
    readonly sections: Readonly<Record<string, GraphQuickSettingsSectionOptionsV1>>;
    readonly contributions: NonNullable<GraphQuickSettingsOptionsV1['contributions']>;
  };
  readonly contextMenu: {
    readonly enabled: boolean;
    readonly coreActions: Readonly<Record<string, GraphUiControlVisibilityV1>>;
  };
  readonly hostOcclusions: NonNullable<GraphSessionUiOptionsV1['hostOcclusions']>;
}

export function resolveGraphSessionUiPolicyV1(
  descriptor: ConsumerProfileDescriptorV1,
  session: GraphSessionUiOptionsV1 | undefined,
): EffectiveGraphSessionUiPolicyV1 {
  const defaults = descriptor.uiDefaults;
  const sessionQuick = session?.quickSettings;
  const sessionContext = session?.contextMenu;
  return {
    quickSettings: {
      visibility: sessionQuick?.visibility ?? defaults?.quickSettingsVisibility ?? 'hidden',
      sections: mergeSections(defaults?.quickSettingsSections, sessionQuick?.sections),
      contributions: [...(sessionQuick?.contributions ?? [])],
    },
    contextMenu: {
      enabled: sessionContext?.enabled ?? defaults?.contextMenuEnabled ?? false,
      coreActions: {
        ...(defaults?.coreContextActions ?? {}),
        ...(sessionContext?.coreActions ?? {}),
      },
    },
    hostOcclusions: [...(session?.hostOcclusions ?? [])],
  };
}

export function graphUiSectionIsShownV1(
  policy: EffectiveGraphSessionUiPolicyV1,
  sectionId: string,
): boolean {
  return policy.quickSettings.sections[sectionId]?.visibility !== 'hidden';
}

export function graphUiControlIsShownV1(
  policy: EffectiveGraphSessionUiPolicyV1,
  sectionId: string,
  controlId: string,
): boolean {
  return graphUiSectionIsShownV1(policy, sectionId)
    && policy.quickSettings.sections[sectionId]?.controls?.[controlId] !== 'hidden';
}

export function graphCoreActionIsShownV1(
  policy: EffectiveGraphSessionUiPolicyV1,
  actionId: string,
): boolean {
  return policy.contextMenu.coreActions[actionId] !== 'hidden';
}

function mergeSections(
  defaults: Readonly<Record<string, GraphQuickSettingsSectionOptionsV1>> | undefined,
  session: Readonly<Record<string, GraphQuickSettingsSectionOptionsV1>> | undefined,
): Readonly<Record<string, GraphQuickSettingsSectionOptionsV1>> {
  const result: Record<string, GraphQuickSettingsSectionOptionsV1> = {};
  for (const sectionId of new Set([...Object.keys(defaults ?? {}), ...Object.keys(session ?? {})])) {
    result[sectionId] = {
      visibility: session?.[sectionId]?.visibility ?? defaults?.[sectionId]?.visibility,
      controls: {
        ...(defaults?.[sectionId]?.controls ?? {}),
        ...(session?.[sectionId]?.controls ?? {}),
      },
    };
  }
  return result;
}
