export type ActivePointer = {
  id: number;
  pointerType: 'mouse' | 'touch' | 'pen';
  clientX: number;
  clientY: number;
  startClientX: number;
  startClientY: number;
  buttons: number;
  button: number;
};

export class PointerTracker {
  private pointers = new Map<number, ActivePointer>();

  upsert(e: PointerEvent) {
    const pointerType =
      (e.pointerType === 'touch' || e.pointerType === 'pen' || e.pointerType === 'mouse'
        ? e.pointerType
        : 'mouse') as ActivePointer['pointerType'];

    const existing = this.pointers.get(e.pointerId);

    const record: ActivePointer = existing ?? {
      id: e.pointerId,
      pointerType,
      clientX: e.clientX,
      clientY: e.clientY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      buttons: e.buttons,
      button: e.button,
    };

    record.clientX = e.clientX;
    record.clientY = e.clientY;
    record.buttons = e.buttons;
    record.button = e.button;

    this.pointers.set(e.pointerId, record);
  }

  delete(pointerId: number) {
    this.pointers.delete(pointerId);
  }

  size() {
    return this.pointers.size;
  }

  values() {
    return Array.from(this.pointers.values());
  }

  two(): [ActivePointer, ActivePointer] | null {
    if (this.pointers.size !== 2) return null;
    const arr = Array.from(this.pointers.values());
    return [arr[0], arr[1]];
  }

  first(): ActivePointer | null {
    return this.values()[0] ?? null;
  }

  get(id: number): ActivePointer | undefined {
    return this.pointers.get(id);
  }

  set(id: number, pointer: ActivePointer) {
    this.pointers.set(id, pointer);
  }
}
