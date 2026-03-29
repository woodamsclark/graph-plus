import type { ClientPt, ScreenPt, Vec2 } from './math.ts';

export type UIState = {
  gravityCenter: Vec2 | null;
  hoveredNodeId: string | null;
  followedNodeId: string | null;
  draggedNodeId: string | null;
  isPanning: boolean;
  isRotating: boolean;
};

export interface Store<T> {
  get(): Readonly<T>;
  set(next: T): void;
}

export type PointerKind = "mouse" | "touch" | "pen";
export type CursorCss = "default" | "pointer" | "grabbing";

export type UserInputEvent =
  | {
      type: "POINTER_DOWN";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      button: 0 | 1 | 2;
      ctrl: boolean;
      meta: boolean;
      shift: boolean;
      timeMs: number;
    }
  | {
      type: "POINTER_MOVE";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      timeMs: number;
    }
  | {
      type: "POINTER_UP";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      button: 0 | 1 | 2;
      timeMs: number;
    }
  | {
      type: "POINTER_CANCEL";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      timeMs: number;
    }
  | {
      type: "WHEEL";
      screen: ScreenPt;
      client: ClientPt;
      deltaX: number;
      deltaY: number;
      ctrl: boolean;
      meta: boolean;
      shift: boolean;
      timeMs: number;
    }
  | {
      type: "LONG_PRESS";
      pointerId: number;
      kind: PointerKind;
      screen: ScreenPt;
      client: ClientPt;
      timeMs: number;
    };

export interface DrainableBuffer<T>{
    push(e: T): void;
    drain(): T[];
    clear(): void;
    }