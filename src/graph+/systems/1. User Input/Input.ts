// InputManager.ts
import type { InputSettings, ScreenPt, PointerKind } from "../../grammar/interfaces.ts";
import { InputBuffer } from "./InputBuffer.ts";

type InputDeps = {
  getCanvas: () => HTMLCanvasElement;
  getBuffer: () => InputBuffer;
  inputSettings: InputSettings;
};


export class Input {
  private longPressTimer: number | null = null;
  private longPressPointerId: number | null = null;
  private settings: InputSettings = {};

  constructor(private deps: InputDeps) {
    this.setInputSettings(deps.inputSettings);
    this.attach();
  }

  setInputSettings(settings: Partial<InputSettings>) {
    this.settings = {
      ...this.settings,
      ...settings,
    };
  }

  destroy(): void {
    this.detach();
    this.clearLongPress();
  }

  // ----- DOM glue ------------------------------------------------------------

  private attach() {
    this.deps.getCanvas().addEventListener("pointerdown",   this.onPointerDown, { passive: false });
    this.deps.getCanvas().addEventListener("pointermove",   this.onPointerMove, { passive: false });
    this.deps.getCanvas().addEventListener("pointerup",     this.onPointerUp, { passive: false });
    this.deps.getCanvas().addEventListener("pointercancel", this.onPointerCancel, { passive: false });
    this.deps.getCanvas().addEventListener("wheel",         this.onWheel, { passive: false });
    this.deps.getCanvas().addEventListener("contextmenu",   this.onContextMenu, { passive: false });
  }

  private detach() {
    this.deps.getCanvas().removeEventListener("pointerdown",    this.onPointerDown as any);
    this.deps.getCanvas().removeEventListener("pointermove",    this.onPointerMove as any);
    this.deps.getCanvas().removeEventListener("pointerup",      this.onPointerUp as any);
    this.deps.getCanvas().removeEventListener("pointercancel",  this.onPointerCancel as any);
    this.deps.getCanvas().removeEventListener("wheel",          this.onWheel as any);
    this.deps.getCanvas().removeEventListener("contextmenu",    this.onContextMenu as any);
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    this.deps.getCanvas().setPointerCapture(e.pointerId);

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.deps.getBuffer().push({
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
    const allowedKinds: PointerKind[] =
    this.settings.longPressPointerKinds ?? ["touch", "pen"];

    if (allowedKinds.includes(kind)) {
      this.startLongPress(e.pointerId, kind, screen, { x: e.clientX, y: e.clientY });
    }
    //if (kind !== "mouse") this.startLongPress(e.pointerId, kind, screen, { x: e.clientX, y: e.clientY });
  };

  private onPointerMove = (e: PointerEvent) => {
    e.preventDefault();

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.deps.getBuffer().push({
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
    try { this.deps.getCanvas().releasePointerCapture(e.pointerId); } catch {}

    const screen = this.getScreenFromClient(e.clientX, e.clientY);
    const kind = this.toPointerKind(e.pointerType);

    this.deps.getBuffer().push({
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

    this.deps.getBuffer().push({
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

    this.deps.getBuffer().push({
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

    //const ms = 450; // make this a setting?
    const ms = this.settings.longPressMs ?? 450; // this should always use default settings, but just in case
    this.longPressPointerId = pointerId;

    this.longPressTimer = window.setTimeout(() => {
      // Still holding same pointer? Interaction will decide what it means.
      this.deps.getBuffer().push({
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
    const rect = this.deps.getCanvas().getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const logicalWidth  = this.deps.getCanvas().width / dpr;
    const logicalHeight = this.deps.getCanvas().height / dpr;

    const scaleX = logicalWidth / rect.width;
    const scaleY = logicalHeight / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }
}
