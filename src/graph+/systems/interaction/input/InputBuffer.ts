import { InputEvent } from "../../../grammar/interfaces.js";


export class InputBuffer {
  private q: InputEvent[] = [];
  push(e: InputEvent) { this.q.push(e); }
  drain(): InputEvent[] { const out = this.q; this.q = []; return out; }
  clear() { this.q = []; }
}
