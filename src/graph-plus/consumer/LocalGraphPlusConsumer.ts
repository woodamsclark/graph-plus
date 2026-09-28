import type {
  GraphPlusVaultModelV1,
  GraphPlusVaultSourceV1,
} from '../application/index.ts';
import {
  GraphPlusApplicationV1,
  type GraphPlusApplicationOptionsV1,
  type GraphPlusNavigatorV1,
} from '../application/GraphPlusApplication.ts';
import type {
  GraphEngineLeaseV1,
  GraphSessionErrorV1,
  GraphSessionUiOptionsV1,
} from '../../graph-engine/contracts/v1/index.ts';
import type { GraphPlusLensStateV1 } from '../query/index.ts';

export interface LocalGraphPlusConsumerOptionsV1<TFile> {
  readonly lease: GraphEngineLeaseV1;
  readonly container: HTMLElement;
  readonly model?: GraphPlusVaultModelV1<TFile>;
  readonly source?: GraphPlusVaultSourceV1<TFile>;
  readonly navigator: GraphPlusNavigatorV1<TFile>;
  readonly countDuplicateLinks?: boolean;
  readonly initialRootNodeId?: string;
  readonly initialDepth?: number;
  readonly initialLens?: GraphPlusLensStateV1;
  readonly profileId?: string;
  readonly ui?: GraphSessionUiOptionsV1;
  readonly onError?: (error: GraphSessionErrorV1 | Error) => void;
  readonly onNotePreview?: GraphPlusApplicationOptionsV1<TFile>['onNotePreview'];
}

/**
 * Compatibility constructor for external callers. Production Global and Local
 * surfaces both instantiate GraphPlusApplicationV1 directly with a mode policy.
 */
export class LocalGraphPlusConsumerV1<TFile> extends GraphPlusApplicationV1<TFile> {
  constructor(options: LocalGraphPlusConsumerOptionsV1<TFile>) {
    super({ ...options, mode: 'local' });
  }
}
