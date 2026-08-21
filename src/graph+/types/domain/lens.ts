export type GraphDirection = 'both' | 'outgoing' | 'incoming';

export type GraphColorGroup = {
  id: string;
  query: string;
  color: string;
};

export type GraphLensState = {
  filter: {
    query: string;
    showTags: boolean;
    showAttachments: boolean;
    showUnresolved: boolean;
    showOrphans: boolean;
  };
  groups: GraphColorGroup[];
  form: {
    mode: 'free' | 'mind-map';
    rootId: string | null;
    direction: GraphDirection;
    relation: string;
    maxDepth: number | null;
    showCrossLinks: boolean;
    showDisconnected: boolean;
    colorBranches: boolean;
  };
};

export function createDefaultGraphLens(showTags = true): GraphLensState {
  return {
    filter: {
      query: '',
      showTags,
      showAttachments: false,
      showUnresolved: false,
      showOrphans: true,
    },
    groups: [],
    form: {
      mode: 'free',
      rootId: null,
      direction: 'both',
      relation: '',
      maxDepth: null,
      showCrossLinks: true,
      showDisconnected: false,
      colorBranches: true,
    },
  };
}

export function cloneGraphLens(state: GraphLensState): GraphLensState {
  return {
    filter: { ...state.filter },
    groups: state.groups.map((group) => ({ ...group })),
    form: { ...state.form },
  };
}
