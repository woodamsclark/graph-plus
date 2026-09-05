import type { Vec3 } from '../../contracts/v1/index.ts';

export interface InputGraphIdentityV1 {
  readonly documentId: string;
  readonly documentRevision: number;
}

export interface GraphScreenPointV1 {
  readonly x: number;
  readonly y: number;
}

export type GraphPointerKindV1 = 'mouse' | 'touch' | 'pen';

interface GraphInputBaseV1 {
  readonly identity: InputGraphIdentityV1;
  readonly timestamp: number;
}

export type GraphInputEventV1 =
  | (GraphInputBaseV1 & {
      readonly type: 'pointer-down';
      readonly pointerId: number;
      readonly pointerKind: GraphPointerKindV1;
      readonly point: GraphScreenPointV1;
      readonly button: number;
      readonly ctrl: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
    })
  | (GraphInputBaseV1 & {
      readonly type: 'pointer-up';
      readonly pointerId: number;
      readonly pointerKind: GraphPointerKindV1;
      readonly point: GraphScreenPointV1;
      readonly button: number;
      readonly ctrl: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
    })
  | (GraphInputBaseV1 & {
      readonly type: 'pointer-move';
      readonly pointerId: number;
      readonly pointerKind: GraphPointerKindV1;
      readonly point: GraphScreenPointV1;
    })
  | (GraphInputBaseV1 & {
      readonly type: 'pointer-cancel';
      readonly pointerId: number;
      readonly pointerKind: GraphPointerKindV1;
      readonly point: GraphScreenPointV1;
    })
  | (GraphInputBaseV1 & {
      readonly type: 'wheel';
      readonly point: GraphScreenPointV1;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly deltaMode: number;
      readonly ctrl: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
    })
  | (GraphInputBaseV1 & {
      readonly type: 'long-press';
      readonly pointerId: number;
      readonly pointerKind: GraphPointerKindV1;
      readonly point: GraphScreenPointV1;
    })
  | (GraphInputBaseV1 & {
      readonly type: 'key-down';
      readonly key: string;
      readonly ctrl: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
      readonly alt: boolean;
      readonly repeat: boolean;
      readonly composing: boolean;
    });

interface GraphCommandBaseV1 {
  readonly identity: InputGraphIdentityV1;
  readonly timestamp: number;
}

export type GraphRuntimeCommandV1 =
  | (GraphCommandBaseV1 & { readonly type: 'pan-by'; readonly deltaX: number; readonly deltaY: number })
  | (GraphCommandBaseV1 & { readonly type: 'orbit-by'; readonly deltaX: number; readonly deltaY: number })
  | (GraphCommandBaseV1 & { readonly type: 'zoom-by'; readonly deltaY: number })
  | (GraphCommandBaseV1 & { readonly type: 'reset-camera' })
  | (GraphCommandBaseV1 & { readonly type: 'fit-camera'; readonly nodeIds?: readonly string[] })
  | (GraphCommandBaseV1 & { readonly type: 'set-selection'; readonly nodeIds: readonly string[] })
  | (GraphCommandBaseV1 & { readonly type: 'set-focus'; readonly nodeId?: string })
  | (GraphCommandBaseV1 & {
      readonly type: 'activate-node';
      readonly nodeId: string;
      readonly activation: 'primary' | 'secondary' | 'keyboard';
    })
  | (GraphCommandBaseV1 & { readonly type: 'activate-background' })
  | (GraphCommandBaseV1 & {
      readonly type: 'request-node-context';
      readonly nodeId: string;
      readonly point: GraphScreenPointV1;
      readonly modality: GraphPointerKindV1;
    })
  | (GraphCommandBaseV1 & { readonly type: 'set-hover'; readonly nodeId?: string })
  | (GraphCommandBaseV1 & { readonly type: 'drag-start'; readonly nodeId: string; readonly point: GraphScreenPointV1 })
  | (GraphCommandBaseV1 & { readonly type: 'drag-update'; readonly nodeId: string; readonly point: GraphScreenPointV1 })
  | (GraphCommandBaseV1 & {
      readonly type: 'drag-end';
      readonly nodeId: string;
      readonly point: GraphScreenPointV1;
      readonly pointerKind: GraphPointerKindV1;
    });

export type GraphRuntimeCommandPayloadV1 = GraphRuntimeCommandV1 extends infer Command
  ? Command extends GraphRuntimeCommandV1
    ? Omit<Command, 'identity' | 'timestamp'>
    : never
  : never;

export interface GraphHitV1 {
  readonly nodeId: string;
  readonly position: Vec3;
  readonly depth: number;
}
