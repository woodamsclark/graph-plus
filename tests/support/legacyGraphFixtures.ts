import type { GraphData, Link, Node, NodeType } from '../../src/graph+/types/domain/graph.ts';
import type { UserInputEvent } from '../../src/graph+/types/domain/ui.ts';

export function node(
  id: string,
  type: NodeType = 'note',
  options: { tags?: string[]; properties?: Record<string, string[]>; x?: number } = {},
): Node {
  const tags = options.tags ?? [];
  const properties = options.properties ?? {};
  return {
    id,
    label: id.replace(/\.md$/, ''),
    type,
    location: { x: options.x ?? 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 10,
    anima: { level: 0, capacity: 100 },
    facets: {
      path: id,
      extension: type === 'note' ? 'md' : undefined,
      tags,
      properties,
      searchText: [id, ...tags, ...Object.keys(properties), ...Object.values(properties).flat()].join(' ').toLowerCase(),
    },
  };
}

export function link(sourceId: string, targetId: string, weight = 1, relations = ['link']): Link {
  return {
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    weight,
    relations,
    length: 100,
    strength: 0.05,
    thickness: 1,
    gate: { state: 'closed', threshold: 0, hysteresis: 0 },
  };
}

export function graph(nodes: Node[], links: Link[]): GraphData {
  return {
    nodes,
    links,
    linksOut: {},
    linksIn: {},
    projection: {
      mode: 'free',
      sourceNodeCount: nodes.length,
      sourceLinkCount: links.length,
    },
  };
}

export function pointer(
  type: 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP',
  x: number,
  y: number,
  button = 0,
): UserInputEvent {
  const common = {
    type,
    pointerId: 1,
    kind: 'mouse' as const,
    screen: { x, y },
    client: { x, y },
    timeMs: type === 'POINTER_UP' ? 20 : type === 'POINTER_MOVE' ? 10 : 0,
  };
  if (type === 'POINTER_MOVE') return common as Extract<UserInputEvent, { type: 'POINTER_MOVE' }>;
  return { ...common, button: button as 0 | 1 | 2, ctrl: false, meta: false, shift: false } as UserInputEvent;
}

export function wheel(options: {
  deltaX?: number;
  deltaY?: number;
  ctrl?: boolean;
  meta?: boolean;
} = {}): Extract<UserInputEvent, { type: 'WHEEL' }> {
  return {
    type: 'WHEEL',
    screen: { x: 100, y: 80 },
    client: { x: 100, y: 80 },
    deltaX: options.deltaX ?? 6,
    deltaY: options.deltaY ?? 12,
    deltaMode: 0,
    ctrl: options.ctrl ?? false,
    meta: options.meta ?? false,
    shift: false,
    timeMs: 0,
  };
}

export function fakeCamera(): any {
  return {
    patchCount: 0,
    patchState() { this.patchCount += 1; },
    worldToScreen: () => ({ x: 0, y: 0, depth: 1, scale: 1, viewZ: 0 }),
    screenToWorld: (x: number, y: number) => ({ x, y, z: 0 }),
  };
}
