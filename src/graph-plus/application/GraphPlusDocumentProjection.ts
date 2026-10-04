import type { GraphDocumentV1 } from '../../graph-engine/contracts/v1/index.ts';
import type { GraphPlusExperiencePolicyV1 } from './GraphPlusExperiencePolicy.ts';

export interface GraphPlusExperienceProjectionOptionsV1 {
  readonly policy: GraphPlusExperiencePolicyV1;
  readonly canonicalDocument?: GraphDocumentV1;
}

/** Derive the document seen by one Graph+ experience from the canonical vault model. */
export function projectGraphPlusExperienceDocumentV1(
  options: GraphPlusExperienceProjectionOptionsV1,
): GraphDocumentV1 {
  return options.canonicalDocument ?? emptyDocument('graph-plus:vault:unavailable');
}

function emptyDocument(documentId: string, revision = 0): GraphDocumentV1 {
  return { schemaVersion: 1, documentId, revision, nodes: [], edges: [] };
}
