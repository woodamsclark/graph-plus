// InputManager.ts
import type { InputEvent, ScreenPt, PointerKind } from "../../../grammar/interfaces.ts";
import { InputBuffer } from "./InputBuffer.ts";

type GetSettings = () => { camera: { longPressMs: number } } | any;

export class InputManager {
  private longPressTimer: number | null = null;
  private longPressPointerId: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private buffer: InputBuffer,
    private getSettings: GetSettings,
  ) {
    this.canvas.style.touchAction = "none";
    this.attach();
  }

  destroy(): void {
    this.detach();
    this.clearLongPress();
  }

  // ----- DOM glue ------------------------------------------------------------

  private attach() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    this.canvas.addEventListener("pointermove", this.onPointerMove, { passive: false });
    this.canvas.addEventListener("pointerup", this.onPointerUp, { passive: false });
    this.canvas.addEventListener("pointercancel", this.onPointerCancel, { passive: false });
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu, { passive: false });
  }

  private detach() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown as any);
    this.canvas.removeEventListener("pointermove", this.onPointerMove as any);
    this.canvas.removeEventListener("pointerup", this.onPointerUp as any);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel as any);
    this.canvas.removeEventListener("wheel", this.onWheel as any);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu as any);
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.buffer.push({
      type: "POINTER_DOWN",
      pointerId: e.pointerId,
      kind,
      screen,
      client: { x: e.clientX, y: e.clientY },
      button: e.button as 0 | 1 | 2,
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey,
      shift: !!e.shiftKey,
      timeMs: performance.now(),
    });

    // long press only for touch/pen
    if (kind !== "mouse") this.startLongPress(e.pointerId, kind, screen, { x: e.clientX, y: e.clientY });
  };

  private onPointerMove = (e: PointerEvent) => {
    e.preventDefault();

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.buffer.push({
      type: "POINTER_MOVE",
      pointerId: e.pointerId,
      kind,
      screen,
      client: { x: e.clientX, y: e.clientY },
      timeMs: performance.now(),
    });
  };

  private onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    this.clearLongPress();
    try { this.canvas.releasePointerCapture(e.pointerId); } catch {}

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.buffer.push({
      type: "POINTER_UP",
      pointerId: e.pointerId,
      kind,
      screen,
      client: { x: e.clientX, y: e.clientY },
      button: e.button as 0 | 1 | 2,
      timeMs: performance.now(),
    });
  };

  private onPointerCancel = (e: PointerEvent) => {
    e.preventDefault();
    this.clearLongPress();

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.buffer.push({
      type: "POINTER_CANCEL",
      pointerId: e.pointerId,
      kind,
      screen,
      client: { x: e.clientX, y: e.clientY },
      timeMs: performance.now(),
    });
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();

    const screen = this.getScreenFromClient(e.clientX, e.clientY);

    this.buffer.push({
      type: "WHEEL",
      screen,
      client: { x: e.clientX, y: e.clientY },
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey,
      shift: !!e.shiftKey,
      timeMs: performance.now(),
    });
  };

  // ----- long press ----------------------------------------------------------

  private startLongPress(pointerId: number, kind: PointerKind, screen: ScreenPt, client: {x:number;y:number}) {
    this.clearLongPress();

    const ms = this.getSettings()?.camera?.longPressMs ?? 450;
    this.longPressPointerId = pointerId;

    this.longPressTimer = window.setTimeout(() => {
      // Still holding same pointer? Interaction will decide what it means.
      this.buffer.push({
        type: "LONG_PRESS",
        pointerId,
        kind,
        screen,
        client,
        timeMs: performance.now(),
      });
    }, ms);
  }

  private clearLongPress() {
    if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressPointerId = null;
  }

  // ----- coords --------------------------------------------------------------

  private toPointerKind(pointerType: string): PointerKind {
    if (pointerType === "touch") return "touch";
    if (pointerType === "pen") return "pen";
    return "mouse";
  }

  private getScreenFromClient(clientX: number, clientY: number): ScreenPt {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const logicalWidth  = this.canvas.width / dpr;
    const logicalHeight = this.canvas.height / dpr;

    const scaleX = logicalWidth / rect.width;
    const scaleY = logicalHeight / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }
}
