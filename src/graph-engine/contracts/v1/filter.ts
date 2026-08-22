import type { GraphScalar } from './values.ts';

export type GraphFilterScopeV1 = 'render' | 'projection';

export interface GraphFilterRequestV1 {
  readonly schemaVersion: 1;
  readonly scope: GraphFilterScopeV1;
  readonly node?: GraphFilterAstV1;
  readonly edge?: GraphFilterAstV1;
}

export type GraphFilterAstV1 =
  | { readonly op: 'all' }
  | { readonly op: 'none' }
  | { readonly op: 'and'; readonly operands: readonly GraphFilterAstV1[] }
  | { readonly op: 'or'; readonly operands: readonly GraphFilterAstV1[] }
  | { readonly op: 'not'; readonly operand: GraphFilterAstV1 }
  | { readonly op: 'id-in'; readonly ids: readonly string[] }
  | { readonly op: 'has-token'; readonly token: string }
  | {
      readonly op: 'attribute-equals';
      readonly attribute: string;
      readonly value: GraphScalar;
    }
  | {
      readonly op: 'attribute-contains';
      readonly attribute: string;
      readonly value: GraphScalar;
    }
  | {
      readonly op: 'attribute-number-range';
      readonly attribute: string;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly op: 'connected-to';
      readonly nodeIds: readonly string[];
      readonly direction?: 'incoming' | 'outgoing' | 'either';
    }
  | {
      readonly op: 'within-depth';
      readonly rootNodeIds: readonly string[];
      readonly maxDepth: number;
      readonly direction?: 'incoming' | 'outgoing' | 'either';
    };
