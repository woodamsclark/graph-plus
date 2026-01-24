// InputBuffer.ts
import type { InputEvent } from "./input_types.ts";

export class InputBuffer {
  private buf: InputEvent[] = [];

  push(e: InputEvent) {
    this.buf.push(e);
  }

  drain(): InputEvent[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  clear() {
    this.buf = [];
  }
}
