import type { GraphCameraController, ProjectedGraphPointV1 } from '../camera/index.ts';
import type { GraphFrameStore } from './GraphFrameStore.ts';
import type { GraphRenderFrameV1, GraphRenderNodeV1 } from './GraphRenderTypes.ts';

interface ProjectedNode {
  readonly node: GraphRenderNodeV1;
  readonly point: ProjectedGraphPointV1;
  readonly radius: number;
}

export class CanvasGraphRenderer {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: GraphCameraController,
    private readonly frames: GraphFrameStore,
  ) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire the graph Canvas2D rendering context.');
    this.context = context;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  render(): void {
    const frame = this.frames.get();
    if (!frame) return;
    this.clear(frame);
    const projected = frame.nodes
      .map((node) => {
        const point = this.camera.worldToScreen(node.position);
        return { node, point, radius: node.radius * point.scale };
      })
      .filter(({ point }) => point.depth > 0)
      .sort((a, b) => b.point.depth - a.point.depth);
    const byId = new Map(projected.map((value) => [value.node.id, value]));
    this.drawEdges(frame, byId);
    this.drawNodes(frame, projected);
  }

  private clear(frame: GraphRenderFrameV1): void {
    this.context.clearRect(0, 0, this.width, this.height);
    if (frame.theme.backgroundColor !== 'transparent') {
      this.context.fillStyle = frame.theme.backgroundColor;
      this.context.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawEdges(frame: GraphRenderFrameV1, nodes: ReadonlyMap<string, ProjectedNode>): void {
    this.context.save();
    this.context.strokeStyle = frame.theme.edgeColor;
    this.context.fillStyle = frame.theme.edgeColor;
    for (const edge of frame.edges) {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target) continue;
      const dx = target.point.x - source.point.x;
      const dy = target.point.y - source.point.y;
      const length = Math.hypot(dx, dy);
      if (length <= 0.0001) continue;
      const unitX = dx / length;
      const unitY = dy / length;
      const startX = source.point.x + unitX * source.radius;
      const startY = source.point.y + unitY * source.radius;
      const endX = target.point.x - unitX * target.radius;
      const endY = target.point.y - unitY * target.radius;
      this.context.lineWidth = edge.thickness;
      this.context.beginPath();
      this.context.moveTo(startX, startY);
      this.context.lineTo(endX, endY);
      this.context.stroke();
      if (edge.directed) drawArrow(this.context, endX, endY, unitX, unitY, Math.max(5, edge.thickness * 3));
    }
    this.context.restore();
  }

  private drawNodes(frame: GraphRenderFrameV1, nodes: readonly ProjectedNode[]): void {
    this.context.save();
    this.context.textAlign = 'center';
    this.context.textBaseline = 'top';
    this.context.font = frame.theme.labelFont;
    for (const { node, point, radius } of nodes) {
      this.context.fillStyle = node.focused
        ? frame.theme.focusedNodeColor
        : node.selected
          ? frame.theme.selectedNodeColor
          : frame.theme.nodeColor;
      this.context.beginPath();
      this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.context.fill();
      if (node.focused || node.selected) {
        this.context.strokeStyle = frame.theme.labelColor;
        this.context.lineWidth = node.focused ? 2 : 1;
        this.context.stroke();
      }
      this.context.fillStyle = frame.theme.labelColor;
      this.context.fillText(node.label, point.x, point.y + radius + 4);
    }
    this.context.restore();
  }
}

function drawArrow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  unitX: number,
  unitY: number,
  size: number,
): void {
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - unitX * size + perpendicularX * size * 0.55, y - unitY * size + perpendicularY * size * 0.55);
  context.lineTo(x - unitX * size - perpendicularX * size * 0.55, y - unitY * size - perpendicularY * size * 0.55);
  context.closePath();
  context.fill();
}
