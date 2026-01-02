import { ScreenPt, ClientPt } from '../shared/interfaces.ts';
type WheelMode = 'pan' | 'zoom';


export class WheelGestureSession {
  private mode: WheelMode | null = null;
  private timer: number | null = null;

  private panPos: ScreenPt = { x: 0, y: 0 };
  private panning = false;

  constructor(
    private onPanStart: (x: number, y: number) => void,
    private onPanMove: (x: number, y: number) => void,
    private onPanEnd: () => void,
    private onZoom: (x: number, y: number, delta: number) => void,
    private endDelayMs = 120,
  ) {}

  handle(e: WheelEvent) {
    const x = e.offsetX;
    const y = e.offsetY;

    if (this.mode == null) {
      this.mode = (e.ctrlKey || e.metaKey) ? 'zoom' : 'pan';

      if (this.mode === 'pan') {
        this.panning = true;
        this.panPos = { x, y };
        this.onPanStart(x, y);
      }
    }

    if (this.mode === 'zoom') {
      this.onZoom(x, y, Math.sign(e.deltaY));
    } else {
      // Pan via virtual cursor
      this.panPos.x -= e.deltaX;
      this.panPos.y -= e.deltaY;
      this.onPanMove(this.panPos.x, this.panPos.y);
    }

    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.end(), this.endDelayMs);
  }

  cancel() {
    this.end();
  }

  private end() {
    if (this.mode === 'pan' && this.panning) this.onPanEnd();
    this.mode = null;
    this.panning = false;
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
