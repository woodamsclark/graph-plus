export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type GraphScalar = string | number | boolean | null;

export type GraphAttributeValue = GraphScalar | readonly GraphScalar[];

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Disposable {
  dispose(): void;
}
