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
  private mouseInside = false;
  private lastMousePoint: GraphScreenPointV1 = { x: 0, y: 0 };
  private lastMod = false;
  private lastCtrl = false;
  private lastMeta = false;
  private lastShift = false;
  private lastAlt = false;
  private physicalCtrlHeld = false;
  private spaceHeld = false;
  private longPressPointer: { readonly pointerId: number; readonly point: GraphScreenPointV1 } | null = null;
  private readonly activePointers = new Set<number>();
  private enabled = true;
  private disposed = false;

  constructor(private readonly options: {
    readonly element: HTMLElement;
    readonly platform: SessionRuntimePlatformV1;
    readonly events: BufferedQueue<GraphInputEventV1>;
    readonly getIdentity: () => InputGraphIdentityV1;
    readonly onInputQueued?: () => void;
    readonly longPressMs?: number;
  }) {
    this.attach();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  isSpaceHeld(): boolean { return this.enabled && !this.disposed && this.spaceHeld; }

  getCursorPoint(): GraphScreenPointV1 | undefined {
    return this.enabled && !this.disposed && this.mouseInside && !this.lastCtrl && !this.physicalCtrlHeld && this.activePointers.size === 0
      ? { ...this.lastMousePoint } : undefined;
  }

  reset(): void {
    this.clearLongPress();
    const pointers = [...this.activePointers];
    this.activePointers.clear();
    for (const pointerId of pointers) {
      try { this.options.element.releasePointerCapture(pointerId); } catch {}
    }
    this.mouseInside = false;
    this.lastMod = false;
    this.lastCtrl = false;
    this.lastMeta = false;
    this.lastShift = false;
    this.lastAlt = false;
    this.physicalCtrlHeld = false;
    this.spaceHeld = false;
    this.options.events.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.reset();
  }

  private attach(): void {
    const canvas = this.options.element;
    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: false });
    canvas.addEventListener('pointerleave', this.onPointerLeave, { passive: false });
    canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
    canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu, { passive: false });
    canvas.addEventListener('keydown', this.onKeyDown);
    this.options.platform.window.addEventListener('blur', this.onWindowBlur);
    this.options.platform.window.addEventListener('keyup', this.onKeyUp);
    this.options.platform.window.addEventListener('keydown', this.onModifierChange);
    this.options.platform.window.addEventListener('keyup', this.onModifierChange);
  }

  private detach(): void {
    const canvas = this.options.element;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('keydown', this.onKeyDown);
    this.options.platform.window.removeEventListener('blur', this.onWindowBlur);
    this.options.platform.window.removeEventListener('keyup', this.onKeyUp);
    this.options.platform.window.removeEventListener('keydown', this.onModifierChange);
    this.options.platform.window.removeEventListener('keyup', this.onModifierChange);
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    try { this.options.element.focus({ preventScroll: true }); } catch { this.options.element.focus(); }
    try { this.options.element.setPointerCapture(event.pointerId); } catch {}
    this.activePointers.add(event.pointerId);
    const pointerKind = pointerKindOf(event.pointerType);
    if (pointerKind !== 'mouse') this.mouseInside = false;
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
      alt: event.altKey,
    });
    if (pointerKind !== 'mouse' && this.activePointers.size === 1) {
      this.startLongPress(event.pointerId, pointerKind, point);
    } else {
      this.clearLongPress();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    if (event.pointerType !== 'mouse' && !this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    const point = this.toScreen(event.clientX, event.clientY);
    const pointerKind = pointerKindOf(event.pointerType);
    if (pointerKind !== 'mouse') this.mouseInside = false;
    if (pointerKind === 'mouse') {
      this.mouseInside = true;
      this.lastMousePoint = point;
      this.lastMod = platformMod(event, this.options.platform);
      this.lastCtrl = event.ctrlKey;
      this.lastMeta = event.metaKey;
      this.lastShift = event.shiftKey;
      this.lastAlt = event.altKey;
    }
    if (this.longPressPointer?.pointerId === event.pointerId
      && distanceSquared(this.longPressPointer.point, point) > 36) {
      this.clearLongPress();
    }
    this.push({
      ...this.base(),
      type: 'pointer-move',
      ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey,
      pointerId: event.pointerId,
      pointerKind,
      point,
      mod: platformMod(event, this.options.platform),
    });
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    const pointerKind = pointerKindOf(event.pointerType);
    if (pointerKind === 'mouse') this.mouseInside = false;
    this.push({
      ...this.base(),
      type: 'pointer-leave',
      pointerId: event.pointerId,
      pointerKind,
      point: this.toScreen(event.clientX, event.clientY),
      mod: this.lastMod,
    });
  };

  private readonly onModifierChange = (event: KeyboardEvent): void => {
    if (!this.enabled || this.disposed) return;
    if (event.key === 'Control') this.physicalCtrlHeld = event.type === 'keydown';
    const mod = platformMod(event, this.options.platform);
    const ctrl = event.ctrlKey;
    const meta = event.metaKey;
    const shift = event.shiftKey;
    const alt = event.altKey;
    if (mod === this.lastMod && meta === this.lastMeta && ctrl === this.lastCtrl && shift === this.lastShift && alt === this.lastAlt) return;
    this.lastMod = mod;
    this.lastCtrl = ctrl;
    this.lastMeta = meta;
    this.lastShift = shift;
    this.lastAlt = alt;
    if (!this.mouseInside && (mod || ctrl || shift || alt)) return;
    this.push({
      ...this.base(),
      type: 'modifier-change',
      meta,
      point: this.lastMousePoint,
      mod,
      ctrl,
      shift,
      alt,
      pointerInside: this.mouseInside,
    });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    this.activePointers.delete(event.pointerId);
    if (this.longPressPointer?.pointerId === event.pointerId) this.clearLongPress();
    try { this.options.element.releasePointerCapture(event.pointerId); } catch {}
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
      alt: event.altKey,
    });
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed) return;
    event.preventDefault();
    if (this.activePointers.has(event.pointerId)) this.cancelInput();
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    if (!this.enabled || this.disposed || !this.activePointers.has(event.pointerId)) return;
    this.cancelInput();
  };

  private cancelInput(): void {
    // Preserve queued gesture events so cancellation also works before a frame.
    const pointers = [...this.activePointers];
    this.activePointers.clear();
    this.clearLongPress();
    this.mouseInside = false;
    this.lastMod = this.lastCtrl = this.lastMeta = this.lastShift = this.lastAlt = false;
    this.physicalCtrlHeld = this.spaceHeld = false;
    for (const pointerId of pointers) {
      try { this.options.element.releasePointerCapture(pointerId); } catch {}
    }
    this.push({ ...this.base(), type: 'cancel-input' });
  }

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
      physicalCtrl: this.physicalCtrlHeld,
      meta: event.metaKey,
      shift: event.shiftKey,
    });
  };

  private readonly onWindowBlur = (): void => {
    if (this.enabled && !this.disposed) this.cancelInput();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || this.disposed) return;
    if (event.defaultPrevented) return;
    if (isGraphKeyboardCommand(event.key)) event.preventDefault();
    if ((event.key === ' ' || event.key === 'Spacebar') && !event.isComposing
      && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) this.spaceHeld = true;
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

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.enabled || this.disposed) return;
    if ((event.key !== ' ' && event.key !== 'Spacebar') || !this.spaceHeld) return;
    this.spaceHeld = false;
    event.preventDefault();
    this.push({
      ...this.base(),
      type: 'key-up',
      key: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
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

  cancelLongPress(): void {
    this.clearLongPress();
  }

  private push(event: GraphInputEventV1): void {
    this.options.events.push(event);
    this.options.onInputQueued?.();
  }

  private base() {
    return {
      identity: { ...this.options.getIdentity() },
      timestamp: this.options.platform.now(),
    };
  }

  private toScreen(clientX: number, clientY: number): GraphScreenPointV1 {
    const bounds = this.options.element.getBoundingClientRect();
    const safeClientX = Number.isFinite(clientX) ? clientX : bounds.left + bounds.width / 2;
    const safeClientY = Number.isFinite(clientY) ? clientY : bounds.top + bounds.height / 2;
    return {
      x: safeClientX - bounds.left,
      y: safeClientY - bounds.top,
    };
  }
}

function platformMod(event: MouseEvent | PointerEvent | KeyboardEvent, platform: SessionRuntimePlatformV1): boolean {
  return platform.isMacOS ? event.metaKey : event.ctrlKey;
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
    'Escape',
    'Enter',
    ' ',
    'Spacebar',
  ].includes(key);
}
