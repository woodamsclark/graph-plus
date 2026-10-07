import type { GraphRenderLabelV2 } from './GraphRenderer.ts';
import type { GraphRenderFrameV1, GraphRenderNodeV1 } from './GraphRenderTypes.ts';

export const EMPTY_GRAPH_LABEL_RECORDS: readonly GraphRenderLabelV2[] = Object.freeze([]);

/** Compatibility projection of canonical node label fields for record-based backends. */
export class GraphLabelRecordCache {
  private records: readonly GraphRenderLabelV2[] = EMPTY_GRAPH_LABEL_RECORDS;

  resolve(frame: GraphRenderFrameV1): readonly GraphRenderLabelV2[] {
    if (frame.policy?.labelMode === 'off') return EMPTY_GRAPH_LABEL_RECORDS;
    const nodes = frame.nodes;
    if (nodes.length === this.records.length && nodes.every((node, index) => matches(this.records[index], node))) {
      return this.records;
    }
    this.records = nodes.map((node, index) => matches(this.records[index], node) ? this.records[index] : {
      id: `label:${node.id}`,
      nodeId: node.id,
      text: node.label,
      color: node.labelColor,
      opacity: node.labelOpacity,
      fontSizePx: node.labelFontSize,
      offset: node.labelOffset ?? { x: 0, y: 0 },
      visible: node.showLabel !== false,
      priority: node.labelPriority ?? 0,
      alwaysVisible: node.labelAlwaysVisible === true,
    });
    return this.records;
  }
}

function matches(record: GraphRenderLabelV2 | undefined, node: GraphRenderNodeV1): boolean {
  return record !== undefined && record.nodeId === node.id && record.text === node.label
    && record.color.r === node.labelColor.r && record.color.g === node.labelColor.g
    && record.color.b === node.labelColor.b && record.color.a === node.labelColor.a
    && record.opacity === node.labelOpacity && record.fontSizePx === node.labelFontSize
    && record.offset.x === (node.labelOffset?.x ?? 0) && record.offset.y === (node.labelOffset?.y ?? 0)
    && record.visible === (node.showLabel !== false) && record.priority === (node.labelPriority ?? 0)
    && record.alwaysVisible === (node.labelAlwaysVisible === true);
}
