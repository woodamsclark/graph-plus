import type { GraphDocumentV1 } from '../../../contracts/v1/index.ts';
import { evaluateGraphFilterV1, type GraphFilterSelectionV1 } from '../../../core/filter/index.ts';
import type { GraphModuleInstanceV1, GraphModulePipelineStateV1 } from '../GraphModuleTypes.ts';

export class FilteringModule implements GraphModuleInstanceV1 {
  projectSource(state: GraphModulePipelineStateV1) {
    const filter = state.viewState.activeFilters.projection;
    if (!filter) return;
    const selection = evaluateGraphFilterV1(state.sourceDocument, filter);
    return {
      document: selectDocument(state.sourceDocument, selection),
      projectionSelection: selection,
    };
  }

  selectRender(state: GraphModulePipelineStateV1) {
    const filter = state.viewState.activeFilters.render;
    if (!filter) return { renderSelection: allOf(state.document) };
    return { renderSelection: evaluateGraphFilterV1(state.document, filter) };
  }
}

function selectDocument(document: GraphDocumentV1, selection: GraphFilterSelectionV1): GraphDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: document.documentId,
    revision: document.revision,
    nodes: document.nodes.filter((node) => selection.nodeIds.has(node.id)),
    edges: document.edges.filter((edge) => selection.edgeIds.has(edge.id)),
  };
}

function allOf(document: GraphDocumentV1): GraphFilterSelectionV1 {
  return {
    nodeIds: new Set(document.nodes.map((node) => node.id)),
    edgeIds: new Set(document.edges.map((edge) => edge.id)),
  };
}
