import type { SessionRuntimePlatformV1 } from '../platform/index.ts';
import type { BufferedQueue } from './BufferedQueue.ts';
import type {
  GraphInputEventV1,
  GraphPointerKindV1,
  GraphScreenPointV1,
  InputGraphIdentityV1,
} from './GraphInteractionTypes.ts';

export class GraphInput {
  private longPressTimer: number | null = null;
  private longPressPointer: { readonly pointerId: number; readonly point: GraphScreenPointV1 } | null = null;
  private readonly activePointers = new Set<number>();
  private enabled = true;
  private disposed = false;

  constructor(private readonly options: {
    readonly canvas: HTMLCanvasElement;
    readonly platform: SessionRuntimePlatformV1;
    readonly events: BufferedQueue<GraphInputEventV1>;
    readonly getIdentity: () => InputGraphIdentityV1;
    readonly longPressMs?: number;
  }) {
    this.attach();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  reset(): void {
    this.clearLongPress();
    this.activePointers.clear();
    this.options.events.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.reset();
  }

  private attach(): void {
    const canvas = this.options.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu, { passive: false });
    canvas.addEventListener('keydown', this.onKeyDown);
  }

  private detach(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    try { this.options.canvas.setPointerCapture(event.pointerId); } catch {}
    this.activePointers.add(event.pointerId);
    const pointerKind = pointerKindOf(event.pointerType);
    const point = this.toScreen(event.clientX, event.clientY);
    this.push({
      ...this.base(),
      type: 'pointer-down',
      pointerId: event.pointerId,
      pointerKind,
      point,
      button: event.button,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
    if (pointerKind !== 'mouse' && this.activePointers.size === 1) {
      this.startLongPress(event.pointerId, pointerKind, point);
    } else {
      this.clearLongPress();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    const point = this.toScreen(event.clientX, event.clientY);
    if (this.longPressPointer?.pointerId === event.pointerId
      && distanceSquared(this.longPressPointer.point, point) > 36) {
      this.clearLongPress();
    }
    this.push({
      ...this.base(),
      type: 'pointer-move',
      pointerId: event.pointerId,
      pointerKind: pointerKindOf(event.pointerType),
      point,
    });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    this.activePointers.delete(event.pointerId);
    if (this.longPressPointer?.pointerId === event.pointerId) this.clearLongPress();
    try { this.options.canvas.releasePointerCapture(event.pointerId); } catch {}
    this.push({
      ...this.base(),
      type: 'pointer-up',
      pointerId: event.pointerId,
      pointerKind: pointerKindOf(event.pointerType),
      point: this.toScreen(event.clientX, event.clientY),
      button: event.button,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    this.activePointers.delete(event.pointerId);
    if (this.longPressPointer?.pointerId === event.pointerId) this.clearLongPress();
    try { this.options.canvas.releasePointerCapture(event.pointerId); } catch {}
    this.push({
      ...this.base(),
      type: 'pointer-cancel',
      pointerId: event.pointerId,
      pointerKind: pointerKindOf(event.pointerType),
      point: this.toScreen(event.clientX, event.clientY),
    });
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    this.push({
      ...this.base(),
      type: 'wheel',
      point: this.toScreen(event.clientX, event.clientY),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || this.disposed) return;
    if (event.defaultPrevented) return;
    if (isGraphKeyboardCommand(event.key)) event.preventDefault();
    this.push({
      ...this.base(),
      type: 'key-down',
      key: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
      repeat: event.repeat,
      composing: event.isComposing,
    });
  };

  private startLongPress(pointerId: number, pointerKind: GraphPointerKindV1, point: GraphScreenPointV1): void {
    this.clearLongPress();
    this.longPressPointer = { pointerId, point };
    this.longPressTimer = this.options.platform.setTimeout(() => {
      this.longPressTimer = null;
      this.longPressPointer = null;
      if (!this.enabled || this.disposed) return;
      this.push({ ...this.base(), type: 'long-press', pointerId, pointerKind, point });
    }, this.options.longPressMs ?? 450);
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) this.options.platform.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressPointer = null;
  }

  private push(event: GraphInputEventV1): void {
    this.options.events.push(event);
  }

  private base() {
    return {
      identity: { ...this.options.getIdentity() },
      timestamp: this.options.platform.now(),
    };
  }

  private toScreen(clientX: number, clientY: number): GraphScreenPointV1 {
    const bounds = this.options.canvas.getBoundingClientRect();
    const ratio = this.options.platform.devicePixelRatio;
    const logicalWidth = this.options.canvas.width / ratio;
    const logicalHeight = this.options.canvas.height / ratio;
    const scaleX = bounds.width > 0 ? logicalWidth / bounds.width : 1;
    const scaleY = bounds.height > 0 ? logicalHeight / bounds.height : 1;
    return {
      x: (clientX - bounds.left) * scaleX,
      y: (clientY - bounds.top) * scaleY,
    };
  }
}

function distanceSquared(a: GraphScreenPointV1, b: GraphScreenPointV1): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function pointerKindOf(value: string): GraphPointerKindV1 {
  if (value === 'touch' || value === 'pen') return value;
  return 'mouse';
}

function isGraphKeyboardCommand(key: string): boolean {
  return [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    '+',
    '=',
    '-',
    '_',
    '0',
    'f',
    'F',
    'Escape',
    'Enter',
  ].includes(key);
}
